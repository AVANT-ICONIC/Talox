import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createLocalVisionReasoner,
	type LocalVisionConfig,
	type OllamaVisionConfig,
	type OpenAICompatibleLocalVisionConfig,
} from "../../src/core/LocalVisionReasoner.js";

afterEach(() => {
	vi.unstubAllGlobals();
});

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("createLocalVisionReasoner", () => {
	it("uses Ollama vision on loopback by default", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ message: { content: "  submit button  " } }));
		vi.stubGlobal("fetch", fetchMock);
		const reasoner = createLocalVisionReasoner({ model: "gemma4" });

		await expect(reasoner.analyze(Buffer.from("png-bytes"), "What is visible?")).resolves.toBe("submit button");
		expect(reasoner.name).toBe("Local VLM · Ollama (gemma4)");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("http://127.0.0.1:11434/api/chat");
		const body = JSON.parse(String(init?.body));
		expect(body).toEqual({
			model: "gemma4",
			messages: [
				{
					role: "user",
					content: "What is visible?",
					images: [Buffer.from("png-bytes").toString("base64")],
				},
			],
			stream: false,
		});
	});

	it("forwards Ollama token and keep-alive options", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ message: { content: "ok" } }));
		vi.stubGlobal("fetch", fetchMock);
		const reasoner = createLocalVisionReasoner({ model: "vision", maxTokens: 128, keepAlive: "10m" });
		await reasoner.analyze(Buffer.from("x"), "inspect");
		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(body.options).toEqual({ num_predict: 128 });
		expect(body.keep_alive).toBe("10m");
	});

	it("snapshots Ollama config so caller mutation cannot change requests", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ message: { content: "ok" } }));
		vi.stubGlobal("fetch", fetchMock);
		const config: OllamaVisionConfig = { model: "stable-model", maxTokens: 64, keepAlive: "5m" };
		const reasoner = createLocalVisionReasoner(config);
		config.model = "mutated-model";
		config.maxTokens = 999;
		config.keepAlive = "0";

		await reasoner.analyze(Buffer.from("x"), "inspect");
		const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(body.model).toBe("stable-model");
		expect(body.options).toEqual({ num_predict: 64 });
		expect(body.keep_alive).toBe("5m");
	});

	it("supports an OpenAI-compatible local multimodal server", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: " found it " } }] }));
		vi.stubGlobal("fetch", fetchMock);
		const reasoner = createLocalVisionReasoner({
			provider: "openai-compatible",
			model: "local-vlm",
			baseUrl: "http://localhost:1234/v1/",
			apiKey: "local-key",
			maxTokens: 222,
		});

		await expect(reasoner.analyze(Buffer.from("image"), "Find target")).resolves.toBe("found it");
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe("http://localhost:1234/v1/chat/completions");
		expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer local-key");
		const body = JSON.parse(String(init?.body));
		expect(body.model).toBe("local-vlm");
		expect(body.max_tokens).toBe(222);
		expect(body.messages[0].content[0]).toEqual({ type: "text", text: "Find target" });
		expect(body.messages[0].content[1].image_url.url).toBe(
			`data:image/png;base64,${Buffer.from("image").toString("base64")}`,
		);
	});

	it("snapshots OpenAI-compatible credentials and generation config", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
		vi.stubGlobal("fetch", fetchMock);
		const config: OpenAICompatibleLocalVisionConfig = {
			provider: "openai-compatible",
			model: "stable-vlm",
			baseUrl: "http://127.0.0.1:1234/v1",
			apiKey: "stable-key",
			maxTokens: 111,
		};
		const reasoner = createLocalVisionReasoner(config);
		config.model = "mutated-vlm";
		config.apiKey = "mutated-key";
		config.maxTokens = 999;

		await reasoner.analyze(Buffer.from("image"), "Find target");
		const [, init] = fetchMock.mock.calls[0]!;
		expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer stable-key");
		const body = JSON.parse(String(init?.body));
		expect(body.model).toBe("stable-vlm");
		expect(body.max_tokens).toBe(111);
	});

	it("omits Authorization when no local API key is configured", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ choices: [] }));
		vi.stubGlobal("fetch", fetchMock);
		const reasoner = createLocalVisionReasoner({
			provider: "openai-compatible",
			model: "local-vlm",
			baseUrl: "http://127.0.0.1:8080/v1",
		});
		await expect(reasoner.analyze(Buffer.from("x"), "q")).resolves.toBeNull();
		expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>).Authorization).toBeUndefined();
	});

	it("refuses non-loopback endpoints by default", () => {
		expect(() => createLocalVisionReasoner({ model: "vision", baseUrl: "https://vlm.example.com" })).toThrow(
			/non-loopback/,
		);
		expect(() =>
			createLocalVisionReasoner({
				provider: "openai-compatible",
				model: "vision",
				baseUrl: "http://192.168.1.25:8000/v1",
			}),
		).toThrow(/allowRemote/);
	});

	it("allows an intentional remote endpoint only with explicit opt-in", async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ message: { content: "lan result" } }));
		vi.stubGlobal("fetch", fetchMock);
		const reasoner = createLocalVisionReasoner({
			model: "vision",
			baseUrl: "http://192.168.1.25:11434",
			allowRemote: true,
		});
		await expect(reasoner.analyze(Buffer.from("x"), "q")).resolves.toBe("lan result");
	});

	it("accepts standard IPv4 and IPv6 loopback URLs", () => {
		expect(() => createLocalVisionReasoner({ model: "vision", baseUrl: "http://127.7.8.9:11434" })).not.toThrow();
		expect(() => createLocalVisionReasoner({ model: "vision", baseUrl: "http://[::1]:11434" })).not.toThrow();
		expect(() => createLocalVisionReasoner({ model: "vision", baseUrl: "http://vision.localhost:11434" })).not.toThrow();
	});

	it("validates model, timeout, token limit, flags, keep-alive, and URL protocol", () => {
		expect(() => createLocalVisionReasoner({ model: "" })).toThrow(/model/);
		expect(() => createLocalVisionReasoner({ model: "vision", timeoutMs: 0 })).toThrow(/timeoutMs/);
		expect(() => createLocalVisionReasoner({ model: "vision", maxTokens: Number.NaN })).toThrow(/maxTokens/);
		expect(() => createLocalVisionReasoner({ model: "vision", baseUrl: "file:///tmp/model" })).toThrow(/http or https/);
		expect(() =>
			createLocalVisionReasoner({ model: "vision", allowRemote: "yes" } as unknown as LocalVisionConfig),
		).toThrow(/allowRemote/);
		expect(() =>
			createLocalVisionReasoner({ model: "vision", keepAlive: {} } as unknown as LocalVisionConfig),
		).toThrow(/keepAlive/);
	});

	it("reports local server HTTP failures without swallowing them", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("model missing", { status: 404 })));
		const reasoner = createLocalVisionReasoner({ model: "missing" });
		await expect(reasoner.analyze(Buffer.from("x"), "q")).rejects.toThrow(/HTTP 404: model missing/);
	});

	it("reports malformed local server JSON clearly", async () => {
		vi.stubGlobal("fetch", vi.fn(async () => new Response("definitely-not-json", { status: 200 })));
		const reasoner = createLocalVisionReasoner({ model: "vision" });
		await expect(reasoner.analyze(Buffer.from("x"), "q")).rejects.toThrow(/invalid JSON/);
	});

	it("normalizes timeout errors", async () => {
		const timeout = new Error("timed out");
		timeout.name = "TimeoutError";
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw timeout;
			}),
		);
		const reasoner = createLocalVisionReasoner({ model: "vision", timeoutMs: 25 });
		await expect(reasoner.analyze(Buffer.from("x"), "q")).rejects.toThrow(/timed out after 25ms/);
	});
});

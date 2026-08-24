import { Readable, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { TaloxMcpSession, TaloxMcpStdioServer, TALOX_MCP_TOOLS } from "../../src/core/mcp/TaloxMcpServer.js";

class FakeController {
	launchCalls: Array<[string, string, string | undefined]> = [];
	stopCalls = 0;
	navigateCalls: string[] = [];
	clickCalls: string[] = [];
	typeCalls: Array<[string, string]> = [];
	stateVariants: Array<"full" | "agent" | "debug" | undefined> = [];

	async launch(profileId: string, profileClass: "ops" | "qa" | "sandbox", browser?: "chromium" | "firefox" | "webkit") {
		this.launchCalls.push([profileId, profileClass, browser]);
	}

	async stop() {
		this.stopCalls += 1;
	}

	async navigate(url: string) {
		this.navigateCalls.push(url);
		return { url, title: "Example" };
	}

	async click(selector: string) {
		this.clickCalls.push(selector);
		return { url: "https://example.com/clicked", title: "Clicked" };
	}

	async type(selector: string, text: string) {
		this.typeCalls.push([selector, text]);
		return { url: "https://example.com/form", title: "Form" };
	}

	async getState(variant?: "full" | "agent" | "debug") {
		this.stateVariants.push(variant);
		return { url: "https://example.com", title: "Example", nodes: [], variant };
	}

	async screenshot() {
		return Buffer.from("fake-png");
	}
}

function request(id: number, method: string, params?: Record<string, unknown>) {
	return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

function toolCall(id: number, name: string, args: Record<string, unknown> = {}) {
	return request(id, "tools/call", { name, arguments: args });
}

describe("TaloxMcpSession", () => {
	it("advertises the modern 2026-07-28 MCP era", async () => {
		const session = new TaloxMcpSession(() => new FakeController());
		const response = await session.handle(request(1, "server/discover"));

		expect(response).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				resultType: "complete",
				supportedVersions: ["2026-07-28"],
				capabilities: { tools: { listChanged: false } },
				ttlMs: 60_000,
				cacheScope: "public",
				_meta: { "io.modelcontextprotocol/serverInfo": { name: "talox", version: "8.1.0" } },
			},
		});
	});

	it("keeps handshake-era compatibility for legacy MCP clients", async () => {
		const session = new TaloxMcpSession(() => new FakeController());
		const initialized = await session.handle(
			request(1, "initialize", {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "test", version: "1" },
			}),
		);
		const tools = await session.handle(request(2, "tools/list"));

		expect(initialized).toMatchObject({ result: { protocolVersion: "2025-06-18" } });
		expect(tools).toMatchObject({ result: { tools: TALOX_MCP_TOOLS } });
		expect(JSON.stringify(tools)).not.toContain("ttlMs");
	});

	it("adds required cache hints to modern tools/list responses", async () => {
		const session = new TaloxMcpSession(() => new FakeController());
		await session.handle(request(1, "server/discover"));
		const response = await session.handle(request(2, "tools/list"));

		expect(response).toMatchObject({
			result: {
				tools: TALOX_MCP_TOOLS,
				resultType: "complete",
				ttlMs: 60_000,
				cacheScope: "public",
				_meta: { "io.modelcontextprotocol/serverInfo": { name: "talox", version: "8.1.0" } },
			},
		});
	});

	it("stamps modern results when the request carries the protocol envelope directly", async () => {
		const session = new TaloxMcpSession(() => new FakeController());
		const response = await session.handle(
			request(1, "tools/list", {
				_meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
			}),
		);

		expect(response).toMatchObject({
			result: {
				resultType: "complete",
				_meta: { "io.modelcontextprotocol/serverInfo": { name: "talox", version: "8.1.0" } },
			},
		});
	});

	it("rejects legacy ping in the modern protocol era", async () => {
		const session = new TaloxMcpSession(() => new FakeController());
		const response = await session.handle(
			request(1, "ping", {
				_meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
			}),
		);

		expect(response).toMatchObject({ error: { code: -32601 } });
	});

	it("rejects unknown tools as protocol InvalidParams", async () => {
		const session = new TaloxMcpSession(() => new FakeController());
		const response = await session.handle(toolCall(1, "talox_definitely_missing"));

		expect(response).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			error: { code: -32602, message: expect.stringContaining("Unknown Talox tool") },
		});
	});

	it("rejects invalid JSON-RPC ids", async () => {
		const session = new TaloxMcpSession(() => new FakeController());
		const response = await session.handle({ jsonrpc: "2.0", id: { nope: true }, method: "tools/list" });

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32600, message: "Invalid Request" },
		});
	});

	it("requires launch before browser-scoped tool calls", async () => {
		const session = new TaloxMcpSession(() => new FakeController());
		const response = await session.handle(toolCall(1, "talox_navigate", { url: "https://example.com" }));

		expect(response).toMatchObject({
			result: {
				isError: true,
				content: [{ type: "text", text: expect.stringContaining("talox_launch") }],
			},
		});
	});

	it("defaults talox_state to the compact agent variant", async () => {
		const fake = new FakeController();
		const session = new TaloxMcpSession(() => fake);
		await session.handle(toolCall(1, "talox_launch"));
		const response = await session.handle(toolCall(2, "talox_state"));

		expect(fake.stateVariants).toEqual(["agent"]);
		expect(response).toMatchObject({ result: { content: [{ type: "text", text: expect.stringContaining('"variant": "agent"') }] } });
	});

	it("rejects extra tool arguments declared outside the schema", async () => {
		const fake = new FakeController();
		const session = new TaloxMcpSession(() => fake);
		await session.handle(toolCall(1, "talox_launch"));
		const response = await session.handle(toolCall(2, "talox_state", { surprise: true }));

		expect(response).toMatchObject({
			result: {
				isError: true,
				content: [{ type: "text", text: expect.stringContaining("Unexpected argument") }],
			},
		});
		expect(fake.stateVariants).toEqual([]);
	});

	it("runs a persistent browser session across MCP tool calls", async () => {
		const fake = new FakeController();
		const session = new TaloxMcpSession(() => fake);

		const launch = await session.handle(
			toolCall(1, "talox_launch", { profileId: "agent-a", profileClass: "qa", browser: "chromium" }),
		);
		const navigate = await session.handle(toolCall(2, "talox_navigate", { url: "https://example.com" }));
		const screenshot = await session.handle(toolCall(3, "talox_screenshot"));
		const stop = await session.handle(toolCall(4, "talox_stop"));

		expect(launch).toMatchObject({ result: { content: [{ type: "text", text: expect.stringContaining('"launched": true') }] } });
		expect(fake.launchCalls).toEqual([["agent-a", "qa", "chromium"]]);
		expect(fake.navigateCalls).toEqual(["https://example.com"]);
		expect(navigate).toMatchObject({ result: { content: [{ type: "text", text: expect.stringContaining("Example") }] } });
		expect(screenshot).toMatchObject({
			result: { content: [{ type: "image", data: Buffer.from("fake-png").toString("base64"), mimeType: "image/png" }] },
		});
		expect(stop).toMatchObject({ result: { content: [{ type: "text", text: expect.stringContaining('"stopped": true') }] } });
		expect(fake.stopCalls).toBe(1);
	});

	it("returns JSON-RPC method errors instead of throwing", async () => {
		const session = new TaloxMcpSession(() => new FakeController());
		const response = await session.handle(request(7, "made/up"));

		expect(response).toEqual({
			jsonrpc: "2.0",
			id: 7,
			error: { code: -32601, message: "Method not found: made/up" },
		});
	});
});

describe("TaloxMcpStdioServer", () => {
	it("emits newline-delimited JSON-RPC and stays silent for notifications", async () => {
		const input = Readable.from([
			`${JSON.stringify(request(1, "server/discover"))}\n`,
			`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1 } })}\n`,
		]);
		let output = "";
		const sink = new Writable({
			write(chunk, _encoding, callback) {
				output += chunk.toString();
				callback();
			},
		});
		const server = new TaloxMcpStdioServer(new TaloxMcpSession(() => new FakeController()), input, sink);

		await server.run();

		const lines = output.trim().split("\n");
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ id: 1, result: { supportedVersions: ["2026-07-28"] } });
	});

	it("returns a JSON-RPC parse error for malformed input", async () => {
		const input = Readable.from(["{definitely-not-json}\n"]);
		let output = "";
		const sink = new Writable({
			write(chunk, _encoding, callback) {
				output += chunk.toString();
				callback();
			},
		});
		const server = new TaloxMcpStdioServer(new TaloxMcpSession(() => new FakeController()), input, sink);

		await server.run();

		expect(JSON.parse(output.trim())).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: { code: -32700, message: "Parse error" },
		});
	});
});

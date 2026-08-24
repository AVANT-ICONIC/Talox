import { describe, expect, it } from "vitest";
import { TaloxMcpSession, TALOX_MCP_TOOLS } from "../../src/core/mcp/TaloxMcpServer.js";

class FakeController {
	launchCalls: Array<[string, string, string | undefined]> = [];
	stopCalls = 0;
	navigateCalls: string[] = [];
	clickCalls: string[] = [];
	typeCalls: Array<[string, string]> = [];

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

	async getState() {
		return { url: "https://example.com", title: "Example", nodes: [] };
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
			request(1, "ping", {
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

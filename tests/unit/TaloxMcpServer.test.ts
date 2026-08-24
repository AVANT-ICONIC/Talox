import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import type { DaemonResponse } from "../../src/core/daemon/TaloxDaemon.js";
import {
	createTaloxMcpServer,
	daemonResponseToMcpToolResult,
} from "../../src/core/mcp/TaloxMcpServer.js";
import { TaloxMcpRuntime } from "../../src/core/mcp/TaloxMcpRuntime.js";

function response(partial: Partial<DaemonResponse>): DaemonResponse {
	return { id: "request", success: true, ...partial };
}

describe("TaloxMcpServer", () => {
	it("constructs an MCP v2 server around a supplied runtime", () => {
		const server = createTaloxMcpServer(new TaloxMcpRuntime());
		expect(server).toBeInstanceOf(McpServer);
	});

	it("converts structured command success into text and structuredContent", () => {
		const result = daemonResponseToMcpToolResult(
			response({ data: { url: "https://example.com", title: "Example" } }),
		);

		expect(result.isError).not.toBe(true);
		expect(result.content[0]).toMatchObject({ type: "text" });
		expect(result.structuredContent).toEqual({ url: "https://example.com", title: "Example" });
	});

	it("returns browser buffers as MCP image content", () => {
		const result = daemonResponseToMcpToolResult(
			response({ data: { encoding: "base64", data: Buffer.from("png").toString("base64") } }),
		);

		expect(result.isError).not.toBe(true);
		expect(result.content[0]).toMatchObject({
			type: "image",
			mimeType: "image/png",
		});
	});

	it("marks daemon failures as MCP tool errors", () => {
		const result = daemonResponseToMcpToolResult({ id: "request", success: false, error: "Session not found" });

		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ type: "text", text: "Session not found" });
	});
});

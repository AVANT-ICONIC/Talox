/**
 * MCP stdio bridge for Talox.
 *
 * This intentionally has no dependency on the MCP SDK so Talox keeps its
 * dependency graph stable. It supports both the handshake-era protocol used by
 * 2025 clients and the stateless 2026-07-28 discovery flow over stdio.
 */

import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { ProfileClass } from "../../types/index.js";
import type { BrowserType } from "../BrowserManager.js";
import { TaloxController } from "../controller/TaloxController.js";

const MODERN_PROTOCOL_VERSION = "2026-07-28";
const LEGACY_PROTOCOL_VERSION = "2025-11-25";
const LEGACY_PROTOCOL_VERSIONS = new Set(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
const SERVER_INFO = { name: "talox", version: "8.1.0" } as const;
const SERVER_INSTRUCTIONS =
	"Use Talox tools to launch and control one persistent browser session. Launch before navigation or interaction, then stop when finished.";

export type JsonRpcId = string | number | null;

type JsonRpcResponse =
	| { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
	| { jsonrpc: "2.0"; id: JsonRpcId; error: { code: number; message: string; data?: unknown } };

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: JsonRpcId;
	method: string;
	params?: unknown;
}

interface McpController {
	launch(profileId: string, profileClass: ProfileClass, browserType?: BrowserType): Promise<void>;
	stop(): Promise<void>;
	navigate(url: string): Promise<{ url: string; title?: string }>;
	click(selector: string): Promise<{ url: string; title?: string }>;
	type(selector: string, text: string): Promise<{ url: string; title?: string }>;
	getState(variant?: "full" | "agent" | "debug"): Promise<unknown>;
	screenshot(options?: { selector?: string; path?: string }): Promise<Buffer | string>;
}

export type McpControllerFactory = () => McpController;

type ProtocolEra = "unknown" | "legacy" | "modern";

type ToolContent =
	| { type: "text"; text: string }
	| { type: "image"; data: string; mimeType: string };

interface ToolCallResult {
	content: ToolContent[];
	isError?: boolean;
}

export const TALOX_MCP_TOOLS = [
	{
		name: "talox_launch",
		description: "Launch a persistent Talox browser session.",
		inputSchema: {
			type: "object",
			properties: {
				profileId: { type: "string", description: "Persistent profile ID. Defaults to mcp." },
				profileClass: {
					type: "string",
					enum: ["ops", "qa", "sandbox"],
					description: "Talox profile class. Defaults to ops.",
				},
				browser: {
					type: "string",
					enum: ["chromium", "firefox", "webkit"],
					description: "Browser engine. Defaults to chromium.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "talox_navigate",
		description: "Navigate the active Talox browser session to a URL.",
		inputSchema: {
			type: "object",
			properties: { url: { type: "string", minLength: 1 } },
			required: ["url"],
			additionalProperties: false,
		},
	},
	{
		name: "talox_click",
		description: "Click an element in the active Talox browser session.",
		inputSchema: {
			type: "object",
			properties: { selector: { type: "string", minLength: 1 } },
			required: ["selector"],
			additionalProperties: false,
		},
	},
	{
		name: "talox_type",
		description: "Type text into an element in the active Talox browser session.",
		inputSchema: {
			type: "object",
			properties: {
				selector: { type: "string", minLength: 1 },
				text: { type: "string" },
			},
			required: ["selector", "text"],
			additionalProperties: false,
		},
	},
	{
		name: "talox_state",
		description: "Return Talox's structured page state. Defaults to compact agent state to minimize context usage.",
		inputSchema: {
			type: "object",
			properties: {
				variant: {
					type: "string",
					enum: ["agent", "debug", "full"],
					description: "State detail level. Defaults to agent.",
				},
			},
			additionalProperties: false,
		},
	},
	{
		name: "talox_screenshot",
		description: "Capture a PNG screenshot of the full page or one selector.",
		inputSchema: {
			type: "object",
			properties: { selector: { type: "string", minLength: 1 } },
			additionalProperties: false,
		},
	},
	{
		name: "talox_stop",
		description: "Stop the active Talox browser session and release its resources.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
	},
] as const;

function defaultControllerFactory(): McpController {
	return new TaloxController(process.cwd());
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
	return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function unexpectedArgument(args: Record<string, unknown>, allowed: readonly string[]): string | null {
	const extra = Object.keys(args).filter((key) => !allowed.includes(key));
	return extra.length > 0 ? `Unexpected argument${extra.length === 1 ? "" : "s"}: ${extra.join(", ")}.` : null;
}

function textResult(value: unknown): ToolCallResult {
	const serialized = JSON.stringify(value, null, 2);
	const text = typeof value === "string" ? value : (serialized ?? String(value));
	return { content: [{ type: "text", text }] };
}

function toolError(message: string): ToolCallResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

function rpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
	const error: { code: number; message: string; data?: unknown } = { code, message };
	if (data !== undefined) error.data = data;
	return { jsonrpc: "2.0", id, error };
}

function requestedModernProtocol(params: unknown): boolean {
	if (!isRecord(params)) return false;
	const meta = params["_meta"];
	if (!isRecord(meta)) return false;
	return meta["io.modelcontextprotocol/protocolVersion"] === MODERN_PROTOCOL_VERSION;
}

export class TaloxMcpSession {
	private readonly controllerFactory: McpControllerFactory;
	private controller: McpController | null = null;
	private era: ProtocolEra = "unknown";

	constructor(controllerFactory: McpControllerFactory = defaultControllerFactory) {
		this.controllerFactory = controllerFactory;
	}

	async handle(input: unknown): Promise<JsonRpcResponse | null> {
		if (!isRecord(input)) return rpcError(null, -32600, "Invalid Request");

		const hasId = Object.hasOwn(input, "id");
		const rawId = hasId ? input["id"] : undefined;
		if (hasId && !isJsonRpcId(rawId)) return rpcError(null, -32600, "Invalid Request");
		const id = rawId as JsonRpcId | undefined;
		const method = input["method"];
		if (input["jsonrpc"] !== "2.0" || typeof method !== "string") {
			return rpcError(id ?? null, -32600, "Invalid Request");
		}

		const request: JsonRpcRequest = {
			jsonrpc: "2.0",
			method,
		};
		if (id !== undefined) request.id = id;
		if (Object.hasOwn(input, "params")) request.params = input["params"];

		if (request.id === undefined) {
			return this.handleNotification(request);
		}

		if (requestedModernProtocol(request.params) && this.era === "unknown") {
			this.era = "modern";
		}

		switch (request.method) {
			case "server/discover":
				return this.handleDiscover(request.id);
			case "initialize":
				return this.handleInitialize(request.id, request.params);
			case "ping":
				if (this.isModern(request.params)) {
					return rpcError(request.id, -32601, "Method not supported by MCP 2026-07-28: ping");
				}
				return rpcResult(request.id, {});
			case "tools/list":
				return rpcResult(request.id, this.completeResult(this.handleToolsList(request.params), request.params));
			case "tools/call":
				if (!isRecord(request.params) || typeof request.params["name"] !== "string") {
					return rpcError(request.id, -32602, "Invalid tools/call parameters: missing tool name.");
				}
				const toolName = request.params["name"];
				if (!TALOX_MCP_TOOLS.some((tool) => tool.name === toolName)) {
					return rpcError(request.id, -32602, `Unknown Talox tool: ${toolName}`);
				}
				return rpcResult(request.id, this.completeResult(await this.handleToolCall(request.params), request.params));
			default:
				return rpcError(request.id, -32601, `Method not found: ${request.method}`);
		}
	}

	async close(): Promise<void> {
		if (!this.controller) return;
		const controller = this.controller;
		this.controller = null;
		await controller.stop();
	}

	private handleNotification(request: JsonRpcRequest): null {
		// MCP lifecycle/cancellation notifications require no response. Unknown
		// notifications are also ignored per JSON-RPC notification semantics.
		if (request.method === "notifications/initialized" && this.era === "unknown") {
			this.era = "legacy";
		}
		return null;
	}

	private handleDiscover(id: JsonRpcId): JsonRpcResponse {
		this.era = "modern";
		return rpcResult(
			id,
			this.completeResult(
				{
					supportedVersions: [MODERN_PROTOCOL_VERSION],
					capabilities: { tools: { listChanged: false } },
					instructions: SERVER_INSTRUCTIONS,
					ttlMs: 60_000,
					cacheScope: "public",
				},
				undefined,
			),
		);
	}

	private handleInitialize(id: JsonRpcId, params: unknown): JsonRpcResponse {
		this.era = "legacy";
		const requested = isRecord(params) ? params["protocolVersion"] : undefined;
		const protocolVersion =
			typeof requested === "string" && LEGACY_PROTOCOL_VERSIONS.has(requested)
				? requested
				: LEGACY_PROTOCOL_VERSION;
		return rpcResult(id, {
			protocolVersion,
			capabilities: { tools: { listChanged: false } },
			serverInfo: SERVER_INFO,
			instructions: SERVER_INSTRUCTIONS,
		});
	}

	private handleToolsList(params: unknown): Record<string, unknown> {
		const result: Record<string, unknown> = { tools: TALOX_MCP_TOOLS };
		if (this.isModern(params)) {
			result["resultType"] = "complete";
			result["ttlMs"] = 60_000;
			result["cacheScope"] = "public";
		}
		return result;
	}

	private completeResult(result: object, params: unknown): object {
		if (!this.isModern(params)) return result;
		const record = result as Record<string, unknown>;
		const existingMeta = isRecord(record["_meta"]) ? record["_meta"] : {};
		return {
			...result,
			resultType: record["resultType"] ?? "complete",
			_meta: {
				...existingMeta,
				"io.modelcontextprotocol/serverInfo": existingMeta["io.modelcontextprotocol/serverInfo"] ?? SERVER_INFO,
			},
		};
	}

	private isModern(params: unknown): boolean {
		return this.era === "modern" || requestedModernProtocol(params);
	}

	private async handleToolCall(params: unknown): Promise<ToolCallResult> {
		if (!isRecord(params) || typeof params["name"] !== "string") {
			return toolError("Invalid tools/call parameters: missing tool name.");
		}
		const args = params["arguments"];
		if (args !== undefined && !isRecord(args)) {
			return toolError("Invalid tools/call parameters: arguments must be an object.");
		}
		const input = isRecord(args) ? args : {};

		try {
			switch (params["name"]) {
				case "talox_launch":
					return await this.launch(input);
				case "talox_navigate":
					return await this.navigate(input);
				case "talox_click":
					return await this.click(input);
				case "talox_type":
					return await this.type(input);
				case "talox_state":
					return await this.state(input);
				case "talox_screenshot":
					return await this.screenshot(input);
				case "talox_stop":
					return await this.stop();
				default:
					return toolError(`Unknown Talox tool: ${params["name"]}`);
			}
		} catch (error: unknown) {
			return toolError(error instanceof Error ? error.message : String(error));
		}
	}

	private async launch(args: Record<string, unknown>): Promise<ToolCallResult> {
		const extra = unexpectedArgument(args, ["profileId", "profileClass", "browser"]);
		if (extra) return toolError(extra);
		if (this.controller) return toolError("A Talox MCP browser session is already active. Stop it before relaunching.");

		const profileId = args["profileId"] ?? "mcp";
		const profileClass = args["profileClass"] ?? "ops";
		const browser = args["browser"] ?? "chromium";
		if (typeof profileId !== "string" || profileId.length === 0) return toolError("profileId must be a non-empty string.");
		if (profileClass !== "ops" && profileClass !== "qa" && profileClass !== "sandbox") {
			return toolError("profileClass must be one of: ops, qa, sandbox.");
		}
		if (browser !== "chromium" && browser !== "firefox" && browser !== "webkit") {
			return toolError("browser must be one of: chromium, firefox, webkit.");
		}

		const controller = this.controllerFactory();
		try {
			await controller.launch(profileId, profileClass, browser);
			this.controller = controller;
			return textResult({ launched: true, profileId, profileClass, browser });
		} catch (error: unknown) {
			await controller.stop().catch(() => undefined);
			throw error;
		}
	}

	private async navigate(args: Record<string, unknown>): Promise<ToolCallResult> {
		const extra = unexpectedArgument(args, ["url"]);
		if (extra) return toolError(extra);
		const controller = this.requireController();
		const url = args["url"];
		if (typeof url !== "string" || url.length === 0) return toolError("url must be a non-empty string.");
		return textResult(await controller.navigate(url));
	}

	private async click(args: Record<string, unknown>): Promise<ToolCallResult> {
		const extra = unexpectedArgument(args, ["selector"]);
		if (extra) return toolError(extra);
		const controller = this.requireController();
		const selector = args["selector"];
		if (typeof selector !== "string" || selector.length === 0) return toolError("selector must be a non-empty string.");
		return textResult(await controller.click(selector));
	}

	private async type(args: Record<string, unknown>): Promise<ToolCallResult> {
		const extra = unexpectedArgument(args, ["selector", "text"]);
		if (extra) return toolError(extra);
		const controller = this.requireController();
		const selector = args["selector"];
		const text = args["text"];
		if (typeof selector !== "string" || selector.length === 0) return toolError("selector must be a non-empty string.");
		if (typeof text !== "string") return toolError("text must be a string.");
		return textResult(await controller.type(selector, text));
	}

	private async state(args: Record<string, unknown>): Promise<ToolCallResult> {
		const extra = unexpectedArgument(args, ["variant"]);
		if (extra) return toolError(extra);
		const variant = args["variant"] ?? "agent";
		if (variant !== "agent" && variant !== "debug" && variant !== "full") {
			return toolError("variant must be one of: agent, debug, full.");
		}
		return textResult(await this.requireController().getState(variant));
	}

	private async screenshot(args: Record<string, unknown>): Promise<ToolCallResult> {
		const extra = unexpectedArgument(args, ["selector"]);
		if (extra) return toolError(extra);
		const controller = this.requireController();
		const selector = args["selector"];
		if (selector !== undefined && (typeof selector !== "string" || selector.length === 0)) {
			return toolError("selector must be a non-empty string when provided.");
		}
		const result = await controller.screenshot(typeof selector === "string" ? { selector } : undefined);
		if (Buffer.isBuffer(result)) {
			return { content: [{ type: "image", data: result.toString("base64"), mimeType: "image/png" }] };
		}
		return textResult({ path: result });
	}

	private async stop(): Promise<ToolCallResult> {
		if (!this.controller) return textResult({ stopped: false, reason: "no active session" });
		const controller = this.controller;
		this.controller = null;
		await controller.stop();
		return textResult({ stopped: true });
	}

	private requireController(): McpController {
		if (!this.controller) throw new Error("No active Talox MCP browser session. Call talox_launch first.");
		return this.controller;
	}
}

export class TaloxMcpStdioServer {
	private readonly session: TaloxMcpSession;
	private readonly input: Readable;
	private readonly output: Writable;

	constructor(
		session: TaloxMcpSession = new TaloxMcpSession(),
		input: Readable = process.stdin,
		output: Writable = process.stdout,
	) {
		this.session = session;
		this.input = input;
		this.output = output;
	}

	async run(): Promise<void> {
		const lines = createInterface({ input: this.input, crlfDelay: Number.POSITIVE_INFINITY });
		try {
			for await (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.length === 0) continue;
				await this.processLine(trimmed);
			}
		} finally {
			await this.session.close();
		}
	}

	async close(): Promise<void> {
		await this.session.close();
	}

	private async processLine(line: string): Promise<void> {
		let payload: unknown;
		try {
			payload = JSON.parse(line);
		} catch {
			this.write(rpcError(null, -32700, "Parse error"));
			return;
		}
		const response = await this.session.handle(payload);
		if (response) this.write(response);
	}

	private write(response: JsonRpcResponse): void {
		this.output.write(`${JSON.stringify(response)}\n`);
	}
}

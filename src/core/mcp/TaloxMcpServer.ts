import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import type { DaemonResponse } from "../daemon/TaloxDaemon.js";
import { TaloxMcpRuntime, type TaloxMcpRuntimeOptions } from "./TaloxMcpRuntime.js";

const sessionIdSchema = z.string().trim().min(1);
const profileClassSchema = z.enum(["qa", "ops", "sandbox"]);
const browserSchema = z.enum(["chromium", "firefox", "webkit"]);

function toStructuredContent(value: unknown): Record<string, unknown> {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return { value };
}

function successResult(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
		structuredContent: toStructuredContent(data),
	};
}

function errorResult(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [{ type: "text" as const, text: message }],
		isError: true,
	};
}

export function daemonResponseToMcpToolResult(response: DaemonResponse) {
	if (!response.success) return errorResult(response.error ?? "Talox command failed");

	const data = response.data;
	if (typeof data === "object" && data !== null && !Array.isArray(data)) {
		const objectData = data as Record<string, unknown>;
		if (objectData["encoding"] === "base64" && typeof objectData["data"] === "string") {
			return {
				content: [
					{
						type: "image" as const,
						data: objectData["data"],
						mimeType: "image/png",
					},
				],
				structuredContent: { encoding: "base64", mimeType: "image/png" },
			};
		}
	}

	return successResult(data ?? {});
}

async function safeToolCall<T>(operation: () => Promise<T> | T) {
	try {
		return successResult(await operation());
	} catch (error) {
		return errorResult(error);
	}
}

export function createTaloxMcpServer(runtime = new TaloxMcpRuntime()): McpServer {
	const server = new McpServer(
		{ name: "talox", version: "8.1.0" },
		{
			instructions:
				"Talox is a stateful browser runtime. Launch a session first, retain its sessionId, then pass that sessionId to browser tools. Sessions are headless by default and remain alive until stopped or the MCP process exits.",
		},
	);

	server.registerTool(
		"launch_session",
		{
			title: "Launch Talox browser session",
			description:
				"Launch a persistent Talox browser session and return its sessionId. Headless is the default. Omit profileId to get an isolated profile unique to this session.",
			inputSchema: z.object({
				profileId: z.string().trim().min(1).optional(),
				profileClass: profileClassSchema.default("ops"),
				browser: browserSchema.default("chromium"),
				headed: z.boolean().default(false),
			}),
		},
		async (args) =>
			safeToolCall(() =>
				runtime.launch({
					profileClass: args.profileClass,
					browser: args.browser,
					headed: args.headed,
					...(args.profileId !== undefined ? { profileId: args.profileId } : {}),
				}),
			),
	);

	server.registerTool(
		"stop_session",
		{
			title: "Stop Talox browser session",
			description: "Close one Talox browser session and release its browser resources.",
			inputSchema: z.object({ sessionId: sessionIdSchema }),
		},
		async ({ sessionId }) => safeToolCall(() => runtime.stop(sessionId)),
	);

	server.registerTool(
		"list_sessions",
		{
			title: "List Talox browser sessions",
			description: "List browser sessions currently owned by this MCP connection.",
			inputSchema: z.object({}),
		},
		async () => successResult({ sessions: runtime.listSessions() }),
	);

	server.registerTool(
		"health",
		{
			title: "Talox MCP health",
			description: "Return MCP runtime health and active browser-session count.",
			inputSchema: z.object({}),
		},
		async () => successResult(runtime.health()),
	);

	server.registerTool(
		"navigate",
		{
			title: "Navigate Talox session",
			description: "Navigate an existing Talox browser session to a URL.",
			inputSchema: z.object({
				sessionId: sessionIdSchema,
				url: z.string().trim().min(1),
			}),
		},
		async ({ sessionId, url }) => daemonResponseToMcpToolResult(await runtime.execute(sessionId, "navigate", { url })),
	);

	server.registerTool(
		"click",
		{
			title: "Click in Talox session",
			description: "Click an element in an existing Talox browser session using a selector.",
			inputSchema: z.object({
				sessionId: sessionIdSchema,
				selector: z.string().trim().min(1),
			}),
		},
		async ({ sessionId, selector }) =>
			daemonResponseToMcpToolResult(await runtime.execute(sessionId, "click", { selector })),
	);

	server.registerTool(
		"type",
		{
			title: "Type in Talox session",
			description: "Type text into an element in an existing Talox browser session.",
			inputSchema: z.object({
				sessionId: sessionIdSchema,
				selector: z.string().trim().min(1),
				text: z.string(),
			}),
		},
		async ({ sessionId, selector, text }) =>
			daemonResponseToMcpToolResult(await runtime.execute(sessionId, "type", { selector, text })),
	);

	server.registerTool(
		"get_state",
		{
			title: "Get Talox page state",
			description:
				"Return Talox's compact, content-sanitized agent page state for an existing browser session.",
			inputSchema: z.object({ sessionId: sessionIdSchema }),
		},
		async ({ sessionId }) =>
			daemonResponseToMcpToolResult(await runtime.execute(sessionId, "getState", { variant: "agent" })),
	);

	server.registerTool(
		"screenshot",
		{
			title: "Capture Talox screenshot",
			description: "Capture a full-page or selector-scoped screenshot. Buffer screenshots are returned as MCP image content.",
			inputSchema: z.object({
				sessionId: sessionIdSchema,
				selector: z.string().trim().min(1).optional(),
			}),
		},
		async ({ sessionId, selector }) =>
			daemonResponseToMcpToolResult(
				await runtime.execute(sessionId, "screenshot", selector === undefined ? undefined : { selector }),
			),
	);

	return server;
}

export interface TaloxMcpStdioService {
	runtime: TaloxMcpRuntime;
	close(): Promise<void>;
}

export function serveTaloxMcpStdio(options: TaloxMcpRuntimeOptions = {}): TaloxMcpStdioService {
	const runtime = new TaloxMcpRuntime(options);
	const handle = serveStdio(() => createTaloxMcpServer(runtime));
	let closed = false;

	const close = async (): Promise<void> => {
		if (closed) return;
		closed = true;
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		process.stdin.off("end", onInputClosed);
		process.stdin.off("close", onInputClosed);
		await Promise.allSettled([runtime.stopAll(), handle.close()]);
	};

	const onSignal = (): void => {
		void close().finally(() => {
			process.exitCode = 0;
		});
	};

	const onInputClosed = (): void => {
		void close();
	};

	process.once("SIGINT", onSignal);
	process.once("SIGTERM", onSignal);
	process.stdin.once("end", onInputClosed);
	process.stdin.once("close", onInputClosed);

	return { runtime, close };
}

/**
 * @file TaloxDaemon.ts
 * @description Long-lived Talox daemon that listens for JSON commands over a
 * Unix socket (or TCP on Windows).
 *
 * Protocol: newline-delimited JSON. Each line is a `DaemonCommand`.
 * The daemon responds with a `DaemonResponse` JSON line.
 */

import { randomUUID } from "node:crypto";
import * as net from "node:net";
import * as os from "node:os";
import type { ProfileClass } from "../../types/index.js";
import type { BrowserType } from "../BrowserManager.js";
import { TaloxController } from "../controller/TaloxController.js";
import { generateSessionId, handleCommand } from "./commandHandler.js";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface DaemonConfig {
	socketPath?: string;
	port?: number;
	host?: string;
}

export interface DaemonCommand {
	id: string;
	action: string;
	params?: Record<string, unknown>;
}

export interface DaemonResponse {
	id: string;
	success: boolean;
	data?: unknown;
	error?: string;
	warning?: string;
}

// ─── Session Record ───────────────────────────────────────────────────────────

interface SessionRecord {
	id: string;
	controller: TaloxController;
	createdAt: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SOCKET_PATH = "/tmp/talox-daemon.sock";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9222;
const isWindows = os.platform() === "win32";

// ─── TaloxDaemon ──────────────────────────────────────────────────────────────

export class TaloxDaemon {
	private readonly config: DaemonConfig;
	private readonly sessions: Map<string, SessionRecord> = new Map();
	private server: net.Server | null = null;
	private running = false;
	private startedAt: number | null = null;

	constructor(config?: DaemonConfig) {
		this.config = config ?? {};
	}

	// ─── Lifecycle ──────────────────────────────────────────────────────────

	/**
	 * Start listening on the configured Unix socket or TCP port.
	 */
	async start(): Promise<void> {
		if (this.running) {
			throw new Error("Daemon is already running");
		}

		this.server = net.createServer((socket) => {
			this.handleConnection(socket);
		});

		this.server.on("error", (err: Error) => {
			console.error(`[TaloxDaemon] Server error: ${err.message}`);
		});

		await new Promise<void>((resolve, reject) => {
			const srv = this.server!;
			srv.once("error", reject);

			if (isWindows || this.config.port !== undefined) {
				const port = this.config.port ?? DEFAULT_PORT;
				const host = this.config.host ?? DEFAULT_HOST;
				srv.listen(port, host, () => {
					srv.removeListener("error", reject);
					resolve();
				});
			} else {
				const socketPath = this.config.socketPath ?? DEFAULT_SOCKET_PATH;
				srv.listen(socketPath, () => {
					srv.removeListener("error", reject);
					resolve();
				});
			}
		});

		this.running = true;
		this.startedAt = Date.now();
	}

	/**
	 * Gracefully stop the daemon: close all sessions then shut down the server.
	 */
	async stop(): Promise<void> {
		if (!this.running || !this.server) {
			return;
		}

		// Close all active sessions
		const stopPromises: Promise<void>[] = [];
		this.sessions.forEach((session) => {
			stopPromises.push(
				session.controller.stop().catch((err: Error) => {
					console.error(`[TaloxDaemon] Error stopping session ${session.id}: ${err.message}`);
				}),
			);
		});
		await Promise.all(stopPromises);
		this.sessions.clear();

		// Close the server
		await new Promise<void>((resolve) => {
			this.server!.close(() => resolve());
		});

		this.running = false;
		this.server = null;
	}

	/**
	 * Whether the daemon is currently listening.
	 */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Get the address the daemon is listening on.
	 */
	getAddress(): string {
		if (!this.server) return "";
		const addr = this.server.address();
		if (typeof addr === "string") return addr;
		if (addr === null) return "";
		return `${addr.address}:${addr.port}`;
	}

	// ─── Connection Handling ────────────────────────────────────────────────

	private handleConnection(socket: net.Socket): void {
		let buffer = "";

		socket.on("data", (chunk: Buffer) => {
			buffer += chunk.toString("utf-8");
			const lines = buffer.split("\n");
			// Keep the last (potentially incomplete) line in the buffer
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (trimmed.length === 0) continue;
				this.processLine(trimmed, socket).catch((err: Error) => {
					console.error(`[TaloxDaemon] Unhandled error: ${err.message}`);
				});
			}
		});

		socket.on("error", (err: Error) => {
			console.error(`[TaloxDaemon] Socket error: ${err.message}`);
		});
	}

	// ─── Command Dispatch ───────────────────────────────────────────────────

	private async processLine(line: string, socket: net.Socket): Promise<void> {
		let command: DaemonCommand;
		try {
			command = JSON.parse(line) as DaemonCommand;
		} catch { // NOSONAR -- non-fatal
			this.sendResponse(socket, {
				id: "unknown",
				success: false,
				error: "Invalid JSON",
			});
			return;
		}

		if (!command.id || !command.action) {
			this.sendResponse(socket, {
				id: command.id ?? "unknown",
				success: false,
				error: "Missing 'id' or 'action' field",
			});
			return;
		}

		const response = await this.dispatchCommand(command);
		this.sendResponse(socket, response);
	}

	private async dispatchCommand(command: DaemonCommand): Promise<DaemonResponse> {
		try {
			switch (command.action) {
				case "launch":
					return await this.handleLaunch(command);
				case "stop":
					return await this.handleStop(command);
				case "shutdown":
					return await this.handleShutdown(command);
				case "list":
					return this.handleList(command);
				case "health":
					return this.handleHealth(command);
				default: {
					// Session-scoped actions
					const sessionId = command.params?.["sessionId"];
					if (typeof sessionId !== "string") {
						return {
							id: command.id,
							success: false,
							error: "Missing 'sessionId' parameter",
						};
					}
					const session = this.sessions.get(sessionId);
					if (!session) {
						return {
							id: command.id,
							success: false,
							error: `Session not found: ${sessionId}`,
						};
					}
					return await handleCommand(session.controller, command);
				}
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { id: command.id, success: false, error: message };
		}
	}

	// ─── Daemon-Level Actions ───────────────────────────────────────────────

	private async handleLaunch(command: DaemonCommand): Promise<DaemonResponse> {
		const profileId = (command.params?.["profileId"] as string | undefined) ?? "daemon";
		const profileClass = (command.params?.["profileClass"] as ProfileClass | undefined) ?? "ops";
		const browserType = (command.params?.["browser"] as BrowserType | undefined) ?? "chromium";

		const sessionId = generateSessionId();
		const controller = new TaloxController(process.cwd());

		try {
			await controller.launch(profileId, profileClass, browserType);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { id: command.id, success: false, error: message };
		}

		this.sessions.set(sessionId, {
			id: sessionId,
			controller,
			createdAt: Date.now(),
		});

		return { id: command.id, success: true, data: { sessionId } };
	}

	private async handleStop(command: DaemonCommand): Promise<DaemonResponse> {
		const sessionId = command.params?.["sessionId"];
		if (typeof sessionId !== "string") {
			return {
				id: command.id,
				success: false,
				error: "Missing 'sessionId' parameter",
			};
		}
		const session = this.sessions.get(sessionId);
		if (!session) {
			return {
				id: command.id,
				success: false,
				error: `Session not found: ${sessionId}`,
			};
		}

		try {
			await session.controller.stop();
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { id: command.id, success: false, error: message };
		}

		this.sessions.delete(sessionId);
		return { id: command.id, success: true, data: { stopped: sessionId } };
	}

	private async handleShutdown(command: DaemonCommand): Promise<DaemonResponse> {
		const response: DaemonResponse = {
			id: command.id,
			success: true,
			data: { message: "Shutting down" },
		};

		// Schedule shutdown after responding
		setImmediate(() => {
			this.stop().catch((err: Error) => {
				console.error(`[TaloxDaemon] Shutdown error: ${err.message}`);
			});
		});

		return response;
	}

	private handleList(command: DaemonCommand): DaemonResponse {
		const sessionList = Array.from(this.sessions.values()).map((s) => ({
			id: s.id,
			createdAt: s.createdAt,
		}));
		return { id: command.id, success: true, data: { sessions: sessionList } };
	}

	private handleHealth(command: DaemonCommand): DaemonResponse {
		return {
			id: command.id,
			success: true,
			data: {
				status: "ok",
				uptime: this.startedAt ? Date.now() - this.startedAt : 0,
				activeSessions: this.sessions.size,
				pid: process.pid,
			},
		};
	}

	// ─── Socket Helpers ─────────────────────────────────────────────────────

	private sendResponse(socket: net.Socket, response: DaemonResponse): void {
		if (socket.destroyed) return;
		try {
			socket.write(`${JSON.stringify(response)}\n`);
		} catch (err: unknown) {
			// NOSONAR — socket may have closed between check and write
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[TaloxDaemon] Write error: ${message}`);
		}
	}
}

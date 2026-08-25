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
import { createLogger } from "../Logger.js";
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
	private readonly log = createLogger("Daemon");
	private readonly config: DaemonConfig;
	private readonly sessions: Map<string, SessionRecord> = new Map();
	private readonly launchTasks: Set<Promise<void>> = new Set();
	private readonly sessionStops: Map<string, Promise<void>> = new Map();
	private server: net.Server | null = null;
	private running = false;
	private stopInFlight: Promise<void> | null = null;
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
			this.log.error(`Server error: ${err.message}`);
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
	 * Failed session stops remain registered so a later stop can retry them.
	 */
	stop(): Promise<void> {
		if (this.stopInFlight) return this.stopInFlight;
		if (!this.running || !this.server) return Promise.resolve();

		const attempt = this.runStop();
		this.stopInFlight = attempt;
		attempt.then(
			() => {
				if (this.stopInFlight === attempt) this.stopInFlight = null;
			},
			() => {
				if (this.stopInFlight === attempt) this.stopInFlight = null;
			},
		);
		return attempt;
	}

	private async runStop(): Promise<void> {
		const launches = Array.from(this.launchTasks);
		if (launches.length > 0) await Promise.allSettled(launches);

		const sessions = Array.from(this.sessions.values());
		const results = await Promise.allSettled(sessions.map((session) => this.stopSession(session)));
		const failures: string[] = [];

		for (const [index, result] of results.entries()) {
			if (result.status === "fulfilled") continue;
			const session = sessions[index];
			if (!session) continue;
			const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
			this.log.error(`Error stopping session ${session.id}: ${message}`);
			failures.push(`${session.id}: ${message}`);
		}

		if (failures.length > 0) {
			throw new Error(`Failed to stop ${failures.length} daemon session(s): ${failures.join("; ")}`);
		}

		const server = this.server;
		if (!server) {
			this.running = false;
			return;
		}
		await new Promise<void>((resolve, reject) => {
			server.close((error?: Error) => {
				if (error) reject(error);
				else resolve();
			});
		});

		if (this.server === server) this.server = null;
		this.running = false;
	}

	private stopSession(session: SessionRecord): Promise<void> {
		const existing = this.sessionStops.get(session.id);
		if (existing) return existing;

		const attempt = Promise.resolve()
			.then(() => session.controller.stop())
			.then(() => {
				if (this.sessions.get(session.id) === session) this.sessions.delete(session.id);
			});
		this.sessionStops.set(session.id, attempt);
		attempt.then(
			() => {
				if (this.sessionStops.get(session.id) === attempt) this.sessionStops.delete(session.id);
			},
			() => {
				if (this.sessionStops.get(session.id) === attempt) this.sessionStops.delete(session.id);
			},
		);
		return attempt;
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
					this.log.error(`Unhandled error: ${err.message}`);
				});
			}
		});

		socket.on("error", (err: Error) => {
			this.log.error(`Socket error: ${err.message}`);
		});
	}

	// ─── Command Dispatch ───────────────────────────────────────────────────

	private async processLine(line: string, socket: net.Socket): Promise<void> {
		let command: DaemonCommand;
		try {
			command = JSON.parse(line) as DaemonCommand;
		} catch {
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
					if (this.sessionStops.has(sessionId)) {
						return {
							id: command.id,
							success: false,
							error: `Session is stopping: ${sessionId}`,
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
		if (this.stopInFlight) {
			return { id: command.id, success: false, error: "Daemon is shutting down" };
		}

		const profileId = (command.params?.["profileId"] as string | undefined) ?? "daemon";
		const profileClass = (command.params?.["profileClass"] as ProfileClass | undefined) ?? "ops";
		const browserType = (command.params?.["browser"] as BrowserType | undefined) ?? "chromium";

		const sessionId = generateSessionId();
		const controller = new TaloxController(process.cwd());
		const launchTask = Promise.resolve()
			.then(() => controller.launch(profileId, profileClass, browserType))
			.then(() => {
				this.sessions.set(sessionId, {
					id: sessionId,
					controller,
					createdAt: Date.now(),
				});
			});
		this.launchTasks.add(launchTask);

		try {
			await launchTask;
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { id: command.id, success: false, error: message };
		} finally {
			this.launchTasks.delete(launchTask);
		}

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
			await this.stopSession(session);
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { id: command.id, success: false, error: message };
		}

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
				this.log.error(`Shutdown error: ${err.message}`);
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
			this.log.error(`Write error: ${message}`);
		}
	}
}

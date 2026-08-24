import { randomUUID } from "node:crypto";
import path from "node:path";
import type { ProfileClass } from "../../types/index.js";
import type { BrowserType } from "../BrowserManager.js";
import { TaloxController } from "../controller/TaloxController.js";
import type { DaemonResponse } from "../daemon/TaloxDaemon.js";
import { handleCommand } from "../daemon/commandHandler.js";

export type TaloxMcpSessionAction = "navigate" | "click" | "type" | "getState" | "screenshot";

export interface TaloxMcpLaunchOptions {
	profileId?: string;
	profileClass?: ProfileClass;
	browser?: BrowserType;
	headed?: boolean;
}

export interface TaloxMcpSessionInfo {
	sessionId: string;
	profileId: string;
	profileClass: ProfileClass;
	browser: BrowserType;
	headed: boolean;
	createdAt: number;
}

export interface TaloxMcpHealth {
	status: "ok";
	activeSessions: number;
	pid: number;
}

export type TaloxMcpControllerFactory = (baseDir: string, headed: boolean) => TaloxController;

export interface TaloxMcpRuntimeOptions {
	baseDir?: string;
	controllerFactory?: TaloxMcpControllerFactory;
	idFactory?: () => string;
	now?: () => number;
}

interface SessionRecord extends TaloxMcpSessionInfo {
	controller: TaloxController;
}

function createController(baseDir: string, headed: boolean): TaloxController {
	return new TaloxController(baseDir, {
		settings: {
			headed,
			verbosity: 0,
		},
	});
}

/**
 * Stateful browser-session runtime shared by all tools registered on one MCP
 * stdio connection. Browser actions reuse the daemon command dispatcher so MCP
 * and daemon clients observe the same validation and response semantics.
 */
export class TaloxMcpRuntime {
	private readonly sessions = new Map<string, SessionRecord>();
	private readonly baseDir: string;
	private readonly controllerFactory: TaloxMcpControllerFactory;
	private readonly idFactory: () => string;
	private readonly now: () => number;

	constructor(options: TaloxMcpRuntimeOptions = {}) {
		this.baseDir = options.baseDir ?? path.join(process.cwd(), ".talox", "profiles", "mcp");
		this.controllerFactory = options.controllerFactory ?? createController;
		this.idFactory = options.idFactory ?? randomUUID;
		this.now = options.now ?? Date.now;
	}

	async launch(options: TaloxMcpLaunchOptions = {}): Promise<TaloxMcpSessionInfo> {
		const sessionId = this.idFactory();
		// A unique default profile prevents concurrent MCP sessions from fighting
		// over Chromium's persistent user-data-dir lock. Callers can still opt into
		// a named persistent profile explicitly when they want continuity.
		const profileId = options.profileId ?? `mcp-${sessionId}`;
		const profileClass = options.profileClass ?? "ops";
		const browser = options.browser ?? "chromium";
		const headed = options.headed ?? false;
		const controller = this.controllerFactory(this.baseDir, headed);

		try {
			await controller.launch(profileId, profileClass, browser, { headed });
		} catch (error) {
			await controller.stop().catch(() => {});
			throw error;
		}

		const record: SessionRecord = {
			sessionId,
			profileId,
			profileClass,
			browser,
			headed,
			createdAt: this.now(),
			controller,
		};
		this.sessions.set(sessionId, record);
		return this.toInfo(record);
	}

	async stop(sessionId: string): Promise<TaloxMcpSessionInfo> {
		const record = this.requireSession(sessionId);
		await record.controller.stop();
		this.sessions.delete(sessionId);
		return this.toInfo(record);
	}

	async stopAll(): Promise<void> {
		const records = [...this.sessions.values()];
		this.sessions.clear();
		await Promise.allSettled(records.map((record) => record.controller.stop()));
	}

	listSessions(): TaloxMcpSessionInfo[] {
		return [...this.sessions.values()].map((record) => this.toInfo(record));
	}

	health(): TaloxMcpHealth {
		return {
			status: "ok",
			activeSessions: this.sessions.size,
			pid: process.pid,
		};
	}

	async execute(
		sessionId: string,
		action: TaloxMcpSessionAction,
		params?: Record<string, unknown>,
		requestId = randomUUID(),
	): Promise<DaemonResponse> {
		const record = this.sessions.get(sessionId);
		if (!record) {
			return {
				id: requestId,
				success: false,
				error: `Session not found: ${sessionId}`,
			};
		}

		return handleCommand(record.controller, {
			id: requestId,
			action,
			...(params !== undefined ? { params } : {}),
		});
	}

	private requireSession(sessionId: string): SessionRecord {
		const record = this.sessions.get(sessionId);
		if (!record) throw new Error(`Session not found: ${sessionId}`);
		return record;
	}

	private toInfo(record: SessionRecord): TaloxMcpSessionInfo {
		return {
			sessionId: record.sessionId,
			profileId: record.profileId,
			profileClass: record.profileClass,
			browser: record.browser,
			headed: record.headed,
			createdAt: record.createdAt,
		};
	}
}

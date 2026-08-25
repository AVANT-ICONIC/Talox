/**
 * @file InspectServer.ts
 * @description DevTools-compatible inspect server for Talox.
 *
 * Exposes an HTTP `/json` endpoint and a WebSocket proxy so that Chrome
 * DevTools can attach to a Talox-controlled page in real-time.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Page } from "playwright-core";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InspectServerConfig {
	port?: number;
	host?: string;
}

interface DevToolsTarget {
	description: string;
	devtoolsFrontendUrl: string;
	id: string;
	title: string;
	type: string;
	url: string;
	webSocketDebuggerUrl: string;
}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * Proxies Chrome DevTools Protocol (CDP) between DevTools and the browser page.
 *
 * When `attach(page)` is called, the server starts accepting DevTools
 * connections and forwards CDP messages bidirectionally, stripping and
 * injecting session IDs so DevTools sees a clean page-level view.
 */
export class InspectServer {
	private readonly port: number;
	private readonly host: string;
	private readonly targetId: string;

	private readonly httpServer: Server;
	private readonly wss: WebSocketServer;
	private page: Page | null = null;
	private cdpSession: import("playwright-core").CDPSession | null = null;
	private readonly devtoolsClients: Set<WebSocket> = new Set();
	private running = false;
	private attachInFlight: Promise<void> | null = null;
	private detachInFlight: Promise<void> | null = null;
	private connectionHandlerInstalled = false;

	constructor(config?: InspectServerConfig) {
		this.port = config?.port ?? 9222;
		this.host = config?.host ?? "127.0.0.1";
		this.targetId = randomUUID();

		this.httpServer = createServer((req, res) => this.handleHttpRequest(req, res));
		this.wss = new WebSocketServer({ server: this.httpServer });
	}

	/**
	 * Attach to a Playwright page and start proxying CDP messages.
	 *
	 * Attachments are serialized so concurrent callers cannot race server start
	 * or leak multiple CDP sessions. Failed attempts leave the next attach free
	 * to retry.
	 */
	async attach(page: Page): Promise<void> {
		while (this.attachInFlight) {
			await this.attachInFlight.catch(() => {});
		}

		const attempt = this.runAttach(page);
		this.attachInFlight = attempt;
		try {
			await attempt;
		} finally {
			if (this.attachInFlight === attempt) this.attachInFlight = null;
		}
	}

	private async runAttach(page: Page): Promise<void> {
		const detach = this.detachInFlight;
		if (detach) await detach;

		this.page = page;
		await this.ensureServerStarted();

		const previousSession = this.cdpSession;
		this.cdpSession = null;
		if (previousSession) {
			await previousSession.detach().catch(() => {}); // NOSONAR — previous page may already be closed
		}

		try {
			this.cdpSession = await page.context().newCDPSession(page);
		} catch {
			// NOSONAR — CDP session creation may fail in some browsers
		}
	}

	private async ensureServerStarted(): Promise<void> {
		if (this.running) return;

		if (!this.connectionHandlerInstalled) {
			this.wss.on("connection", (ws: WebSocket) => {
				this.handleDevToolsConnection(ws);
			});
			this.connectionHandlerInstalled = true;
		}

		await new Promise<void>((resolve, reject) => {
			this.httpServer.once("error", reject);
			this.httpServer.listen(this.port, this.host, () => {
				this.httpServer.removeListener("error", reject);
				this.running = true;
				resolve();
			});
		});
	}

	/**
	 * Stop proxying and wait until the inspect sockets are actually released.
	 */
	detach(): Promise<void> {
		if (this.detachInFlight) return this.detachInFlight;

		const attempt = this.runDetach();
		this.detachInFlight = attempt;
		attempt.then(
			() => {
				if (this.detachInFlight === attempt) this.detachInFlight = null;
			},
			() => {
				if (this.detachInFlight === attempt) this.detachInFlight = null;
			},
		);
		return attempt;
	}

	private async runDetach(): Promise<void> {
		const attach = this.attachInFlight;
		if (attach) await attach.catch(() => {});

		const clients = Array.from(this.devtoolsClients);
		for (const ws of clients) {
			try {
				ws.terminate();
			} catch {
				try {
					ws.close();
				} catch {
					// NOSONAR — client may already be closed
				}
			}
		}
		this.devtoolsClients.clear();

		const cdpSession = this.cdpSession;
		this.cdpSession = null;
		const cdpDetach = cdpSession ? cdpSession.detach().catch(() => {}) : Promise.resolve();

		this.page = null;

		if (!this.running) {
			await cdpDetach;
			return;
		}

		const webSocketClose = this.closeWebSocketServer();
		const httpClose = this.closeHttpServer();
		await Promise.all([cdpDetach, webSocketClose, httpClose]);
		this.running = false;
	}

	private closeWebSocketServer(): Promise<void> {
		return new Promise<void>((resolve) => {
			try {
				this.wss.close(() => resolve());
			} catch {
				resolve();
			}
		});
	}

	private closeHttpServer(): Promise<void> {
		return new Promise<void>((resolve) => {
			try {
				this.httpServer.close(() => resolve());
			} catch {
				resolve();
			}
		});
	}

	/**
	 * Return the `devtools://` URL for opening DevTools.
	 */
	getAddress(): string {
		return `devtools://devtools/bundled/inspector.html?ws=${this.host}:${this.port}`;
	}

	// ─── Private Helpers ─────────────────────────────────────────────────

	private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
		const urlPath = req.url ?? "/";

		if (urlPath === "/json" || urlPath === "/json/list") {
			const targets = this.buildTargetList();
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(targets));
			return;
		}

		if (urlPath === "/json/version") {
			const versionInfo = {
				Browser: "Talox/Chromium",
				"Protocol-Version": "1.3",
				"User-Agent": "Talox",
				"WebKit-Version": "537.36",
			};
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify(versionInfo));
			return;
		}

		res.writeHead(404);
		res.end("Not Found");
	}

	private buildTargetList(): DevToolsTarget[] {
		const wsUrl = `ws://${this.host}:${this.port}`;
		const pageUrl = this.page?.url() ?? "about:blank";
		const pageTitle = this.page ? "(Talox controlled page)" : "No page attached";

		return [
			{
				description: "",
				devtoolsFrontendUrl: this.getAddress(),
				id: this.targetId,
				title: pageTitle,
				type: "page",
				url: pageUrl,
				webSocketDebuggerUrl: wsUrl,
			},
		];
	}

	private handleDevToolsConnection(ws: WebSocket): void {
		this.devtoolsClients.add(ws);

		const onCdpEvent = ({ method, params }: { method: string; params?: unknown }) => {
			const msg = JSON.stringify({ method, params });
			if (ws.readyState === ws.OPEN) {
				ws.send(msg);
			}
		};

		if (this.cdpSession) {
			this.cdpSession.on("event", onCdpEvent);
		}

		ws.on("message", (raw: RawData) => {
			this.forwardToCdp(raw).catch(() => {
				// NOSONAR — CDP forwarding failures are logged and ignored
			});
		});

		ws.on("close", () => {
			this.devtoolsClients.delete(ws);
			if (this.cdpSession) {
				this.cdpSession.off("event", onCdpEvent);
			}
		});
	}

	private async forwardToCdp(raw: RawData): Promise<void> {
		if (!this.cdpSession) return;

		let parsed: { id?: number; method: string; params?: unknown };
		try {
			const str = typeof raw === "string" ? raw : Buffer.from(raw as Uint8Array).toString("utf-8");
			parsed = JSON.parse(str);
		} catch {
			// NOSONAR — malformed CDP messages are ignored
			return;
		}

		try {
			const result = await (this.cdpSession as any).send(parsed.method, parsed.params);

			const response = {
				id: parsed.id,
				result,
			};

			const clients = Array.from(this.devtoolsClients);
			for (const client of clients) {
				if (client.readyState === client.OPEN) {
					client.send(JSON.stringify(response));
				}
			}
		} catch (error: unknown) {
			const errorResponse = {
				id: parsed.id,
				error: {
					code: -32000,
					message: error instanceof Error ? error.message : String(error),
				},
			};

			const clients = Array.from(this.devtoolsClients);
			for (const client of clients) {
				if (client.readyState === client.OPEN) {
					client.send(JSON.stringify(errorResponse));
				}
			}
		}
	}
}

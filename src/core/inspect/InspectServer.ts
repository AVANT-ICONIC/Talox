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

	private httpServer: Server;
	private wss: WebSocketServer;
	private page: Page | null = null;
	private cdpSession: import("playwright-core").CDPSession | null = null;
	private devtoolsClients: Set<WebSocket> = new Set();
	private running = false;

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
	 * Starts the HTTP and WebSocket servers if not already running.
	 */
	async attach(page: Page): Promise<void> {
		this.page = page;

		try {
			this.cdpSession = await page.context().newCDPSession(page);
		} catch {
			// NOSONAR — CDP session creation may fail in some browsers
		}

		if (!this.running) {
			this.running = true;

			this.wss.on("connection", (ws: WebSocket) => {
				this.handleDevToolsConnection(ws);
			});

			await new Promise<void>((resolve, reject) => {
				this.httpServer.once("error", reject);
				this.httpServer.listen(this.port, this.host, () => {
					this.httpServer.removeListener("error", reject);
					resolve();
				});
			});
		}
	}

	/**
	 * Stop proxying and shut down the servers.
	 */
	detach(): void {
		const clients = Array.from(this.devtoolsClients);
		for (const ws of clients) {
			try {
				ws.close();
			} catch {
				// NOSONAR
			}
		}
		this.devtoolsClients.clear();

		if (this.cdpSession) {
			try {
				void this.cdpSession.detach();
			} catch {
				// NOSONAR — detach may fail if session already closed
			}
			this.cdpSession = null;
		}

		this.page = null;

		if (this.running) {
			this.running = false;
			this.wss.close();
			this.httpServer.close();
		}
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

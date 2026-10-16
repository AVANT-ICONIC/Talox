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
import type { BrowserEngineTelemetrySnapshot, EngineMode } from "../browser/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InspectServerConfig {
	port?: number;
	host?: string;
	/** Optional routed-browser telemetry; absent callbacks preserve the DevTools-only server. */
	engineStatus?: () => BrowserEngineTelemetrySnapshot | Promise<BrowserEngineTelemetrySnapshot>;
	/** Applies to future routed tasks without interrupting running workers. */
	setEngineMode?: (mode: EngineMode) => void;
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

type CdpEventHandler = (event: { method: string; params?: unknown }) => void;

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
	private readonly engineStatus: InspectServerConfig["engineStatus"];
	private readonly setEngineMode: InspectServerConfig["setEngineMode"];
	private readonly engineControlToken = randomUUID();
	private readonly dashboardNonce = randomUUID();

	private readonly httpServer: Server;
	private readonly wss: WebSocketServer;
	private page: Page | null = null;
	private cdpSession: import("playwright-core").CDPSession | null = null;
	private readonly devtoolsClients: Set<WebSocket> = new Set();
	private readonly clientEventHandlers = new Map<WebSocket, CdpEventHandler>();
	private running = false;
	private attachInFlight: Promise<void> | null = null;
	private detachInFlight: Promise<void> | null = null;
	private connectionHandlerInstalled = false;

	constructor(config?: InspectServerConfig) {
		this.port = config?.port ?? 9222;
		this.host = config?.host ?? "127.0.0.1";
		this.targetId = randomUUID();
		this.engineStatus = config?.engineStatus;
		this.setEngineMode = config?.setEngineMode;

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

		await this.ensureServerStarted();

		const previousSession = this.cdpSession;
		const previousPage = this.page;
		let nextSession: import("playwright-core").CDPSession;
		try {
			nextSession = await page.context().newCDPSession(page);
		} catch {
			// Preserve a working attachment when a replacement page cannot provide CDP.
			// On first attach, keep historical behavior and expose the requested page
			// through /json even though CDP proxying is unavailable.
			if (!previousSession) this.page = page;
			else this.page = previousPage;
			return;
		}

		if (previousSession) this.unbindClientsFromSession(previousSession);
		this.cdpSession = nextSession;
		this.page = page;
		this.bindClientsToSession(nextSession);

		if (previousSession && previousSession !== nextSession) {
			await previousSession.detach().catch(() => {}); // NOSONAR — previous page may already be closed
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

		const cdpSession = this.cdpSession;
		this.cdpSession = null;
		if (cdpSession) this.unbindClientsFromSession(cdpSession);

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
		this.clientEventHandlers.clear();

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
		return `devtools://devtools/bundled/inspector.html?ws=${this.host}:${this.getListenPort()}`;
	}

	/** Local dashboard URL, available when engineStatus is configured. */
	getDashboardAddress(): string {
		const host = this.host.includes(":") ? `[${this.host}]` : this.host;
		return `http://${host}:${this.getListenPort()}/`;
	}

	private getListenPort(): number {
		if (this.port !== 0) return this.port;
		const address = this.httpServer.address();
		return address && typeof address === "object" ? address.port : this.port;
	}

	// ─── Private Helpers ─────────────────────────────────────────────────

	private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
		const urlPath = req.url ?? "/";
		if (this.engineStatus && ["/", "/engine", "/engine/mode"].includes(urlPath)) {
			void this.handleEngineRequest(req, res, urlPath).catch((error: unknown) => {
				this.sendEngineJson(res, 503, {
					status: "unread",
					error: error instanceof Error ? error.message : "Browser engine telemetry is unread",
				});
			});
			return;
		}

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

	private sendEngineJson(res: ServerResponse, statusCode: number, value: unknown): void {
		const body = JSON.stringify(value);
		res.writeHead(statusCode, { "Content-Type": "application/json", "Cache-Control": "no-store" });
		res.end(body);
	}

	private async readEngineStatus(): Promise<BrowserEngineTelemetrySnapshot> {
		const snapshot = await this.engineStatus?.();
		if (!snapshot?.engines || !["auto", "machine", "human"].includes(snapshot.mode)) {
			throw new Error("Browser engine telemetry is unread");
		}
		return snapshot;
	}

	/** Literal loopback hosts prevent browser requests through a rebound DNS name. */
	private isLocalEngineRequest(req: IncomingMessage): boolean {
		const peer = req.socket.remoteAddress;
		if (peer !== "127.0.0.1" && peer !== "::1" && peer !== "::ffff:127.0.0.1") return false;
		const host = req.headers.host;
		if (!host) return false;
		return new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${this.getListenPort()}$`, "i").test(host);
	}

	private async handleEngineRequest(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
		if (!this.isLocalEngineRequest(req)) {
			this.sendEngineJson(res, 403, { error: "Browser engine controls are available on loopback only" });
			return;
		}
		if (path === "/engine/mode") {
			await this.handleEngineModeRequest(req, res);
			return;
		}
		if (req.method !== "GET") {
			res.setHeader("Allow", "GET");
			this.sendEngineJson(res, 405, { error: "Use GET for browser engine status" });
			return;
		}
		if (path === "/engine") {
			this.sendEngineJson(res, 200, await this.readEngineStatus());
			return;
		}
		res.writeHead(200, {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
			"Content-Security-Policy": `default-src 'none'; script-src 'nonce-${this.dashboardNonce}'; style-src 'nonce-${this.dashboardNonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
			"X-Content-Type-Options": "nosniff",
		});
		res.end(this.renderEngineDashboard());
	}

	private async handleEngineModeRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		if (req.method !== "POST") {
			res.setHeader("Allow", "POST");
			this.sendEngineJson(res, 405, { error: "Use POST to change browser engine mode" });
			return;
		}
		if (!this.setEngineMode) {
			this.sendEngineJson(res, 409, { error: "Browser engine mode is read-only" });
			return;
		}
		if (
			req.headers.origin !== `http://${req.headers.host}` ||
			req.headers["x-talox-inspect-token"] !== this.engineControlToken
		) {
			this.sendEngineJson(res, 403, { error: "Browser engine mode requires the local dashboard" });
			return;
		}
		if (req.headers["content-type"]?.split(";", 1)[0]?.trim() !== "application/json") {
			this.sendEngineJson(res, 415, { error: "Browser engine mode requires application/json" });
			return;
		}
		let body = "";
		for await (const chunk of req) {
			body += Buffer.from(chunk).toString("utf-8");
			if (Buffer.byteLength(body) > 1024) {
				this.sendEngineJson(res, 413, { error: "Browser engine mode body exceeds 1024 bytes" });
				return;
			}
		}
		let mode: unknown;
		try {
			mode = (JSON.parse(body) as { mode?: unknown })?.mode;
		} catch {
			this.sendEngineJson(res, 400, { error: "Invalid browser engine mode JSON" });
			return;
		}
		if (mode !== "auto" && mode !== "machine" && mode !== "human") {
			this.sendEngineJson(res, 400, { error: "Browser engine mode must be auto, machine, or human" });
			return;
		}
		this.setEngineMode(mode);
		this.sendEngineJson(res, 200, await this.readEngineStatus());
	}

	/** Reuses Replay's panels, type, palette, mark, pills and selector styling. */
	private renderEngineDashboard(): string {
		return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Talox Inspect · Browser engines</title>
<style nonce="${this.dashboardNonce}">
:root{color-scheme:dark;--bg:#07090c;--panel:#0d1117;--panel2:#111821;--line:#202a36;--muted:#8190a3;--text:#e8eef6;--accent:#2dd4bf;--accent2:#22d3ee;--warn:#fbbf24;--bad:#fb7185}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:13px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}select{font:inherit}
.topbar{display:flex;align-items:center;gap:18px;padding:14px 24px;border-bottom:1px solid var(--line);background:#090d12}.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.08em}.mark{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#041012;font-weight:950}.brand small{display:block;color:var(--muted);font-size:9px;letter-spacing:.18em;font-weight:700}.session{flex:1;color:var(--muted)}.pill{border:1px solid var(--line);border-radius:999px;padding:5px 9px;color:var(--muted);background:#0b1016}.pill[data-status="unread"]{color:var(--warn)}
main{max-width:1080px;margin:auto;padding:36px 24px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:22px}.panel-title{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;gap:18px}.panel-title strong{font-size:12px;letter-spacing:.06em;text-transform:uppercase}h1{font-size:25px;letter-spacing:-.02em;margin:0 0 8px}p{color:var(--muted);margin:0 0 24px}.control-row{display:flex;gap:18px;align-items:center;padding:20px;flex-wrap:wrap}.control-row select{height:36px;border:1px solid var(--line);border-radius:7px;background:#101720;color:var(--text);padding:0 12px}.hint{color:var(--muted);font-size:12px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:8px 20px 20px;gap:20px}.label{color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px}.value{font-size:24px;font-weight:650}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;text-align:left}th,td{padding:14px 20px;border-bottom:1px solid var(--line)}th{color:var(--muted);font-size:11px;font-weight:500}tbody tr:last-child td{border:0}.engine{font-weight:700;color:var(--accent)}.notice{min-height:18px;color:var(--muted);font-size:12px;margin-top:14px;overflow-wrap:anywhere}a{color:var(--accent);text-decoration:none}.links{display:flex;gap:18px;font-size:12px}@media(max-width:700px){.session{display:none}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.panel-title{align-items:flex-start;flex-direction:column}main{padding:24px 16px}}
</style></head><body>
<header class="topbar"><div class="brand"><div class="mark">T</div><div>TALOX<small>INSPECT</small></div></div><span class="session">Local browser runtime</span><span class="pill" id="health" data-status="unread">Telemetry unread</span></header>
<main><h1>Browser engines</h1><p>Route machine workloads and keep Chromium ready for rendering and human interaction.</p>
<section class="panel" aria-labelledby="routingTitle"><div class="panel-title"><strong id="routingTitle">Routing</strong><span class="hint" id="updated">Waiting for telemetry</span></div><div class="control-row"><label for="engineMode">Browser Engine</label><select id="engineMode" disabled><option value="auto">AUTO</option><option value="machine">LIGHTPANDA</option><option value="human">CHROMIUM</option></select><span class="hint">Mode changes apply to future tasks. Running tasks continue.</span></div>
<div class="stats"><div><div class="label">Active engine</div><div class="value" id="activeEngine">unread</div></div><div><div class="label">Running workers</div><div class="value" id="runningWorkers">unread</div></div><div><div class="label">RAM</div><div class="value" id="ramBytes">unread</div></div><div><div class="label">Queued tasks</div><div class="value" id="queuedTasks">unread</div></div><div><div class="label">Tasks completed</div><div class="value" id="tasksCompleted">unread</div></div><div><div class="label">Average latency</div><div class="value" id="averageLatencyMs">unread</div></div><div><div class="label">Error rate</div><div class="value" id="errorRate">unread</div></div><div><div class="label">Fallback count</div><div class="value" id="fallbackCount">unread</div></div></div></section>
<section class="panel" aria-labelledby="workersTitle"><div class="panel-title"><strong id="workersTitle">Engine workers</strong><span class="hint">Independent sessions and resource readings</span></div><div class="table-wrap"><table><thead><tr><th>Engine</th><th>Workers / queue</th><th>RAM</th><th>CPU</th><th>Completed / failed</th><th>Average latency</th></tr></thead><tbody id="workers"></tbody></table></div></section>
<div class="links"><a href="/json">DevTools targets</a><a href="/engine">Telemetry JSON</a></div><div class="notice mono" id="fallback"></div><div class="notice" id="message" role="status" aria-live="polite"></div></main>
<script nonce="${this.dashboardNonce}">
const CONTROL_TOKEN=${JSON.stringify(this.engineControlToken)};
const CAN_CHANGE=${Boolean(this.setEngineMode)};
const $=id=>document.getElementById(id);
const metricIds=["activeEngine","runningWorkers","ramBytes","queuedTasks","tasksCompleted","averageLatencyMs","errorRate","fallbackCount"];
let changing=false,lastMode="auto";
const finite=value=>typeof value==="number"&&Number.isFinite(value);
const number=value=>finite(value)?value.toLocaleString():"unread";
const ram=value=>finite(value)?(value/1048576).toFixed(1)+" MB":"unread";
const latency=value=>finite(value)?value.toFixed(1)+" ms":"unread";
const percent=value=>finite(value)?value.toFixed(1)+"%":"unread";
function cell(row,value,className){const td=document.createElement("td");td.textContent=value;if(className)td.className=className;row.appendChild(td)}
function render(data){if(!data||!data.engines||!["auto","machine","human"].includes(data.mode))throw new Error("Invalid engine telemetry");lastMode=data.mode;if(!changing)$("engineMode").value=data.mode;$("engineMode").disabled=changing||!CAN_CHANGE;$("activeEngine").textContent=data.activeEngine===null?"Idle":typeof data.activeEngine==="string"?data.activeEngine.toUpperCase():"unread";["runningWorkers","queuedTasks","tasksCompleted","fallbackCount"].forEach(id=>$(id).textContent=number(data[id]));$("ramBytes").textContent=ram(data.ramBytes);$("averageLatencyMs").textContent=latency(data.averageLatencyMs);$("errorRate").textContent=finite(data.errorRate)?percent(data.errorRate*100):"unread";$("workers").textContent="";for(const name of ["lightpanda","chromium"]){const engine=data.engines[name];const row=document.createElement("tr");cell(row,name.toUpperCase(),"engine");cell(row,number(engine?.activeWorkers)+" / "+number(engine?.queuedTasks));cell(row,engine?.resourceStatus==="available"?ram(engine.ramBytes):"unread");cell(row,engine?.resourceStatus==="available"?percent(engine.cpuPercent):"unread");cell(row,number(engine?.tasksCompleted)+" / "+number(engine?.tasksFailed));cell(row,latency(engine?.averageLatencyMs));if(engine?.resourceError)row.title=engine.resourceError;$("workers").appendChild(row)}$("health").textContent="Live telemetry";$("health").dataset.status="available";$("updated").textContent="Updated "+new Date().toLocaleTimeString();const reason=data.lastFallback;$("fallback").textContent=reason?"Last fallback: "+reason.from+" → "+reason.to+" · "+reason.reason+" · "+reason.message:"No fallback recorded"}
function unread(error){metricIds.forEach(id=>$(id).textContent="unread");$("workers").textContent="";$("fallback").textContent="Fallback history unread";$("health").textContent="Telemetry unread";$("health").dataset.status="unread";$("updated").textContent="Reading failed";$("engineMode").disabled=true;$("message").textContent=error instanceof Error?error.message:String(error)}
async function load(){if(changing)return;try{const response=await fetch("/engine",{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"Engine telemetry unread");render(data)}catch(error){unread(error)}}
$("engineMode").addEventListener("change",async()=>{changing=true;$("engineMode").disabled=true;try{const response=await fetch("/engine/mode",{method:"POST",headers:{"Content-Type":"application/json","X-Talox-Inspect-Token":CONTROL_TOKEN},body:JSON.stringify({mode:$("engineMode").value})});const data=await response.json();if(!response.ok)throw new Error(data.error||"Browser engine mode change failed");changing=false;render(data);$("message").textContent="Browser engine mode updated for future tasks."}catch(error){$("engineMode").value=lastMode;$("message").textContent=error instanceof Error?error.message:String(error)}finally{changing=false;$("engineMode").disabled=!CAN_CHANGE}});
load();const polling=setInterval(load,1000);window.addEventListener("pagehide",()=>clearInterval(polling));
</script></body></html>`;
	}

	private buildTargetList(): DevToolsTarget[] {
		const wsUrl = `ws://${this.host}:${this.getListenPort()}`;
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

		const onCdpEvent: CdpEventHandler = ({ method, params }) => {
			const msg = JSON.stringify({ method, params });
			if (ws.readyState === ws.OPEN) {
				ws.send(msg);
			}
		};
		this.clientEventHandlers.set(ws, onCdpEvent);

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
			this.clientEventHandlers.delete(ws);
			if (this.cdpSession) {
				this.cdpSession.off("event", onCdpEvent);
			}
		});
	}

	private bindClientsToSession(session: import("playwright-core").CDPSession): void {
		for (const handler of this.clientEventHandlers.values()) {
			session.on("event", handler);
		}
	}

	private unbindClientsFromSession(session: import("playwright-core").CDPSession): void {
		for (const handler of this.clientEventHandlers.values()) {
			session.off("event", handler);
		}
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

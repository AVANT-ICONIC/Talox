import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { request } from "node:http";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { InspectServer } from "../dist/core/inspect/InspectServer.js";

function telemetry(overrides = {}) {
	const engine = {
		activeWorkers: 1,
		queuedTasks: 2,
		tasksCompleted: 7,
		tasksFailed: 1,
		averageLatencyMs: 12.5,
		ramBytes: 10485760,
		cpuPercent: 2.5,
		resourceStatus: "available",
	};
	return {
		mode: "auto",
		activeEngine: "lightpanda",
		runningWorkers: 1,
		queuedTasks: 2,
		ramBytes: 10485760,
		tasksCompleted: 7,
		tasksFailed: 1,
		averageLatencyMs: 12.5,
		errorRate: 0.125,
		fallbackCount: 1,
		engines: { lightpanda: { ...engine }, chromium: { ...engine, activeWorkers: 0 } },
		...overrides,
	};
}

async function startServer(t, config = {}) {
	const server = new InspectServer({ port: 0, ...config });
	const session = new EventEmitter();
	session.detach = async () => {};
	session.send = async () => ({});
	await server.attach({
		url: () => "http://fixture.local/article",
		context: () => ({ newCDPSession: async () => session }),
	});
	t.after(() => server.detach());
	return { server, url: server.getDashboardAddress() };
}

function send(url, { method = "GET", headers = {}, body } = {}) {
	return new Promise((resolve, reject) => {
		const req = request(url, { method, headers }, (res) => {
			let text = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => { text += chunk; });
			res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
			res.on("error", reject);
		});
		req.on("error", reject);
		req.end(body);
	});
}

async function controlHeaders(url) {
	const dashboard = await send(url);
	const token = dashboard.text.match(/const CONTROL_TOKEN=("[^"]+");/)?.[1];
	assert.ok(token, "The local dashboard embeds its mode-control token");
	return {
		origin: new URL(url).origin,
		"content-type": "application/json",
		"x-talox-inspect-token": JSON.parse(token),
	};
}

function runDashboard(html, response) {
	const elements = new Map();
	const element = () => ({
		textContent: "",
		dataset: {},
		disabled: true,
		value: "auto",
		children: [],
		listeners: {},
		appendChild(child) { this.children.push(child); },
		addEventListener(name, handler) { this.listeners[name] = handler; },
	});
	const context = {
		document: {
			getElementById(id) {
				if (!elements.has(id)) elements.set(id, element());
				return elements.get(id);
			},
			createElement: element,
		},
		fetch: async () => response,
		setInterval: () => 1,
		clearInterval: () => {},
		window: { addEventListener: () => {} },
	};
	const script = html.match(/<script nonce="[^"]+">([\s\S]+)<\/script>/)?.[1];
	assert.ok(script, "The dashboard has a protected inline script");
	runInNewContext(script, context);
	return { elements, context };
}

test("Inspect keeps DevTools discovery unchanged when browser engine callbacks are absent", async (t) => {
	const { server, url } = await startServer(t);
	assert.equal((await send(url)).status, 404);
	assert.equal((await send(`${url}engine`)).status, 404);
	const targets = JSON.parse((await send(`${url}json`)).text);
	assert.equal(targets.length, 1);
	assert.equal(targets[0].url, "http://fixture.local/article");
	assert.match(targets[0].webSocketDebuggerUrl, /:[1-9]\d*$/);
	assert.match(server.getAddress(), /:[1-9]\d*$/);
	assert.equal(JSON.parse((await send(`${url}json/version`)).text).Browser, "Talox/Chromium");
});

test("Inspect exposes live browser engine telemetry with an engine selector in the existing Talox style", async (t) => {
	let snapshot = telemetry();
	const { url } = await startServer(t, { engineStatus: () => snapshot });
	const dashboard = await send(url);
	assert.equal(dashboard.status, 200);
	assert.match(dashboard.text, /<option value="auto">AUTO<\/option>/);
	assert.match(dashboard.text, /<option value="machine">LIGHTPANDA<\/option>/);
	assert.match(dashboard.text, /<option value="human">CHROMIUM<\/option>/);
	assert.match(dashboard.text, /--accent:#2dd4bf/);
	assert.match(dashboard.text, /Mode changes apply to future tasks\. Running tasks continue\./);
	assert.match(dashboard.headers["content-security-policy"], /frame-ancestors 'none'/);
	assert.equal(dashboard.headers["cache-control"], "no-store");
	assert.deepEqual(JSON.parse((await send(`${url}engine`)).text), snapshot);
	snapshot = telemetry({ tasksCompleted: 12, activeEngine: "mixed" });
	assert.deepEqual(JSON.parse((await send(`${url}engine`)).text), snapshot);
});

test("Inspect changes browser mode only through a local same-origin token-protected POST", async (t) => {
	let snapshot = telemetry();
	const changes = [];
	const { url } = await startServer(t, {
		engineStatus: () => snapshot,
		setEngineMode(mode) { changes.push(mode); snapshot = { ...snapshot, mode }; },
	});
	const headers = await controlHeaders(url);
	for (const mode of ["machine", "human", "auto"]) {
		const result = await send(`${url}engine/mode`, { method: "POST", headers, body: JSON.stringify({ mode }) });
		assert.equal(result.status, 200);
		assert.equal(JSON.parse(result.text).mode, mode);
	}
	assert.deepEqual(changes, ["machine", "human", "auto"]);
	assert.equal(snapshot.runningWorkers, 1);
});

test("Inspect rejects cross-origin missing-token and rebound-host engine controls without changing mode", async (t) => {
	const changes = [];
	const { url } = await startServer(t, { engineStatus: telemetry, setEngineMode: (mode) => changes.push(mode) });
	const headers = await controlHeaders(url);
	const body = JSON.stringify({ mode: "human" });
	const missingToken = { ...headers };
	delete missingToken["x-talox-inspect-token"];
	for (const unsafeHeaders of [
		missingToken,
		{ ...headers, origin: "https://unrelated.example" },
		{ ...headers, "x-talox-inspect-token": "incorrect" },
		{ ...headers, host: `rebound.example:${new URL(url).port}` },
	]) {
		assert.equal((await send(`${url}engine/mode`, { method: "POST", headers: unsafeHeaders, body })).status, 403);
	}
	assert.deepEqual(changes, []);
	assert.equal((await send(url, { headers: { host: `rebound.example:${new URL(url).port}` } })).status, 403);
});

test("Inspect restricts engine status to loopback peers even when the server is configured for remote DevTools", async (t) => {
	const { server } = await startServer(t, { engineStatus: telemetry });
	let status;
	let response;
	server.handleHttpRequest(
		{ url: "/engine", method: "GET", headers: { host: `127.0.0.1:${new URL(server.getDashboardAddress()).port}` }, socket: { remoteAddress: "192.0.2.2" } },
		{ writeHead: (code) => { status = code; }, end: (body) => { response = JSON.parse(body); } },
	);
	assert.equal(status, 403);
	assert.match(response.error, /loopback only/);
});

test("Inspect rejects invalid modes malformed JSON wrong content types and oversized mode bodies", async (t) => {
	const changes = [];
	const { url } = await startServer(t, { engineStatus: telemetry, setEngineMode: (mode) => changes.push(mode) });
	const headers = await controlHeaders(url);
	for (const body of ['{"mode":"unknown"}', "{", "null", "{}", '{"mode":false}']) {
		assert.equal((await send(`${url}engine/mode`, { method: "POST", headers, body })).status, 400);
	}
	assert.equal((await send(`${url}engine/mode`, { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: '{"mode":"human"}' })).status, 415);
	assert.equal((await send(`${url}engine/mode`, { method: "POST", headers, body: JSON.stringify({ mode: "human", padding: "x".repeat(1200) }) })).status, 413);
	assert.deepEqual(changes, []);
});

test("Inspect rejects mode changes when controls are read-only and returns allowed methods", async (t) => {
	const { url } = await startServer(t, { engineStatus: telemetry });
	const headers = await controlHeaders(url);
	assert.equal((await send(`${url}engine/mode`, { method: "POST", headers, body: '{"mode":"human"}' })).status, 409);
	const getMode = await send(`${url}engine/mode`);
	assert.equal(getMode.status, 405);
	assert.equal(getMode.headers.allow, "POST");
	const postStatus = await send(`${url}engine`, { method: "POST" });
	assert.equal(postStatus.status, 405);
	assert.equal(postStatus.headers.allow, "GET");
});

test("Inspect reports a failed telemetry reading as unread instead of successful empty metrics", async (t) => {
	const { url } = await startServer(t, { engineStatus: () => { throw new Error("Resource probe failed"); } });
	const result = await send(`${url}engine`);
	assert.equal(result.status, 503);
	assert.deepEqual(JSON.parse(result.text), { status: "unread", error: "Resource probe failed" });
});

test("Inspect awaits an asynchronous resource reading before returning live telemetry", async (t) => {
	const snapshot = telemetry({ ramBytes: 20971520 });
	let readings = 0;
	const { url } = await startServer(t, {
		engineStatus: async () => {
			readings++;
			await new Promise((resolve) => setImmediate(resolve));
			return snapshot;
		},
	});
	assert.equal((await send(url)).status, 200);
	assert.equal(readings, 0, "The static dashboard does not perform a resource reading");
	const result = await send(`${url}engine`);
	assert.equal(result.status, 200);
	assert.deepEqual(JSON.parse(result.text), snapshot);
	assert.equal(readings, 1);
});

test("Inspect reports a rejected asynchronous resource reading as unread", async (t) => {
	const { url } = await startServer(t, {
		engineStatus: async () => {
			await new Promise((resolve) => setImmediate(resolve));
			throw new Error("RAM reading failed");
		},
	});
	const result = await send(`${url}engine`);
	assert.equal(result.status, 503);
	assert.deepEqual(JSON.parse(result.text), { status: "unread", error: "RAM reading failed" });
});

test("Inspect awaits refreshed resource telemetry after applying a browser mode change", async (t) => {
	let snapshot = telemetry();
	const { url } = await startServer(t, {
		engineStatus: async () => {
			await new Promise((resolve) => setImmediate(resolve));
			return snapshot;
		},
		setEngineMode: (mode) => { snapshot = { ...snapshot, mode }; },
	});
	const headers = await controlHeaders(url);
	const result = await send(`${url}engine/mode`, { method: "POST", headers, body: '{"mode":"machine"}' });
	assert.equal(result.status, 200);
	assert.equal(JSON.parse(result.text).mode, "machine");
	assert.equal(JSON.parse(result.text).runningWorkers, 1);
});

test("Inspect rejects missing or invalid telemetry snapshots instead of returning an empty successful response", async (t) => {
	let snapshot;
	const { url } = await startServer(t, { engineStatus: () => snapshot });
	for (const value of [undefined, null, {}, { mode: "unknown", engines: {} }]) {
		snapshot = value;
		const result = await send(`${url}engine`);
		assert.equal(result.status, 503);
		assert.equal(JSON.parse(result.text).status, "unread");
	}
});

test("Inspect reports a failed mode callback without claiming the mode changed", async (t) => {
	const { url } = await startServer(t, {
		engineStatus: telemetry,
		setEngineMode: () => { throw new Error("Router unavailable"); },
	});
	const headers = await controlHeaders(url);
	const result = await send(`${url}engine/mode`, { method: "POST", headers, body: '{"mode":"machine"}' });
	assert.equal(result.status, 503);
	assert.equal(JSON.parse(result.text).error, "Router unavailable");
});

test("Inspect renders RAM CPU error rates and fallback reasons without inventing unread resource values", async (t) => {
	const snapshot = telemetry({
		ramBytes: null,
		lastFallback: { from: "lightpanda", to: "chromium", reason: "unsupported-capability", message: "Screenshots need rendering" },
	});
	snapshot.engines.lightpanda = { ...snapshot.engines.lightpanda, resourceStatus: "unread", ramBytes: 0, cpuPercent: 0 };
	const { url } = await startServer(t, { engineStatus: () => snapshot });
	const html = (await send(url)).text;
	const { elements } = runDashboard(html, { ok: true, json: async () => snapshot });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(elements.get("ramBytes").textContent, "unread");
	assert.equal(elements.get("errorRate").textContent, "12.5%");
	assert.equal(elements.get("activeEngine").textContent, "LIGHTPANDA");
	assert.equal(elements.get("engineMode").disabled, true);
	const workers = elements.get("workers").children;
	assert.equal(workers[0].children[2].textContent, "unread");
	assert.equal(workers[0].children[3].textContent, "unread");
	assert.equal(workers[1].children[2].textContent, "10.0 MB");
	assert.equal(workers[1].children[3].textContent, "2.5%");
	assert.match(elements.get("fallback").textContent, /lightpanda → chromium · unsupported-capability · Screenshots need rendering/);
});

test("Inspect marks the dashboard unread and disables mode changes after a failed status request", async (t) => {
	const { url } = await startServer(t, { engineStatus: telemetry, setEngineMode: () => {} });
	const html = (await send(url)).text;
	const { elements } = runDashboard(html, { ok: false, json: async () => ({ status: "unread", error: "Telemetry unavailable" }) });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(elements.get("health").textContent, "Telemetry unread");
	assert.equal(elements.get("tasksCompleted").textContent, "unread");
	assert.equal(elements.get("engineMode").disabled, true);
	assert.equal(elements.get("message").textContent, "Telemetry unavailable");
});

test("Inspect sends the selected browser mode from its dashboard and keeps active worker telemetry", async (t) => {
	const snapshot = telemetry();
	const { url } = await startServer(t, { engineStatus: () => snapshot, setEngineMode: () => {} });
	const html = (await send(url)).text;
	const { elements, context } = runDashboard(html, { ok: true, json: async () => snapshot });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(elements.get("engineMode").disabled, false);
	let called;
	context.fetch = async (path, options) => {
		called = { path, options };
		return { ok: true, json: async () => ({ ...snapshot, mode: "human" }) };
	};
	elements.get("engineMode").value = "human";
	await elements.get("engineMode").listeners.change();
	assert.equal(called.path, "/engine/mode");
	assert.equal(called.options.method, "POST");
	assert.equal(called.options.headers["Content-Type"], "application/json");
	assert.equal(typeof called.options.headers["X-Talox-Inspect-Token"], "string");
	assert.deepEqual(JSON.parse(called.options.body), { mode: "human" });
	assert.equal(elements.get("runningWorkers").textContent, "1");
	assert.equal(elements.get("engineMode").value, "human");
	assert.equal(elements.get("engineMode").disabled, false);
	assert.equal(elements.get("message").textContent, "Browser engine mode updated for future tasks.");
});

test("Inspect restores the prior dashboard mode and reports a rejected change", async (t) => {
	const snapshot = telemetry();
	const { url } = await startServer(t, { engineStatus: () => snapshot, setEngineMode: () => {} });
	const html = (await send(url)).text;
	const { elements, context } = runDashboard(html, { ok: true, json: async () => snapshot });
	await new Promise((resolve) => setImmediate(resolve));
	context.fetch = async () => ({ ok: false, json: async () => ({ error: "Router unavailable" }) });
	elements.get("engineMode").value = "machine";
	await elements.get("engineMode").listeners.change();
	assert.equal(elements.get("engineMode").value, "auto");
	assert.equal(elements.get("message").textContent, "Router unavailable");
});

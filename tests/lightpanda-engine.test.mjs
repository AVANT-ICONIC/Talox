import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { CdpConnection } from "../dist/core/browser/CdpConnection.js";
import { LightpandaEngine } from "../dist/core/browser/LightpandaEngine.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const nodeExecutable = process.execPath;
const fixtureUrl = "http://127.0.0.1:12345/fixture";
const fixtureTask = (operation = "extract", extra = {}) => ({ url: fixtureUrl, operation, trustedContent: true, ...extra });

async function mockEngine(t, mode = "ok", options = {}) {
	const directory = path.join(root, ".apex", "adapter-fixtures", randomUUID());
	await mkdir(directory, { recursive: true });
	t.after(() => rm(directory, { recursive: true, force: true }));
	const executablePath = path.join(directory, "fixture-lightpanda.mjs");
	const eventsPath = path.join(directory, "worker-events.log");
	const source = `#!${nodeExecutable}
import ws from ${JSON.stringify(pathToFileURL(path.join(root, "node_modules/ws/index.js")).href)};
const { WebSocketServer } = ws;
import { appendFileSync, readFileSync } from 'node:fs';
const mode = ${JSON.stringify(mode)};
if (process.argv[2] === 'version') { console.log(mode === 'wrong-version' ? '9.9.9' : '1.0.0'); process.exit(0); }
appendFileSync(${JSON.stringify(eventsPath)}, process.pid + '\\n');
const sequence = readFileSync(${JSON.stringify(eventsPath)}, 'utf8').trim().split('\\n').length;
const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
const server = new WebSocketServer({host:'127.0.0.1', port});
server.on('connection', socket => socket.on('message', raw => {
  const command = JSON.parse(raw.toString());
  const send = result => socket.send(JSON.stringify({id:command.id,result,sessionId:command.sessionId}));
  const event = (method, params={}) => socket.send(JSON.stringify({method,params,sessionId:'session-one'}));
  const error = message => socket.send(JSON.stringify({id:command.id,error:{code:-32601,message}}));
  const expression = command.params?.expression ?? '';
  if (command.method === 'Target.createTarget') return send({targetId:'target-one'});
  if (command.method === 'Target.attachToTarget') return send({sessionId:'session-one'});
  if (command.method === 'Page.enable' && mode === 'startup-stall') return;
  if (command.method === 'Page.navigate') {
    if (mode === 'crash' || (mode === 'crash-once' && sequence === 1)) return process.exit(12);
    if (mode === 'timeout') return;
    if (mode === 'delayed') { setTimeout(() => { send({frameId:'frame-one'}); event('Page.loadEventFired',{timestamp:1}); }, 250); return; }
    send({frameId:'frame-one'});
    event('Network.responseReceived', {response:{url:command.params.url + '?credential=synthetic#fragment',status:200},type:'Document'});
    return event('Page.loadEventFired',{timestamp:1});
  }
  if (command.method === 'Network.enable' && mode === 'unsupported') return error('UnknownMethod');
  if (command.method === 'Network.getCookies') return send(mode === 'malformed-cookies' ? {} : {cookies:[{name:'fixture',value:'synthetic',domain:'127.0.0.1',path:'/'}]});
  if (command.method === 'Runtime.evaluate') {
    if (mode === 'malformed-js') return send({});
    if (expression.includes('talox-probe')) return send({result:{type:'object',value:{math:2,dom:mode !== 'broken-dom'}}});
    if (expression.includes('ready: document.readyState')) return send({result:{type:'object',value:{url:${JSON.stringify(fixtureUrl)},ready:'complete',root:true,body:mode !== 'missing-body'}}});
    if (expression.includes("typeof e.click")) {
      if (expression.includes('e.click();')) {
        if (mode === 'ambiguous-click') return socket.close();
        return send({result:{type:'object',value:{performed:true}}});
      }
      return send({result:{type:'boolean',value:mode !== 'missing-target'}});
    }
    if (expression.includes('e.dispatchEvent')) return send({result:{type:'object',value:{performed:true}}});
    if (expression.includes("INPUT|TEXTAREA")) return send({result:{type:'boolean',value:true}});
    if (expression.includes('headings:')) return send({result:{type:'object',value:{url:${JSON.stringify(fixtureUrl)},title:'Fixture',text:'Hello',links:[],headings:[{level:1,text:'Hello'}]}}});
    if (expression.includes('attributes:')) return send({result:{type:'object',value:[{tag:'h1',text:'Hello',attributes:{id:'heading'}}]}});
    if (expression === 'throw-new-error') return send({exceptionDetails:{text:'Error'},result:{type:'undefined'}});
    if (expression === 'missing-result') return send({result:{type:'object',objectId:'remote'}});
    return send({result:{type:'number',value:42}});
  }
  return send({});
}));
`;
	await writeFile(executablePath, source);
	await chmod(executablePath, 0o755);
	const engine = new LightpandaEngine({ executablePath, startupTimeoutMs: 1200, shutdownTimeoutMs: 1000, ...options });
	t.after(() => engine.close());
	return { engine, eventsPath };
}

async function run(engine, task) { return engine.execute(task, new AbortController().signal); }
function failure(code, dispatched = false) { return (error) => error.code === code && error.dispatched === dispatched; }

test("Lightpanda reports an actionable installation error before dispatching a task", async () => {
	const engine = new LightpandaEngine({ executablePath: path.join(root, ".apex", "not-installed-lightpanda") });
	await assert.rejects(run(engine, fixtureTask()), (error) => error.code === "not-installed" && !error.dispatched && error.message.includes("node scripts/install-lightpanda.mjs"));
	await engine.close();
});

test("Lightpanda refuses untrusted content and rendering before starting a worker", async () => {
	const engine = new LightpandaEngine({ executablePath: "/nonexistent-lightpanda" });
	await assert.rejects(run(engine, { url: fixtureUrl, operation: "extract" }), failure("unsupported-capability"));
	await assert.rejects(run(engine, fixtureTask("extract", { trustedContent: "yes" })), failure("unsupported-capability"));
	await assert.rejects(run(engine, fixtureTask("screenshot")), failure("unsupported-capability"));
	await assert.rejects(run(engine, fixtureTask("extract", { requiredCapabilities: ["csp"] })), failure("unsupported-capability"));
	await assert.rejects(run(engine, fixtureTask("extract", { authenticated: true })), failure("unsupported-capability"));
	await engine.close();
});

test("Lightpanda validates task inputs and worker limits without claiming dispatch", async (t) => {
	assert.throws(() => new LightpandaEngine({ maxWorkers: 0.5 }), failure("invalid-task"));
	const { engine } = await mockEngine(t, "timeout", { maxWorkers: 1 });
	await assert.rejects(run(engine, fixtureTask("query")), failure("invalid-task"));
	await assert.rejects(run(engine, fixtureTask("fill", { selector: "input" })), failure("invalid-task"));
	await assert.rejects(run(engine, fixtureTask("extract", { url: "file:///fixture" })), failure("invalid-task"));
	const controller = new AbortController();
	const first = engine.execute(fixtureTask(), controller.signal);
	const firstRejected = assert.rejects(first, failure("operation-timeout"));
	await assert.rejects(run(engine, fixtureTask()), failure("queue-full"));
	controller.abort();
	await firstRejected;
});

test("Lightpanda requires the pinned executable version", async (t) => {
	const { engine } = await mockEngine(t, "wrong-version");
	await assert.rejects(run(engine, fixtureTask()), failure("startup-failed"));
});

test("Lightpanda probes actual DOM behaviour before navigating", async (t) => {
	const { engine } = await mockEngine(t, "broken-dom");
	await assert.rejects(run(engine, fixtureTask()), failure("broken-dom"));
});

test("Lightpanda treats a missing DOM or JavaScript result as a failed reading", async (t) => {
	const missingBody = await mockEngine(t, "missing-body");
	await assert.rejects(run(missingBody.engine, fixtureTask()), failure("broken-dom"));
	const missingJavaScript = await mockEngine(t, "malformed-js");
	await assert.rejects(run(missingJavaScript.engine, fixtureTask()), failure("execution-failed"));
	const missingCookies = await mockEngine(t, "malformed-cookies");
	await assert.rejects(run(missingCookies.engine, fixtureTask("cookies")), failure("execution-failed"));
});

test("Lightpanda extracts and queries serializable DOM data and executes JavaScript", async (t) => {
	const { engine } = await mockEngine(t);
	const extracted = await run(engine, fixtureTask());
	assert.equal(extracted.title, "Fixture");
	assert.deepEqual(extracted.headings, [{ level: 1, text: "Hello" }]);
	assert.deepEqual(await run(engine, fixtureTask("query", { selector: "h1" })), [{ tag: "h1", text: "Hello", attributes: { id: "heading" } }]);
	assert.equal(await run(engine, fixtureTask("evaluate", { expression: "40 + 2", readOnly: true })), 42);
	await assert.rejects(run(engine, fixtureTask("evaluate", { expression: "throw-new-error" })), failure("execution-failed", true));
	await assert.rejects(run(engine, fixtureTask("evaluate", { expression: "missing-result" })), failure("unsupported-capability", true));
});

test("Lightpanda reports supported click and fill actions only after explicit confirmation", async (t) => {
	const { engine } = await mockEngine(t);
	assert.deepEqual(await run(engine, fixtureTask("click", { selector: "button" })), { performed: true });
	assert.deepEqual(await run(engine, fixtureTask("fill", { selector: "input", value: "synthetic value" })), { performed: true });
	const missingTarget = await mockEngine(t, "missing-target");
	await assert.rejects(run(missingTarget.engine, fixtureTask("click", { selector: "button", readOnly: true })), failure("execution-failed"));
});

test("Lightpanda records an ambiguous click as dispatched so it cannot be blindly replayed", async (t) => {
	const { engine } = await mockEngine(t, "ambiguous-click");
	await assert.rejects(run(engine, fixtureTask("click", { selector: "button", readOnly: true })), failure("engine-crashed", true));
});

test("Lightpanda reads supported cookies and sanitizes observed network URLs", async (t) => {
	const { engine } = await mockEngine(t);
	assert.equal((await run(engine, fixtureTask("cookies")))[0].name, "fixture");
	assert.deepEqual(await run(engine, fixtureTask("network")), [{ url: fixtureUrl, status: 200, type: "document" }]);
	const unsupported = await mockEngine(t, "unsupported");
	await assert.rejects(run(unsupported.engine, fixtureTask("network")), failure("unsupported-command"));
});

test("Lightpanda bounds a CDP startup command that never responds", async (t) => {
	const { engine } = await mockEngine(t, "startup-stall", { startupTimeoutMs: 700 });
	const started = performance.now();
	await assert.rejects(run(engine, fixtureTask()), failure("operation-timeout"));
	assert.ok(performance.now() - started < 1800);
});

test("Lightpanda terminates timed out and crashed workers and can run a fresh task", async (t) => {
	const crashed = await mockEngine(t, "crash-once");
	await assert.rejects(run(crashed.engine, fixtureTask()), failure("engine-crashed"));
	assert.equal((await run(crashed.engine, fixtureTask())).title, "Fixture");
	const timedOut = await mockEngine(t, "timeout");
	await assert.rejects(run(timedOut.engine, fixtureTask("extract", { timeoutMs: 700 })), failure("operation-timeout"));
	for (const fixture of [crashed, timedOut]) {
		assert.equal((await fixture.engine.getResourceUsage()).workers, 0);
		const pids = (await readFile(fixture.eventsPath, "utf8")).trim().split("\n").map(Number);
		for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
	}
});

test("Lightpanda cancellation settles only the selected worker and preserves a concurrent task", async (t) => {
	const { engine, eventsPath } = await mockEngine(t, "delayed");
	const stopped = new AbortController();
	const active = new AbortController();
	const first = engine.execute(fixtureTask(), stopped.signal);
	const rejected = assert.rejects(first, failure("operation-timeout"));
	const second = engine.execute(fixtureTask(), active.signal);
	const completed = Promise.all([rejected, second]);
	void completed.catch(() => {});
	const started = performance.now();
	while (true) {
		try { if ((await readFile(eventsPath, "utf8")).trim().split("\n").length === 2) break; }
		catch (error) { if (error.code !== "ENOENT") throw error; }
		assert.ok(performance.now() - started < 1200, "Both owned workers must start before cancellation");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.equal((await engine.getResourceUsage()).workers, 2);
	stopped.abort();
	await engine.cancel(stopped.signal);
	const [, result] = await completed;
	assert.equal(result.title, "Fixture");
	assert.equal((await engine.getResourceUsage()).workers, 0);
});

test("Lightpanda telemetry measures startup navigation and execution without altering results", async (t) => {
	const measurements = [];
	const { engine } = await mockEngine(t, "ok", { onTiming: (measurement) => { measurements.push(measurement); if (measurement.phase === "execution") throw new Error("diagnostic fixture"); } });
	const signal = new AbortController().signal;
	assert.equal((await engine.execute(fixtureTask(), signal)).title, "Fixture");
	assert.deepEqual(measurements.map((entry) => entry.phase), ["startup", "navigation", "execution"]);
	assert.ok(measurements.every((entry) => entry.signal === signal && entry.durationMs >= 0));
	await engine.close();
	await assert.rejects(run(engine, fixtureTask()), failure("router-closed"));
});

test("The CDP transport rejects malformed responses and unsupported commands", async (t) => {
	const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
	await new Promise((resolve) => server.once("listening", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	server.on("connection", (socket) => socket.on("message", (raw) => {
		const request = JSON.parse(raw.toString());
		if (request.method === "Bad.event") { socket.send(JSON.stringify({ method: "Network.responseReceived", params: [] })); return; }
		if (request.method === "Null.result") { socket.send(JSON.stringify({ id: request.id, result: null })); return; }
		socket.send(JSON.stringify(request.method === "Unsupported.command" ? { id: request.id, error: { code: -32601, message: "UnknownMethod" } } : { id: request.id }));
	}));
	const connection = await CdpConnection.connect(`ws://127.0.0.1:${server.address().port}`, 1000);
	t.after(() => connection.close());
	await assert.rejects(connection.send("Unsupported.command"), (error) => error.code === "unsupported-command");
	await assert.rejects(connection.send("Missing.result"), (error) => error.code === "execution-failed");
	await assert.rejects(connection.send("Null.result"), (error) => error.code === "execution-failed");
	await assert.rejects(connection.send("Bad.event"), (error) => error.code === "execution-failed");
	connection.close();
});

const realExecutable = path.join(root, ".apex/cache/lightpanda/1.0.0/lightpanda");
test("The pinned Lightpanda binary executes local DOM JavaScript forms cookies and network tasks in isolated sessions", { skip: !existsSync(realExecutable) && "Install the pinned official binary to run this integration fixture" }, async (t) => {
	const server = http.createServer((_request, response) => {
		response.setHeader("Content-Type", "text/html");
		response.setHeader("Set-Cookie", "fixture=synthetic; Path=/; SameSite=Lax");
		response.end('<!doctype html><html><head><title>Actual fixture</title></head><body><h1 id="heading">Hello real engine</h1><a href="/next">Next</a><input id="input"><button id="button" onclick="document.querySelector(\'#heading\').textContent=\'clicked\'">Click</button><div id="rendered"></div><script>document.querySelector("#rendered").textContent="JavaScript rendered";</script></body></html>');
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const engine = new LightpandaEngine({ executablePath: realExecutable });
	t.after(() => engine.close());
	const url = `http://127.0.0.1:${server.address().port}/fixture`;
	const task = (operation, extra = {}) => fixtureTask(operation, { url, ...extra });
	const extracted = await run(engine, task("extract"));
	assert.equal(extracted.title, "Actual fixture");
	assert.match(extracted.text, /JavaScript rendered/);
	assert.equal((await run(engine, task("query", { selector: "h1" })))[0].text, "Hello real engine");
	assert.equal(await run(engine, task("evaluate", { expression: "Promise.resolve(40 + 2)", readOnly: true })), 42);
	assert.deepEqual(await run(engine, task("fill", { selector: "#input", value: "hello" })), { performed: true });
	assert.deepEqual(await run(engine, task("click", { selector: "#button" })), { performed: true });
	assert.equal((await run(engine, task("cookies")))[0].name, "fixture");
	assert.ok((await run(engine, task("network"))).some((entry) => entry.url === url && entry.status === 200));
	assert.equal(await run(engine, task("evaluate", { expression: "document.querySelector('#heading').textContent", readOnly: true })), "Hello real engine");
	assert.equal((await engine.getResourceUsage()).workers, 0);
});

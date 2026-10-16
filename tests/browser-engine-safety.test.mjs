import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { ChromiumEngine } from "../dist/core/browser/ChromiumEngine.js";
import { BrowserEngineError } from "../dist/core/browser/types.js";
import { TaloxController } from "../dist/core/controller/TaloxController.js";

const task = { url: "http://127.0.0.1/fixture", operation: "extract", trustedContent: true };

function deferred() {
	let resolve;
	const promise = new Promise((yes) => { resolve = yes; });
	return { promise, resolve };
}

async function until(predicate) {
	for (let index = 0; index < 200; index++) {
		if (predicate()) return;
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.fail("Expected asynchronous fixture state was never reached");
}

function controller(config = {}) {
	const subject = new TaloxController(".apex/controller-safety-tests", config);
	subject._session.stop = async () => {};
	return subject;
}

function recordingPage() {
	const scripts = [];
	const routes = [];
	const listeners = new Map();
	return {
		scripts,
		routes,
		listeners,
		addInitScript: async (script) => { scripts.push(script); },
		route: async (_, handler) => { routes.push(handler); },
		on: (name, handler) => { listeners.set(name, handler); },
	};
}

function guardRuntime(script) {
	const calls = { beacons: 0 };
	class OwnedWebSocket {}
	class OwnedRequest {
		open() {}
		send() {}
		abort() {}
	}
	const context = {
		URL,
		location: new URL(task.url),
		navigator: { sendBeacon: () => { calls.beacons++; return true; } },
		WebSocket: OwnedWebSocket,
		XMLHttpRequest: OwnedRequest,
		fetch: async () => ({ ok: true }),
		console: { warn: () => {}, error: () => {} },
	};
	context.window = context;
	runInNewContext(script, context);
	return { context, calls };
}

function mockedChromium(options = {}) {
	const calls = { navigations: 0, clicks: 0, closed: 0 };
	const page = {
		setDefaultTimeout: () => {},
		on: () => {},
		goto: async () => { calls.navigations++; return { status: () => 200 }; },
		locator: () => ({ click: async () => { calls.clicks++; } }),
	};
	const context = { newPage: async () => page, close: async () => { calls.closed++; } };
	const parent = { browser: () => ({ newContext: async () => context }) };
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests", ...options });
	engine.ensureBrowser = async () => parent;
	return { engine, parent, context, page, calls };
}

test("An authenticated task queued for one session never borrows a replacement session", async (t) => {
	const subject = controller({ browserEngine: { mode: "human", concurrency: { chromium: 1 } } });
	const sessionA = { name: "owned-session-a" };
	const sessionB = { name: "owned-session-b" };
	let activeContext = sessionA;
	subject._session.profile = { class: "sandbox" };
	subject._session.getPlaywrightPage = () => ({ context: () => activeContext });
	subject.getBrowserEngineTelemetry();
	const router = subject.browserRouter;
	const original = router.adapters.chromium;
	const gate = deferred();
	const borrowed = [];
	router.adapters.chromium = {
		name: "chromium",
		capabilities: original.capabilities,
		execute: async (request) => {
			borrowed.push(original.options.getAuthenticatedContext(request));
			return gate.promise;
		},
		close: async () => { gate.resolve("closed"); },
	};
	t.after(async () => { gate.resolve("closed"); await subject.stop(); await original.close(); });
	const first = subject.runBrowserTask({ ...task, authenticated: true });
	await until(() => borrowed.length === 1);
	const queued = subject.runBrowserTask({ ...task, authenticated: true });
	const rejected = assert.rejects(queued, (error) => error.code === "invalid-task" && error.dispatched === false && /session changed/i.test(error.message));
	await until(() => router.getTelemetry().queuedTasks === 1);
	activeContext = sessionB;
	gate.resolve("completed under the original session");
	assert.equal((await first).value, "completed under the original session");
	await rejected;
	assert.deepEqual(borrowed, [sessionA]);
	assert.equal(router.getTelemetry().runningWorkers, 0);
});

test("Routed strict guards keep their own allowlists without contaminating the persistent session cache", async (t) => {
	const subject = controller({ settings: { networkGuard: "strict" } });
	t.after(() => subject.stop());
	const sandboxPage = recordingPage();
	await subject._session.prepareRoutedPage(sandboxPage);
	assert.equal(subject._session._networkGuard, null);
	const sandbox = guardRuntime(sandboxPage.scripts[0]);
	assert.equal(sandbox.context.navigator.sendBeacon("https://outside.invalid/fixture"), true);
	assert.equal(sandbox.calls.beacons, 1);
	subject._session.profile = { class: "ops" };
	const opsPage = recordingPage();
	await subject._session.prepareRoutedPage(opsPage);
	const ops = guardRuntime(opsPage.scripts[0]);
	assert.equal(ops.context.navigator.sendBeacon("https://outside.invalid/fixture"), false);
	assert.equal(ops.context.navigator.sendBeacon("https://github.com/owned-fixture"), true);
	assert.equal(ops.calls.beacons, 1);
	assert.equal(subject._session._networkGuard, null);
	const persistentPage = recordingPage();
	await subject._session.injectNetworkGuard(persistentPage);
	const persistent = guardRuntime(persistentPage.scripts[0]);
	assert.equal(persistent.context.navigator.sendBeacon("https://outside.invalid/fixture"), false);
	assert.equal(persistent.calls.beacons, 0);
});

test("A routed page keeps its captured ops request and popup guards after the active profile changes", async (t) => {
	const subject = controller();
	t.after(() => subject.stop());
	subject._session.profile = { class: "ops" };
	const page = recordingPage();
	await subject._session.prepareRoutedPage(page);
	subject._session.profile = { class: "sandbox" };
	let aborted;
	let continued = false;
	await page.routes[0]({
		request: () => ({
			method: () => "GET",
			url: () => "https://outside.invalid/owned-fixture",
			headers: () => ({ authorization: "synthetic-owned-fixture-marker" }),
			postData: () => null,
		}),
		abort: async (reason) => { aborted = reason; },
		continue: async () => { continued = true; },
	});
	assert.equal(aborted, "accessdenied");
	assert.equal(continued, false);
	let popupClosed = false;
	page.listeners.get("popup")({ url: () => "http://127.0.0.1/owned-popup", close: async () => { popupClosed = true; } });
	assert.equal(popupClosed, true);
});

test("Chromium revalidates policy after asynchronous startup before navigating or dispatching an action", async (t) => {
	let allowed = true;
	const started = deferred();
	const startup = deferred();
	const fixture = mockedChromium({ validateTask: () => {
		if (!allowed) throw new BrowserEngineError("invalid-task", "Owned policy changed during startup", { dispatched: false });
	} });
	t.after(() => fixture.engine.close());
	fixture.engine.ensureBrowser = async () => { started.resolve(); return startup.promise; };
	const pending = fixture.engine.execute({ ...task, operation: "click", selector: "#owned-button" }, new AbortController().signal);
	const rejected = assert.rejects(pending, (error) => error.code === "invalid-task" && error.dispatched === false);
	await started.promise;
	allowed = false;
	startup.resolve(fixture.parent);
	await rejected;
	assert.equal(fixture.calls.navigations, 0);
	assert.equal(fixture.calls.clicks, 0);
	assert.equal(fixture.calls.closed, 1);
	assert.equal(fixture.engine.workers.size, 0);
});

test("Chromium refuses a non-idempotent action when its policy changes during navigation", async (t) => {
	let allowed = true;
	const navigating = deferred();
	const navigation = deferred();
	const fixture = mockedChromium({ validateTask: () => {
		if (!allowed) throw new BrowserEngineError("invalid-task", "Owned policy changed during navigation", { dispatched: false });
	} });
	t.after(() => fixture.engine.close());
	fixture.page.goto = async () => { fixture.calls.navigations++; navigating.resolve(); return navigation.promise; };
	const pending = fixture.engine.execute({ ...task, operation: "click", selector: "#owned-button" }, new AbortController().signal);
	const rejected = assert.rejects(pending, (error) => error.code === "invalid-task" && error.dispatched === false);
	await navigating.promise;
	allowed = false;
	navigation.resolve({ status: () => 200 });
	await rejected;
	assert.equal(fixture.calls.navigations, 1);
	assert.equal(fixture.calls.clicks, 0);
	assert.equal(fixture.calls.closed, 1);
});

test("Chromium diagnostic callback failures cannot change a successfully executed action", async (t) => {
	const phases = [];
	const fixture = mockedChromium({ onTiming: ({ phase }) => { phases.push(phase); throw new Error("Owned diagnostic fixture failed"); } });
	t.after(() => fixture.engine.close());
	const result = await fixture.engine.execute({ ...task, operation: "click", selector: "#owned-button" }, new AbortController().signal);
	assert.deepEqual(result, { performed: true });
	assert.deepEqual(phases, ["startup", "navigation", "execution"]);
	assert.equal(fixture.calls.navigations, 1);
	assert.equal(fixture.calls.clicks, 1);
	assert.equal(fixture.calls.closed, 1);
	assert.equal(fixture.engine.workers.size, 0);
});

test("Chromium process signals refuse unread invalid and current PIDs and target only the stored positive owned PID", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	let connected = true;
	engine.browserContext = { browser: () => ({ isConnected: () => connected }) };
	let identity = "owned";
	engine.browserIdentity = identity;
	engine.readProcessIdentity = () => identity;
	const signals = [];
	t.mock.method(process, "kill", (pid, signal) => {
		assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid, "Every existence probe and signal must use a positive owned PID");
		if (signal !== 0) signals.push({ pid, signal });
		return true;
	});
	t.after(async () => { engine.browserContext = null; engine.browserPid = null; await engine.close(); });
	for (const pid of [null, undefined, 0, process.pid, -17, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
		engine.browserPid = pid;
		assert.throws(() => engine.signalOwnedBrowser("SIGTERM"), (error) => error.code === "cancellation-unconfirmed");
	}
	assert.deepEqual(signals, []);
	engine.browserPid = 910001;
	engine.signalOwnedBrowser("SIGTERM");
	engine.signalOwnedBrowser("SIGKILL");
	assert.deepEqual(signals, [{ pid: 910001, signal: "SIGTERM" }, { pid: 910001, signal: "SIGKILL" }]);
	connected = false;
	engine.signalOwnedBrowser("SIGKILL");
	assert.equal(signals.length, 3, "A disconnected CDP channel is not evidence that the owned process exited");
	identity = "replacement-process";
	assert.throws(() => engine.signalOwnedBrowser("SIGTERM"), (error) => error.code === "cancellation-unconfirmed" && /identity changed/.test(error.message));
	assert.equal(signals.length, 3, "A reused PID must never receive a termination signal");
});

test("Chromium shutdown exhausts bounded supervision and reports an unconfirmed owned process exit", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	const closing = deferred();
	let closeCalls = 0;
	let detached = 0;
	const browser = {
		isConnected: () => true,
		close: () => { closeCalls++; return closing.promise; },
		newBrowserCDPSession: async () => ({
			send: async () => ({ processInfo: [{ id: 910002, type: "browser" }] }),
			detach: async () => { detached++; },
		}),
	};
	engine.browserContext = { browser: () => browser };
	engine.browserPid = 910002;
	engine.browserIdentity = "owned";
	engine.readProcessIdentity = () => "owned";
	const signals = [];
	t.mock.method(process, "kill", (pid, signal) => { if (signal !== 0) signals.push({ pid, signal }); return true; });
	const budgets = [];
	const settledWithin = engine.settledWithin.bind(engine);
	engine.settledWithin = (promise, budget) => { budgets.push(budget); return settledWithin(promise, 5); };
	t.after(async () => { closing.resolve(); engine.browserContext = null; engine.browserPid = null; await engine.close(); });
	const started = performance.now();
	await assert.rejects(engine.close(), (error) => error.code === "cancellation-unconfirmed" && /did not stop/.test(error.message));
	assert.ok(performance.now() - started < 500, "Scaled supervision deadlines must remain bounded");
	assert.deepEqual(budgets, [2000, 3000, 2000, 20000]);
	assert.deepEqual(signals, [{ pid: 910002, signal: "SIGTERM" }, { pid: 910002, signal: "SIGKILL" }]);
	assert.equal(closeCalls, 1);
	assert.equal(detached, 1);
	assert.equal(engine.browserContext.browser(), browser, "Unconfirmed cleanup must retain ownership for a retry");
});

test("Closing an authenticated Chromium worker preserves its borrowed session and never signals that browser", async (t) => {
	let pageClosed = 0;
	let contextClosed = 0;
	let browserClosed = 0;
	const page = {
		setDefaultTimeout: () => {},
		on: () => {},
		goto: async () => ({ status: () => 200 }),
		locator: () => ({ click: async () => {} }),
		close: async () => { pageClosed++; },
	};
	const borrowed = {
		newPage: async () => page,
		close: async () => { contextClosed++; },
		browser: () => ({ isConnected: () => true, close: async () => { browserClosed++; } }),
	};
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests", getAuthenticatedContext: () => borrowed });
	const signals = [];
	t.mock.method(process, "kill", (pid, signal) => { signals.push({ pid, signal }); return true; });
	t.after(() => engine.close());
	assert.deepEqual(await engine.execute({ ...task, operation: "click", selector: "#owned-button", authenticated: true }, new AbortController().signal), { performed: true });
	await engine.close();
	assert.equal(pageClosed, 1);
	assert.equal(contextClosed, 0);
	assert.equal(browserClosed, 0);
	assert.deepEqual(signals, []);
	assert.equal(engine.browserContext, null);
});

test("Chromium records only children reported by its owned CDP connection and clears stale launch identities", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	const processes = [{ id: 910010, type: "browser" }, { id: 910011, type: "renderer" }, { id: 910012, type: "GPU" }];
	const identityReads = [];
	let detached = 0;
	const browser = {
		isConnected: () => false,
		newBrowserCDPSession: async () => ({
			send: async (method) => { assert.equal(method, "SystemInfo.getProcessInfo"); return { processInfo: processes }; },
			detach: async () => { detached++; },
		}),
	};
	const context = { browser: () => browser };
	engine.manager.launch = async () => context;
	engine.manager.closeAll = async () => {};
	engine.readProcessIdentity = (pid) => { identityReads.push(pid); return `owned-${pid}`; };
	engine.browserPid = 910009;
	engine.browserIdentity = "stale-browser";
	engine.ownedChildren.set(910008, "stale-child");
	t.mock.method(process, "kill", () => { assert.fail("Capturing readable owned identities must not signal a process"); });
	t.after(async () => { engine.browserContext = null; await engine.close(); });
	assert.equal(await engine.launchBrowser(), context);
	assert.equal(engine.browserPid, 910010);
	assert.equal(engine.browserIdentity, "owned-910010");
	assert.deepEqual([...engine.ownedChildren], [[910011, "owned-910011"], [910012, "owned-910012"]]);
	assert.deepEqual(identityReads, [910010, 910011, 910012]);
	assert.equal(detached, 1);
});

test("Chromium signals only stored positive child identities and skips children proven to have departed", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	engine.browserPid = 910020;
	engine.readProcessIdentity = (pid) => `owned-${pid}`;
	engine.rememberOwnedChildren([{ id: 910020 }, { id: 910021 }, { id: 910022 }]);
	const calls = [];
	t.mock.method(process, "kill", (pid, signal) => {
		assert.ok(Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid);
		calls.push({ pid, signal });
		if (pid === 910022) throw Object.assign(new Error("Owned fixture process exited"), { code: "ESRCH" });
		return true;
	});
	t.after(() => engine.close());
	engine.signalOwnedChildren();
	assert.deepEqual(calls, [{ pid: 910021, signal: 0 }, { pid: 910021, signal: "SIGKILL" }, { pid: 910022, signal: 0 }]);
	assert.ok(calls.every(({ pid }) => pid !== 910020 && pid !== 910023), "Parent and unreported processes must remain untouched");
});

test("Chromium refuses invalid child PIDs both when capturing ownership and before signalling stored children", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	engine.readProcessIdentity = () => "owned";
	const calls = [];
	t.mock.method(process, "kill", (pid, signal) => { calls.push({ pid, signal }); return true; });
	t.after(() => engine.close());
	for (const pid of [undefined, null, 0, -21, 0.5, Number.NaN, Number.POSITIVE_INFINITY, process.pid]) {
		assert.throws(() => engine.rememberOwnedChildren([{ id: pid }]), (error) => error.code === "cancellation-unconfirmed");
		engine.ownedChildren.clear();
		engine.ownedChildren.set(pid, "owned");
		assert.throws(() => engine.signalOwnedChildren(), (error) => error.code === "cancellation-unconfirmed");
	}
	assert.deepEqual(calls, []);
});

test("Chromium refuses to signal a stored child PID whose process identity has changed", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	engine.ownedChildren.set(910030, "owned-original-child");
	engine.readProcessIdentity = () => "replacement-child";
	const calls = [];
	t.mock.method(process, "kill", (pid, signal) => { calls.push({ pid, signal }); return true; });
	t.after(() => engine.close());
	assert.throws(() => engine.signalOwnedChildren(), (error) => error.code === "cancellation-unconfirmed" && /identity changed/.test(error.message));
	assert.deepEqual(calls, [{ pid: 910030, signal: 0 }]);
});

test("An unread Chromium child identity stays an error unless an existence probe proves that child exited", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	const unread = new Error("Owned child identity reading is unread");
	engine.readProcessIdentity = () => { throw unread; };
	let exited = false;
	const calls = [];
	t.mock.method(process, "kill", (pid, signal) => {
		calls.push({ pid, signal });
		if (exited) throw Object.assign(new Error("Owned fixture process exited"), { code: "ESRCH" });
		return true;
	});
	t.after(() => engine.close());
	assert.throws(() => engine.readLiveProcessIdentity(910040), (error) => error === unread);
	assert.throws(() => engine.rememberOwnedChildren([{ id: 910040 }]), (error) => error === unread);
	assert.equal(engine.ownedChildren.size, 0);
	engine.ownedChildren.set(910040, "owned-original-child");
	assert.throws(() => engine.signalOwnedChildren(), (error) => error === unread);
	assert.ok(calls.every(({ signal }) => signal === 0), "Unread ownership must never authorize a termination signal");
	exited = true;
	assert.equal(engine.readLiveProcessIdentity(910040), null);
	engine.ownedChildren.clear();
	engine.rememberOwnedChildren([{ id: 910040 }]);
	assert.equal(engine.ownedChildren.size, 0);
	engine.ownedChildren.set(910040, "owned-original-child");
	assert.doesNotThrow(() => engine.signalOwnedChildren());
	assert.ok(calls.every(({ signal }) => signal === 0));
});

test("A failed shutdown CDP reading remains observable after Chromium still completes owned graceful cleanup", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	const unread = new Error("Owned CDP process list is unread");
	let connected = true;
	let closeCalls = 0;
	let managerClosed = 0;
	let detached = 0;
	const browser = {
		isConnected: () => connected,
		close: async () => { closeCalls++; connected = false; },
		newBrowserCDPSession: async () => ({
			send: async () => { throw unread; },
			detach: async () => { detached++; },
		}),
	};
	engine.browserContext = { browser: () => browser };
	engine.manager.closeAll = async () => { managerClosed++; };
	t.mock.method(process, "kill", () => { assert.fail("Completed graceful cleanup does not need a process signal"); });
	t.after(() => engine.close());
	await assert.rejects(engine.close(), (error) => error.code === "cancellation-unconfirmed" && error.cause === unread);
	assert.equal(closeCalls, 1);
	assert.equal(managerClosed, 1);
	assert.equal(detached, 1);
	assert.equal(engine.browserContext, null);
	assert.equal(engine.ownedChildren.size, 0);
});

test("A stalled Chromium worker close cannot block owned browser shutdown and remains a bounded error", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	const workerClosing = deferred();
	const events = [];
	let connected = true;
	const browser = {
		isConnected: () => connected,
		newBrowserCDPSession: async () => ({ send: async () => ({ processInfo: [] }), detach: async () => {} }),
		close: async () => { events.push("browser-close"); connected = false; },
	};
	engine.browserContext = { browser: () => browser };
	engine.workers.set(new AbortController().signal, { context: { close: () => { events.push("worker-close"); return workerClosing.promise; } } });
	engine.manager.closeAll = async () => { events.push("manager-close"); };
	const budgets = [];
	const settledWithin = engine.settledWithin.bind(engine);
	engine.settledWithin = (promise, budget) => { budgets.push(budget); return settledWithin(promise, 5); };
	t.mock.method(process, "kill", () => { assert.fail("A gracefully closed owned browser must not be signalled"); });
	t.after(async () => { workerClosing.resolve(); engine.workers.clear(); engine.browserContext = null; await engine.close(); });
	await assert.rejects(engine.close(), (error) => error.code === "cancellation-unconfirmed" && /worker pages did not close/.test(error.message));
	assert.deepEqual(events, ["worker-close", "browser-close", "manager-close"]);
	assert.deepEqual(budgets, [2000, 3000, 5000]);
	assert.equal(engine.browserContext.browser(), browser, "Incomplete worker cleanup must retain owned state for a retry");
});

test("A crashed Chromium browser disposes its old managed context and owned children before relaunching", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	const events = [];
	const oldContext = { browser: () => ({ isConnected: () => false }) };
	const newContext = { browser: () => ({
		isConnected: () => false,
		newBrowserCDPSession: async () => ({
			send: async () => ({ processInfo: [{ id: 910052, type: "browser" }, { id: 910053, type: "renderer" }] }),
			detach: async () => {},
		}),
	}) };
	engine.browserContext = oldContext;
	engine.browserPid = 910050;
	engine.browserIdentity = "owned-910050";
	engine.ownedChildren.set(910051, "owned-910051");
	engine.readLiveProcessIdentity = (pid) => pid === 910050 ? null : `owned-${pid}`;
	engine.readProcessIdentity = (pid) => `owned-${pid}`;
	engine.manager.closeAll = async () => { events.push("dispose-old-context"); assert.equal(engine.browserContext, oldContext); };
	engine.manager.launch = async () => {
		events.push("launch-new-context");
		assert.equal(engine.browserContext, null);
		assert.equal(engine.browserPid, null);
		assert.equal(engine.ownedChildren.size, 0);
		return newContext;
	};
	const signals = [];
	t.mock.method(process, "kill", (pid, signal) => {
		assert.equal(pid, 910051, "Restart must touch only the previously captured owned child");
		if (signal !== 0) { signals.push({ pid, signal }); events.push("stop-old-child"); }
		return true;
	});
	t.after(async () => { engine.browserContext = null; engine.manager.closeAll = async () => {}; await engine.close(); });
	assert.equal(await engine.ensureBrowser(), newContext);
	assert.deepEqual(events, ["stop-old-child", "dispose-old-context", "launch-new-context"]);
	assert.deepEqual(signals, [{ pid: 910051, signal: "SIGKILL" }]);
	assert.equal(engine.browserContext, newContext);
	assert.equal(engine.browserPid, 910052);
	assert.equal(engine.browserIdentity, "owned-910052");
	assert.deepEqual([...engine.ownedChildren], [[910053, "owned-910053"]]);
});

test("A disconnected Chromium browser with a running or unread main process refuses restart and retains ownership", async (t) => {
	const unread = new Error("Owned disconnected process identity is unread");
	t.mock.method(process, "kill", () => { assert.fail("Unconfirmed restart cannot signal a process"); });
	for (const reading of ["owned-main-still-running", unread]) {
		const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
		const oldContext = { browser: () => ({ isConnected: () => false }) };
		engine.browserContext = oldContext;
		engine.browserPid = 910060;
		engine.browserIdentity = "owned-main-still-running";
		engine.ownedChildren.set(910061, "owned-child");
		engine.readLiveProcessIdentity = () => { if (reading instanceof Error) throw reading; return reading; };
		engine.manager.closeAll = async () => { assert.fail("The old managed context cannot be discarded before its process exits"); };
		engine.manager.launch = async () => { assert.fail("Unconfirmed ownership cannot launch a replacement browser"); };
		t.after(async () => { engine.browserContext = null; engine.manager.closeAll = async () => {}; await engine.close(); });
		await assert.rejects(engine.ensureBrowser(), (error) => reading instanceof Error ? error === unread : error.code === "cancellation-unconfirmed" && error.dispatched === false);
		assert.equal(engine.browserContext, oldContext);
		assert.equal(engine.browserPid, 910060);
		assert.equal(engine.browserIdentity, "owned-main-still-running");
		assert.deepEqual([...engine.ownedChildren], [[910061, "owned-child"]]);
		assert.equal(engine.starting, null);
	}
});

test("Closing Chromium during asynchronous launch records ownership before supervising the new browser", async (t) => {
	const engine = new ChromiumEngine({ profileRoot: ".apex/controller-safety-tests" });
	const launched = deferred();
	const launching = deferred();
	let connected = true;
	let browserClosed = 0;
	let managerClosed = 0;
	let detached = 0;
	const browser = {
		isConnected: () => connected,
		newBrowserCDPSession: async () => ({
			send: async () => ({ processInfo: [{ id: 910070, type: "browser" }, { id: 910071, type: "renderer" }] }),
			detach: async () => { detached++; },
		}),
		close: async () => {
			assert.equal(engine.browserPid, 910070);
			assert.equal(engine.browserIdentity, "owned-910070");
			assert.deepEqual([...engine.ownedChildren], [[910071, "owned-910071"]]);
			browserClosed++;
			connected = false;
		},
	};
	const context = { browser: () => browser, close: async () => { assert.fail("Launch must leave shutdown to owned browser supervision"); } };
	engine.manager.launch = () => { launching.resolve(); return launched.promise; };
	engine.manager.closeAll = async () => { managerClosed++; };
	engine.readProcessIdentity = (pid) => `owned-${pid}`;
	t.mock.method(process, "kill", () => { assert.fail("Completed graceful launch-race shutdown must not signal a process"); });
	t.after(() => engine.close());
	const startup = engine.ensureBrowser();
	const rejected = assert.rejects(startup, (error) => error.code === "router-closed" && error.dispatched === false);
	await launching.promise;
	const stopping = engine.close();
	launched.resolve(context);
	await Promise.all([rejected, stopping]);
	assert.equal(browserClosed, 1);
	assert.equal(managerClosed, 1);
	assert.equal(detached, 2);
	assert.equal(engine.browserContext, null);
	assert.equal(engine.browserPid, null);
	assert.equal(engine.ownedChildren.size, 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { TaloxController } from "../dist/core/controller/TaloxController.js";
import { ChromiumEngine } from "../dist/core/browser/ChromiumEngine.js";

const task = { url: "http://127.0.0.1/fixture", operation: "extract", trustedContent: true };
function controller(config = {}) { return new TaloxController(".apex/controller-tests", config); }
function installRouter(subject, execute) {
  subject.browserRouter = { execute, close: async () => {}, getTelemetry: () => ({}), refreshResources: async () => ({}) };
  subject._session.stop = async () => {};
}

test("The controller exposes AUTO routing without changing the existing rendered page contract", async () => {
  const subject = controller();
  assert.equal(subject.getBrowserEngineTelemetry().mode, "auto");
  assert.equal(subject._session.getPlaywrightPage(), null);
  subject.setBrowserEngineMode("machine");
  assert.equal(subject.getBrowserEngineTelemetry().mode, "machine");
  await subject.stop();
});

test("The controller applies configured worker limits to both the router and Lightpanda adapter", async () => {
  const subject = controller({ browserEngine: { concurrency: { lightpanda: 10 } } });
  subject.getBrowserEngineTelemetry();
  assert.equal(subject.browserRouter.adapters.lightpanda.maxWorkers, 10);
  assert.equal(subject.browserRouter.limits.lightpanda, 10);
  await subject.stop();
});

test("The controller preserves navigation and action policy before any routed task dispatch", async () => {
  const subject = controller();
  let calls = 0;
  installRouter(subject, async () => { calls++; });
  subject._session.profile = { class: "ops" };
  await assert.rejects(subject.runBrowserTask({ ...task, url: "https://outside.invalid" }), /blocked by the session policy/);
  await assert.rejects(subject.runBrowserTask({ ...task, operation: "click", selector: "#delete-account" }), /blocked by the session policy/);
  assert.equal(calls, 0);
  await subject.stop();
});

test("The controller requires Chromium request guards for guarded profiles network settings and origin headers", async () => {
  for (const config of [{ settings: { networkGuard: "strict" } }, { originHeaders: { "http://127.0.0.1": { "X-Owned-Fixture": "yes" } } }, {}]) {
    const subject = controller(config);
    if (Object.keys(config).length === 0) subject._session.profile = { class: "ops" };
    let received;
    installRouter(subject, async (value) => { received = value; return { engine: "chromium", value: {}, durationMs: 1 }; });
    await subject.runBrowserTask(task);
    assert.ok(received.requiredCapabilities.includes("request-policy"));
    await subject.stop();
  }
});

test("The controller keeps approval denial observable and never starts an engine afterward", async () => {
  const subject = controller();
  let calls = 0;
  installRouter(subject, async () => { calls++; });
  subject.setOnRiskyActionHook(async () => false);
  await assert.rejects(subject.runBrowserTask(task), /blocked by the approval hook/);
  assert.equal(calls, 0);
  await subject.stop();
});

test("An approval that spans controller shutdown cannot start a fresh browser after stop completes", async () => {
  const subject = controller();
  let approve;
  let calls = 0;
  installRouter(subject, async () => { calls++; });
  subject.setOnRiskyActionHook((action) => action === "navigate" ? new Promise((resolve) => { approve = resolve; }) : Promise.resolve(true));
  const pending = subject.runBrowserTask(task);
  await subject.stop();
  approve(true);
  await assert.rejects(pending, (error) => error.code === "router-closed");
  assert.equal(calls, 0);
});

test("Human takeover beginning during approval prevents the machine task from dispatching", async () => {
  const subject = controller();
  let approve;
  let calls = 0;
  installRouter(subject, async () => { calls++; });
  subject.setOnRiskyActionHook((action) => action === "navigate" ? new Promise((resolve) => { approve = resolve; }) : Promise.resolve(true));
  const pending = subject.runBrowserTask(task);
  subject.takeoverState = "WAITING_FOR_HUMAN";
  approve(true);
  await assert.rejects(pending, /paused during browser task approval/);
  assert.equal(calls, 0);
  await subject.stop();
});

test("Standalone Chromium adapters expose request guards and authenticated sessions only when configured", async () => {
  const plain = new ChromiumEngine();
  assert.equal(plain.capabilities.has("request-policy"), false);
  assert.equal(plain.capabilities.has("authenticated-session"), false);
  await assert.rejects(plain.execute({ ...task, requiredCapabilities: ["request-policy"] }, new AbortController().signal), (error) => error.code === "unsupported-capability" && !error.dispatched);
  const configured = new ChromiumEngine({ preparePage: async () => {}, getAuthenticatedContext: () => null });
  assert.equal(configured.capabilities.has("request-policy"), true);
  assert.equal(configured.capabilities.has("authenticated-session"), true);
  await plain.close();
  await configured.close();
});

test("Changing the session profile during approval cannot dispatch under stale sandbox permissions", async () => {
  const subject = controller();
  let approve;
  let calls = 0;
  installRouter(subject, async () => { calls++; });
  subject.setOnRiskyActionHook((action) => action === "navigate" ? new Promise((resolve) => { approve = resolve; }) : Promise.resolve(true));
  const pending = subject.runBrowserTask({ ...task, url: "https://outside.invalid" });
  subject._session.profile = { class: "ops" };
  approve(true);
  await assert.rejects(pending, /Session changed during browser task approval/);
  assert.equal(calls, 0);
  await subject.stop();
});

test("A routed engine cleanup failure still closes the existing human session and stays observable", async () => {
  const subject = controller();
  let sessionClosed = false;
  subject.browserRouter = { close: async () => { throw new Error("unconfirmed worker exit"); } };
  subject._session.stop = async () => { sessionClosed = true; };
  await assert.rejects(subject.stop(), /unconfirmed worker exit/);
  assert.equal(sessionClosed, true);
});

test("Chromium resource telemetry reports active workers together with measured RAM and CPU", async () => {
  const subject = new ChromiumEngine();
  let detached = false;
  subject.browserContext = { browser: () => ({ isConnected: () => true, newBrowserCDPSession: async () => ({ send: async () => ({ processInfo: [{ id: process.pid }] }), detach: async () => { detached = true; } }) }) };
  subject.workers.set(new AbortController().signal, {});
  const usage = await subject.getResourceUsage();
  assert.equal(usage.status, "available");
  assert.ok(usage.rssBytes > 0);
  assert.equal(usage.workers, 1);
  assert.equal(detached, true);
  subject.workers.clear();
  subject.browserContext = null;
  await subject.close();
});

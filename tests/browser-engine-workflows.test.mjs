import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { TaloxController } from "../dist/core/controller/TaloxController.js";
import { ChromiumEngine } from "../dist/core/browser/ChromiumEngine.js";
import { LightpandaEngine } from "../dist/core/browser/LightpandaEngine.js";
import { startFixtureServer } from "../scripts/benchmark-browser-engines.mjs";

const live = process.env.TALOX_ENGINE_INTEGRATION === "1";

test("Both genuine browser engines return matching DOM and JavaScript results on owned fixtures", { skip: !live }, async (t) => {
  const server = await startFixtureServer();
  t.after(() => server.close());
  for (const Engine of [ChromiumEngine, LightpandaEngine]) {
    const engine = new Engine();
    try {
      const task = { url: `${server.origin}/javascript`, trustedContent: true, timeoutMs: 15000 };
      const value = await engine.execute({ ...task, operation: "evaluate", expression: "document.querySelectorAll('a').length", readOnly: true }, new AbortController().signal);
      assert.equal(value, 100);
      const query = await engine.execute({ ...task, operation: "query", selector: "a" }, new AbortController().signal);
      assert.equal(query.length, 100);
      assert.equal(query[0].tag, "a");
      const form = await engine.execute({ ...task, url: `${server.origin}/form`, operation: "fill", selector: "#name", value: "Talox fixture" }, new AbortController().signal);
      assert.deepEqual(form, { performed: true });
      const extracted = await engine.execute({ ...task, url: `${server.origin}/static`, operation: "extract" }, new AbortController().signal);
      assert.equal(extracted.links.length, 100);
      assert.ok(extracted.title);
    } finally { await engine.close(); }
  }
});

test("AUTO executes trusted machine work on Lightpanda and renders screenshots through Chromium", { skip: !live }, async (t) => {
  const server = await startFixtureServer();
  t.after(() => server.close());
  const subject = new TaloxController(".apex/workflow-tests", { browserEngine: { operationTimeoutMs: 15000 } });
  t.after(() => subject.stop());
  const task = { url: `${server.origin}/static`, operation: "extract", trustedContent: true };
  assert.equal((await subject.runBrowserTask(task)).engine, "lightpanda");
  const screenshot = await subject.runBrowserTask({ ...task, operation: "screenshot" });
  assert.equal(screenshot.engine, "chromium");
  assert.equal(screenshot.fallback.reason, "unsupported-capability");
  assert.ok(Buffer.from(screenshot.value.data, "base64").subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  const secure = await subject.runBrowserTask({ url: task.url, operation: "query", selector: "a" });
  assert.equal(secure.engine, "chromium");
  assert.equal(secure.fallback.reason, "unsupported-capability");
  assert.equal(secure.value.length, 100);
});

test("Missing Lightpanda falls back to Chromium while preserving an actionable installation reason", { skip: !live }, async (t) => {
  const server = await startFixtureServer();
  t.after(() => server.close());
  const subject = new TaloxController(".apex/workflow-tests", { browserEngine: { lightpanda: { executablePath: ".apex/fixture-missing-lightpanda" } } });
  t.after(() => subject.stop());
  const result = await subject.runBrowserTask({ url: `${server.origin}/static`, operation: "extract", trustedContent: true });
  assert.equal(result.engine, "chromium");
  assert.equal(result.fallback.reason, "not-installed");
  assert.match(result.fallback.message, /lightpanda not installed: run node scripts\/install-lightpanda.mjs/);
  assert.equal(result.value.links.length, 100);
});

test("Authenticated routed work uses an isolated page in the explicitly active Chromium session", { skip: !live, timeout: 45000 }, async (t) => {
  const server = await startFixtureServer();
  const root = path.resolve(".apex/workflow-tests", randomUUID());
  await mkdir(root, { recursive: true });
  const subject = new TaloxController(root, { settings: { humanStealth: 0, automaticThinkingEnabled: false, fidgetEnabled: false, headed: false } });
  t.after(async () => { try { await subject.stop(); } finally { await server.close(); await rm(root, { recursive: true, force: true }); } });
  await subject.launch("owned-auth-fixture", "qa");
  const page = subject._session.getPlaywrightPage();
  await page.goto(`${server.origin}/authenticated`);
  const previousUrl = page.url();
  const previousPages = page.context().pages().length;
  const result = await subject.runBrowserTask({ url: `${server.origin}/empty`, operation: "cookies", authenticated: true });
  assert.equal(result.engine, "chromium");
  assert.equal(result.fallback.reason, "authenticated-session");
  assert.ok(result.value.some((cookie) => cookie.name === "fixture_session" && cookie.httpOnly));
  assert.equal(page.url(), previousUrl);
  assert.equal(page.isClosed(), false);
  assert.equal(page.context().pages().length, previousPages);
});

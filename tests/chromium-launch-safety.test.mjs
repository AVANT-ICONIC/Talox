import assert from "node:assert/strict";
import { test } from "node:test";
import { chromeLaunchArgs } from "../dist/core/browser/ChromeLaunchArgs.js";
import { BrowserManager } from "../dist/core/BrowserManager.js";
import { sampleBrowserProcesses } from "../dist/core/browser/ResourceMonitor.js";

test("Chromium launch flags preserve the operator keychain protection after caller overrides", () => {
  const manager = new BrowserManager();
  const options = manager.buildLaunchOptions({ args: ["--password-store=keychain", "--use-mock-keychain=false", "--other"] }, "chromium");
  assert.deepEqual(options.args, ["--other", "--use-mock-keychain", "--password-store=basic"]);
});

test("Shared Chrome flags are deterministic and do not accumulate duplicate protection switches", () => {
  assert.deepEqual(chromeLaunchArgs(chromeLaunchArgs(["--custom"])), ["--custom", "--use-mock-keychain", "--password-store=basic"]);
});

test("Firefox launch options keep the existing arguments without Chromium keychain flags", () => {
  assert.deepEqual(new BrowserManager().buildLaunchOptions({ args: ["--custom"] }, "firefox").args, ["--custom"]);
});

test("An absent browser resource reading remains unread instead of reporting zero memory", async () => {
  assert.deepEqual(await sampleBrowserProcesses([]), { rssBytes: null, cpuPercent: null, status: "unread", error: "No active browser process" });
});

test("Resource monitoring refuses unsafe or malformed process identifiers", async () => {
  for (const pid of [-1, 0, NaN, 1.2]) await assert.rejects(sampleBrowserProcesses([pid]), /Invalid browser PID/);
});

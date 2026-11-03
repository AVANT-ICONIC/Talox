import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { LIGHTPANDA_VERSION, installLightpanda, selectArtifact, verifyBinary } from "../scripts/install-lightpanda.mjs";
import { benchmarkWorkloads, closeMeasuredEngine, measureBatch, parseSwapUsage, quantile, scalingDecision, startFixtureServer, summarizeAttempts } from "../scripts/benchmark-browser-engines.mjs";

const artifactsRoot = path.resolve(".apex/tests");

async function withDirectory(run) {
  await mkdir(artifactsRoot, { recursive: true });
  const directory = await mkdtemp(path.join(artifactsRoot, "lightpanda-install-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test("Lightpanda downloads use a stable official release and platform specific SHA256", () => {
  for (const [platform, arch] of [["darwin", "arm64"], ["darwin", "x64"], ["linux", "arm64"], ["linux", "x64"]]) {
    const artifact = selectArtifact(platform, arch);
    assert.match(artifact.url, /^https:\/\/github\.com\/lightpanda-io\/browser\/releases\/download\/1\.0\.0\//);
    assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
    assert.ok(artifact.bytes > 1_000_000);
    assert.ok(Number.isSafeInteger(artifact.assetId));
  }
});

test("unsupported platforms fail with an actionable installation error", () => {
  assert.throws(() => selectArtifact("win32", "x64"), /no pinned binary.*supported macOS or glibc Linux/);
});

test("binary verification proves both size and SHA256 before execution permission is granted", async () => {
  await withDirectory(async (directory) => {
    const binaryPath = path.join(directory, "binary");
    const bytes = Buffer.from("verified fixture");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(binaryPath, bytes);
    assert.equal(await verifyBinary(binaryPath, { bytes: bytes.length, sha256 }), sha256);
    await assert.rejects(verifyBinary(binaryPath, { bytes: bytes.length + 1, sha256 }), /size mismatch/);
    await assert.rejects(verifyBinary(binaryPath, { bytes: bytes.length, sha256: "0".repeat(64) }), /SHA256 mismatch/);
  });
});

test("an unreadable cached binary is an error rather than an installed verdict", async () => {
  await withDirectory(async (directory) => {
    await assert.rejects(verifyBinary(path.join(directory, "missing"), selectArtifact("darwin", "arm64")), { code: "ENOENT" });
    await mkdir(path.join(directory, LIGHTPANDA_VERSION), { recursive: true });
    const binaryPath = path.join(directory, LIGHTPANDA_VERSION, "lightpanda");
    await writeFile(binaryPath, "corrupt");
    await assert.rejects(installLightpanda({ cacheDir: directory, platform: "darwin", arch: "arm64", fetchImpl: () => { throw new Error("must not download over corruption"); } }), /size mismatch/);
    assert.equal(await readFile(binaryPath, "utf8"), "corrupt");
  });
});

test("a failed official download leaves no executable or partial artifact", async () => {
  await withDirectory(async (directory) => {
    await assert.rejects(installLightpanda({ cacheDir: directory, platform: "darwin", arch: "arm64", fetchImpl: async () => new Response("unavailable", { status: 503 }) }), /HTTP 503/);
    assert.deepEqual(await readdir(path.join(directory, LIGHTPANDA_VERSION)), []);
    await assert.rejects(installLightpanda({ cacheDir: directory, platform: "darwin", arch: "arm64", fetchImpl: async () => new Response("truncated") }), /size mismatch/);
    assert.deepEqual(await readdir(path.join(directory, LIGHTPANDA_VERSION)), []);
  });
});

test("benchmark percentiles reject unread samples and leave absent metrics unread", () => {
  assert.equal(quantile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(quantile([5, 1, 3, 2, 4], 0.95), 5);
  assert.equal(quantile([], 0.5), null);
  assert.throws(() => quantile([Number.NaN], 0.5), /Unread/);
  const result = summarizeAttempts([{ status: "failed", code: "engine-crashed", durationMs: 4, phases: {} }]);
  assert.equal(result.successfulTaskLatencyMs.status, "unread");
  assert.equal(result.successfulTaskLatencyMs.p50, null);
  assert.equal(result.crashCount, 1);
  const unsupported = summarizeAttempts([{ status: "unsupported", code: "unsupported-capability", durationMs: 1, phases: {} }]);
  assert.equal(unsupported.unsupported, 1);
  assert.equal(unsupported.failed, 0);
  assert.equal(unsupported.successRate, 0);
});

test("benchmark scaling stops on swap growth and unread pressure cannot authorize concurrency", () => {
  assert.equal(parseSwapUsage("total = 1024.00M used = 12.50M free = 1011.50M"), 12.5 * 1024 ** 2);
  assert.throws(() => parseSwapUsage("unavailable"), /unread/);
  assert.throws(() => parseSwapUsage("used = 1.2.3M"), /unread/);
  const baseline = { status: "available", freeBytes: 64 * 1024 ** 3, swapBytes: 0, loadAverage: 0 };
  assert.equal(scalingDecision({ ...baseline, swapBytes: 65 * 1024 ** 2 }, baseline, 10).reason, "swap-growth");
  assert.equal(scalingDecision({ status: "unread" }, baseline, 10).allowed, false);
  assert.equal(scalingDecision(baseline, baseline, 10).reason, "worker-memory-unread");
  assert.equal(scalingDecision({ ...baseline, freeBytes: 1 }, baseline, 1).allowed, false);
  for (const field of ["freeBytes", "swapBytes", "loadAverage"]) {
    for (const invalid of [null, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      assert.equal(scalingDecision({ ...baseline, [field]: invalid }, baseline, 1).allowed, false);
    }
  }
  assert.equal(scalingDecision(baseline, baseline, 1, Number.NaN).reason, "invalid-worker-memory");
});

test("benchmark pressure monitoring stops new jobs inside a batch when swap starts growing", async () => {
  let checks = 0;
  let executed = 0;
  const baseline = { status: "available", freeBytes: 64 * 1024 ** 3, swapBytes: 0, loadAverage: 0 };
  const workload = { name: "owned", task: { timeoutMs: 1000 }, expected: (value) => value === 1 };
  const engine = { async execute() { executed++; return 1; } };
  const batch = await measureBatch(engine, [workload, workload, workload], 1, new WeakMap(), {
    baseline, pressureIntervalMs: 0,
    pressureReader: async () => (++checks === 1 ? baseline : { ...baseline, swapBytes: 65 * 1024 ** 2 }),
  });
  assert.equal(executed, 1);
  assert.equal(batch.attempts.length, 1);
  assert.equal(batch.jobsNotStarted, 2);
  assert.equal(batch.stopped.reason, "swap-growth");
});

test("benchmark shutdown failures remain recorded and fail the run even when resource readings also fail", async () => {
  const result = { lifecycle: {} };
  const engine = {
    async close() { throw Object.assign(new Error("Owned browser did not stop"), { code: "cancellation-unconfirmed" }); },
    async getResourceUsage() { throw new Error("Process metrics unread"); },
  };
  await assert.rejects(closeMeasuredEngine(engine, result), /Owned browser did not stop/);
  assert.equal(result.lifecycle.closeStatus, "failed");
  assert.equal(result.lifecycle.closeError.code, "cancellation-unconfirmed");
  assert.equal(result.lifecycle.afterCloseResources.status, "unread");
  assert.equal(result.lifecycle.afterCloseResources.rssBytes, null);
});

test("benchmark fixtures are served on loopback and only owned tasks assert trusted content", async () => {
  const fixture = await startFixtureServer();
  try {
    assert.match(fixture.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${fixture.origin}/static`);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal((body.match(/<a /g) ?? []).length, 100);
    assert.equal(body.includes("<script>"), false);
    assert.equal((await fetch(`${fixture.origin}/missing`)).status, 404);
    const workloads = benchmarkWorkloads(fixture.origin);
    assert.ok(workloads.every((workload) => workload.task.trustedContent === true && workload.task.url.startsWith(fixture.origin)));
    assert.equal(workloads.find((workload) => workload.name === "authenticated-site").task.authenticated, true);
  } finally { await fixture.close(); }
});

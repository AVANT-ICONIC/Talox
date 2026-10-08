import { execFile } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { LIGHTPANDA_VERSION, LIGHTPANDA_COMMIT, selectArtifact } from "./install-lightpanda.mjs";

const execFileAsync = promisify(execFile);
const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = path.join(checkoutRoot, "tests/fixtures/browser-engines");

export function quantile(values, probability) {
  if (values.length === 0) return null;
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) throw new Error("Unread or invalid benchmark sample");
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * probability) - 1)];
}

function distribution(values) {
  return { samples: values.length, p50: quantile(values, 0.5), p95: quantile(values, 0.95), status: values.length ? "measured" : "unread" };
}

export function parseSwapUsage(output) {
  const match = output.match(/used\s*=\s*([\d.]+)([KMG])/i);
  if (!match) throw new Error("Swap usage unread: unexpected sysctl output");
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Swap usage unread: invalid numeric value");
  return amount * ({ K: 1024, M: 1024 ** 2, G: 1024 ** 3 })[match[2].toUpperCase()];
}

export async function readResourcePressure() {
  try {
    let freeBytes = os.freemem();
    let swapBytes;
    if (process.platform === "darwin") {
      const [{ stdout: swap }, { stdout: pressure }] = await Promise.all([
        execFileAsync("/usr/sbin/sysctl", ["-n", "vm.swapusage"], { timeout: 2000 }),
        execFileAsync("/usr/bin/memory_pressure", ["-Q"], { timeout: 2000 }),
      ]);
      const match = pressure.match(/System-wide memory free percentage:\s*(\d+)%/);
      if (!match) throw new Error("Memory pressure unread: unexpected memory_pressure output");
      freeBytes = os.totalmem() * Number(match[1]) / 100;
      swapBytes = parseSwapUsage(swap);
    } else if (process.platform === "linux") {
      const memory = await readFile("/proc/meminfo", "utf8");
      const available = memory.match(/^MemAvailable:\s*(\d+) kB/m);
      const swapTotal = memory.match(/^SwapTotal:\s*(\d+) kB/m);
      const swapFree = memory.match(/^SwapFree:\s*(\d+) kB/m);
      if (!available || !swapTotal || !swapFree) throw new Error("Memory pressure unread: missing /proc/meminfo fields");
      freeBytes = Number(available[1]) * 1024;
      swapBytes = (Number(swapTotal[1]) - Number(swapFree[1])) * 1024;
    } else {
      throw new Error(`Swap monitoring unavailable on ${process.platform}`);
    }
    return { status: "available", freeBytes, swapBytes, loadAverage: os.loadavg()[0] };
  } catch (error) {
    return { status: "unread", error: error instanceof Error ? error.message : String(error), freeBytes: null, swapBytes: null, loadAverage: null };
  }
}

export function scalingDecision(pressure, baseline, concurrency, perWorkerBytes = null) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) return { allowed: false, reason: "invalid-concurrency" };
  if (pressure.status !== "available" || baseline.status !== "available") return { allowed: concurrency === 1, reason: "resource-pressure-unread" };
  if (![pressure, baseline].every((reading) => [reading.freeBytes, reading.swapBytes, reading.loadAverage].every((value) => Number.isFinite(value) && value >= 0))) return { allowed: false, reason: "invalid-resource-pressure" };
  if (perWorkerBytes !== null && (!Number.isFinite(perWorkerBytes) || perWorkerBytes < 0)) return { allowed: false, reason: "invalid-worker-memory" };
  const reserve = Math.max(2 * 1024 ** 3, os.totalmem() * 0.15);
  if (pressure.swapBytes > baseline.swapBytes + 64 * 1024 ** 2) return { allowed: false, reason: "swap-growth" };
  if (concurrency > 1 && perWorkerBytes === null) return { allowed: false, reason: "worker-memory-unread" };
  if (pressure.freeBytes < reserve + concurrency * (perWorkerBytes ?? 0)) return { allowed: false, reason: "memory-reserve" };
  if (concurrency > 1 && pressure.loadAverage > os.cpus().length * 0.9) return { allowed: false, reason: "shared-cpu-pressure" };
  return { allowed: true, reason: "within-reserve" };
}

export async function startFixtureServer() {
  const fixtures = new Map(await Promise.all(["static", "javascript", "form", "spa"].map(async (name) => [name, await readFile(path.join(fixtureRoot, `${name}.html`), "utf8")])));
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.setHeader("Cache-Control", "no-store");
    if (pathname === "/robots.txt") { response.end("User-agent: *\nAllow: /\n"); return; }
    if (pathname === "/empty") { response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Empty owned fixture</title><body>Ready</body>"); return; }
    if (pathname.startsWith("/article/")) { response.setHeader("Content-Type", "text/html"); response.end(`<!doctype html><title>Article</title><article>${pathname.slice(1)}</article>`); return; }
    if (pathname === "/authenticated") { response.setHeader("Set-Cookie", "fixture_session=owned-demo; HttpOnly; SameSite=Strict; Path=/"); response.setHeader("Content-Type", "text/html"); response.end("<!doctype html><title>Owned auth fixture</title><main>authenticated owned fixture</main>"); return; }
    const fixture = fixtures.get(pathname.slice(1));
    if (!fixture) { response.writeHead(404); response.end("Fixture missing"); return; }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(fixture);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server address unread");
  return { origin: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}

const extraction = `(() => { const clock = typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : null; const start = clock && clock(); const rows = Array.from(document.querySelectorAll('a')).map(a => ({text:a.textContent,href:a.getAttribute('href')})); return {rows,count:rows.length,extractionMs:clock ? clock()-start : null}; })()`;

export function benchmarkWorkloads(origin) {
  return [
    { name: "static-html", task: { url: `${origin}/static`, operation: "evaluate", expression: extraction, readOnly: true }, expected: (value) => value?.count === 100 },
    { name: "javascript-rendered", task: { url: `${origin}/javascript`, operation: "evaluate", expression: extraction, readOnly: true }, expected: (value) => value?.count === 100 },
    { name: "structured-extraction", task: { url: `${origin}/static`, operation: "evaluate", expression: "Array.from(document.querySelectorAll('a')).map(a => ({name:a.textContent,price:Number(a.getAttribute('data-price'))}))", readOnly: true }, expected: (value) => Array.isArray(value) && value.length === 100 && value[99].price === 100 },
    { name: "javascript-execution", task: { url: `${origin}/empty`, operation: "evaluate", expression: "(() => { const clock=typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : null; const start=clock && clock(); let sum=0; for(let i=0;i<100000;i++) sum+=i; return {sum,jsMs:clock ? clock()-start : null}; })()", readOnly: true }, expected: (value) => value?.sum === 4999950000 },
    { name: "form-interaction", task: { url: `${origin}/form`, operation: "evaluate", expression: "(() => { const field=document.querySelector('#name'); field.value='Talox owned fixture'; field.dispatchEvent(new Event('input',{bubbles:true})); return {value:field.value}; })()" }, expected: (value) => value?.value === "Talox owned fixture" },
    { name: "complex-spa", task: { url: `${origin}/spa`, operation: "evaluate", expression: "(() => { document.querySelector('#next').click(); return {selected:document.querySelector('#selected').textContent,links:document.querySelectorAll('a').length,hash:location.hash}; })()" }, expected: (value) => value?.selected === "1" && value?.links === 100 && value?.hash === "#item-1" },
    { name: "authenticated-site", task: { url: `${origin}/authenticated`, operation: "cookies", authenticated: true }, expected: (value) => Array.isArray(value) && value.some((cookie) => cookie.name === "fixture_session" && cookie.httpOnly === true) },
    ...Array.from({ length: 3 }, (_, index) => ({ name: `multi-page-${index + 1}`, task: { url: `${origin}/article/${index}`, operation: "evaluate", expression: "document.querySelector('article').textContent", readOnly: true }, expected: (value) => value === `article/${index}` })),
  ].map((workload) => ({ ...workload, task: { ...workload.task, trustedContent: true, timeoutMs: 15_000 } }));
}

async function runAttempt(engine, workload, timingRecords) {
  const controller = new AbortController();
  const phases = {};
  timingRecords.set(controller.signal, phases);
  const timer = setTimeout(() => controller.abort(new Error("Benchmark operation deadline")), workload.task.timeoutMs);
  const started = performance.now();
  try {
    const value = await engine.execute(workload.task, controller.signal);
    if (!workload.expected(value)) throw new Error(`Fixture correctness assertion failed for ${workload.name}`);
    return { workload: workload.name, status: "passed", durationMs: performance.now() - started, phases, recordsExtracted: typeof value?.count === "number" ? value.count : Array.isArray(value) ? value.length : null, extractionMs: value?.extractionMs ?? null, jsMs: value?.jsMs ?? null };
  } catch (error) {
    return { workload: workload.name, status: error?.code === "unsupported-capability" ? "unsupported" : "failed", durationMs: performance.now() - started, phases, code: error?.code ?? "execution-failed", error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    if (controller.signal.aborted && engine.cancel) await engine.cancel(controller.signal);
    timingRecords.delete(controller.signal);
  }
}

export async function measureBatch(engine, jobs, concurrency, timingRecords, { baseline, perWorkerBytes = null, pressureReader = readResourcePressure, pressureIntervalMs = 1000 } = {}) {
  const resourceSamples = [];
  let stopSampling = false;
  const sampling = (async () => {
    while (!stopSampling) {
      if (engine.getResourceUsage) {
        try { resourceSamples.push(await engine.getResourceUsage()); } catch (error) { resourceSamples.push({ status: "unread", rssBytes: null, error: String(error) }); }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  const attempts = [];
  let next = 0;
  let stopped;
  let lastPressureCheck = -Infinity;
  let pressureCheck;
  const pressureSamples = [];
  const scheduleAllowed = async () => {
    if (stopped) return false;
    if (pressureCheck) return pressureCheck;
    if (performance.now() - lastPressureCheck < pressureIntervalMs) return true;
    lastPressureCheck = performance.now();
    pressureCheck = (async () => {
      let pressure;
      try { pressure = await pressureReader(); } catch (error) { pressure = { status: "unread", error: String(error) }; }
      pressureSamples.push(pressure);
      const decision = scalingDecision(pressure, baseline ?? pressure, concurrency, perWorkerBytes);
      if (!decision.allowed) stopped = { reason: decision.reason, pressure };
      return decision.allowed;
    })();
    try { return await pressureCheck; } finally { pressureCheck = undefined; }
  };
  const started = performance.now();
  try {
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        if (!await scheduleAllowed()) break;
        if (next >= jobs.length) break;
        const workload = jobs[next++];
        attempts.push(await runAttempt(engine, workload, timingRecords));
      }
    }));
  } finally {
    stopSampling = true;
    await sampling;
  }
  const active = resourceSamples.filter((sample) => sample.status === "available" && (sample.workers === undefined || sample.workers > 0) && Number.isFinite(sample.rssBytes));
  const unread = resourceSamples.filter((sample) => sample.status !== "available");
  const workerSamples = active.map((sample) => sample.workers).filter((value) => Number.isFinite(value));
  const durationMs = performance.now() - started;
  return {
    concurrency, durationMs, attempts, pressureSamples, ...(stopped ? { stopped, jobsNotStarted: jobs.length - next } : {}), throughputTasksPerSecond: attempts.filter((attempt) => attempt.status === "passed").length / (durationMs / 1000),
    resources: { status: active.length ? (unread.length ? "partial" : "measured") : "unread", activeSamples: active.length, unreadSamples: unread.length, peakRssBytes: active.length ? Math.max(...active.map((sample) => sample.rssBytes)) : null, medianActiveRssBytes: quantile(active.map((sample) => sample.rssBytes), 0.5), steadyStateRssBytes: null, steadyStateStatus: "unread", steadyStateReason: "No stable idle observation window; active process lifecycle samples are not steady state.", maxObservedWorkers: workerSamples.length ? Math.max(...workerSamples) : null, cpuPercent: distribution(active.map((sample) => sample.cpuPercent).filter((value) => Number.isFinite(value))), errors: [...new Set(unread.map((sample) => sample.error ?? "resource read unavailable"))] },
  };
}

export function summarizeAttempts(attempts) {
  const successful = attempts.filter((attempt) => attempt.status === "passed");
  const extraction = successful.filter((attempt) => Number.isFinite(attempt.recordsExtracted) && Number.isFinite(attempt.extractionMs));
  const extractionDurationMs = extraction.reduce((sum, attempt) => sum + attempt.extractionMs, 0);
  return {
    attempts: attempts.length, passed: successful.length, failed: attempts.filter((attempt) => attempt.status === "failed").length, unsupported: attempts.filter((attempt) => attempt.status === "unsupported").length,
    successRate: attempts.length ? successful.length / attempts.length : null,
    crashCount: attempts.filter((attempt) => attempt.code === "engine-crashed").length,
    fallbackFrequency: { status: "unread", reason: "Raw adapter comparison; router fallback is tested separately." },
    successfulTaskLatencyMs: distribution(successful.map((attempt) => attempt.durationMs)),
    startupMs: distribution(successful.map((attempt) => attempt.phases.startup).filter((value) => Number.isFinite(value))),
    navigationToUsableDomMs: distribution(successful.map((attempt) => attempt.phases.navigation).filter((value) => Number.isFinite(value))),
    executionMs: distribution(successful.map((attempt) => attempt.phases.execution).filter((value) => Number.isFinite(value))),
    domExtractionMs: distribution(successful.map((attempt) => attempt.extractionMs).filter((value) => Number.isFinite(value))),
    domExtractionRecordsPerSecond: extractionDurationMs > 0 ? extraction.reduce((sum, attempt) => sum + attempt.recordsExtracted, 0) / (extractionDurationMs / 1000) : null,
    javascriptMs: distribution(successful.map((attempt) => attempt.jsMs).filter((value) => Number.isFinite(value))),
  };
}

export async function closeMeasuredEngine(engine, result) {
  try {
    await engine.close();
    result.lifecycle.closeStatus = "closed";
  } catch (error) {
    result.lifecycle.closeStatus = "failed";
    result.lifecycle.closeError = { code: error?.code ?? "shutdown-failed", error: error instanceof Error ? error.message : String(error) };
    throw error;
  } finally {
    try {
      result.lifecycle.afterCloseResources = engine.getResourceUsage ? await engine.getResourceUsage() : { status: "unread", rssBytes: null };
    } catch (error) {
      result.lifecycle.afterCloseResources = { status: "unread", rssBytes: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export async function runBenchmarks({ runs = 3, concurrencyLevels = [1, 2, 4, 10], executablePath, output = path.join(checkoutRoot, "docs/benchmarks/lightpanda.json") } = {}) {
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 20) throw new Error("runs must be between 1 and 20");
  if (!concurrencyLevels.length || !concurrencyLevels.every((count) => Number.isSafeInteger(count) && count >= 1 && count <= 50)) throw new Error("concurrency must contain explicit worker counts between 1 and 50");
  const [{ ChromiumEngine }, { LightpandaEngine }] = await Promise.all([
    import("../dist/core/browser/ChromiumEngine.js"), import("../dist/core/browser/LightpandaEngine.js"),
  ]);
  const fixture = await startFixtureServer();
  const timingRecords = new WeakMap();
  const onTiming = ({ phase, durationMs, signal }) => {
    const record = timingRecords.get(signal);
    if (record && Number.isFinite(durationMs) && durationMs >= 0) record[phase] = durationMs;
  };
  const baseline = await readResourcePressure();
  const report = {
    schemaVersion: 1, measuredAt: new Date().toISOString(), node: process.version,
    platform: process.platform, architecture: process.arch, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), runs,
    fixturePolicy: "Owned loopback fixtures only; trustedContent true; no external site or real credentials.",
    lightpanda: { version: LIGHTPANDA_VERSION, upstreamCommit: LIGHTPANDA_COMMIT, artifact: selectArtifact() },
    pressureBaseline: baseline, engines: {},
    limitations: ["First process launch is process-cold; OS disk caches are not flushed.", "Lightpanda uses a fresh process for every task; subsequent tasks do not represent a reused warm browser.", "Chromium uses the existing BrowserManager, not the controller perception/stealth/takeover pipeline.", "Complex SPA fixture uses DOM/history APIs; it does not certify every application framework.", "Form fixture mutates a local field; it does not submit a payment or external request.", "Authenticated fixture requires an active controller context; raw adapters correctly report unsupported.", "RAM/CPU are sampled active owned workers, not machine-wide usage; the 50ms sampler can miss brief peaks.", "Steady-state RAM has no stable idle observation window and remains unread.", "Raw adapters do not fall back, so fallback frequency is explicitly unread here."],
  };
  try {
    for (const name of ["chromium", "lightpanda"]) {
      const engine = name === "chromium" ? new ChromiumEngine({ profileRoot: path.join(checkoutRoot, ".apex/benchmark-profiles"), onTiming }) : new LightpandaEngine({ ...(executablePath ? { executablePath } : {}), maxWorkers: Math.max(...concurrencyLevels), onTiming });
      const workloads = benchmarkWorkloads(fixture.origin);
      const result = { batches: [], skipped: [], lifecycle: {}, summary: null };
      report.engines[name] = result;
      try {
        result.lifecycle.firstTask = await runAttempt(engine, { name: "first-task", task: { url: `${fixture.origin}/empty`, operation: "evaluate", expression: "1", readOnly: true, trustedContent: true, timeoutMs: 15_000 }, expected: (value) => value === 1 }, timingRecords);
        result.lifecycle.subsequentTask = await runAttempt(engine, { name: "subsequent-task", task: { url: `${fixture.origin}/empty`, operation: "evaluate", expression: "1", readOnly: true, trustedContent: true, timeoutMs: 15_000 }, expected: (value) => value === 1 }, timingRecords);
        let perWorkerBytes = null;
        for (const concurrency of concurrencyLevels) {
          const pressure = await readResourcePressure();
          const decision = scalingDecision(pressure, baseline, concurrency, perWorkerBytes);
          if (!decision.allowed) { result.skipped.push({ concurrency, reason: decision.reason, pressure }); continue; }
          const repetitions = runs * Math.ceil(concurrency / workloads.length);
          const jobs = Array.from({ length: repetitions }, () => workloads).flat();
          const batch = await measureBatch(engine, jobs, concurrency, timingRecords, { baseline, perWorkerBytes });
          batch.repetitionsPerWorkload = repetitions;
          batch.pressureBefore = pressure;
          batch.pressureAfter = await readResourcePressure();
          result.batches.push(batch);
          if (batch.resources.peakRssBytes !== null) perWorkerBytes = Math.max(perWorkerBytes ?? 0, batch.resources.peakRssBytes / concurrency);
          if (!scalingDecision(batch.pressureAfter, baseline, concurrency, perWorkerBytes).allowed) break;
        }
      } finally {
        result.summary = summarizeAttempts(result.batches.flatMap((batch) => batch.attempts));
        await closeMeasuredEngine(engine, result);
      }
      result.workloads = Object.fromEntries(workloads.map((workload) => [workload.name, summarizeAttempts(result.batches.flatMap((batch) => batch.attempts.filter((attempt) => attempt.workload === workload.name)))]));
    }
  } finally {
    await fixture.close();
    report.pressureAfter = await readResourcePressure();
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${key}`);
    if (key === "--runs") options.runs = Number(value);
    else if (key === "--concurrency") options.concurrencyLevels = value.split(",").map(Number);
    else if (key === "--lightpanda-path") options.executablePath = path.resolve(value);
    else if (key === "--output") options.output = path.resolve(value);
    else throw new Error(`Unknown benchmark option: ${key}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runBenchmarks(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(Object.fromEntries(Object.entries(report.engines).map(([name, result]) => [name, { summary: result.summary, skipped: result.skipped }])), null, 2));
    if (Object.values(report.engines).some((result) => result.summary?.failed > 0 || result.lifecycle.firstTask?.status === "failed" || result.lifecycle.subsequentTask?.status === "failed")) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

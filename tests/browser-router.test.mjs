import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserRouter, isReplaySafe, requiredCapabilities } from '../dist/core/browser/BrowserRouter.js';
import { BrowserEngineError } from '../dist/core/browser/types.js';

const capabilities = ['navigation', 'dom', 'javascript', 'click', 'fill', 'cookies', 'network', 'screenshot', 'visual', 'human-takeover', 'authenticated-session', 'csp', 'request-policy'];
const task = (overrides = {}) => ({ url: 'http://localhost:1234/article', operation: 'extract', trustedContent: true, ...overrides });
const engine = (name, execute = async () => name, overrides = {}) => ({ name, capabilities: new Set(capabilities), execute, close: async () => {}, ...overrides });
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function until(predicate) {
  for (let index = 0; index < 200; index++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail('Expected asynchronous state was never reached');
}
function router(t, options = {}) {
  const instance = new BrowserRouter({ chromium: engine('chromium'), lightpanda: engine('lightpanda'), ...options });
  t.after(() => instance.close());
  return instance;
}

test('AUTO chooses Lightpanda for supported controlled DOM work', async (t) => {
  const instance = router(t);
  assert.deepEqual(await instance.execute(task()).then(({ engine, value, fallback }) => ({ engine, value, fallback })), {
    engine: 'lightpanda', value: 'lightpanda', fallback: undefined,
  });
});

test('Untrusted content requires CSP enforcement before Lightpanda can navigate', async (t) => {
  let calls = 0;
  const instance = router(t, { lightpanda: engine('lightpanda', async () => { calls++; }, { capabilities: new Set(capabilities.filter((value) => value !== 'csp')) }) });
  const result = await instance.execute(task({ trustedContent: false }));
  assert.equal(result.engine, 'chromium');
  assert.equal(result.fallback.reason, 'unsupported-capability');
  assert.match(result.fallback.message, /csp/);
  assert.equal(calls, 0);
  assert.ok(requiredCapabilities(task({ trustedContent: undefined })).has('csp'));
});

test('Screenshots and explicitly required visual capabilities select Chromium before dispatch', async (t) => {
  const instance = router(t, { lightpanda: engine('lightpanda', async () => assert.fail('Lightpanda must not execute'), { capabilities: new Set(['navigation', 'dom', 'javascript']) }) });
  for (const request of [task({ operation: 'screenshot' }), task({ requiredCapabilities: ['human-takeover'] })]) {
    const result = await instance.execute(request);
    assert.equal(result.engine, 'chromium');
    assert.equal(result.fallback.reason, 'unsupported-capability');
  }
});

test('Authenticated tasks select Chromium even when Lightpanda advertises cookies', async (t) => {
  const result = await router(t).execute(task({ authenticated: true }));
  assert.equal(result.engine, 'chromium');
  assert.equal(result.fallback.reason, 'authenticated-session');
});

test('Tasks requiring configured request policy select Chromium without bypassing guards', async (t) => {
  let calls = 0;
  const instance = router(t, { lightpanda: engine('lightpanda', async () => { calls++; }, { capabilities: new Set(capabilities.filter((value) => value !== 'request-policy')) }) });
  const result = await instance.execute(task({ requiredCapabilities: ['request-policy'] }));
  assert.equal(result.engine, 'chromium');
  assert.equal(result.fallback.reason, 'unsupported-capability');
  assert.match(result.fallback.message, /request-policy/);
  assert.equal(calls, 0);
});

test('HUMAN mode selects the existing Chromium engine', async (t) => {
  const result = await router(t, { mode: 'human' }).execute(task());
  assert.equal(result.engine, 'chromium');
  assert.equal(result.fallback, undefined);
});

test('Missing Lightpanda falls back to Chromium with an observable reason', async (t) => {
  const instance = router(t, { lightpanda: undefined });
  const result = await instance.execute(task());
  assert.equal(result.fallback.reason, 'not-installed');
  assert.equal(instance.getTelemetry().fallbackCount, 1);
});

test('Read operations recover from a crashed Lightpanda without transferring session data', async (t) => {
  let calls = 0;
  const instance = router(t, { lightpanda: engine('lightpanda', async () => { throw new BrowserEngineError('engine-crashed', 'worker exited'); }), chromium: engine('chromium', async (request) => { calls++; assert.equal(request.authenticated, undefined); return 'recovered'; }) });
  const result = await instance.execute(task());
  assert.equal(result.value, 'recovered');
  assert.equal(result.fallback.reason, 'engine-crashed');
  assert.equal(calls, 1);
});

test('Unsupported actions may fall back only when their adapter proves they were never dispatched', async (t) => {
  const instance = router(t, { lightpanda: engine('lightpanda', async () => { throw new BrowserEngineError('unsupported-command', 'not supported', { dispatched: false }); }) });
  const result = await instance.execute(task({ operation: 'click', selector: '#buy' }));
  assert.equal(result.engine, 'chromium');
  assert.equal(result.fallback.reason, 'unsupported-command');
});

test('Clicks and fills never replay after ambiguous dispatch even with readOnly set', async (t) => {
  let chromiumCalls = 0;
  const instance = router(t, { lightpanda: engine('lightpanda', async () => { throw new Error('connection lost'); }), chromium: engine('chromium', async () => { chromiumCalls++; }) });
  for (const operation of ['click', 'fill']) {
    await assert.rejects(instance.execute(task({ operation, readOnly: true }), 'machine'), (error) => error.code === 'unsafe-replay' && error.cause.code === 'execution-failed');
  }
  assert.equal(chromiumCalls, 0);
  assert.equal(instance.getTelemetry().fallbackCount, 0);
});

test('JavaScript evaluation defaults to non-idempotent and requires an explicit read-only declaration to replay', async (t) => {
  const instance = router(t, { lightpanda: engine('lightpanda', async () => { throw new BrowserEngineError('broken-dom', 'document unavailable'); }) });
  await assert.rejects(instance.execute(task({ operation: 'evaluate', expression: 'sendPayment()' })), { code: 'unsafe-replay' });
  const result = await instance.execute(task({ operation: 'evaluate', expression: 'document.title', readOnly: true }));
  assert.equal(result.engine, 'chromium');
  assert.equal(result.fallback.reason, 'broken-dom');
  for (const operation of ['extract', 'query', 'network', 'cookies', 'screenshot']) assert.ok(isReplaySafe(task({ operation })));
});

test('Changing the caller task while it runs cannot change replay safety', async (t) => {
  const dispatched = deferred();
  const failed = deferred();
  const instance = router(t, { lightpanda: engine('lightpanda', async () => { dispatched.resolve(); return failed.promise; }) });
  const request = task({ operation: 'click', selector: '#delete' });
  const result = instance.execute(request);
  await dispatched.promise;
  request.operation = 'extract';
  request.readOnly = true;
  failed.reject(new Error('lost response'));
  await assert.rejects(result, { code: 'unsafe-replay' });
});

test('A failed Chromium fallback never loops back to Lightpanda', async (t) => {
  let lightpandaCalls = 0;
  let chromiumCalls = 0;
  const instance = router(t, {
    lightpanda: engine('lightpanda', async () => { lightpandaCalls++; throw new Error('failed'); }),
    chromium: engine('chromium', async () => { chromiumCalls++; throw new Error('also failed'); }),
  });
  await assert.rejects(instance.execute(task()), { code: 'execution-failed', engine: 'chromium' });
  assert.equal(lightpandaCalls, 1);
  assert.equal(chromiumCalls, 1);
});

test('Repeated hostname failures route AUTO to Chromium while MACHINE permits a recovery probe', async (t) => {
  let calls = 0;
  const instance = router(t, { lightpanda: engine('lightpanda', async () => { calls++; if (calls <= 2) throw new Error('failed'); return 'healthy'; }) });
  await instance.execute(task());
  await instance.execute(task());
  const circuitResult = await instance.execute(task());
  assert.equal(circuitResult.fallback.reason, 'site-unreliable');
  assert.equal(calls, 2);
  assert.equal((await instance.execute(task(), 'machine')).engine, 'lightpanda');
  assert.equal((await instance.execute(task())).engine, 'lightpanda');
});

test('Hostname failure memory does not affect another site', async (t) => {
  const instance = router(t, { reliabilityThreshold: 1, lightpanda: engine('lightpanda', async (request) => { if (new URL(request.url).hostname === 'localhost') throw new Error('failed'); return 'healthy'; }) });
  await instance.execute(task());
  assert.equal((await instance.execute(task({ url: 'https://example.test/page' }))).engine, 'lightpanda');
});

test('Timeout fallback waits for the prior Lightpanda worker to terminate', async (t) => {
  const work = deferred();
  const events = [];
  const instance = router(t, {
    operationTimeoutMs: 15,
    lightpanda: engine('lightpanda', async () => { events.push('started'); return work.promise; }, { cancel: async (signal) => { assert.ok(signal.aborted); events.push('stopped'); work.reject(signal.reason); } }),
    chromium: engine('chromium', async () => { events.push('fallback'); return 'done'; }),
  });
  const result = await instance.execute(task());
  assert.deepEqual(events, ['started', 'stopped', 'fallback']);
  assert.equal(result.fallback.reason, 'operation-timeout');
  assert.equal(instance.getTelemetry().runningWorkers, 0);
});

test('Unconfirmed timeout cancellation blocks fallback and retains capacity until execution ends', async (t) => {
  const work = deferred();
  let chromiumCalls = 0;
  const instance = router(t, {
    operationTimeoutMs: 10,
    recoveryTimeoutMs: 10,
    lightpanda: engine('lightpanda', async () => work.promise, { close: async () => work.reject(new Error('closed')) }),
    chromium: engine('chromium', async () => { chromiumCalls++; }),
  });
  await assert.rejects(instance.execute(task()), { code: 'cancellation-unconfirmed' });
  assert.equal(chromiumCalls, 0);
  assert.equal(instance.getTelemetry().runningWorkers, 1);
  work.reject(new Error('stopped'));
  await until(() => instance.getTelemetry().runningWorkers === 0);
});

test('A timed-out click is never replayed after its worker stops', async (t) => {
  const work = deferred();
  const instance = router(t, { operationTimeoutMs: 10, lightpanda: engine('lightpanda', async () => work.promise, { cancel: async (signal) => work.reject(signal.reason) }) });
  await assert.rejects(instance.execute(task({ operation: 'click', readOnly: true })), { code: 'unsafe-replay' });
  assert.equal(instance.getTelemetry().fallbackCount, 0);
});

test('Per-engine concurrency queues excess work in arrival order', async (t) => {
  const gates = [deferred(), deferred(), deferred()];
  const order = [];
  const instance = router(t, { concurrency: { lightpanda: 1 }, lightpanda: engine('lightpanda', async (request) => { const index = Number(request.value); order.push(index); return gates[index].promise; }) });
  const tasks = gates.map((_, index) => instance.execute(task({ value: String(index) })));
  await until(() => instance.getTelemetry().queuedTasks === 2 && order.length === 1);
  assert.deepEqual(order, [0]);
  assert.equal(instance.getTelemetry().runningWorkers, 1);
  gates[0].resolve('zero');
  await until(() => order.length === 2);
  gates[1].resolve('one');
  await until(() => order.length === 3);
  gates[2].resolve('two');
  await Promise.all(tasks);
  assert.deepEqual(order, [0, 1, 2]);
  assert.equal(instance.getTelemetry().queuedTasks, 0);
});

test('Queue backpressure rejects excess HUMAN work before Chromium dispatch', async (t) => {
  const gate = deferred();
  const instance = router(t, { mode: 'human', maxQueueSize: 1, chromium: engine('chromium', async () => gate.promise) });
  const first = instance.execute(task());
  const second = instance.execute(task());
  await assert.rejects(instance.execute(task()), { code: 'queue-full', dispatched: false });
  assert.equal(instance.getTelemetry().queuedTasks, 1);
  gate.resolve('done');
  await Promise.all([first, second]);
});

test('A queue deadline prevents an expired task from being dispatched', async (t) => {
  const gate = deferred();
  let calls = 0;
  const instance = router(t, { mode: 'human', chromium: engine('chromium', async () => { calls++; return gate.promise; }) });
  const first = instance.execute(task());
  await until(() => calls === 1);
  await assert.rejects(instance.execute(task({ timeoutMs: 10 })), { code: 'operation-timeout', dispatched: false });
  assert.equal(calls, 1);
  assert.equal(instance.getTelemetry().queuedTasks, 0);
  gate.resolve('done');
  await first;
});

test('Changing the engine mode does not interrupt an unrelated active task', async (t) => {
  const gate = deferred();
  let signal;
  const instance = router(t, { lightpanda: engine('lightpanda', async (_, executionSignal) => { signal = executionSignal; return gate.promise; }) });
  const first = instance.execute(task());
  await until(() => signal !== undefined);
  instance.setMode('human');
  assert.equal(signal.aborted, false);
  assert.equal((await instance.execute(task())).engine, 'chromium');
  gate.resolve('done');
  assert.equal((await first).engine, 'lightpanda');
});

test('Router shutdown cancels only its own executions and rejects queued and future tasks', async (t) => {
  const gate = deferred();
  let signal;
  let closed = 0;
  const instance = router(t, { mode: 'human', chromium: engine('chromium', async (_, ownSignal) => { signal = ownSignal; return gate.promise; }, { cancel: async (ownSignal) => { assert.equal(ownSignal, signal); gate.reject(ownSignal.reason); }, close: async () => { closed++; gate.reject(new Error('closed')); } }) });
  const active = instance.execute(task());
  const queued = instance.execute(task());
  const outcomes = Promise.allSettled([active, queued]);
  await until(() => signal !== undefined);
  await instance.close();
  assert.ok(signal.aborted);
  assert.equal(closed, 1);
  assert.ok((await outcomes).every((result) => result.status === 'rejected'));
  await assert.rejects(instance.execute(task()), { code: 'router-closed' });
  assert.equal(instance.getTelemetry().runningWorkers, 0);
});

test('Resource failures remain unread and do not become zero RAM', async (t) => {
  const gate = deferred();
  const instance = router(t, { lightpanda: engine('lightpanda', async () => gate.promise, { getResourceUsage: async () => { throw new Error('unread RSS'); } }) });
  const result = instance.execute(task());
  await until(() => instance.getTelemetry().runningWorkers === 1);
  const snapshot = await instance.refreshResources();
  assert.equal(snapshot.ramBytes, null);
  assert.equal(snapshot.engines.lightpanda.resourceStatus, 'error');
  assert.equal(snapshot.engines.lightpanda.resourceError, 'unread RSS');
  gate.resolve('done');
  await result;
});

test('Telemetry records workers measured RAM latency failures and fallback reasons without task contents', async (t) => {
  const gate = deferred();
  const instance = router(t, { lightpanda: engine('lightpanda', async () => gate.promise, { getResourceUsage: async () => ({ rssBytes: 512, cpuPercent: 12 }) }) });
  const pending = instance.execute(task({ expression: 'private-content' }));
  await until(() => instance.getTelemetry().runningWorkers === 1);
  const live = await instance.refreshResources();
  assert.equal(live.activeEngine, 'lightpanda');
  assert.equal(live.ramBytes, 512);
  assert.equal(live.engines.lightpanda.cpuPercent, 12);
  gate.reject(new BrowserEngineError('engine-crashed', 'worker exited'));
  await pending;
  const final = instance.getTelemetry();
  assert.equal(final.tasksCompleted, 1);
  assert.equal(final.tasksFailed, 1);
  assert.equal(final.errorRate, 0.5);
  assert.equal(final.fallbackCount, 1);
  assert.equal(final.lastFallback.reason, 'engine-crashed');
  assert.ok(final.averageLatencyMs >= 0);
  assert.equal(JSON.stringify(final).includes('private-content'), false);
  final.engines.lightpanda.tasksFailed = 100;
  assert.equal(instance.getTelemetry().engines.lightpanda.tasksFailed, 1);
});

test('Invalid URLs operations modes limits and deadlines fail before any engine work', async (t) => {
  let calls = 0;
  const instance = router(t, { lightpanda: engine('lightpanda', async () => { calls++; }) });
  for (const url of ['', 'invalid', 'file:///etc/passwd', 'https://user:password@example.test/']) await assert.rejects(instance.execute(task({ url })), { code: 'invalid-task', dispatched: false });
  await assert.rejects(instance.execute(task({ operation: 'purchase' })), { code: 'invalid-task' });
  await assert.rejects(instance.execute(task({ timeoutMs: 0 })), { code: 'invalid-task' });
  await assert.rejects(instance.execute(task(), 'unknown'), { code: 'invalid-task' });
  assert.throws(() => instance.setMode('unknown'), { code: 'invalid-task' });
  for (const options of [{ concurrency: { lightpanda: 0 } }, { operationTimeoutMs: NaN }, { recoveryTimeoutMs: -1 }, { maxQueueSize: -1 }, { reliabilityThreshold: 0 }]) assert.throws(() => new BrowserRouter({ chromium: engine('chromium'), ...options }), { code: 'invalid-task' });
  assert.equal(calls, 0);
});

test('Unknown adapter failures conservatively mark dispatch as ambiguous', () => {
  assert.equal(new BrowserEngineError('execution-failed', 'unknown').dispatched, true);
  assert.equal(new BrowserEngineError('startup-failed', 'not started', { dispatched: false }).dispatched, false);
});

test('Invalid resource readings remain errors instead of reporting zero RAM', async (t) => {
  const instance = router(t, { lightpanda: engine('lightpanda', undefined, { getResourceUsage: async () => ({ rssBytes: NaN }) }) });
  const snapshot = await instance.refreshResources();
  assert.equal(snapshot.engines.lightpanda.ramBytes, null);
  assert.equal(snapshot.engines.lightpanda.resourceStatus, 'error');
  assert.match(snapshot.engines.lightpanda.resourceError, /invalid RAM/);
});

test('Shutdown failures report unconfirmed worker cleanup and never pretend to succeed', async () => {
  const instance = new BrowserRouter({ chromium: engine('chromium', undefined, { close: async () => { throw new Error('worker would not exit'); } }) });
  await assert.rejects(instance.close(), { code: 'cancellation-unconfirmed' });
  await assert.rejects(instance.close(), { code: 'cancellation-unconfirmed' });
  await assert.rejects(instance.execute(task()), { code: 'router-closed' });
});

test('Queued tasks revalidate their captured session context before any engine dispatch', async (t) => {
  const session = Symbol('session context');
  const gate = deferred();
  let currentSession = 1;
  let calls = 0;
  let chromiumCalls = 0;
  const instance = router(t, {
    concurrency: { lightpanda: 1 },
    beforeDispatch: (request, selectedEngine) => {
      assert.equal(selectedEngine, 'lightpanda');
      if (request[session] !== currentSession) throw new BrowserEngineError('invalid-task', 'Session changed while task was queued', { dispatched: false });
    },
    lightpanda: engine('lightpanda', async () => { calls++; return gate.promise; }),
    chromium: engine('chromium', async () => { chromiumCalls++; }),
  });
  const active = instance.execute(task({ [session]: currentSession }));
  await until(() => calls === 1);
  const rejected = assert.rejects(instance.execute(task({ [session]: currentSession })), { code: 'invalid-task', dispatched: false });
  await until(() => instance.getTelemetry().queuedTasks === 1);
  currentSession = 2;
  gate.resolve('complete');
  await active;
  await rejected;
  assert.equal(calls, 1);
  assert.equal(chromiumCalls, 0);
  assert.equal(instance.getTelemetry().runningWorkers, 0);
  assert.equal(instance.getTelemetry().fallbackCount, 0);
});

test('Invalid task errors and generic context validation failures never trigger engine fallback', async (t) => {
  let chromiumCalls = 0;
  for (const options of [
    { beforeDispatch: () => { throw new Error('Context changed'); } },
    { beforeDispatch: () => { throw new BrowserEngineError('invalid-task', 'Profile changed', { dispatched: false }); } },
    { lightpanda: engine('lightpanda', async () => { throw new BrowserEngineError('invalid-task', 'Invalid selector', { dispatched: false }); }) },
  ]) {
    const instance = router(t, { ...options, chromium: engine('chromium', async () => { chromiumCalls++; }) });
    await assert.rejects(instance.execute(task()), { code: 'invalid-task', dispatched: false });
    assert.equal(instance.getTelemetry().fallbackCount, 0);
  }
  assert.equal(chromiumCalls, 0);
});

test('Headline RAM includes a resident idle Chromium browser while Lightpanda tasks run and after tasks finish', async (t) => {
  const gate = deferred();
  const instance = router(t, {
    chromium: engine('chromium', undefined, { getResourceUsage: async () => ({ rssBytes: 768, cpuPercent: 0 }) }),
    lightpanda: engine('lightpanda', async () => gate.promise, { getResourceUsage: async () => ({ rssBytes: 512, cpuPercent: 2 }) }),
  });
  const pending = instance.execute(task());
  await until(() => instance.getTelemetry().runningWorkers === 1);
  const live = await instance.refreshResources();
  assert.equal(live.activeEngine, 'lightpanda');
  assert.equal(live.engines.chromium.activeWorkers, 0);
  assert.equal(live.ramBytes, 1280);
  gate.resolve('complete');
  await pending;
  assert.equal(instance.getTelemetry().activeEngine, null);
  assert.equal(instance.getTelemetry().ramBytes, 1280);
});

test('An idle engine with a failed RAM reading keeps the headline total unread', async (t) => {
  const gate = deferred();
  const instance = router(t, {
    chromium: engine('chromium', undefined, { getResourceUsage: async () => { throw new Error('Resident Chromium RAM could not be read'); } }),
    lightpanda: engine('lightpanda', async () => gate.promise, { getResourceUsage: async () => ({ rssBytes: 512 }) }),
  });
  const pending = instance.execute(task());
  await until(() => instance.getTelemetry().runningWorkers === 1);
  const live = await instance.refreshResources();
  assert.equal(live.engines.chromium.activeWorkers, 0);
  assert.equal(live.engines.chromium.resourceStatus, 'error');
  assert.equal(live.engines.lightpanda.ramBytes, 512);
  assert.equal(live.ramBytes, null);
  gate.resolve('complete');
  await pending;
  assert.equal(instance.getTelemetry().ramBytes, null);
});

test('Graceful shutdown has its own deadline without extending operation recovery', async () => {
  const instance = new BrowserRouter({
    chromium: engine('chromium', async () => 'done', { close: () => new Promise((resolve) => setTimeout(resolve, 20)) }),
    recoveryTimeoutMs: 5,
    shutdownTimeoutMs: 100,
  });
  assert.equal(instance.recoveryTimeoutMs, 5);
  await instance.close();
});

test('A browser that cannot shut down before its configured deadline reports unconfirmed cleanup', async () => {
  const instance = new BrowserRouter({ chromium: engine('chromium', async () => 'done', { close: () => new Promise(() => {}) }), shutdownTimeoutMs: 5 });
  await assert.rejects(instance.close(), { code: 'cancellation-unconfirmed' });
});

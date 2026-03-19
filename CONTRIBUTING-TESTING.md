# Testing Guide

Talox has two test layers. Both must pass before any release.

---

## Unit Tests (vitest)

Pure-logic tests — no browser, no network, fast.

```bash
npm test
```

**Coverage:**
- `EventBus` — on/off/once/emit, listener counts, error isolation
- `ModeManager` — deprecated alias resolution, presets, capability queries, `updateSettings`
- `modes` — `resolveMode()`, `CANONICAL_MODES` set, all deprecated alias mappings
- `AnnotationBuffer` — push/size/isEmpty/getAll/peek/get/undo/clear
- `BotDetector` — null clean page, CAPTCHA title/URL, hard block, 429, fingerprint script, signal ordering
- `AdaptationEngine` — no-op in debug/speed, adapted event in smart, settings patch, semantic healing

---

## Real-World Tests (Playwright Test)

Tests run against real websites. No local fixture server.

```bash
npm run test:real
```

Run a single scenario:

```bash
npm run test:real:single "Gorilla Mail"
npm run test:real:single "Reddit"
npm run test:real:single "ChatGPT"
npm run test:real:single "Grok"
```

### Credentials

Some scenarios require credentials. Copy `.env.test.example` to `.env.test` and fill in:

```bash
cp .env.test.example .env.test
# Edit .env.test with your test account credentials
export $(cat .env.test | xargs) && npm run test:real
```

Tests that need credentials **automatically skip** if the env vars are not set — they will not fail.

### Scenarios

| File | Site | Mode | Credentials |
| :--- | :--- | :--- | :--- |
| `01-guerrillamail.spec.ts` | guerrillamail.com | `smart` | None |
| `02-reddit-signup.spec.ts` | reddit.com | `smart` | None (generates fresh account) |
| `03-reddit-login.spec.ts` | reddit.com | `smart` | `REDDIT_USER` + `REDDIT_PASS` |
| `04-x-bot-detection.spec.ts` | x.com | `smart` | None |
| `05-stackoverflow.spec.ts` | stackoverflow.com | `smart` | None |
| `06-chatgpt-agent-to-agent.spec.ts` | chat.openai.com | `smart` | None (guest mode) |
| `06b-grok-agent-to-agent.spec.ts` | grok.com | `smart` | None (free mode) |
| `07-observe-driven-ai.spec.ts` | iana.org + example.com | `debug` + overlay | None |

### What each scenario proves

**Scenario 1 — Gorilla Mail**: Talox can navigate, read, and extract data from a real JS-driven page. Proves `findElement()`, `evaluate()`, and AX-Tree work on a real site.

**Scenario 2 — Reddit signup**: Talox can fill real forms on a heavily bot-protected SPA. Proves `type()`, `click()`, and `adapted` event on real bot detection.

**Scenario 3 — Reddit login**: Persistent authenticated sessions work correctly. Proves profile continuity, `getState()` AX-Tree accuracy on a logged-in page, and logout flow.

**Scenario 4 — X.com**: Smart mode survives one of the most aggressive bot-detection environments. Proves `AdaptationEngine` doesn't break on sites that actively try to block automation.

**Scenario 5 — Stack Overflow**: Real developer-facing content is readable. Proves `describePage()`, `findElement()`, and `extractTable()` on a Cloudflare-protected site.

**Scenario 6 — ChatGPT**: An AI agent can use Talox to navigate ChatGPT's web UI and send/receive messages in guest mode (no account required). This is the "agent-to-agent fallback" use case — a Talox agent asking another AI when it doesn't know what to do.

**Scenario 6b — Grok**: Same agent-to-agent pattern on xAI's Grok (grok.com), which is also freely accessible without an account. Proves Talox works on X's infrastructure.

**Scenario 7 — AI-driven observe session**: The `debug` + `{ overlay, record }` pattern works headlessly. Proves the full observe pipeline (inject → annotate via evaluate → session:end → report written) without a human or headed browser.

---

## When to use which mode

The most common mistake: using `smart` mode when testing your own app. `smart` adds bot-detection warmup delays and stealth randomness that distort your results. Use `debug`.

| You are testing... | Use mode | Headless? |
| :--- | :--- | :--- |
| Your own app or website (AI agent) | `debug` | Yes (default) |
| Your own app, watching the browser | `debug` + `{ headed: true }` | No |
| Your own app, human annotation session | `debug` + `{ headed, overlay, record }` or `observe` | No |
| Your own app, AI-driven annotations | `debug` + `{ overlay: true, record: true }` | Yes |
| Bot-resilience / third-party sites | `smart` | Yes |
| Raw throughput / CI pipeline | `speed` | Yes |

> **Decision rule**: If you own the server, use `debug`. If you don't, use `smart`.

---

## Writing Observe-Driven Tests

The new test paradigm: AI agent runs a `debug` session with `overlay: true` and `record: true`, programmatically fires annotations via `talox.evaluate()`, gets a PR-ready Markdown report at the end. No human, no headed browser required.

```typescript
talox.on('sessionEnd', ({ reportPath }) => {
  console.log('Test report:', reportPath);
});

await talox.launch('ai-test', 'qa', 'debug', 'chromium', {
  overlay: true,
  record:  true,
  output:  'both',
  outputDir: './test-sessions',
});

await talox.navigate('http://localhost:3000');
const state = await talox.getState();

for (const bug of state.bugs) {
  await talox.evaluate(`
    window.__taloxEmit__('annotation:add', {
      interactionIndex: 1,
      labels: ['bug'],
      comment: ${JSON.stringify(bug.message)},
      element: { tag: 'body', text: '' },
    });
  `);
}

await talox.evaluate(`window.__taloxEmit__('session:end', {})`);
```

See `tests/real/07-observe-driven-ai.spec.ts` for the full working example.

---

## Pre-publish gate

```bash
npm run test:publish
```

Runs: TypeScript check → unit tests → production build. All must pass.

---

## CI

Two jobs in `.github/workflows/ci.yml`:

| Job | Trigger | What it runs |
| :--- | :--- | :--- |
| **Unit Tests** | Every push + PR to `main` | `npm test` (vitest, 79 tests, no browser) |
| **Real-World Tests** | Nightly at 03:00 UTC + manual `workflow_dispatch` | `npx playwright test` against live sites |

Real-world tests never run on regular pushes — this avoids IP bans and rate limits from hitting live sites on every commit.

**Trigger a manual run** (with optional filter):
1. GitHub → Actions → CI → Run workflow
2. Optionally enter a test name filter, e.g. `Gorilla Mail` or `Reddit`

**GitHub Secrets required** for credential-based scenarios:
- `REDDIT_USER` — test account username (Scenario 3 only; skips without it)
- `REDDIT_PASS` — test account password

Playwright HTML report and failure videos are uploaded as artifacts on every run.

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

## E2E Tests (Playwright Test)

Three surfaces, all must be green. Runs against a local fixture server on port 9999.

```bash
npm run test:e2e
```

### Fixture server

The fixture server starts and stops automatically via `playwright.config.ts` `webServer`. Six HTML fixtures:

| Path | Purpose |
| :--- | :--- |
| `/form.html` | Login form with email + password + submit |
| `/captcha.html` | Simulates CAPTCHA page (triggers `adapted` in smart mode) |
| `/rate-limit.html` + `/api/data` (429) | Rate limit detection |
| `/shadow-dom.html` | Shadow DOM element collection |
| `/observe-target.html` | Multi-section page with nav links, contact form, product section |
| `/multi-page.html` | Second tab target |

### Surface 1 — Agent Actions (`tests/e2e/agent-actions.spec.ts`)

Tests run in **`debug` mode** — the correct mode for testing your own app or site.

Covers: full form fill + submit (email → password → click → success div), value persistence after focus change, `click()` state return, nav link hash update, `mouseMove()` traversal, `fidget()`, `think()`, `scrollTo()`, `evaluate()`, `findElement()` bounding box + null case + end-to-end click, `screenshot()`, shadow DOM collection, multi-tab open/switch/close, `setAttentionFrame()` + `clearAttentionFrame()`.

### Surface 2 — Observe Mode (`tests/e2e/observe-mode.spec.ts`)

Tests the human-driven session infrastructure.

Covers: `window.__talox__` defined after navigation, `sessionId` is a non-empty string, overlay persists after SPA navigation, `__taloxEmit__` exposed on window, `annotation:add` fires `annotationAdded` event, `annotation:undo` fires `annotationUndone` and decrements buffer, undo on empty buffer is safe no-op, browser close writes session report to outputDir, session report JSON is valid with annotations, Markdown report contains annotations table, `sessionEnd` event fires with correct counts.

### Surface 3 — Smart Mode (`tests/e2e/smart-mode.spec.ts`)

Tests the AdaptationEngine feedback loop.

Covers: CAPTCHA page fires `adapted` with `captcha_detected`, payload has `reason/strategy/from/to`, settings patch applied, rate-limit page fires `adapted` with `rate_limit`, clean page fires no `adapted`, `adapted` NOT emitted in debug or speed mode, two bot signals produce two `adapted` events, `isSemanticHealingActive()` starts false, `resetSemanticHealing()` clears the flag.

---

## When to use which mode in your tests

The most common mistake is launching in `smart` mode when testing your own app. `smart` mode adds human-paced delays, bot-detection warmup, and stealth settings designed for the open internet — none of which you want when the app is yours. Use `debug`.

| You are testing... | Use mode | Why |
| :--- | :--- | :--- |
| Your own app or website | `debug` | Clean deterministic execution, full bug events, no stealth noise |
| Bot-resilience / third-party sites | `smart` | Self-healing + AdaptationEngine feedback loop |
| Raw throughput / CI speed | `speed` | `domcontentloaded` wait, zero simulation overhead |
| Human interaction recording | `observe` | Full CDP bridge, context menu, annotation modal, session report |
| AI exploratory testing | `observe` | Agent fires annotations via `talox.evaluate()` + `__taloxEmit__` |

> **Decision rule**: If you own the server, use `debug`. If you don't, use `smart`.

---

## Writing Observe-Driven Tests

Talox's observe mode supports a new category of test that traditional frameworks can't express: **AI exploratory tests with element-attached annotations**.

The pattern:

1. Launch in `observe` mode and listen for `sessionEnd`
2. Navigate and inspect the app using `getState()` — check `state.bugs`, `state.console.errors`, `state.network.failedRequests`
3. Use `talox.evaluate()` to call `window.__taloxEmit__('annotation:add', {...})` for each issue found
4. End the session; the report becomes your test artifact

```typescript
await talox.launch('ai-test', 'qa', 'observe', 'chromium', { output: 'both' });
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

// End and collect report
await talox.evaluate(`window.__taloxEmit__('session:end', {})`);
```

The generated Markdown report is ready to paste into a PR comment or GitHub issue.

---

## Pre-publish gate

```bash
npm run test:publish
```

Runs: TypeScript check → unit tests → E2E tests → production build. All must pass.

---

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs unit and E2E jobs in parallel on every push and pull request.

from pathlib import Path

# Current Playwright (>=1.57) removed page.accessibility. Talox used optional
# chaining, so the missing API silently looked like a null AX snapshot and paid
# every configured AX retry/backoff before falling back to DOM collection.
p = Path("src/core/PageStateCollector.ts")
s = p.read_text()
old = '''\t\tlet nodes: TaloxNode[] = [];\n\t\tlet axSnapshot: any = null;\n\t\tlet axTreeError: Error | null = null;\n\n\t\tfor (let attempt = 0; attempt <= maxRetries; attempt++) {\n\t\t\tthis.retryStats.axTreeAttempts++;\n\n\t\t\ttry {\n'''
new = '''\t\tlet nodes: TaloxNode[] = [];\n\t\tlet axSnapshot: any = null;\n\t\tlet axTreeError: Error | null = null;\n\n\t\tconst accessibility = (this.page as any).accessibility;\n\t\tconst snapshot = accessibility?.snapshot;\n\t\tif (typeof snapshot !== "function") {\n\t\t\t// Playwright removed page.accessibility in v1.57. Treat an unavailable\n\t\t\t// legacy AX source as a capability miss, not as a transient empty tree.\n\t\t\t// The outer collection loop still preserves DOM hydration retries.\n\t\t\treturn { nodes: [], shouldUseFallback: this.options.useDomFallback };\n\t\t}\n\n\t\tfor (let attempt = 0; attempt <= maxRetries; attempt++) {\n\t\t\tthis.retryStats.axTreeAttempts++;\n\n\t\t\ttry {\n'''
if old not in s:
    raise SystemExit("collectWithRetry pre-loop marker missing")
s = s.replace(old, new, 1)
old = '''\t\t\t\ttry {\n\t\t\t\t\taxSnapshot = await (this.page as any).accessibility?.snapshot();\n\t\t\t\t} catch (error_) {\n'''
new = '''\t\t\t\ttry {\n\t\t\t\t\taxSnapshot = await snapshot.call(accessibility);\n\t\t\t\t} catch (error_) {\n'''
if old not in s:
    raise SystemExit("legacy snapshot call marker missing")
s = s.replace(old, new, 1)
p.write_text(s)

# Make the unit helper capable of representing modern Playwright pages where
# page.accessibility does not exist.
p = Path("tests/unit/PageStateCollector.test.ts")
s = p.read_text()
old = '''\t\taxSnapshot: any;\n\t\t$$result: any[];\n'''
new = '''\t\taxSnapshot: any;\n\t\taccessibilityAvailable: boolean;\n\t\t$$result: any[];\n'''
if old not in s:
    raise SystemExit("unit override type marker missing")
s = s.replace(old, new, 1)
old = '''\t\taxSnapshot = null,\n\t\t$$result = [],\n'''
new = '''\t\taxSnapshot = null,\n\t\taccessibilityAvailable = true,\n\t\t$$result = [],\n'''
if old not in s:
    raise SystemExit("unit destructure marker missing")
s = s.replace(old, new, 1)
old = '''\t\taccessibility: {\n\t\t\tsnapshot: vi.fn(() => Promise.resolve(axSnapshot)),\n\t\t},\n\t\t$$: vi.fn(() => Promise.resolve($$result)),\n'''
new = '''\t\t...(accessibilityAvailable\n\t\t\t? { accessibility: { snapshot: vi.fn(() => Promise.resolve(axSnapshot)) } }\n\t\t\t: {}),\n\t\t$$: vi.fn(() => Promise.resolve($$result)),\n'''
if old not in s:
    raise SystemExit("unit accessibility mock marker missing")
s = s.replace(old, new, 1)

marker = '''\t\tit.each(["about:blank", "about:srcdoc"])(\n\t\t\t"skips hydration backoff for synthetic document %s",\n'''
start = s.find(marker)
if start == -1:
    raise SystemExit("synthetic document test marker missing")
# Insert compatibility regression immediately before synthetic document tests.
addition = '''\t\tit("falls back immediately when modern Playwright has no page.accessibility API", async () => {\n\t\t\tconst page = makeMockPage({ accessibilityAvailable: false });\n\t\t\tconst collector = new PageStateCollector(page, {\n\t\t\t\tuseDomFallback: true,\n\t\t\t\tdomFallbackThreshold: 0,\n\t\t\t});\n\n\t\t\tawait collector.collect();\n\n\t\t\tconst stats = collector.getRetryStats();\n\t\t\texpect(stats.axTreeAttempts).toBe(0);\n\t\t\texpect(stats.totalDelayMs).toBe(0);\n\t\t\texpect(page.$$).toHaveBeenCalled();\n\t\t});\n\n'''
if "falls back immediately when modern Playwright has no page.accessibility API" not in s:
    s = s[:start] + addition + s[start:]
p.write_text(s)

# Permanent real-browser regression. It verifies the actual installed Playwright
# surface, not a mock that accidentally keeps the removed API alive forever.
p = Path("tests/core/page-state-accessibility-compat.test.ts")
p.write_text('''import { afterAll, beforeAll, describe, expect, it } from "vitest";\nimport { chromium, type Browser, type Page } from "playwright-core";\nimport { PageStateCollector } from "../../src/core/PageStateCollector.js";\n\ndescribe("PageStateCollector · modern Playwright accessibility compatibility", () => {\n\tlet browser: Browser;\n\tlet page: Page;\n\n\tbeforeAll(async () => {\n\t\tbrowser = await chromium.launch({ headless: true });\n\t\tpage = await browser.newPage();\n\t\tawait page.setContent(`<main><h1>Compatibility</h1>${Array.from({ length: 12 }, (_, i) => `<button>Action ${i}</button>`).join("")}</main>`);\n\t});\n\n\tafterAll(async () => {\n\t\tawait browser?.close();\n\t});\n\n\tit("does not retry the removed page.accessibility API before DOM fallback", async () => {\n\t\texpect((page as any).accessibility).toBeUndefined();\n\t\tconst collector = new PageStateCollector(page);\n\n\t\tconst state = await collector.collect();\n\t\tconst stats = collector.getRetryStats();\n\n\t\texpect(stats.axTreeAttempts).toBe(0);\n\t\texpect(stats.totalDelayMs).toBe(0);\n\t\texpect(state.nodes.length).toBeGreaterThanOrEqual(12);\n\t\texpect(state.interactiveElements.length).toBeGreaterThanOrEqual(12);\n\t});\n});\n''')

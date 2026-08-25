from pathlib import Path

# 1) Validate selector syntax before expensive state collection.
p = Path("src/core/InteractionReliability.ts")
s = p.read_text()
marker = "\tasync resolveBeforeClick(page: Page, selector: string, nodes: TaloxNode[]): Promise<ReliabilityOutcome> {"
method = "\t/** Fail fast on selector syntax errors without collecting full page state. */\n\tasync assertSelectorSyntax(page: Page, selector: string): Promise<void> {\n\t\ttry {\n\t\t\tawait page.$(selector);\n\t\t} catch (error: unknown) {\n\t\t\tif (isSelectorSyntaxError(error)) throw error;\n\t\t\t// Non-syntax failures still belong to the normal reliability/recovery path.\n\t\t}\n\t}\n\n"
if "async assertSelectorSyntax(page: Page, selector: string)" not in s:
    if marker not in s:
        raise SystemExit("resolveBeforeClick marker missing")
    s = s.replace(marker, method + marker, 1)
p.write_text(s)

p = Path("src/core/controller/ActionExecutor.ts")
s = p.read_text()
click_old = "\tasync click(selector: string): Promise<TaloxPageState> {\n\t\tconst page = this.getPage();\n\t\tconst prevState = await this.getActiveStateCollector().collect();\n"
click_new = "\tasync click(selector: string): Promise<TaloxPageState> {\n\t\tconst page = this.getPage();\n\t\t// Validate syntax before full state collection: sparse pages can spend seconds\n\t\t// retrying AX/DOM hydration for a selector Playwright can reject immediately.\n\t\tawait this.reliability.assertSelectorSyntax(page, selector);\n\t\tconst prevState = await this.getActiveStateCollector().collect();\n"
if "Validate syntax before full state collection" not in s:
    if click_old not in s:
        raise SystemExit("click marker missing")
    s = s.replace(click_old, click_new, 1)

type_old = "\tasync type(selector: string, text: string): Promise<TaloxPageState> {\n\t\tconst page = this.getPage();\n\t\tconst prevState = await this.getActiveStateCollector().collect();\n"
type_new = "\tasync type(selector: string, text: string): Promise<TaloxPageState> {\n\t\tconst page = this.getPage();\n\t\tawait this.reliability.assertSelectorSyntax(page, selector);\n\t\tconst prevState = await this.getActiveStateCollector().collect();\n"
if type_new not in s:
    if type_old not in s:
        raise SystemExit("type marker missing")
    s = s.replace(type_old, type_new, 1)
p.write_text(s)

# 2) Explicit browser choices are authoritative. Avoid a throwaway probe process.
p = Path("src/core/BrowserManager.ts")
s = p.read_text()
old = "\tprivate async resolveBrowserType(browserType?: BrowserType): Promise<BrowserType> {\n\t\tconst actual = browserType || this.config.browser.preferred;\n\t\tif (process.platform === \"darwin\" || !this.config.browser.autoDetect) return actual;\n"
new = "\tprivate async resolveBrowserType(browserType?: BrowserType): Promise<BrowserType> {\n\t\t// An explicit caller choice is authoritative. launchWithFallback() already\n\t\t// reports an actionable install error if the requested browser is unavailable.\n\t\tif (browserType) return browserType;\n\t\tconst actual = this.config.browser.preferred;\n\t\tif (process.platform === \"darwin\" || !this.config.browser.autoDetect) return actual;\n"
if "An explicit caller choice is authoritative" not in s:
    if old not in s:
        raise SystemExit("resolveBrowserType marker missing")
    s = s.replace(old, new, 1)
p.write_text(s)

# Unit mock must expose the new reliability method.
p = Path("tests/unit/ActionExecutor.test.ts")
s = p.read_text()
marker = "\tInteractionReliability: class {\n\t\tresolveBeforeClick = vi.fn().mockResolvedValue({\n"
replacement = "\tInteractionReliability: class {\n\t\tassertSelectorSyntax = vi.fn().mockResolvedValue(undefined);\n\t\tresolveBeforeClick = vi.fn().mockResolvedValue({\n"
if "assertSelectorSyntax = vi.fn().mockResolvedValue(undefined);" not in s:
    if marker not in s:
        raise SystemExit("ActionExecutor reliability mock marker missing")
    s = s.replace(marker, replacement, 1)
p.write_text(s)

# Direct syntax-validator coverage.
p = Path("tests/unit/InteractionReliability.test.ts")
s = p.read_text()
marker = "\t\tit(\"fails immediately when Playwright reports malformed CSS syntax\", async () => {\n\t\t\tconst syntaxError = new Error('Unexpected token \"\" while parsing css selector \"[[[invalid\"');\n\t\t\tconst page = makePage({ $: vi.fn().mockRejectedValue(syntaxError) });\n\n\t\t\tawait expect(reliability.resolveBeforeClick(page, \"[[[invalid\", [])).rejects.toBe(syntaxError);\n\t\t});\n"
addition = marker + "\n\t\tit(\"validates malformed selector syntax without requiring page state\", async () => {\n\t\t\tconst syntaxError = new Error('Unexpected token \"\" while parsing css selector \"[[[invalid\"');\n\t\t\tconst page = makePage({ $: vi.fn().mockRejectedValue(syntaxError) });\n\n\t\t\tawait expect(reliability.assertSelectorSyntax(page, \"[[[invalid\")).rejects.toBe(syntaxError);\n\t\t});\n"
if "validates malformed selector syntax without requiring page state" not in s:
    if marker not in s:
        raise SystemExit("InteractionReliability malformed test marker missing")
    s = s.replace(marker, addition, 1)
p.write_text(s)

# Explicit browser launch skips probing; omitted browser still probes preferred browser only.
p = Path("tests/unit/BrowserManagerBundledDetection.test.ts")
s = p.read_text()
start = s.index('\tit("probes requested Chromium without launching unrelated browser detectors"')
end_marker = "\n\t});\n\n});"
end = s.index(end_marker, start) + len("\n\t});")
replacement = '''\tit("skips browser probing when Chromium is explicitly requested", async () => {
\t\tconst originalDisplay = process.env.DISPLAY;
\t\tprocess.env.DISPLAY = ":talox-unit";
\t\ttry {
\t\t\tconst manager = new BrowserManager({
\t\t\t\tbrowser: { autoDetect: true, preferred: "chromium", headless: true } as any,
\t\t\t\tsettings: { virtualDisplay: false, adaptiveStealthEnabled: false } as any,
\t\t\t});
\t\t\tawait manager.launch({
\t\t\t\tid: "explicit-browser", class: "sandbox", purpose: "test",
\t\t\t\tuserDataDir: "/tmp/talox-explicit-browser",
\t\t\t\tmetadata: { createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() },
\t\t\t}, false, "chromium");
\t\t\texpect(chromiumLaunch).not.toHaveBeenCalled();
\t\t\texpect(firefoxLaunch).not.toHaveBeenCalled();
\t\t\texpect(webkitLaunch).not.toHaveBeenCalled();
\t\t\texpect(chromiumPersistentContext).toHaveBeenCalledTimes(1);
\t\t\tawait manager.close();
\t\t} finally {
\t\t\tif (originalDisplay === undefined) delete process.env.DISPLAY;
\t\t\telse process.env.DISPLAY = originalDisplay;
\t\t}
\t});

\tit("probes only the preferred browser when no browser is explicitly requested", async () => {
\t\tconst originalDisplay = process.env.DISPLAY;
\t\tprocess.env.DISPLAY = ":talox-unit";
\t\ttry {
\t\t\tconst manager = new BrowserManager({
\t\t\t\tbrowser: { autoDetect: true, preferred: "chromium", headless: true } as any,
\t\t\t\tsettings: { virtualDisplay: false, adaptiveStealthEnabled: false } as any,
\t\t\t});
\t\t\tawait manager.launch({
\t\t\t\tid: "implicit-browser", class: "sandbox", purpose: "test",
\t\t\t\tuserDataDir: "/tmp/talox-implicit-browser",
\t\t\t\tmetadata: { createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() },
\t\t\t}, false);
\t\t\texpect(chromiumLaunch).toHaveBeenCalledTimes(1);
\t\t\texpect(firefoxLaunch).not.toHaveBeenCalled();
\t\t\texpect(webkitLaunch).not.toHaveBeenCalled();
\t\t\texpect(chromiumPersistentContext).toHaveBeenCalledTimes(1);
\t\t\tawait manager.close();
\t\t} finally {
\t\t\tif (originalDisplay === undefined) delete process.env.DISPLAY;
\t\t\telse process.env.DISPLAY = originalDisplay;
\t\t}
\t});'''
s = s[:start] + replacement + s[end:]
p.write_text(s)

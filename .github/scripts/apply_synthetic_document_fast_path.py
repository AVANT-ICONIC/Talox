from pathlib import Path

# PageStateCollector: about:blank/about:srcdoc are browser-synthetic documents.
# Do one state pass, but do not burn SPA hydration retry/backoff windows.
p = Path("src/core/PageStateCollector.ts")
s = p.read_text()

old = '''\tprivate async collectWithRetry(nodeThreshold: number): Promise<{ nodes: TaloxNode[]; shouldUseFallback: boolean }> {\n\t\tconst { maxRetries = DEFAULT_RETRY_OPTIONS.maxRetries } = this.options.retry;\n'''
new = '''\tprivate async collectWithRetry(\n\t\tnodeThreshold: number,\n\t\tmaxRetriesOverride?: number,\n\t): Promise<{ nodes: TaloxNode[]; shouldUseFallback: boolean }> {\n\t\tconst configuredMaxRetries = this.options.retry.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries;\n\t\tconst maxRetries = maxRetriesOverride ?? configuredMaxRetries;\n'''
if old not in s:
    raise SystemExit("collectWithRetry marker missing")
s = s.replace(old, new, 1)

old = '''\t\tconst collectStart = Date.now();\n\t\tconst url = this.page.url();\n\t\tconst title = await this.page.title();\n'''
new = '''\t\tconst collectStart = Date.now();\n\t\tconst url = this.page.url();\n\t\tconst title = await this.page.title();\n\t\t// Browser-synthetic documents do not have an application hydration lifecycle.\n\t\t// Retrying an empty AX tree here only adds deterministic backoff delay. Keep\n\t\t// one complete collection pass so dynamically inserted DOM is still observed.\n\t\tconst syntheticDocument = url === "about:blank" || url === "about:srcdoc";\n'''
if old not in s:
    raise SystemExit("collect url marker missing")
s = s.replace(old, new, 1)

old = '''\t\tlet collectionAttempts = 0;\n\t\tconst maxCollectionAttempts = 3;\n\n\t\twhile (collectionAttempts < maxCollectionAttempts) {\n\t\t\tconst result = await this.collectWithRetry(nodeThreshold);\n'''
new = '''\t\tlet collectionAttempts = 0;\n\t\tconst maxCollectionAttempts = syntheticDocument ? 1 : 3;\n\n\t\twhile (collectionAttempts < maxCollectionAttempts) {\n\t\t\tconst result = await this.collectWithRetry(nodeThreshold, syntheticDocument ? 0 : undefined);\n'''
if old not in s:
    raise SystemExit("collection attempts marker missing")
s = s.replace(old, new, 1)
p.write_text(s)

# Unit regression: default retry settings must not back off on synthetic docs.
p = Path("tests/unit/PageStateCollector.test.ts")
s = p.read_text()
marker = '''\t\tit("includes timing metadata with totalMs >= 0", async () => {\n\t\t\tconst page = makeMockPage();\n\t\t\tconst collector = new PageStateCollector(page, { ...FAST_OPTS, useDomFallback: false });\n\t\t\tconst state = await collector.collect();\n\t\t\texpect(state.timing).toBeDefined();\n\t\t\texpect(state.timing!.totalMs).toBeGreaterThanOrEqual(0);\n\t\t\texpect(state.timing!.collectedAt).toBe(state.timestamp);\n\t\t});\n'''
addition = marker + '''\n\t\tit.each(["about:blank", "about:srcdoc"])(\n\t\t\t"skips hydration backoff for synthetic document %s",\n\t\t\tasync (url) => {\n\t\t\t\tconst page = makeMockPage({ url, axSnapshot: null });\n\t\t\t\tconst collector = new PageStateCollector(page, { useDomFallback: false });\n\n\t\t\t\tawait collector.collect();\n\n\t\t\t\texpect(page.accessibility.snapshot).toHaveBeenCalledTimes(1);\n\t\t\t\texpect(collector.getRetryStats().totalDelayMs).toBe(0);\n\t\t\t},\n\t\t);\n'''
if marker not in s:
    raise SystemExit("PageStateCollector test marker missing")
s = s.replace(marker, addition, 1)
p.write_text(s)

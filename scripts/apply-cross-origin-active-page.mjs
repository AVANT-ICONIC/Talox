import fs from "node:fs";

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first === -1) throw new Error(`Missing anchor: ${label}`);
  if (source.indexOf(search, first + search.length) !== -1) throw new Error(`Duplicate anchor: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

const managerPath = "src/core/CrossOriginManager.ts";
let manager = fs.readFileSync(managerPath, "utf8");

manager = replaceOnce(
  manager,
  '\tprivate page: Page | null = null;\n\tprivate mainCdpSession: CDPSession | null = null;',
  '\tprivate page: Page | null = null;\n\tprivate pageGeneration = 0;\n\tprivate mainCdpSession: CDPSession | null = null;',
  "CrossOriginManager page generation field",
);

manager = replaceOnce(
  manager,
  `\tinstall(page: Page): void {\n\t\tif (this.page === page) return;\n\t\tif (this.page) {\n\t\t\tthis.removePageListeners();\n\t\t\tthis.clearSessions();\n\t\t}\n\n\t\tthis.page = page;\n\t\tpage.on("frameattached", this.frameAttachedListener);\n\t\tpage.on("framenavigated", this.frameNavigatedListener);\n\t\tpage.on("framedetached", this.frameDetachedListener);\n\t}`,
  `\tinstall(page: Page): void {\n\t\tif (this.page === page) return;\n\t\tthis.pageGeneration++;\n\t\tif (this.page) {\n\t\t\tthis.removePageListeners();\n\t\t\tthis.clearSessions();\n\t\t}\n\n\t\tthis.page = page;\n\t\tpage.on("frameattached", this.frameAttachedListener);\n\t\tpage.on("framenavigated", this.frameNavigatedListener);\n\t\tpage.on("framedetached", this.frameDetachedListener);\n\n\t\t// Rebinding can happen after navigation (for example openPage/switchPage),\n\t\t// so bootstrap child frames that already exist instead of waiting for a\n\t\t// future frame event that may never fire.\n\t\tconst existingFrames = typeof page.frames === "function" ? page.frames() : [];\n\t\tfor (const frame of existingFrames) {\n\t\t\tif (frame.parentFrame()) void this.tryCreateSession(frame);\n\t\t}\n\t}`,
  "CrossOriginManager install",
);

manager = replaceOnce(
  manager,
  `\tdispose(): void {\n\t\tthis.removePageListeners();\n\t\tthis.clearSessions();`,
  `\tdispose(): void {\n\t\tthis.pageGeneration++;\n\t\tthis.removePageListeners();\n\t\tthis.clearSessions();`,
  "CrossOriginManager dispose generation",
);

manager = replaceOnce(
  manager,
  `\tprivate async tryCreateSession(frame: Frame): Promise<void> {\n\t\tif (!this.page) return;\n\n\t\tconst parentFrame = frame.parentFrame();\n\t\tif (!parentFrame) return;\n\n\t\tconst frameUrl = frame.url();\n\t\tif (!frameUrl) return;\n\n\t\tconst parentUrl = parentFrame.url();\n\t\tif (!this.isCrossOrigin(frameUrl, parentUrl)) return;\n\n\t\ttry {\n\t\t\t// Playwright scopes this CDP session to the OOPIF target. Passing the\n\t\t\t// page here would make a trust-gated frame command execute on the page.\n\t\t\tconst cdpSession = await this.page.context().newCDPSession(frame);\n\t\t\tconst frameId = this.resolveFrameId(frame);\n\t\t\tconst trust = this.assessTrust(frameUrl, parentUrl);\n\n\t\t\tthis.sessions.set(frameId, {\n\t\t\t\tframeId,\n\t\t\t\tcdpSession,\n\t\t\t\torigin: trust.origin,\n\t\t\t\ttrust,\n\t\t\t});\n\t\t} catch {\n\t\t\t// NOSONAR — frames without a separate CDP target cannot get a session\n\t\t}\n\t}`,
  `\tprivate async tryCreateSession(frame: Frame): Promise<void> {\n\t\tconst page = this.page;\n\t\tconst generation = this.pageGeneration;\n\t\tif (!page) return;\n\n\t\tconst parentFrame = frame.parentFrame();\n\t\tif (!parentFrame) return;\n\n\t\tconst frameUrl = frame.url();\n\t\tif (!frameUrl) return;\n\n\t\tconst parentUrl = parentFrame.url();\n\t\tif (!this.isCrossOrigin(frameUrl, parentUrl)) return;\n\n\t\ttry {\n\t\t\t// Playwright scopes this CDP session to the OOPIF target. Passing the\n\t\t\t// page here would make a trust-gated frame command execute on the page.\n\t\t\tconst cdpSession = await page.context().newCDPSession(frame);\n\n\t\t\t// A tab switch/recreation can retire the page while CDP session creation\n\t\t\t// is still in flight. Never let that late result leak into the new page.\n\t\t\tif (this.page !== page || this.pageGeneration !== generation) {\n\t\t\t\tcdpSession.detach().catch(() => {}); // NOSONAR — best-effort stale cleanup\n\t\t\t\treturn;\n\t\t\t}\n\n\t\t\tconst frameId = this.resolveFrameId(frame);\n\t\t\tconst trust = this.assessTrust(frameUrl, parentUrl);\n\t\t\tconst existing = this.sessions.get(frameId);\n\t\t\tif (existing && existing.cdpSession !== cdpSession) {\n\t\t\t\texisting.cdpSession.detach().catch(() => {}); // NOSONAR — collapse bootstrap/event races\n\t\t\t}\n\n\t\t\tthis.sessions.set(frameId, {\n\t\t\t\tframeId,\n\t\t\t\tcdpSession,\n\t\t\t\torigin: trust.origin,\n\t\t\t\ttrust,\n\t\t\t});\n\t\t} catch {\n\t\t\t// NOSONAR — frames without a separate CDP target cannot get a session\n\t\t}\n\t}`,
  "CrossOriginManager tryCreateSession",
);

fs.writeFileSync(managerPath, manager);

const controllerPath = "src/core/controller/TaloxController.ts";
let controller = fs.readFileSync(controllerPath, "utf8");

controller = replaceOnce(
  controller,
  `\tprivate setupCrossOriginManager(page: import("playwright-core").Page): void {\n\t\tif (!this.settings.enableCrossOriginIframes) return;\n\t\tthis.crossOriginManager = new CrossOriginManagerClass({ trustedDomains: this.settings.trustedDomains });\n\t\tthis.crossOriginManager.install(page);\n\t}`,
  `\tprivate setupCrossOriginManager(page: import("playwright-core").Page): void {\n\t\tif (!this.settings.enableCrossOriginIframes) return;\n\t\tif (!this.crossOriginManager) {\n\t\t\tthis.crossOriginManager = new CrossOriginManagerClass({ trustedDomains: this.settings.trustedDomains });\n\t\t}\n\t\tthis.crossOriginManager.install(page);\n\t}\n\n\t/** Keep cross-origin iframe tracking aligned with Talox's active page. */\n\tprivate retargetCrossOriginManagerToActivePage(): void {\n\t\tif (!this.settings.enableCrossOriginIframes) {\n\t\t\tthis.disposeCrossOriginManager();\n\t\t\treturn;\n\t\t}\n\t\tconst page = this._session.getPlaywrightPage();\n\t\tif (!page) {\n\t\t\tthis.disposeCrossOriginManager();\n\t\t\treturn;\n\t\t}\n\t\tthis.setupCrossOriginManager(page);\n\t}`,
  "TaloxController cross-origin setup",
);

controller = replaceOnce(
  controller,
  `\t\tif (page && this.harRecorder?.isRecording()) {\n\t\t\tthis.harRecorder.startContext(page.context());\n\t\t}\n\t\tthis.retargetVideoRecorderToActivePage();`,
  `\t\tif (page && this.harRecorder?.isRecording()) {\n\t\t\tthis.harRecorder.startContext(page.context());\n\t\t}\n\t\tthis.retargetCrossOriginManagerToActivePage();\n\t\tthis.retargetVideoRecorderToActivePage();`,
  "TaloxController headed lifecycle",
);

controller = replaceOnce(
  controller,
  `\tasync openPage(url: string): Promise<TaloxPageState> {\n\t\tconst state = await this._session.openPage(url);\n\t\tthis.retargetVideoRecorderToActivePage();\n\t\treturn state;\n\t}\n\tasync closePage(index: number): Promise<void> {\n\t\tawait this._session.closePage(index);\n\t\tthis.retargetVideoRecorderToActivePage();\n\t}\n\tswitchPage(index: number): void {\n\t\tthis._session.switchPage(index);\n\t\tthis.retargetVideoRecorderToActivePage();\n\t}`,
  `\tasync openPage(url: string): Promise<TaloxPageState> {\n\t\tconst state = await this._session.openPage(url);\n\t\tthis.retargetCrossOriginManagerToActivePage();\n\t\tthis.retargetVideoRecorderToActivePage();\n\t\treturn state;\n\t}\n\tasync closePage(index: number): Promise<void> {\n\t\tawait this._session.closePage(index);\n\t\tthis.retargetCrossOriginManagerToActivePage();\n\t\tthis.retargetVideoRecorderToActivePage();\n\t}\n\tswitchPage(index: number): void {\n\t\tthis._session.switchPage(index);\n\t\tthis.retargetCrossOriginManagerToActivePage();\n\t\tthis.retargetVideoRecorderToActivePage();\n\t}`,
  "TaloxController multi-page lifecycle",
);

fs.writeFileSync(controllerPath, controller);

for (const path of [
  "tests/unit/CrossOriginManagerRebindBootstrap.test.ts",
  "tests/unit/TaloxControllerCrossOriginPageLifecycle.test.ts",
]) {
  const text = fs.readFileSync(path, "utf8");
  if (!text.endsWith("\n")) fs.writeFileSync(path, `${text}\n`);
}

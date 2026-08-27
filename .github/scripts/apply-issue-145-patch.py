from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


har_path = Path("src/core/HarRecorder.ts")
har = har_path.read_text()

har = replace_once(
    har,
    'import type { Page, Request, Response } from "playwright-core";',
    'import type { BrowserContext, Page, Request, Response } from "playwright-core";',
    "HarRecorder browser-context import",
)

har = replace_once(
    har,
    '\tprivate page: Page | null = null;\n\tprivate requestHandler: RequestHandler | null = null;',
    '\tprivate eventSource: Page | BrowserContext | null = null;\n\tprivate requestHandler: RequestHandler | null = null;',
    "HarRecorder event source field",
)

start_begin = har.index('\tstart(page: Page): void {')
start_end_marker = '\n\t/**\n\t * Flush all captured entries to a HAR 1.2 file and return a summary.\n\t */'
start_end = har.index(start_end_marker, start_begin)
new_start = '''\tstart(page: Page): void {
\t\tif (this.recording) return;
\t\tif (this.eventSource || this.requestHandler || this.responseHandler) {
\t\t\tthrow new Error("Cannot start HAR recording while previous page listeners await cleanup. Call stop() again first.");
\t\t}
\t\tthis.attachEventSource(page);
\t\tthis.recording = true;
\t}

\t/**
\t * Record all requests/responses emitted by a browser context.
\t * Rebinding while recording preserves captured entries and moves listener
\t * ownership to the replacement context (for headed/headless recreation).
\t */
\tstartContext(context: BrowserContext): void {
\t\tif (this.recording && this.eventSource === context) return;
\t\tif (this.recording) {
\t\t\tthis.detachEventSourceListeners();
\t\t} else if (this.eventSource || this.requestHandler || this.responseHandler) {
\t\t\tthrow new Error("Cannot start HAR recording while previous page listeners await cleanup. Call stop() again first.");
\t\t}
\t\tthis.attachEventSource(context);
\t\tthis.recording = true;
\t}

\tprivate attachEventSource(source: Page | BrowserContext): void {
\t\tconst requestHandler: RequestHandler = (request) => {
\t\t\tif (this.recording) this.captureRequest(request);
\t\t};
\t\tconst responseHandler: ResponseHandler = (response) => {
\t\t\tif (!this.recording) return Promise.resolve();
\t\t\tconst capture = this.captureResponse(response);
\t\t\tthis.responseCaptures.add(capture);
\t\t\tvoid capture.then(
\t\t\t\t() => this.responseCaptures.delete(capture),
\t\t\t\t() => this.responseCaptures.delete(capture),
\t\t\t);
\t\t\treturn capture;
\t\t};

\t\tsource.on("request", requestHandler);
\t\tthis.eventSource = source;
\t\tthis.requestHandler = requestHandler;

\t\ttry {
\t\t\tsource.on("response", responseHandler);
\t\t\tthis.responseHandler = responseHandler;
\t\t} catch (error) {
\t\t\ttry {
\t\t\t\tsource.off("request", requestHandler);
\t\t\t\tthis.eventSource = null;
\t\t\t\tthis.requestHandler = null;
\t\t\t} catch {
\t\t\t\t// Keep listener ownership so a later stop() can retry cleanup.
\t\t\t}
\t\t\tthrow error;
\t\t}
\t}
'''
har = har[:start_begin] + new_start + har[start_end:]

har = replace_once(
    har,
    '\t\t\tthis.detachPageListeners();',
    '\t\t\tthis.detachEventSourceListeners();',
    "HarRecorder stop detach call",
)

detach_begin = har.index('\tprivate detachPageListeners(): void {')
detach_end = har.index('\n\tprivate captureRequest(req: Request): void {', detach_begin)
new_detach = '''\tprivate detachEventSourceListeners(): void {
\t\tconst source = this.eventSource;
\t\tif (!source) return;

\t\tlet firstFailure: unknown;
\t\tlet failed = false;
\t\tconst requestHandler = this.requestHandler;
\t\tif (requestHandler) {
\t\t\ttry {
\t\t\t\tsource.off("request", requestHandler);
\t\t\t\tif (this.requestHandler === requestHandler) this.requestHandler = null;
\t\t\t} catch (error) {
\t\t\t\tfirstFailure = error;
\t\t\t\tfailed = true;
\t\t\t}
\t\t}

\t\tconst responseHandler = this.responseHandler;
\t\tif (responseHandler) {
\t\t\ttry {
\t\t\t\tsource.off("response", responseHandler);
\t\t\t\tif (this.responseHandler === responseHandler) this.responseHandler = null;
\t\t\t} catch (error) {
\t\t\t\tif (!failed) firstFailure = error;
\t\t\t\tfailed = true;
\t\t\t}
\t\t}

\t\tif (!this.requestHandler && !this.responseHandler && this.eventSource === source) {
\t\t\tthis.eventSource = null;
\t\t}
\t\tif (failed) throw firstFailure;
\t}
'''
har = har[:detach_begin] + new_detach + har[detach_end:]
har_path.write_text(har)

controller_path = Path("src/core/controller/TaloxController.ts")
controller = controller_path.read_text()

old_setup = '''\t/** Start HAR recording if configured. */
\tprivate setupHarRecording(page: import("playwright-core").Page): void {
\t\tif (!this.harRecordingConfig?.enabled) return;
\t\tconst harOpts: HarRecorderOptions = {
\t\t\toutputPath: this.harRecordingConfig.outputPath,
\t\t};
\t\tif (this.harRecordingConfig.includeContent !== undefined) {
\t\t\tharOpts.includeContent = this.harRecordingConfig.includeContent;
\t\t}
\t\tthis.harRecorder = new HarRecorderClass(harOpts);
\t\tthis.harRecorder.start(page);
\t}
'''
new_setup = '''\t/** Start session-wide HAR recording if configured. */
\tprivate setupHarRecording(page: import("playwright-core").Page): void {
\t\tif (!this.harRecordingConfig?.enabled) return;
\t\tif (!this.harRecorder) {
\t\t\tconst harOpts: HarRecorderOptions = {
\t\t\t\toutputPath: this.harRecordingConfig.outputPath,
\t\t\t};
\t\t\tif (this.harRecordingConfig.includeContent !== undefined) {
\t\t\t\tharOpts.includeContent = this.harRecordingConfig.includeContent;
\t\t\t}
\t\t\tthis.harRecorder = new HarRecorderClass(harOpts);
\t\t}
\t\tthis.harRecorder.startContext(page.context());
\t}
'''
controller = replace_once(controller, old_setup, new_setup, "TaloxController HAR setup")

old_headed = '''\tasync setHeaded(headed: boolean): Promise<void> {
\t\tconst frame = this.getAttentionFrame();
\t\tthis.settings.headed = headed;
\t\tawait this._session.setHeadedMode(headed);
\t\tif (frame) this.setAttentionFrameForActivePage(frame);
\t}
'''
new_headed = '''\tasync setHeaded(headed: boolean): Promise<void> {
\t\tconst frame = this.getAttentionFrame();
\t\tthis.settings.headed = headed;
\t\tawait this._session.setHeadedMode(headed);
\t\tif (frame) this.setAttentionFrameForActivePage(frame);
\t\tconst page = this._session.getPlaywrightPage();
\t\tif (page && this.harRecorder?.isRecording()) {
\t\t\tthis.harRecorder.startContext(page.context());
\t\t}
\t}
'''
controller = replace_once(controller, old_headed, new_headed, "TaloxController headed HAR rebind")
controller_path.write_text(controller)

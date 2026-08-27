from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)


video_path = Path("src/core/VideoRecorder.ts")
video = video_path.read_text()

start_anchor = '''\tstart(page: Page): void {
\t\tif (this.recording) {
\t\t\treturn;
\t\t}
\t\tif (this.finalizationPending) {
\t\t\tthrow new Error("Cannot start a new video recording while the previous recording awaits finalization.");
\t\t}
\t\tthis.page = page;
\t\tthis.recording = true;
\t\tthis.finalizationPending = true;
\t\tthis.frames = [];

\t\tconst intervalMs = Math.round(1000 / this.fps);

\t\tthis.interval = setInterval(() => {
\t\t\tthis.captureFrame().catch(() => {
\t\t\t\t// NOSONAR — frame capture failures are non-fatal
\t\t\t});
\t\t}, intervalMs);
\t}
'''
start_replacement = start_anchor + '''
\t/**
\t * Move an active recording to another page without resetting captured frames.
\t * A null page temporarily pauses frame capture until another page is assigned.
\t */
\tretarget(page: Page | null): void {
\t\tif (!this.recording) return;
\t\tthis.page = page;
\t}
'''
video = replace_once(video, start_anchor, start_replacement, "VideoRecorder retarget method")
video_path.write_text(video)

controller_path = Path("src/core/controller/TaloxController.ts")
controller = controller_path.read_text()

video_setup = '''\t/** Start video recording if configured. */
\tprivate setupVideoRecording(page: import("playwright-core").Page): void {
\t\tif (!this.videoRecordingConfig?.enabled) return;
\t\tconst vrOpts: { outputPath: string; fps?: number } = {
\t\t\toutputPath: this.videoRecordingConfig.outputPath,
\t\t};
\t\tif (this.videoRecordingConfig.fps) vrOpts.fps = this.videoRecordingConfig.fps;
\t\tthis.videoRecorder = new VideoRecorderClass(vrOpts);
\t\tthis.videoRecorder.start(page);
\t\tif (this.settings.verbosity >= 1) {
\t\t\tthis.log.info(`Video recording started → ${this.videoRecordingConfig.outputPath}`);
\t\t}
\t}
'''
video_setup_replacement = video_setup + '''
\t/** Keep session video frame capture aligned with Talox's active page. */
\tprivate retargetVideoRecorderToActivePage(): void {
\t\tif (!this.videoRecorder?.isRecording()) return;
\t\tthis.videoRecorder.retarget(this._session.getPlaywrightPage());
\t}
'''
controller = replace_once(controller, video_setup, video_setup_replacement, "Controller video retarget helper")

headed_old = '''\t\tif (page && this.harRecorder?.isRecording()) {
\t\t\tthis.harRecorder.startContext(page.context());
\t\t}
\t}
'''
headed_new = '''\t\tif (page && this.harRecorder?.isRecording()) {
\t\t\tthis.harRecorder.startContext(page.context());
\t\t}
\t\tthis.retargetVideoRecorderToActivePage();
\t}
'''
controller = replace_once(controller, headed_old, headed_new, "headed video retarget")

multi_old = '''\tasync openPage(url: string): Promise<TaloxPageState> {
\t\treturn this._session.openPage(url);
\t}
\tasync closePage(index: number): Promise<void> {
\t\treturn this._session.closePage(index);
\t}
\tswitchPage(index: number): void {
\t\treturn this._session.switchPage(index);
\t}
'''
multi_new = '''\tasync openPage(url: string): Promise<TaloxPageState> {
\t\tconst state = await this._session.openPage(url);
\t\tthis.retargetVideoRecorderToActivePage();
\t\treturn state;
\t}
\tasync closePage(index: number): Promise<void> {
\t\tawait this._session.closePage(index);
\t\tthis.retargetVideoRecorderToActivePage();
\t}
\tswitchPage(index: number): void {
\t\tthis._session.switchPage(index);
\t\tthis.retargetVideoRecorderToActivePage();
\t}
'''
controller = replace_once(controller, multi_old, multi_new, "multi-page video retarget")
controller_path.write_text(controller)

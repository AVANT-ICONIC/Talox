/**
 * @file VideoRecorder.ts
 * @description Frame-based video recording for Talox sessions.
 *
 * Captures screenshots at a configurable FPS and encodes them into a video
 * file using ffmpeg (preferred) or falls back to a PNG sequence with an
 * HTML viewer.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { Page } from "playwright-core";

// ─── Types ──────────────────────────────────────────────────────────────────

export type VideoFormat = "mp4" | "webm";

export interface VideoRecorderOptions {
	outputPath: string;
	fps?: number;
	format?: VideoFormat;
}

// ─── Implementation ─────────────────────────────────────────────────────────

/**
 * Records a browser session as a sequence of frames, then encodes to video.
 *
 * If ffmpeg is available on the system PATH, frames are piped through
 * ffmpeg for proper encoding. Otherwise frames are saved as numbered PNGs
 * with an HTML viewer file.
 */
export class VideoRecorder {
	private readonly outputPath: string;
	private readonly fps: number;
	private readonly format: VideoFormat;

	private recording = false;
	private finalizationPending = false;
	private stopInFlight: Promise<string> | null = null;
	private frames: Buffer[] = [];
	private interval: NodeJS.Timeout | null = null;
	private page: Page | null = null;

	constructor(options: VideoRecorderOptions) {
		this.outputPath = options.outputPath;
		this.fps = options.fps ?? 10;
		this.format = options.format ?? "webm";
	}

	/**
	 * Start capturing frames from the given Playwright page.
	 *
	 * Sets up a periodic timer that takes PNG screenshots at the configured FPS.
	 */
	start(page: Page): void {
		if (this.recording) {
			return;
		}
		if (this.finalizationPending) {
			throw new Error("Cannot start a new video recording while the previous recording awaits finalization.");
		}
		this.page = page;
		this.recording = true;
		this.finalizationPending = true;
		this.frames = [];

		const intervalMs = Math.round(1000 / this.fps);

		this.interval = setInterval(() => {
			this.captureFrame().catch(() => {
				// NOSONAR — frame capture failures are non-fatal
			});
		}, intervalMs);
	}

	/**
	 * Move an active recording to another page without resetting captured frames.
	 * A null page temporarily pauses frame capture until another page is assigned.
	 */
	retarget(page: Page | null): void {
		if (!this.recording) return;
		this.page = page;
	}

	/**
	 * Stop capturing and encode the recorded frames into the output file.
	 * Failed finalization keeps captured frames available for a later retry.
	 *
	 * @returns The absolute path to the encoded video or viewer HTML.
	 */
	stop(): Promise<string> {
		if (this.stopInFlight) return this.stopInFlight;
		if (!this.finalizationPending) return Promise.resolve("");

		const attempt = this.runStop();
		this.stopInFlight = attempt;
		attempt.then(
			() => {
				if (this.stopInFlight === attempt) this.stopInFlight = null;
			},
			() => {
				if (this.stopInFlight === attempt) this.stopInFlight = null;
			},
		);
		return attempt;
	}

	private async runStop(): Promise<string> {
		if (this.interval) {
			clearInterval(this.interval);
			this.interval = null;
		}
		this.recording = false;

		const output = path.resolve(this.outputPath);

		if (this.frames.length === 0) {
			await mkdir(path.dirname(output), { recursive: true });
			await writeFile(output, "");
		} else {
			const hasFfmpeg = await checkFfmpeg();

			if (hasFfmpeg) {
				await this.encodeWithFfmpeg(output);
			} else {
				await this.savePngSequence(output);
			}
		}

		this.frames = [];
		this.page = null;
		this.finalizationPending = false;
		return output;
	}

	/** Whether the recorder is currently capturing frames. */
	isRecording(): boolean {
		return this.recording;
	}

	/** Number of frames captured so far. */
	getFrameCount(): number {
		return this.frames.length;
	}

	// ─── Private Helpers ─────────────────────────────────────────────────

	private async captureFrame(): Promise<void> {
		if (!this.page || !this.recording) return;
		try {
			const buffer = await this.page.screenshot({ type: "png" });
			this.frames.push(buffer);
		} catch {
			// NOSONAR — page may be navigated away or closed between ticks
		}
	}

	private async encodeWithFfmpeg(output: string): Promise<void> {
		await mkdir(path.dirname(output), { recursive: true });

		const codec = this.format === "mp4" ? "libx264" : "libvpx-vp9";
		const pixFmt = "yuv420p"; // NOSONAR — same for both formats

		const ffmpegArgs = [
			"-f",
			"image2pipe",
			"-vcodec",
			"png",
			"-r",
			String(this.fps),
			"-i",
			"-",
			"-vcodec",
			codec,
			"-pix_fmt",
			pixFmt,
			"-y",
			output,
		];

		await new Promise<void>((resolve, reject) => {
			const proc = execFile("ffmpeg", ffmpegArgs, (error) => {
				if (error) {
					reject(error instanceof Error ? error : new Error(String(error)));
				} else {
					resolve();
				}
			});

			const stdin = proc.stdin;
			if (!stdin) {
				reject(new Error("ffmpeg stdin unavailable"));
				return;
			}

			let drained = true;
			let idx = 0;

			const writeNext = () => {
				while (drained && idx < this.frames.length) {
					const frame = this.frames[idx];
					if (!frame) {
						idx++;
						continue;
					}
					idx++;
					drained = stdin.write(frame);
				}
				if (idx >= this.frames.length) {
					stdin.end();
				}
			};

			stdin.on("drain", () => {
				drained = true;
				writeNext();
			});

			writeNext();
		});
	}

	private async savePngSequence(output: string): Promise<void> {
		const framesDir = output.replace(/\.\w+$/, "_frames");
		await mkdir(framesDir, { recursive: true });

		const padding = String(this.frames.length).length;

		for (let i = 0; i < this.frames.length; i++) {
			const frameName = `frame_${String(i + 1).padStart(padding, "0")}.png`;
			const frame = this.frames[i];
			if (frame) await writeFile(path.join(framesDir, frameName), frame);
		}

		const htmlContent = buildViewerHtml(this.fps, this.frames.length);
		await writeFile(path.join(framesDir, "viewer.html"), htmlContent);

		await writeFile(output, `View recording at: ${path.join(framesDir, "viewer.html")}\n`);
	}
}

// ─── Module-level Utilities ─────────────────────────────────────────────────

let ffmpegAvailable: boolean | null = null;

async function checkFfmpeg(): Promise<boolean> {
	if (ffmpegAvailable !== null) {
		return ffmpegAvailable;
	}

	return new Promise<boolean>((resolve) => {
		execFile("ffmpeg", ["-version"], (error) => {
			ffmpegAvailable = !error;
			resolve(ffmpegAvailable);
		});
	});
}

function buildViewerHtml(fps: number, frameCount: number): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Talox Recording Viewer</title>
<style>
body { margin: 0; background: #111; color: #eee; font-family: sans-serif; text-align: center; }
img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
.controls { padding: 10px; }
button { margin: 4px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
</style>
</head>
<body>
<div class="controls">
  <button id="playPause">Play</button>
  <button id="stepBack">Step Back</button>
  <button id="stepFwd">Step Fwd</button>
  <span id="info">Frame 1 / ${frameCount}</span>
</div>
<img id="frame" src="frame_1.png" />
<script>
const total = ${frameCount};
const pad = String(total).length;
let current = 1;
let playing = false;
let timer = null;
const fps = ${fps};
const img = document.getElementById("frame");
const info = document.getElementById("info");
function show(n) {
  current = Math.max(1, Math.min(total, n));
  img.src = "frame_" + String(current).padStart(pad, "0") + ".png";
  info.textContent = "Frame " + current + " / " + total;
}
function play() {
  playing = true;
  timer = setInterval(() => { if (current >= total) { pause(); return; } show(current + 1); }, 1000 / fps);
}
function pause() { playing = false; if (timer) clearInterval(timer); timer = null; }
document.getElementById("playPause").onclick = () => { playing ? pause() : play(); document.getElementById("playPause").textContent = playing ? "Pause" : "Play"; };
document.getElementById("stepBack").onclick = () => { pause(); show(current - 1); };
document.getElementById("stepFwd").onclick = () => { pause(); show(current + 1); };
</script>
</body>
</html>`;
}

/**
 * @file HarRecorder.ts
 * @description HAR 1.2 recording via Playwright request/response interception.
 *
 * Captures network traffic into the standard HAR format so agents and developers
 * can inspect, replay, or debug the full request/response lifecycle.
 */

import { writeFileSync } from "node:fs";
import type { Page, Request, Response } from "playwright-core";

// ─── HAR 1.2 Types ──────────────────────────────────────────────────────────

export interface HarRecorderOptions {
	outputPath: string;
	includeContent?: boolean;
}

export interface HarTiming {
	/** Milliseconds between request start and response received. */
	wait: number;
	/** Milliseconds to read the response body (approximated as 0). */
	receive: number;
}

export interface HarHeader {
	name: string;
	value: string;
}

export interface HarRequest {
	method: string;
	url: string;
	httpVersion: string;
	headers: HarHeader[];
	queryString: Array<{ name: string; value: string }>;
	postData?: string;
	headersSize: number;
	bodySize: number;
}

export interface HarResponse {
	status: number;
	statusText: string;
	httpVersion: string;
	headers: HarHeader[];
	content: {
		size: number;
		mimeType: string;
		text?: string;
	};
	headersSize: number;
	bodySize: number;
}

export interface HarEntry {
	startedDateTime: string;
	time: number;
	request: HarRequest;
	response: HarResponse;
	timings: HarTiming;
}

export interface HarCreator {
	name: string;
	version: string;
}

export interface HarLog {
	version: string;
	creator: HarCreator;
	entries: HarEntry[];
}

export interface HarFile {
	log: HarLog;
}

export interface HarResult {
	/** Absolute path the HAR file was written to. */
	outputPath: string;
	/** Number of entries recorded. */
	entryCount: number;
	/** Total wall-clock duration in ms (first request to last response). */
	totalDurationMs: number;
}

// ─── Internal tracking ──────────────────────────────────────────────────────

interface PendingRequest {
	entry: HarEntry;
	timestamp: number;
}

type RequestHandler = (request: Request) => void;
type ResponseHandler = (response: Response) => Promise<void>;

// ─── HarRecorder ────────────────────────────────────────────────────────────

export class HarRecorder {
	private readonly outputPath: string;
	private readonly includeContent: boolean;
	private recording = false;
	private readonly entries: HarEntry[] = [];
	private readonly pending = new Map<Request, PendingRequest>();
	private readonly responseCaptures = new Set<Promise<void>>();
	private page: Page | null = null;
	private requestHandler: RequestHandler | null = null;
	private responseHandler: ResponseHandler | null = null;
	private stopInFlight: Promise<HarResult> | null = null;
	private readonly version = "5.0.1";

	constructor(options: HarRecorderOptions) {
		this.outputPath = options.outputPath;
		this.includeContent = options.includeContent ?? true;
	}

	// ── Public API ─────────────────────────────────────────────────────────

	/**
	 * Install request/response interception on the given page.
	 * Call after the page has been created (e.g. after `launch()`).
	 */
	start(page: Page): void {
		if (this.recording) return;
		if (this.page || this.requestHandler || this.responseHandler) {
			throw new Error("Cannot start HAR recording while previous page listeners await cleanup. Call stop() again first.");
		}

		const requestHandler: RequestHandler = (request) => {
			if (this.recording) this.captureRequest(request);
		};
		const responseHandler: ResponseHandler = (response) => {
			if (!this.recording) return Promise.resolve();
			const capture = this.captureResponse(response);
			this.responseCaptures.add(capture);
			void capture.then(
				() => this.responseCaptures.delete(capture),
				() => this.responseCaptures.delete(capture),
			);
			return capture;
		};

		page.on("request", requestHandler);
		this.page = page;
		this.requestHandler = requestHandler;

		try {
			page.on("response", responseHandler);
			this.responseHandler = responseHandler;
		} catch (error) {
			try {
				page.off("request", requestHandler);
				this.page = null;
				this.requestHandler = null;
			} catch {
				// Keep listener ownership so a later stop() can retry cleanup.
			}
			throw error;
		}

		this.recording = true;
	}

	/**
	 * Flush all captured entries to a HAR 1.2 file and return a summary.
	 */
	stop(): Promise<HarResult> {
		if (this.stopInFlight) return this.stopInFlight;

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

	private async runStop(): Promise<HarResult> {
		this.recording = false;

		let listenerFailure: unknown;
		let listenerCleanupFailed = false;
		try {
			this.detachPageListeners();
		} catch (error) {
			listenerFailure = error;
			listenerCleanupFailed = true;
		}

		if (this.responseCaptures.size > 0) {
			await Promise.allSettled([...this.responseCaptures]);
		}
		this.pending.clear();

		const har: HarFile = {
			log: {
				version: "1.2",
				creator: { name: "Talox", version: this.version },
				entries: this.entries,
			},
		};

		writeFileSync(this.outputPath, JSON.stringify(har, null, 2), "utf-8");

		const result = {
			outputPath: this.outputPath,
			entryCount: this.entries.length,
			totalDurationMs: this.computeTotalDuration(),
		};

		if (listenerCleanupFailed) throw listenerFailure;
		return result;
	}

	isRecording(): boolean {
		return this.recording;
	}

	getEntries(): HarEntry[] {
		return [...this.entries];
	}

	// ── Internal helpers ───────────────────────────────────────────────────

	private detachPageListeners(): void {
		const page = this.page;
		if (!page) return;

		let firstFailure: unknown;
		let failed = false;
		const requestHandler = this.requestHandler;
		if (requestHandler) {
			try {
				page.off("request", requestHandler);
				if (this.requestHandler === requestHandler) this.requestHandler = null;
			} catch (error) {
				firstFailure = error;
				failed = true;
			}
		}

		const responseHandler = this.responseHandler;
		if (responseHandler) {
			try {
				page.off("response", responseHandler);
				if (this.responseHandler === responseHandler) this.responseHandler = null;
			} catch (error) {
				if (!failed) firstFailure = error;
				failed = true;
			}
		}

		if (!this.requestHandler && !this.responseHandler && this.page === page) {
			this.page = null;
		}
		if (failed) throw firstFailure;
	}

	private captureRequest(req: Request): void {
		const headers = this.headersToArray(req.headers());
		const postData = req.postData() ?? undefined;
		const queryString = this.parseQueryString(req.url());

		const entry: HarEntry = {
			startedDateTime: new Date().toISOString(),
			time: 0,
			request: {
				method: req.method(),
				url: req.url(),
				httpVersion: "HTTP/1.1",
				headers,
				queryString,
				headersSize: -1,
				bodySize: postData ? Buffer.byteLength(postData, "utf-8") : 0,
			},
			response: {
				status: 0,
				statusText: "",
				httpVersion: "HTTP/1.1",
				headers: [],
				content: { size: 0, mimeType: "" },
				headersSize: -1,
				bodySize: -1,
			},
			timings: { wait: 0, receive: 0 },
		};

		if (postData !== undefined) {
			entry.request.postData = postData;
		}

		this.pending.set(req, { entry, timestamp: Date.now() });
	}

	private async captureResponse(res: Response): Promise<void> {
		const req = res.request();
		const pending = this.pending.get(req);
		if (!pending) return;

		this.pending.delete(req);
		const { entry, timestamp } = pending;
		const elapsed = Date.now() - timestamp;

		const resHeaders = this.headersToArray(res.headers());
		const mimeType = res.headers()["content-type"] ?? "";

		let bodyText: string | undefined;
		let bodySize = 0;
		if (this.includeContent) {
			try {
				bodyText = await res.text();
				bodySize = Buffer.byteLength(bodyText, "utf-8");
			} catch {
				// NOSONAR — body may not be accessible for some responses
			}
		}

		entry.time = elapsed;
		const content: { size: number; mimeType: string; text?: string } = {
			size: bodySize,
			mimeType,
		};
		if (bodyText !== undefined) {
			content.text = bodyText;
		}
		entry.response = {
			status: res.status(),
			statusText: res.statusText(),
			httpVersion: "HTTP/1.1",
			headers: resHeaders,
			content,
			headersSize: -1,
			bodySize: bodySize,
		};
		entry.timings = { wait: elapsed, receive: 0 };

		this.entries.push(entry);
	}

	private headersToArray(headers: Record<string, string>): HarHeader[] {
		return Object.entries(headers).map(([name, value]) => ({ name, value }));
	}

	private parseQueryString(url: string): Array<{ name: string; value: string }> {
		try {
			const parsed = new URL(url);
			return Array.from(parsed.searchParams.entries()).map(([name, value]) => ({ name, value }));
		} catch {
			// NOSONAR — invalid URL, return empty
			return [];
		}
	}

	private computeTotalDuration(): number {
		if (this.entries.length === 0) return 0;
		const first = new Date(this.entries[0]!.startedDateTime).getTime();
		const last = new Date(this.entries.at(-1)!.startedDateTime).getTime();
		return last - first;
	}
}

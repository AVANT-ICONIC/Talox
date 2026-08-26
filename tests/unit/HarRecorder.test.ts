import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs before importing the module
vi.mock("node:fs", () => ({
	writeFileSync: vi.fn(),
}));

const { writeFileSync } = await import("node:fs");
const { HarRecorder } = await import("../../src/core/HarRecorder");

import type { HarEntry, HarFile } from "../../src/core/HarRecorder";

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockRequest(
	overrides: Partial<{
		method: string;
		url: string;
		headers: Record<string, string>;
		postData: string | null;
	}> = {},
) {
	return {
		method: vi.fn().mockReturnValue(overrides.method ?? "GET"),
		url: vi.fn().mockReturnValue(overrides.url ?? "https://example.com/api"),
		headers: vi.fn().mockReturnValue(overrides.headers ?? { "content-type": "application/json" }),
		postData: vi.fn().mockReturnValue(overrides.postData ?? null),
	};
}

function createMockResponse(
	overrides: Partial<{
		status: number;
		statusText: string;
		headers: Record<string, string>;
		text: string;
	}> = {},
) {
	const req = createMockRequest();
	return {
		request: vi.fn().mockReturnValue(req),
		status: vi.fn().mockReturnValue(overrides.status ?? 200),
		statusText: vi.fn().mockReturnValue(overrides.statusText ?? "OK"),
		headers: vi.fn().mockReturnValue(overrides.headers ?? { "content-type": "text/html" }),
		text: vi.fn().mockResolvedValue(overrides.text ?? "<html></html>"),
	};
}

function createMockPage() {
	const listeners: Record<string, ((...args: any[]) => any)[]> = {};
	return {
		on: vi.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
			listeners[event] = listeners[event] || [];
			listeners[event].push(handler);
		}),
		off: vi.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
			listeners[event] = (listeners[event] || []).filter((candidate) => candidate !== handler);
		}),
		getListeners: (event: string) => listeners[event] || [],
	};
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("HarRecorder", () => {
	let recorder: InstanceType<typeof HarRecorder>;

	beforeEach(() => {
		vi.mocked(writeFileSync).mockClear();
		recorder = new HarRecorder({ outputPath: "/tmp/test.har" });
	});

	describe("lifecycle", () => {
		it("is not recording initially", () => {
			expect(recorder.isRecording()).toBe(false);
		});

		it("start sets recording to true", () => {
			const page = createMockPage();
			recorder.start(page as any);
			expect(recorder.isRecording()).toBe(true);
		});

		it("start is idempotent", () => {
			const page = createMockPage();
			recorder.start(page as any);
			recorder.start(page as any);
			expect(page.on).toHaveBeenCalledTimes(2); // one request + one response listener
		});

		it("stop sets recording to false", async () => {
			const page = createMockPage();
			recorder.start(page as any);
			const result = await recorder.stop();
			expect(recorder.isRecording()).toBe(false);
			expect(result.outputPath).toBe("/tmp/test.har");
		});

		it("stop with no entries returns zero count and duration", async () => {
			const result = await recorder.stop();
			expect(result.entryCount).toBe(0);
			expect(result.totalDurationMs).toBe(0);
		});
	});

	describe("request/response capture", () => {
		it("captures a request and response pair as an entry", async () => {
			const page = createMockPage();
			recorder.start(page as any);

			// Simulate request event
			const requestHandler = page.getListeners("request")[0]!;
			const mockReq = createMockRequest({
				method: "POST",
				url: "https://example.com/api?q=test",
				headers: { "content-type": "application/json" },
				postData: '{"key":"value"}',
			});
			requestHandler(mockReq);

			// Simulate response event
			const responseHandler = page.getListeners("response")[0]!;
			const mockRes = createMockResponse({
				status: 200,
				statusText: "OK",
				headers: { "content-type": "application/json" },
				text: '{"result":"ok"}',
			});
			// Link response to the request
			mockRes.request.mockReturnValue(mockReq);
			await responseHandler(mockRes);

			const entries = recorder.getEntries();
			expect(entries).toHaveLength(1);
			expect(entries[0]!.request.method).toBe("POST");
			expect(entries[0]!.request.url).toBe("https://example.com/api?q=test");
			expect(entries[0]!.request.postData).toBe('{"key":"value"}');
			expect(entries[0]!.response.status).toBe(200);
			expect(entries[0]!.response.content.text).toBe('{"result":"ok"}');
		});

		it("captures query string parameters", async () => {
			const page = createMockPage();
			recorder.start(page as any);

			const requestHandler = page.getListeners("request")[0]!;
			const mockReq = createMockRequest({
				url: "https://example.com/search?q=hello&page=2",
			});
			requestHandler(mockReq);

			const responseHandler = page.getListeners("response")[0]!;
			const mockRes = createMockResponse();
			mockRes.request.mockReturnValue(mockReq);
			await responseHandler(mockRes);

			const entries = recorder.getEntries();
			expect(entries[0]!.request.queryString).toEqual([
				{ name: "q", value: "hello" },
				{ name: "page", value: "2" },
			]);
		});

		it("ignores responses without matching pending requests", async () => {
			const page = createMockPage();
			recorder.start(page as any);

			const responseHandler = page.getListeners("response")[0]!;
			const mockRes = createMockResponse();
			// No prior request was captured
			await responseHandler(mockRes);

			expect(recorder.getEntries()).toHaveLength(0);
		});
	});

	describe("HAR 1.2 format output", () => {
		it("writes valid HAR 1.2 JSON on stop", async () => {
			const page = createMockPage();
			recorder.start(page as any);

			// Capture one entry
			const requestHandler = page.getListeners("request")[0]!;
			const mockReq = createMockRequest();
			requestHandler(mockReq);

			const responseHandler = page.getListeners("response")[0]!;
			const mockRes = createMockResponse();
			mockRes.request.mockReturnValue(mockReq);
			await responseHandler(mockRes);

			const result = await recorder.stop();

			expect(result.entryCount).toBe(1);
			expect(writeFileSync).toHaveBeenCalledTimes(1);

			const [filePath, content] = vi.mocked(writeFileSync).mock.calls[0]!;
			expect(filePath).toBe("/tmp/test.har");

			const har: HarFile = JSON.parse(content as string);
			expect(har.log.version).toBe("1.2");
			expect(har.log.creator.name).toBe("Talox");
			expect(har.log.entries).toHaveLength(1);
		});

		it("includes bodySize for POST data", async () => {
			const page = createMockPage();
			recorder.start(page as any);

			const requestHandler = page.getListeners("request")[0]!;
			const mockReq = createMockRequest({
				method: "POST",
				postData: "hello world",
			});
			requestHandler(mockReq);

			const responseHandler = page.getListeners("response")[0]!;
			const mockRes = createMockResponse();
			mockRes.request.mockReturnValue(mockReq);
			await responseHandler(mockRes);

			await recorder.stop();

			const [, content] = vi.mocked(writeFileSync).mock.calls[0]!;
			const har: HarFile = JSON.parse(content as string);
			expect(har.log.entries[0]!.request.bodySize).toBe(11); // "hello world".length
		});
	});

	describe("totalDurationMs", () => {
		it("returns 0 when there are no entries", async () => {
			const result = await recorder.stop();
			expect(result.totalDurationMs).toBe(0);
		});
	});
});
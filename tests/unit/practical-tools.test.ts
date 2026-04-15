/**
 * Unit tests for practical-tools — browser utility tools.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	captureApiResponse,
	exportMarkdownSnapshot,
	extractVisibleStructuredContent,
	getPracticalTools,
	openBackgroundTab,
	searchOnSite,
} from "../../src/tools/practical-tools.js";
import type { TaloxPageState } from "../../src/types/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTaloxMock(overrides: Record<string, any> = {}) {
	return {
		openPage: vi.fn(),
		evaluate: vi.fn(),
		getState: vi.fn(),
		...overrides,
	};
}

function samplePageState(overrides: Partial<TaloxPageState> = {}): TaloxPageState {
	return {
		url: "https://example.com",
		title: "Example Page",
		timestamp: new Date().toISOString(),
		console: [],
		network: [],
		nodes: [],
		interactiveElements: [],
		bugs: [],
		...overrides,
	} as TaloxPageState;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("practical-tools", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	// ── getPracticalTools ────────────────────────────────────────────────────

	describe("getPracticalTools", () => {
		it("returns an object with expected tool methods", () => {
			const talox = makeTaloxMock();
			const tools = getPracticalTools(talox as any);
			expect(tools).toHaveProperty("openBackgroundTab");
			expect(tools).toHaveProperty("captureApiResponse");
			expect(tools).toHaveProperty("exportMarkdownSnapshot");
			expect(tools).toHaveProperty("searchOnSite");
			expect(tools).toHaveProperty("extractVisibleStructuredContent");
			expect(typeof tools.openBackgroundTab).toBe("function");
			expect(typeof tools.captureApiResponse).toBe("function");
		});
	});

	// ── openBackgroundTab ────────────────────────────────────────────────────

	describe("openBackgroundTab", () => {
		it("returns state and message from talox.openPage", async () => {
			const state = samplePageState({ url: "https://example.com", nodes: [{ id: "n1" } as any] });
			const talox = makeTaloxMock({ openPage: vi.fn().mockResolvedValue(state) });
			const result = await openBackgroundTab(talox as any, "https://example.com");
			expect(talox.openPage).toHaveBeenCalledWith("https://example.com");
			expect(result.state).toBe(state);
			expect(result.message).toContain("https://example.com");
			expect(result.message).toContain("1 nodes");
		});
	});

	// ── captureApiResponse ───────────────────────────────────────────────────

	describe("captureApiResponse", () => {
		it("calls talox.evaluate and returns the result", async () => {
			const apiResult = { status: 200, headers: { "content-type": "application/json" }, body: '{"ok":true}' };
			const talox = makeTaloxMock({ evaluate: vi.fn().mockResolvedValue(apiResult) });
			const result = await captureApiResponse(talox as any, "/api/data");
			expect(talox.evaluate).toHaveBeenCalled();
			expect(result.status).toBe(200);
			expect(result.body).toBe('{"ok":true}');
		});

		it("passes init options through to evaluate", async () => {
			const talox = makeTaloxMock({ evaluate: vi.fn().mockResolvedValue({ status: 201, headers: {}, body: "" }) });
			await captureApiResponse(talox as any, "/api/create", { method: "POST" });
			const evalArg = talox.evaluate.mock.calls[0][0] as string;
			expect(evalArg).toContain("POST");
		});
	});

	// ── exportMarkdownSnapshot ───────────────────────────────────────────────

	describe("exportMarkdownSnapshot", () => {
		it("extracts text content, writes file, returns resolved path", async () => {
			vi.spyOn(fs, "writeFile").mockResolvedValue(undefined as any);
			const bodyText = "# Hello\n## World\nSome paragraph\n### Section";
			const talox = makeTaloxMock({ evaluate: vi.fn().mockResolvedValue(bodyText) });
			const result = await exportMarkdownSnapshot(talox as any, "/tmp/snapshot.md");
			expect(result).toBe(path.resolve("/tmp/snapshot.md"));
			expect(fs.writeFile).toHaveBeenCalled();
			const writtenContent = (fs.writeFile as any).mock.calls[0][1] as string;
			expect(writtenContent).toContain("# Hello");
			expect(writtenContent).toContain("## World");
		});

		it("filters out empty lines and adds double-newlines between blocks", async () => {
			vi.spyOn(fs, "writeFile").mockResolvedValue(undefined as any);
			const bodyText = "# Title\n\n\nContent line\n\n\n### Sub";
			const talox = makeTaloxMock({ evaluate: vi.fn().mockResolvedValue(bodyText) });
			await exportMarkdownSnapshot(talox as any, "/tmp/out.md");
			const writtenContent = (fs.writeFile as any).mock.calls[0][1] as string;
			// Should not have triple newlines
			expect(writtenContent).not.toMatch(/\n\n\n/);
			expect(writtenContent).toContain("# Title");
			expect(writtenContent).toContain("Content line");
			expect(writtenContent).toContain("### Sub");
		});
	});

	// ── searchOnSite ─────────────────────────────────────────────────────────

	describe("searchOnSite", () => {
		it("returns search results from evaluate", async () => {
			const results = [
				{ selector: "p#intro", snippet: "Welcome to the site", tag: "p" },
				{ selector: "h1.title", snippet: "Welcome Home", tag: "h1" },
			];
			const talox = makeTaloxMock({ evaluate: vi.fn().mockResolvedValue(results) });
			const found = await searchOnSite(talox as any, "welcome");
			expect(found).toHaveLength(2);
			expect(found[0]!.snippet).toContain("Welcome");
		});

		it("respects the limit parameter", async () => {
			const results = [{ selector: "p", snippet: "test", tag: "p" }];
			const talox = makeTaloxMock({ evaluate: vi.fn().mockResolvedValue(results) });
			await searchOnSite(talox as any, "test", 1);
			const evalArg = talox.evaluate.mock.calls[0][0] as string;
			// The generated JS should embed the limit value
			expect(evalArg).toContain("1");
		});

		it("defaults limit to 5", async () => {
			const talox = makeTaloxMock({ evaluate: vi.fn().mockResolvedValue([]) });
			await searchOnSite(talox as any, "anything");
			const evalArg = talox.evaluate.mock.calls[0][0] as string;
			expect(evalArg).toContain("5");
		});
	});

	// ── extractVisibleStructuredContent ──────────────────────────────────────

	describe("extractVisibleStructuredContent", () => {
		it("returns structured content from page state", async () => {
			const state = samplePageState({
				url: "https://example.com",
				title: "Example",
				nodes: [
					{
						id: "h1",
						role: "heading",
						name: "Main Heading",
						boundingBox: { x: 0, y: 0, width: 800, height: 40 },
					} as any,
					{
						id: "p1",
						role: "paragraph",
						name: "Some text content here",
						boundingBox: { x: 0, y: 50, width: 800, height: 30 },
					} as any,
				],
			});
			const talox = makeTaloxMock({ getState: vi.fn().mockResolvedValue(state) });
			const result = await extractVisibleStructuredContent(talox as any);
			expect(result.url).toBe("https://example.com");
			expect(result.title).toBe("Example");
			expect(result.sections).toHaveLength(2);
			expect(result.sections[0]!.heading).toBe("Main Heading");
			expect(result.sections[0]!.summary).toBe("Main Heading");
		});

		it("skips nodes with empty names", async () => {
			const state = samplePageState({
				nodes: [
					{ id: "a", role: "link", name: "", boundingBox: { x: 0, y: 0, width: 100, height: 20 } } as any,
					{ id: "b", role: "heading", name: "Valid", boundingBox: { x: 0, y: 30, width: 100, height: 20 } } as any,
				],
			});
			const talox = makeTaloxMock({ getState: vi.fn().mockResolvedValue(state) });
			const result = await extractVisibleStructuredContent(talox as any);
			expect(result.sections).toHaveLength(1);
			expect(result.sections[0]!.heading).toBe("Valid");
		});

		it("caps sections at 6", async () => {
			const nodes = Array.from({ length: 10 }, (_, i) => ({
				id: `n${i}`,
				role: "heading",
				name: `Section ${i}`,
				boundingBox: { x: 0, y: i * 50, width: 800, height: 30 },
			}));
			const state = samplePageState({ nodes: nodes as any });
			const talox = makeTaloxMock({ getState: vi.fn().mockResolvedValue(state) });
			const result = await extractVisibleStructuredContent(talox as any);
			expect(result.sections).toHaveLength(6);
		});

		it('uses "Section" as heading for non-heading roles', async () => {
			const state = samplePageState({
				nodes: [
					{
						id: "p1",
						role: "paragraph",
						name: "Hello world",
						boundingBox: { x: 0, y: 0, width: 800, height: 30 },
					} as any,
				],
			});
			const talox = makeTaloxMock({ getState: vi.fn().mockResolvedValue(state) });
			const result = await extractVisibleStructuredContent(talox as any);
			expect(result.sections[0]!.heading).toBe("Section");
		});

		it("deduplicates selectors", async () => {
			const state = samplePageState({
				nodes: [
					{ id: "dup", role: "heading", name: "First", boundingBox: { x: 0, y: 0, width: 800, height: 30 } } as any,
					{ id: "dup", role: "heading", name: "Second", boundingBox: { x: 0, y: 50, width: 800, height: 30 } } as any,
				],
			});
			const talox = makeTaloxMock({ getState: vi.fn().mockResolvedValue(state) });
			const result = await extractVisibleStructuredContent(talox as any);
			// Second node has same selector `#dup` so it should be skipped
			expect(result.sections).toHaveLength(1);
		});
	});
});

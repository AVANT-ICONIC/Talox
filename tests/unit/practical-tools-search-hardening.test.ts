import { describe, expect, it, vi } from "vitest";
import { searchOnSite } from "../../src/tools/practical-tools.js";

function makeTaloxMock() {
	return {
		evaluate: vi.fn().mockResolvedValue([]),
	};
}

describe("searchOnSite hardening", () => {
	it("preserves the whitespace regex in generated browser code", async () => {
		const talox = makeTaloxMock();

		await searchOnSite(talox as any, "hello");

		const evalArg = talox.evaluate.mock.calls[0]![0] as string;
		expect(evalArg).toContain("split(/\\s+/)");
		expect(evalArg).not.toContain("split(/s+/)");
	});

	it("clamps non-positive and oversized limits before interpolation", async () => {
		const low = makeTaloxMock();
		await searchOnSite(low as any, "hello", -20);
		const lowScript = low.evaluate.mock.calls[0]![0] as string;
		expect(lowScript).toContain("matches.length >= 1");
		expect(lowScript).toContain("matches.slice(0, 1)");

		const high = makeTaloxMock();
		await searchOnSite(high as any, "hello", 500);
		const highScript = high.evaluate.mock.calls[0]![0] as string;
		expect(highScript).toContain("matches.length >= 100");
		expect(highScript).toContain("matches.slice(0, 100)");
	});

	it("falls back safely for non-finite or runtime-invalid limit values", async () => {
		const infinite = makeTaloxMock();
		await searchOnSite(infinite as any, "hello", Number.POSITIVE_INFINITY);
		const infiniteScript = infinite.evaluate.mock.calls[0]![0] as string;
		expect(infiniteScript).toContain("matches.length >= 5");
		expect(infiniteScript).not.toContain("Infinity");

		const injected = makeTaloxMock();
		await searchOnSite(injected as any, "hello", "1); globalThis.__taloxInjected = true; //" as any);
		const injectedScript = injected.evaluate.mock.calls[0]![0] as string;
		expect(injectedScript).toContain("matches.length >= 5");
		expect(injectedScript).not.toContain("__taloxInjected");
	});
});

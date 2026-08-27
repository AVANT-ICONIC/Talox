import { describe, expect, it, vi } from "vitest";
import { SessionManager } from "../../src/core/controller/SessionManager.js";

function makeCollector() {
	const close = vi.fn().mockResolvedValue(undefined);
	return {
		collector: { getPage: () => ({ close }) } as any,
		close,
	};
}

describe("SessionManager page mouse position reindexing", () => {
	it("preserves the surviving page position when closing a middle page", async () => {
		const session = new SessionManager(
			{ automaticThinkingEnabled: false, verbosity: 0 } as any,
			{ emit: vi.fn() } as any,
			".",
		);
		const first = makeCollector();
		const middle = makeCollector();
		const last = makeCollector();
		const positions = session.pageMousePositions;

		session.pages = [first.collector, middle.collector, last.collector];
		session.activePageIndex = 2;
		positions.set(0, { x: 10, y: 20 });
		positions.set(1, { x: 30, y: 40 });
		positions.set(2, { x: 50, y: 60 });

		await session.closePage(1);

		expect(middle.close).toHaveBeenCalledOnce();
		expect(session.activePageIndex).toBe(1);
		expect(session.pageMousePositions).toBe(positions);
		expect([...positions.entries()]).toEqual([
			[0, { x: 10, y: 20 }],
			[1, { x: 50, y: 60 }],
		]);
		expect(positions.has(2)).toBe(false);
	});
});

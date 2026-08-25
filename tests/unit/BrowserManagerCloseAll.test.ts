import type { BrowserContext } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { BrowserManager } from "../../src/core/BrowserManager.js";

describe("BrowserManager closeAll failure cleanup", () => {
	it("cleans every tracked resource before surfacing a context close failure", async () => {
		const manager = new BrowserManager();
		const closeFailure = new Error("close failed");
		const failingContext = { close: vi.fn().mockRejectedValue(closeFailure) } as unknown as BrowserContext;
		const healthyContext = { close: vi.fn().mockResolvedValue(undefined) } as unknown as BrowserContext;
		const state = manager as unknown as {
			contexts: Set<BrowserContext>;
			context: BrowserContext | null;
			releasePersistentProfileOwnership: () => void;
		};
		state.contexts.add(failingContext);
		state.contexts.add(healthyContext);
		state.context = failingContext;
		const releaseOwnership = vi.spyOn(state, "releasePersistentProfileOwnership");
		const stopXvfb = vi.spyOn(manager, "stopXvfb");

		await expect(manager.closeAll()).rejects.toBe(closeFailure);

		expect(failingContext.close).toHaveBeenCalledTimes(1);
		expect(healthyContext.close).toHaveBeenCalledTimes(1);
		expect(state.contexts.size).toBe(0);
		expect(manager.getContext()).toBeNull();
		expect(releaseOwnership).toHaveBeenCalledTimes(1);
		expect(stopXvfb).toHaveBeenCalledTimes(1);
	});
});

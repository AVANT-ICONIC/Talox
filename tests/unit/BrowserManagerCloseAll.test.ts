import type { BrowserContext } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { BrowserManager } from "../../src/core/BrowserManager.js";

describe("BrowserManager closeAll failure cleanup", () => {
	it("waits for every close and retains failed contexts for a safe retry", async () => {
		const manager = new BrowserManager();
		const closeFailure = new Error("close failed");
		const failingClose = vi.fn().mockRejectedValueOnce(closeFailure).mockResolvedValue(undefined);
		const healthyClose = vi.fn().mockResolvedValue(undefined);
		const failingContext = { close: failingClose } as unknown as BrowserContext;
		const healthyContext = { close: healthyClose } as unknown as BrowserContext;
		const state = manager as unknown as {
			contexts: Set<BrowserContext>;
			context: BrowserContext | null;
			ownedProfileDir: string | null;
			profileOwnerContext: BrowserContext | null;
			releasePersistentProfileOwnership: () => void;
		};
		state.contexts.add(failingContext);
		state.contexts.add(healthyContext);
		state.context = failingContext;
		state.ownedProfileDir = "/tmp/talox-close-retry";
		state.profileOwnerContext = failingContext;
		const releaseOwnership = vi.spyOn(state, "releasePersistentProfileOwnership");
		const stopXvfb = vi.spyOn(manager, "stopXvfb");

		await expect(manager.closeAll()).rejects.toBe(closeFailure);

		expect(failingClose).toHaveBeenCalledTimes(1);
		expect(healthyClose).toHaveBeenCalledTimes(1);
		expect(state.contexts.has(failingContext)).toBe(true);
		expect(state.contexts.has(healthyContext)).toBe(false);
		expect(manager.getContext()).toBe(failingContext);
		expect(state.ownedProfileDir).toBe("/tmp/talox-close-retry");
		expect(releaseOwnership).not.toHaveBeenCalled();
		expect(stopXvfb).not.toHaveBeenCalled();

		await expect(manager.closeAll()).resolves.toBeUndefined();

		expect(failingClose).toHaveBeenCalledTimes(2);
		expect(healthyClose).toHaveBeenCalledTimes(1);
		expect(state.contexts.size).toBe(0);
		expect(manager.getContext()).toBeNull();
		expect(state.ownedProfileDir).toBeNull();
		expect(releaseOwnership).toHaveBeenCalledTimes(1);
		expect(stopXvfb).toHaveBeenCalledTimes(1);
	});
});

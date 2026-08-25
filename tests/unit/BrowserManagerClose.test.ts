import type { BrowserContext } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { BrowserManager } from "../../src/core/BrowserManager.js";

type BrowserManagerState = {
	contexts: Set<BrowserContext>;
	context: BrowserContext | null;
	ownedProfileDir: string | null;
	profileOwnerContext: BrowserContext | null;
	releasePersistentProfileOwnership: () => void;
};

describe("BrowserManager close reconciliation", () => {
	it("removes a successfully closed context even when no close event is emitted", async () => {
		const manager = new BrowserManager();
		const context = { close: vi.fn().mockResolvedValue(undefined) } as unknown as BrowserContext;
		const state = manager as unknown as BrowserManagerState;
		state.contexts.add(context);
		state.context = context;
		state.ownedProfileDir = "/tmp/talox-close-success";
		state.profileOwnerContext = context;
		const releaseOwnership = vi.spyOn(state, "releasePersistentProfileOwnership");
		const stopXvfb = vi.spyOn(manager, "stopXvfb");

		await manager.close();

		expect(context.close).toHaveBeenCalledTimes(1);
		expect(state.contexts.size).toBe(0);
		expect(manager.getContext()).toBeNull();
		expect(state.ownedProfileDir).toBeNull();
		expect(releaseOwnership).toHaveBeenCalledTimes(1);
		expect(stopXvfb).toHaveBeenCalledTimes(1);
	});

	it("retains a context and shared resources when close rejects so the close can be retried", async () => {
		const manager = new BrowserManager();
		const closeFailure = new Error("close failed");
		const close = vi.fn().mockRejectedValueOnce(closeFailure).mockResolvedValue(undefined);
		const context = { close } as unknown as BrowserContext;
		const state = manager as unknown as BrowserManagerState;
		state.contexts.add(context);
		state.context = context;
		state.ownedProfileDir = "/tmp/talox-close-retry";
		state.profileOwnerContext = context;
		const releaseOwnership = vi.spyOn(state, "releasePersistentProfileOwnership");
		const stopXvfb = vi.spyOn(manager, "stopXvfb");

		await expect(manager.close()).rejects.toBe(closeFailure);

		expect(close).toHaveBeenCalledTimes(1);
		expect(state.contexts.has(context)).toBe(true);
		expect(manager.getContext()).toBe(context);
		expect(state.ownedProfileDir).toBe("/tmp/talox-close-retry");
		expect(releaseOwnership).not.toHaveBeenCalled();
		expect(stopXvfb).not.toHaveBeenCalled();

		await expect(manager.close()).resolves.toBeUndefined();

		expect(close).toHaveBeenCalledTimes(2);
		expect(state.contexts.size).toBe(0);
		expect(manager.getContext()).toBeNull();
		expect(state.ownedProfileDir).toBeNull();
		expect(releaseOwnership).toHaveBeenCalledTimes(1);
		expect(stopXvfb).toHaveBeenCalledTimes(1);
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const snapshotMocks = vi.hoisted(() => ({
	capture: vi.fn(),
	restore: vi.fn(),
}));

vi.mock("../../src/core/SessionSnapshot.js", () => ({
	captureSessionSnapshot: snapshotMocks.capture,
	restoreSessionSnapshot: snapshotMocks.restore,
}));

import { TaloxController } from "../../src/core/controller/TaloxController.js";

const snapshot = {
	url: "https://example.com/account",
	title: "Account",
	capturedAt: "2026-08-27T00:00:00.000Z",
	cookies: [],
	localStorage: {},
	sessionStorage: {},
	scrollX: 0,
	scrollY: 0,
};

function createController() {
	const controller = new TaloxController("/tmp/talox-set-headed-shared-settings", {
		settings: {
			headed: false,
			automaticThinkingEnabled: false,
			autoDialogHandling: false,
		},
	});
	const session = controller._session as any;
	const oldPage = { isClosed: vi.fn(() => false) };
	const oldContext = {};
	const newPage = { isClosed: vi.fn(() => false) };
	const newContext = { newPage: vi.fn(async () => newPage) };
	const oldCollector = { getPage: () => oldPage };
	const newCollector = { getPage: () => newPage };

	session.profile = {
		id: "set-headed-profile",
		class: "qa",
		purpose: "setHeaded shared settings regression",
		userDataDir: "/tmp/talox-set-headed-shared-settings/set-headed-profile",
		metadata: { createdAt: "", lastUsed: "" },
	};
	session.pages = [oldCollector];
	session.activePageIndex = 0;

	vi.spyOn(session.browserManager, "getContext").mockReturnValue(oldContext as any);
	const close = vi.spyOn(session.browserManager, "close").mockResolvedValue(undefined);
	const launch = vi.spyOn(session.browserManager, "launch").mockResolvedValue(newContext as any);
	vi.spyOn(session, "injectNetworkGuard").mockResolvedValue(undefined);
	vi.spyOn(session, "injectStealthScripts").mockResolvedValue(undefined);
	session.attachSecurityHooks = vi.fn(async () => undefined);
	session.createStateCollector = vi.fn(() => newCollector);
	session.activateCachedStateForActivePage = vi.fn();
	session.startAutoThinking = vi.fn();
	session.startSessionIdleMonitor = vi.fn();

	return { controller, close, launch, newContext, newPage, oldContext, oldPage };
}

describe("TaloxController setHeaded shared settings lifecycle", () => {
	beforeEach(() => {
		snapshotMocks.capture.mockReset();
		snapshotMocks.restore.mockReset();
		snapshotMocks.capture.mockResolvedValue(snapshot);
		snapshotMocks.restore.mockResolvedValue(undefined);
	});

	it("reaches the real browser recreation path before shared settings flip to the target mode", async () => {
		const { controller, close, launch, newContext, newPage, oldContext, oldPage } = createController();

		await controller.setHeaded(true);

		expect(snapshotMocks.capture).toHaveBeenCalledWith(oldPage, oldContext);
		expect(close).toHaveBeenCalledOnce();
		expect(launch).toHaveBeenCalledOnce();
		expect(newContext.newPage).toHaveBeenCalledOnce();
		expect(snapshotMocks.restore).toHaveBeenCalledWith(newPage, newContext, snapshot);
		expect(controller.settings.headed).toBe(true);
	});

	it("keeps same-mode setHeaded calls as no-ops", async () => {
		const { controller, close, launch } = createController();

		await controller.setHeaded(false);

		expect(close).not.toHaveBeenCalled();
		expect(launch).not.toHaveBeenCalled();
		expect(snapshotMocks.capture).not.toHaveBeenCalled();
		expect(controller.settings.headed).toBe(false);
	});
});

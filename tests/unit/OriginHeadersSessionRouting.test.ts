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
	url: "https://api.example.com/account",
	title: "Account",
	capturedAt: "2026-08-27T00:00:00.000Z",
	cookies: [],
	localStorage: {},
	sessionStorage: {},
	scrollX: 0,
	scrollY: 0,
};

const emptyState = {
	url: "https://api.example.com/account",
	title: "Account",
	nodes: [],
	interactiveElements: [],
	console: { logs: [], errors: [], warnings: [] },
	network: { requests: [], failedRequests: [] },
	bugs: [],
	timestamp: "2026-08-27T00:00:00.000Z",
};

function createPage(order: string[]) {
	let closed = false;
	let closeHandler: (() => void) | null = null;
	return {
		route: vi.fn(async () => {
			order.push("route");
		}),
		unroute: vi.fn().mockResolvedValue(undefined),
		on: vi.fn(),
		once: vi.fn((event: string, handler: () => void) => {
			if (event === "close") closeHandler = handler;
		}),
		off: vi.fn((event: string, handler: () => void) => {
			if (event === "close" && closeHandler === handler) closeHandler = null;
		}),
		goto: vi.fn(async () => {
			order.push("goto");
		}),
		close: vi.fn(async () => {
			closed = true;
			const handler = closeHandler;
			closeHandler = null;
			handler?.();
		}),
		isClosed: vi.fn(() => closed),
	};
}

function createController() {
	return new TaloxController("/tmp/talox-origin-session-routing", {
		originHeaders: {
			"https://api.example.com": { Authorization: "Bearer secret" },
		},
		settings: {
			automaticThinkingEnabled: false,
			autoDialogHandling: false,
		},
	});
}

function setQaProfile(session: any, id: string): void {
	session.profile = {
		id,
		class: "qa",
		purpose: "origin routing regression",
		userDataDir: `/tmp/talox-origin-session-routing/${id}`,
		metadata: { createdAt: "", lastUsed: "" },
	};
}

function installCollectorStub(session: any, page: any) {
	const collector = {
		getPage: () => page,
		collect: vi.fn(async () => ({ ...emptyState, bugs: [] })),
	};
	session.createStateCollector = vi.fn(() => collector);
	vi.spyOn(session.rulesEngine, "analyze").mockReturnValue([]);
	return collector;
}

describe("OriginHeaders session routing", () => {
	beforeEach(() => {
		snapshotMocks.capture.mockReset();
		snapshotMocks.restore.mockReset();
		snapshotMocks.capture.mockResolvedValue(snapshot);
		snapshotMocks.restore.mockResolvedValue(undefined);
	});

	it("installs security then origin headers before the first openPage navigation", async () => {
		const order: string[] = [];
		const controller = createController();
		const session = controller._session as any;
		const page = createPage(order);
		setQaProfile(session, "origin-routing-profile");
		vi.spyOn(session.browserManager, "newPage").mockResolvedValue(page as any);
		vi.spyOn(session, "injectStealthScripts").mockResolvedValue(undefined);
		installCollectorStub(session, page);

		await controller.openPage("https://api.example.com/account");

		expect(order).toEqual(["route", "route", "goto"]);
	});

	it("keeps the surviving sibling route through open, switch, and close", async () => {
		const controller = createController();
		const session = controller._session as any;
		const firstPage = createPage([]);
		const secondPage = createPage([]);
		const firstCollector = { getPage: () => firstPage };
		setQaProfile(session, "origin-sibling-profile");
		session.pages = [firstCollector];
		session.activePageIndex = 0;
		await (controller as any).setupOriginHeaders(firstPage as any);
		vi.spyOn(session.browserManager, "newPage").mockResolvedValue(secondPage as any);
		vi.spyOn(session, "injectStealthScripts").mockResolvedValue(undefined);
		installCollectorStub(session, secondPage);

		await controller.openPage("https://api.example.com/account");
		controller.switchPage(0);
		await controller.closePage(1);

		expect(firstPage.unroute).not.toHaveBeenCalled();
		expect(secondPage.unroute).not.toHaveBeenCalled();
		expect(firstPage.route).toHaveBeenCalledTimes(1);
		await (controller as any).disposeOriginHeaders();
		expect(firstPage.unroute).toHaveBeenCalledTimes(1);
		expect(secondPage.unroute).not.toHaveBeenCalled();
	});

	it("installs origin headers on the recreated page before snapshot restoration navigation", async () => {
		const order: string[] = [];
		const controller = createController();
		const session = controller._session as any;
		const oldPage = createPage([]);
		const newPage = createPage(order);
		const oldContext = {};
		const newContext = { newPage: vi.fn(async () => newPage) };
		const oldCollector = { getPage: () => oldPage };
		const newCollector = installCollectorStub(session, newPage);
		setQaProfile(session, "origin-headed-profile");
		session.pages = [oldCollector];
		session.activePageIndex = 0;
		vi.spyOn(session.browserManager, "getContext").mockReturnValue(oldContext as any);
		vi.spyOn(session.browserManager, "close").mockResolvedValue(undefined);
		vi.spyOn(session.browserManager, "launch").mockResolvedValue(newContext as any);
		vi.spyOn(session, "injectStealthScripts").mockResolvedValue(undefined);
		session.createStateCollector = vi.fn(() => newCollector);
		snapshotMocks.restore.mockImplementation(async () => {
			order.push("restore");
		});

		await controller.setHeaded(true);
		session.stopSessionIdleMonitor();

		expect(order).toEqual(["route", "route", "restore"]);
	});
});

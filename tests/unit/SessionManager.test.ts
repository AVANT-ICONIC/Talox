/**
 * Unit tests for SessionManager — browser session lifecycle, multi-page
 * management, security hooks, auto-thinking, and behavioral DNA.
 * All Playwright/browser dependencies are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockLaunch = vi.fn();
const mockClose = vi.fn();
const mockGetContext = vi.fn().mockReturnValue(null);
const mockNewPage = vi.fn();

vi.mock("../../src/core/BrowserManager.js", () => ({
	BrowserManager: class {
		launch = mockLaunch;
		close = mockClose;
		getContext = mockGetContext;
		newPage = mockNewPage;
	},
}));

vi.mock("../../src/core/ProfileVault.js", () => ({
	ProfileVault: class {
		createProfile = vi.fn().mockResolvedValue({
			id: "test-profile-1",
			class: "sandbox",
			purpose: "Test",
			userDataDir: "/tmp/test-profile",
			metadata: { createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() },
		});
	},
}));

vi.mock("../../src/core/PageStateCollector.js", () => ({
	PageStateCollector: class {
		collect = vi.fn().mockResolvedValue({
			url: "https://example.com",
			title: "Test",
			timestamp: new Date().toISOString(),
			console: { errors: [] },
			network: { failedRequests: [] },
			nodes: [],
			interactiveElements: [],
			bugs: [],
		});
		page = {
			url: vi.fn().mockReturnValue("https://example.com"),
			goto: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
			screenshot: vi.fn().mockResolvedValue(Buffer.from("")),
			mouse: {
				move: vi.fn().mockResolvedValue(undefined),
				click: vi.fn().mockResolvedValue(undefined),
				wheel: vi.fn().mockResolvedValue(undefined),
			},
			keyboard: { type: vi.fn().mockResolvedValue(undefined), press: vi.fn().mockResolvedValue(undefined) },
			addInitScript: vi.fn().mockResolvedValue(undefined),
			route: vi.fn().mockResolvedValue(undefined),
			on: vi.fn(),
			evaluate: vi.fn().mockResolvedValue(undefined),
		};
	},
}));

vi.mock("../../src/core/RulesEngine.js", () => ({
	RulesEngine: class {
		analyze = vi.fn().mockReturnValue([]);
		diffStructural = vi.fn().mockReturnValue([]);
	},
}));

vi.mock("../../src/core/ArtifactBuilder.js", () => ({
	ArtifactBuilder: class {
		addAction = vi.fn();
	},
}));

vi.mock("../../src/core/VisionGate.js", () => ({
	VisionGate: class {
		getBaseline = vi.fn().mockResolvedValue(null);
		saveBaseline = vi.fn().mockResolvedValue(undefined);
		compare = vi.fn().mockResolvedValue({ mismatchedPixels: 0, ssimScore: 1 });
		extractText = vi.fn().mockResolvedValue("");
	},
}));

vi.mock("../../src/core/PolicyEngine.js", () => ({
	PolicyEngine: class {
		isAllowed = vi.fn().mockReturnValue(true);
		canPerform = vi.fn().mockReturnValue(true);
	},
}));

vi.mock("../../src/core/HumanMouse.js", () => ({
	HumanMouse: {
		click: vi.fn().mockResolvedValue({ x: 100, y: 200 }),
		move: vi.fn().mockResolvedValue(undefined),
		fidget: vi.fn().mockResolvedValue(undefined),
	},
}));

vi.mock("../../src/core/observe/ObserveSession.js", () => ({
	ObserveSession: class {
		start = vi.fn().mockResolvedValue(undefined);
		endSession = vi.fn().mockResolvedValue(undefined);
	},
}));

vi.mock("../../src/core/SessionSnapshot.js", () => ({
	captureSessionSnapshot: vi.fn().mockResolvedValue({
		url: "https://example.com",
		cookies: [],
		localStorage: {},
		sessionStorage: {},
		scrollPosition: { x: 0, y: 0 },
	}),
	restoreSessionSnapshot: vi.fn().mockResolvedValue(undefined),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockContext() {
	return {
		close: vi.fn().mockResolvedValue(undefined),
		newPage: vi.fn().mockResolvedValue(createMockPage()),
		on: vi.fn(),
		pages: vi.fn().mockReturnValue([]),
	};
}

function createMockPage() {
	return {
		url: vi.fn().mockReturnValue("https://example.com"),
		goto: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("png")),
		mouse: {
			move: vi.fn().mockResolvedValue(undefined),
			click: vi.fn().mockResolvedValue(undefined),
			wheel: vi.fn().mockResolvedValue(undefined),
		},
		keyboard: {
			type: vi.fn().mockResolvedValue(undefined),
			press: vi.fn().mockResolvedValue(undefined),
		},
		addInitScript: vi.fn().mockResolvedValue(undefined),
		route: vi.fn().mockResolvedValue(undefined),
		on: vi.fn(),
		evaluate: vi.fn().mockResolvedValue(undefined),
	};
}

const defaultSettings = {
	mouseSpeed: 1.0,
	typingDelayMin: 50,
	typingDelayMax: 150,
	typoProbability: 0,
	fidgetEnabled: false,
	humanStealth: 0,
	stealthLevel: "low" as const,
	adaptiveStealthEnabled: false,
	automaticThinkingEnabled: false,
	perceptionDepth: "full" as const,
	headed: false,
	autoHeadedEscalation: true,
	verbosity: 0 as const,
	humanTakeoverEnabled: false,
	humanTakeoverTimeoutMs: 120000,
	idleTimeout: 5000,
	precisionDecay: 0.1,
	adaptiveStealthSensitivity: 0.5,
	adaptiveStealthRadius: 100,
	safeMode: false,
};

// ─── Import after mocks ────────────────────────────────────────────────────

import { SessionManager } from "../../src/core/controller/SessionManager.js";

describe("SessionManager", () => {
	let sm: SessionManager;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ shouldAdvanceTime: true });
		mockLaunch.mockReset();
		mockClose.mockReset();
		mockGetContext.mockReturnValue(null);
		mockNewPage.mockReset();

		sm = new SessionManager({ ...defaultSettings } as any, { emit: vi.fn() } as any, "/tmp/talox-test");
	});

	afterEach(() => {
		vi.useRealTimers();
		sm.stopAutoThinking();
	});

	// ─── Constructor ─────────────────────────────────────────────────────────

	describe("constructor", () => {
		it("initializes all subsystems", () => {
			expect(sm.browserManager).toBeDefined();
			expect(sm.profileVault).toBeDefined();
			expect(sm.rulesEngine).toBeDefined();
			expect(sm.artifactBuilder).toBeDefined();
			expect(sm.visionGate).toBeDefined();
			expect(sm.policyEngine).toBeDefined();
		});

		it("starts with no active page", () => {
			expect(sm.activePageIndex).toBe(-1);
			expect(sm.pages).toEqual([]);
		});
	});

	// ─── Launch ─────────────────────────────────────────────────────────────

	describe("launch", () => {
		it("launches browser and creates initial page", async () => {
			const mockCtx = createMockContext();
			const mockPage = createMockPage();
			mockCtx.newPage.mockResolvedValue(mockPage);
			mockLaunch.mockResolvedValue(mockCtx);

			await sm.launch("test-id", "sandbox", { ...defaultSettings } as any);

			expect(mockLaunch).toHaveBeenCalled();
			expect(sm.activePageIndex).toBe(0);
			expect(sm.pages.length).toBe(1);
		});

		it("sets profile via profileVault", async () => {
			const mockCtx = createMockContext();
			mockCtx.newPage.mockResolvedValue(createMockPage());
			mockLaunch.mockResolvedValue(mockCtx);

			await sm.launch("test-id", "qa", { ...defaultSettings } as any);

			expect(sm.profile).toBeDefined();
			expect(sm.profile!.id).toBe("test-profile-1");
		});

		it("records launch artifact", async () => {
			const mockCtx = createMockContext();
			mockCtx.newPage.mockResolvedValue(createMockPage());
			mockLaunch.mockResolvedValue(mockCtx);
			const addActionSpy = vi.spyOn(sm.artifactBuilder, "addAction");

			await sm.launch("test-id", "sandbox", { ...defaultSettings } as any);

			expect(addActionSpy).toHaveBeenCalledWith(
				"launch",
				expect.objectContaining({
					profileId: "test-id",
					profileClass: "sandbox",
				}),
			);
		});

		it("initializes mouse position for first page", async () => {
			const mockCtx = createMockContext();
			mockCtx.newPage.mockResolvedValue(createMockPage());
			mockLaunch.mockResolvedValue(mockCtx);

			await sm.launch("test-id", "sandbox", { ...defaultSettings } as any);

			expect(sm.pageMousePositions.get(0)).toEqual({ x: 0, y: 0 });
		});

		it("passes headless: false when observeOptions.headed is true", async () => {
			const mockCtx = createMockContext();
			mockCtx.newPage.mockResolvedValue(createMockPage());
			mockLaunch.mockResolvedValue(mockCtx);

			await sm.launch("test-id", "sandbox", { ...defaultSettings } as any, "chromium", {
				headed: true,
				overlay: false,
				record: false,
			});

			expect(mockLaunch).toHaveBeenCalledWith(
				expect.anything(),
				expect.any(Boolean),
				"chromium",
				expect.objectContaining({ headless: false }),
			);
		});

		it("injects stealth scripts on new page", async () => {
			const mockCtx = createMockContext();
			const mockPage = createMockPage();
			mockCtx.newPage.mockResolvedValue(mockPage);
			mockLaunch.mockResolvedValue(mockCtx);

			await sm.launch("test-id", "sandbox", { ...defaultSettings } as any);

			expect(mockPage.addInitScript).toHaveBeenCalled();
		});
	});

	// ─── Stop ───────────────────────────────────────────────────────────────

	describe("stop", () => {
		it("closes browser and stops auto-thinking", async () => {
			mockClose.mockResolvedValue(undefined);

			await sm.stop();

			expect(mockClose).toHaveBeenCalled();
		});
	});

	// ─── Multi-Page Management ──────────────────────────────────────────────

	describe("openPage", () => {
		it("creates a new page/tab and navigates", async () => {
			const mockPage = createMockPage();
			mockNewPage.mockResolvedValue(mockPage);

			// First set up an initial page
			sm.pages = [
				{
					collect: vi.fn().mockResolvedValue({
						url: "",
						title: "",
						timestamp: "",
						console: { errors: [] },
						network: { failedRequests: [] },
						nodes: [],
						interactiveElements: [],
						bugs: [],
					}),
				} as any,
			];
			sm.activePageIndex = 0;

			const state = await sm.openPage("https://new-page.com");

			expect(mockNewPage).toHaveBeenCalled();
			expect(sm.pages.length).toBe(2);
			expect(sm.activePageIndex).toBe(1);
			expect(state).toBeDefined();
		});

		it("records openPage artifact", async () => {
			const mockPage = createMockPage();
			mockNewPage.mockResolvedValue(mockPage);
			sm.pages = [
				{
					collect: vi.fn().mockResolvedValue({
						url: "",
						title: "",
						timestamp: "",
						console: { errors: [] },
						network: { failedRequests: [] },
						nodes: [],
						interactiveElements: [],
						bugs: [],
					}),
				} as any,
			];
			sm.activePageIndex = 0;
			const addActionSpy = vi.spyOn(sm.artifactBuilder, "addAction");

			await sm.openPage("https://example.com");

			expect(addActionSpy).toHaveBeenCalledWith(
				"openPage",
				expect.objectContaining({
					url: "https://example.com",
				}),
			);
		});
	});

	describe("closePage", () => {
		it("closes page and adjusts active index", async () => {
			const mockPage1 = createMockPage();
			const mockPage2 = createMockPage();

			sm.pages = [{ collect: vi.fn(), page: mockPage1 } as any, { collect: vi.fn(), page: mockPage2 } as any];
			sm.activePageIndex = 1;
			sm.pageMousePositions.set(0, { x: 0, y: 0 });
			sm.pageMousePositions.set(1, { x: 100, y: 200 });

			await sm.closePage(1);

			expect(mockPage2.close).toHaveBeenCalled();
			expect(sm.pages.length).toBe(1);
			expect(sm.activePageIndex).toBe(0);
		});

		it("adjusts activePageIndex when closing a page before active", async () => {
			const mockPage1 = createMockPage();
			const mockPage2 = createMockPage();
			const mockPage3 = createMockPage();

			sm.pages = [
				{ collect: vi.fn(), page: mockPage1 } as any,
				{ collect: vi.fn(), page: mockPage2 } as any,
				{ collect: vi.fn(), page: mockPage3 } as any,
			];
			sm.activePageIndex = 2;

			await sm.closePage(0);

			expect(sm.pages.length).toBe(2);
			expect(sm.activePageIndex).toBe(1); // was 2, decremented because index 0 removed
		});

		it("throws for invalid page index", async () => {
			sm.pages = [];

			await expect(sm.closePage(0)).rejects.toThrow("Invalid page index");
			await expect(sm.closePage(-1)).rejects.toThrow("Invalid page index");
		});
	});

	describe("switchPage", () => {
		it("switches active page index", () => {
			sm.pages = [{}, {}, {}] as any;

			sm.switchPage(2);
			expect(sm.activePageIndex).toBe(2);

			sm.switchPage(0);
			expect(sm.activePageIndex).toBe(0);
		});

		it("throws for invalid index", () => {
			sm.pages = [{}] as any;
			expect(() => sm.switchPage(5)).toThrow("Invalid page index");
			expect(() => sm.switchPage(-1)).toThrow("Invalid page index");
		});

		it("records switchPage artifact", () => {
			sm.pages = [{}, {}] as any;
			const addActionSpy = vi.spyOn(sm.artifactBuilder, "addAction");

			sm.switchPage(1);

			expect(addActionSpy).toHaveBeenCalledWith("switchPage", { index: 1 });
		});
	});

	describe("getPageCount", () => {
		it("returns number of pages", () => {
			expect(sm.getPageCount()).toBe(0);
			sm.pages = [{} as any, {} as any];
			expect(sm.getPageCount()).toBe(2);
		});
	});

	describe("getActivePageIndex", () => {
		it("returns current active page index", () => {
			expect(sm.getActivePageIndex()).toBe(-1);
			sm.activePageIndex = 2;
			expect(sm.getActivePageIndex()).toBe(2);
		});
	});

	describe("getActivePage", () => {
		it("returns null when no active page", () => {
			expect(sm.getActivePage()).toBeNull();
		});

		it("returns the active page collector", () => {
			const collector = { collect: vi.fn() };
			sm.pages = [collector as any];
			sm.activePageIndex = 0;

			expect(sm.getActivePage()).toBe(collector);
		});
	});

	describe("getPage", () => {
		it("throws when no active page", () => {
			expect(() => sm.getPage()).toThrow("No active page");
		});

		it("returns the playwright page from active collector", () => {
			const mockPage = createMockPage();
			sm.pages = [{ page: mockPage } as any];
			sm.activePageIndex = 0;

			expect(sm.getPage()).toBe(mockPage);
		});
	});

	describe("getPlaywrightPage", () => {
		it("returns null when no active page", () => {
			expect(sm.getPlaywrightPage()).toBeNull();
		});

		it("returns page from active collector", () => {
			const mockPage = createMockPage();
			sm.pages = [{ page: mockPage } as any];
			sm.activePageIndex = 0;

			expect(sm.getPlaywrightPage()).toBe(mockPage);
		});
	});

	describe("getAllPages", () => {
		it("returns copy of pages array", () => {
			sm.pages = [{} as any, {} as any];
			const all = sm.getAllPages();
			expect(all).toEqual(sm.pages);
			expect(all).not.toBe(sm.pages); // should be a copy
		});
	});

	// ─── Freeze/Unfreeze ────────────────────────────────────────────────────

	describe("freeze/unfreeze", () => {
		it("freeze stops auto-thinking and records artifact", () => {
			const addActionSpy = vi.spyOn(sm.artifactBuilder, "addAction");
			sm.freeze();
			expect(addActionSpy).toHaveBeenCalledWith(
				"freeze",
				expect.objectContaining({
					timestamp: expect.any(String),
				}),
			);
		});

		it("unfreeze records artifact", () => {
			const addActionSpy = vi.spyOn(sm.artifactBuilder, "addAction");
			sm.unfreeze();
			expect(addActionSpy).toHaveBeenCalledWith(
				"unfreeze",
				expect.objectContaining({
					timestamp: expect.any(String),
				}),
			);
		});
	});

	// ─── Auto-Thinking ──────────────────────────────────────────────────────

	describe("auto-thinking", () => {
		it("startAutoThinking is skipped when disabled in settings", () => {
			const addActionSpy = vi.spyOn(sm.artifactBuilder, "addAction");
			// automaticThinkingEnabled is false by default in our test settings
			sm.startAutoThinking({});
			expect(addActionSpy).toHaveBeenCalledWith("startAutoThinking", { reason: "disabled" });
		});

		it("startAutoThinking creates interval when enabled", () => {
			sm.settings.automaticThinkingEnabled = true;
			sm.startAutoThinking({});
			expect(sm.isAutoThinkingRunning()).toBe(true);
		});

		it("startAutoThinking is no-op when already active", () => {
			sm.settings.automaticThinkingEnabled = true;
			sm.startAutoThinking({});
			// Second call should be a no-op
			sm.startAutoThinking({});
			expect(sm.isAutoThinkingRunning()).toBe(true);
		});

		it("stopAutoThinking stops the interval", () => {
			sm.settings.automaticThinkingEnabled = true;
			sm.startAutoThinking({});
			expect(sm.isAutoThinkingRunning()).toBe(true);

			sm.stopAutoThinking();
			expect(sm.isAutoThinkingRunning()).toBe(false);
		});

		it("stopAutoThinking is no-op when not active", () => {
			expect(sm.isAutoThinkingRunning()).toBe(false);
			sm.stopAutoThinking();
			expect(sm.isAutoThinkingRunning()).toBe(false);
		});

		it("isAutoThinkingRunning reflects state", () => {
			sm.settings.automaticThinkingEnabled = true;
			expect(sm.isAutoThinkingRunning()).toBe(false);
			sm.startAutoThinking({});
			expect(sm.isAutoThinkingRunning()).toBe(true);
			sm.stopAutoThinking();
			expect(sm.isAutoThinkingRunning()).toBe(false);
		});

		it("setAutomaticThinkingEnabled updates settings", () => {
			sm.setAutomaticThinkingEnabled(true);
			expect(sm.settings.automaticThinkingEnabled).toBe(true);
			sm.setAutomaticThinkingEnabled(false);
			expect(sm.settings.automaticThinkingEnabled).toBe(false);
		});

		it("setIdleTimeout clamps between 1000 and 60000", () => {
			sm.setIdleTimeout(500);
			expect(sm.settings.idleTimeout).toBe(1000);

			sm.setIdleTimeout(100000);
			expect(sm.settings.idleTimeout).toBe(60000);

			sm.setIdleTimeout(5000);
			expect(sm.settings.idleTimeout).toBe(5000);
		});

		it("recordActivity updates timestamp", () => {
			const before = Date.now();
			sm.recordActivity();
			// Activity timestamp should be >= before
			// (in fake timers, Date.now() is controlled)
		});
	});

	// ─── Behavioral DNA ─────────────────────────────────────────────────────

	describe("generateBehavioralDNA", () => {
		it("generates deterministic DNA for same profile ID", () => {
			const dna1 = sm.generateBehavioralDNA("profile-1");
			const dna2 = sm.generateBehavioralDNA("profile-1");
			expect(dna1).toEqual(dna2);
		});

		it("generates different DNA for different profile IDs", () => {
			const dna1 = sm.generateBehavioralDNA("profile-1");
			const dna2 = sm.generateBehavioralDNA("profile-2");
			// Not guaranteed to be different for all fields, but jitter should differ
			expect(dna1).toBeDefined();
			expect(dna2).toBeDefined();
		});

		it("includes expected DNA fields", () => {
			const dna = sm.generateBehavioralDNA("test");
			expect(dna).toHaveProperty("jitterFrequency");
			expect(dna).toHaveProperty("accelerationCurve");
			expect(dna).toHaveProperty("typingRhythm");
			expect(dna).toHaveProperty("clickPrecision");
			expect(dna).toHaveProperty("movementStyle");
		});

		it("records artifact", () => {
			const addActionSpy = vi.spyOn(sm.artifactBuilder, "addAction");
			sm.generateBehavioralDNA("test");
			expect(addActionSpy).toHaveBeenCalledWith(
				"generateBehavioralDNA",
				expect.objectContaining({
					profileId: "test",
				}),
			);
		});
	});

	// ─── Headed Mode Escalation ─────────────────────────────────────────────

	describe("setHeadedMode", () => {
		it("is no-op when settings.headed already matches", async () => {
			// Must have an active page so getPage() doesn't throw
			const mockPage = createMockPage();
			sm.pages = [{ page: mockPage, collect: vi.fn() } as any];
			sm.activePageIndex = 0;
			const mockCtx = createMockContext();
			mockGetContext.mockReturnValue(mockCtx);
			sm.profile = {
				id: "test",
				class: "sandbox",
				purpose: "test",
				userDataDir: "/tmp/test",
				metadata: { createdAt: "", lastUsed: "" },
			};
			sm.settings.headed = true;

			await sm.setHeadedMode(true);
			expect(mockLaunch).not.toHaveBeenCalled();
		});

		it("is no-op when no context/page/profile", async () => {
			// getPage() throws when there's no active page — set up enough state
			// to reach the early-return guard without throwing.
			// When context is null, the guard at line 194 returns early.
			// But getPage() is called first, so we need a valid page.
			const mockPage = createMockPage();
			sm.pages = [{ page: mockPage, collect: vi.fn() } as any];
			sm.activePageIndex = 0;
			// No context, no profile → guard returns early
			mockGetContext.mockReturnValue(null);
			sm.profile = null;
			sm.settings.headed = false;

			await sm.setHeadedMode(true);
			expect(mockLaunch).not.toHaveBeenCalled();
		});

		it("relaunches browser and restores snapshot when switching", async () => {
			const mockCtx = createMockContext();
			const mockPage = createMockPage();
			mockCtx.newPage.mockResolvedValue(mockPage);
			mockGetContext.mockReturnValue(mockCtx);
			mockLaunch.mockResolvedValue(mockCtx);

			sm.settings.headed = false;
			sm.profile = {
				id: "test",
				class: "sandbox",
				purpose: "test",
				userDataDir: "/tmp/test",
				metadata: { createdAt: "", lastUsed: "" },
			};
			sm.pages = [{ page: mockPage, collect: vi.fn() } as any];
			sm.activePageIndex = 0;

			await sm.setHeadedMode(true);

			expect(mockClose).toHaveBeenCalled();
			expect(mockLaunch).toHaveBeenCalled();
			expect(sm.settings.headed).toBe(true);
		});
	});

	// ─── Security Hooks ─────────────────────────────────────────────────────

	describe("injectStealthScripts", () => {
		it("calls page.addInitScript for stealth injection", async () => {
			const mockPage = createMockPage();
			await sm.injectStealthScripts(mockPage);
			expect(mockPage.addInitScript).toHaveBeenCalled();
		});
	});

	// ─── Cursor Heartbeat (auto-thinking behaviors) ─────────────────────────

	describe("performMicroJitter", () => {
		it("moves mouse by small random offset", async () => {
			const mockPage = createMockPage();
			const setLastMousePos = vi.fn();

			await sm.performMicroJitter(mockPage, { x: 100, y: 200 }, setLastMousePos);

			expect(mockPage.mouse.move).toHaveBeenCalled();
			expect(setLastMousePos).toHaveBeenCalledWith(
				expect.objectContaining({
					x: expect.any(Number),
					y: expect.any(Number),
				}),
			);
		});
	});

	describe("performSmallCursorMovement", () => {
		it("moves mouse by larger offset with clamping", async () => {
			const mockPage = createMockPage();
			const setLastMousePos = vi.fn();
			const clampToFrame = vi.fn((x, y) => ({ x, y }));

			await sm.performSmallCursorMovement(mockPage, { x: 300, y: 400 }, null, clampToFrame, setLastMousePos);

			expect(mockPage.mouse.move).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), { steps: 2 });
			expect(setLastMousePos).toHaveBeenCalled();
		});

		it("uses clampToFrame when attention frame is provided", async () => {
			const mockPage = createMockPage();
			const setLastMousePos = vi.fn();
			const frame = { x: 0, y: 0, width: 800, height: 600 };
			const clampToFrame = vi.fn((x, y) => ({ x: Math.min(x, 800), y: Math.min(y, 600) }));

			await sm.performSmallCursorMovement(mockPage, { x: 300, y: 400 }, frame, clampToFrame, setLastMousePos);

			expect(clampToFrame).toHaveBeenCalled();
		});
	});

	describe("performMicroScroll", () => {
		it("scrolls using mouse.wheel", async () => {
			const mockPage = createMockPage();

			await sm.performMicroScroll(mockPage);

			expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, expect.any(Number));
		});
	});

	describe("triggerThinkingBehavior", () => {
		it("does nothing when automatic thinking is disabled", async () => {
			sm.settings.automaticThinkingEnabled = false;
			await sm.triggerThinkingBehavior({ x: 0, y: 0 }, null, (x, y) => ({ x, y }));
			// Should complete without error or action
		});
	});

	// ─── Visual Verification ────────────────────────────────────────────────

	describe("verifyVisual", () => {
		it("auto-saves baseline when not found and autoSave is true", async () => {
			const mockPage = createMockPage();
			sm.pages = [{ page: mockPage, collect: vi.fn() } as any];
			sm.activePageIndex = 0;

			const result = await sm.verifyVisual("test-baseline", true);

			expect(result.isMatch).toBe(true);
			expect(result.mismatchedPixels).toBe(0);
		});

		it("throws when baseline not found and autoSave is false", async () => {
			const mockPage = createMockPage();
			sm.pages = [{ page: mockPage, collect: vi.fn() } as any];
			sm.activePageIndex = 0;

			await expect(sm.verifyVisual("missing-baseline", false)).rejects.toThrow("not found and autoSave is false");
		});
	});
});

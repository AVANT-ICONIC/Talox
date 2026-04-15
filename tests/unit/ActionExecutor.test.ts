/**
 * Unit tests for ActionExecutor — browser interaction execution logic.
 * All Playwright Page, Locator, Keyboard, Mouse objects are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../src/core/HumanMouse.js", () => ({
	HumanMouse: {
		click: vi.fn().mockResolvedValue({ x: 150, y: 250 }),
		move: vi.fn().mockResolvedValue(undefined),
		fidget: vi.fn().mockResolvedValue(undefined),
	},
}));

vi.mock("../../src/core/SemanticMapper.js", () => ({
	SemanticMapper: class {
		mapNodes = vi.fn().mockReturnValue([]);
		filterByType = vi.fn().mockReturnValue([]);
	},
}));

vi.mock("../../src/core/PolicyEngine.js", () => ({
	PolicyEngine: class {
		isAllowed = vi.fn().mockReturnValue(true);
		canPerform = vi.fn().mockReturnValue(true);
	},
}));

vi.mock("../../src/core/ArtifactBuilder.js", () => ({
	ArtifactBuilder: class {
		addAction = vi.fn();
	},
}));

vi.mock("../../src/core/PageStateCollector.js", () => ({
	PageStateCollector: class {
		collect = vi.fn();
	},
}));

vi.mock("../../src/core/InteractionReliability.js", () => ({
	InteractionReliability: class {
		resolveBeforeClick = vi.fn().mockResolvedValue({
			resolvedSelector: "",
			attempts: [],
			recoveryNotes: "",
		});
		recoverAfterFailure = vi.fn().mockResolvedValue({
			resolved: false,
			resolvedSelector: "",
			resolvedElement: null,
			mode: "",
			attempts: [],
			recoveryNotes: "",
		});
	},
}));

vi.mock("../../src/types/index.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../src/types/index.js")>();
	return {
		...actual,
		diffPageState: vi.fn().mockReturnValue({
			fromUrl: "",
			toUrl: "",
			urlChanged: false,
			fromTitle: "",
			toTitle: "",
			titleChanged: false,
			nodesAdded: [],
			nodesRemoved: [],
			nodesModified: [],
			bugsAdded: [],
			bugsRemoved: [],
			interactiveElementsAdded: [],
			interactiveElementsRemoved: [],
		}),
	};
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockPage() {
	return {
		url: vi.fn().mockReturnValue("https://example.com"),
		goto: vi.fn().mockResolvedValue(undefined),
		click: vi.fn().mockResolvedValue(undefined),
		type: vi.fn().mockResolvedValue(undefined),
		$: vi.fn().mockResolvedValue(null),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("")),
		evaluate: vi.fn().mockResolvedValue(undefined),
		waitForSelector: vi.fn().mockResolvedValue(undefined),
		waitForNavigation: vi.fn().mockResolvedValue(undefined),
		waitForLoadState: vi.fn().mockResolvedValue(undefined),
		viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
		mouse: {
			click: vi.fn().mockResolvedValue(undefined),
			move: vi.fn().mockResolvedValue(undefined),
			down: vi.fn().mockResolvedValue(undefined),
			up: vi.fn().mockResolvedValue(undefined),
			wheel: vi.fn().mockResolvedValue(undefined),
		},
		keyboard: {
			type: vi.fn().mockResolvedValue(undefined),
			press: vi.fn().mockResolvedValue(undefined),
		},
		context: vi.fn().mockReturnValue({}),
	};
}

function createMockElement(
	box: { x: number; y: number; width: number; height: number } | null = { x: 100, y: 200, width: 80, height: 40 },
) {
	return {
		boundingBox: vi.fn().mockResolvedValue(box),
		click: vi.fn().mockResolvedValue(undefined),
		screenshot: vi.fn().mockResolvedValue(Buffer.from("")),
		scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
		evaluate: vi.fn().mockResolvedValue(undefined),
	};
}

function makeFakeState(overrides: Record<string, any> = {}): any {
	return {
		url: "https://example.com",
		title: "Test Page",
		timestamp: new Date().toISOString(),
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
		...overrides,
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

function createTestExecutor(overrides: Record<string, any> = {}) {
	const settings = { ...defaultSettings, ...overrides.settings };
	const events = { emit: vi.fn() };
	const artifactBuilder = { addAction: vi.fn() };
	const policyEngine = { isAllowed: vi.fn().mockReturnValue(true), canPerform: vi.fn().mockReturnValue(true) };
	const semanticMapper = {
		mapNodes: vi.fn().mockReturnValue([]),
		filterByType: vi.fn().mockReturnValue([]),
	};

	const mockPage = createMockPage();
	const mockCollector = { collect: vi.fn().mockResolvedValue(makeFakeState()) };
	const profile = null;

	const deps = {
		getPage: () => mockPage,
		getActiveStateCollector: () => mockCollector,
		getProfile: () => profile,
		getCurrentLastMousePos: () => ({ x: 0, y: 0 }),
		setCurrentLastMousePos: vi.fn(),
		getAttentionFrame: () => null,
		clampToFrame: (x: number, y: number) => ({ x, y }),
		findElementInFrame: vi.fn().mockResolvedValue(null),
		riskyActionHook: undefined as (() => Promise<boolean>) | undefined,
		recordActivity: vi.fn(),
		getCursorStepCallback: undefined,
		...overrides,
	};

	const { ActionExecutor } = require("../../src/core/controller/ActionExecutor.js");
	// Construct via dynamic import approach — instead use a factory:
	// We need to import the class. Let's just instantiate with `new`.
	const executor = new ActionExecutor(
		settings,
		events,
		artifactBuilder,
		policyEngine,
		semanticMapper,
		deps.getPage,
		deps.getActiveStateCollector,
		deps.getProfile,
		deps.getCurrentLastMousePos,
		deps.setCurrentLastMousePos,
		deps.getAttentionFrame,
		deps.clampToFrame,
		deps.findElementInFrame,
		deps.riskyActionHook,
		deps.recordActivity,
		deps.getCursorStepCallback,
	);

	return { executor, mockPage, mockCollector, settings, events, artifactBuilder, policyEngine, semanticMapper, deps };
}

// Import module under test
import { ActionExecutor } from "../../src/core/controller/ActionExecutor.js";

describe("ActionExecutor", () => {
	// We'll construct directly since we have the import

	function makeExecutor(overrides: Record<string, any> = {}) {
		const settings = { ...defaultSettings, ...overrides.settings };
		const events = { emit: vi.fn() };
		const artifactBuilder = { addAction: vi.fn() };
		const policyEngine = {
			isAllowed: vi.fn().mockReturnValue(true),
			canPerform: vi.fn().mockReturnValue(true),
		};
		const semanticMapper = {
			mapNodes: vi.fn().mockReturnValue([]),
			filterByType: vi.fn().mockReturnValue([]),
		};
		const mockPage = createMockPage();
		const mockCollector = { collect: vi.fn().mockResolvedValue(makeFakeState()) };

		const pageRef = { current: mockPage as any };
		const deps = {
			getPage: () => pageRef.current,
			getActiveStateCollector: () => mockCollector,
			getProfile: () => null,
			getCurrentLastMousePos: () => ({ x: 0, y: 0 }),
			setCurrentLastMousePos: vi.fn(),
			getAttentionFrame: () => null,
			clampToFrame: (x: number, y: number) => ({ x, y }),
			findElementInFrame: vi.fn().mockResolvedValue(null),
			riskyActionHook: undefined as any,
			recordActivity: vi.fn(),
			getCursorStepCallback: undefined as any,
			...overrides,
		};

		const executor = new ActionExecutor(
			settings,
			events,
			artifactBuilder,
			policyEngine,
			semanticMapper,
			deps.getPage,
			deps.getActiveStateCollector,
			deps.getProfile,
			deps.getCurrentLastMousePos,
			deps.setCurrentLastMousePos,
			deps.getAttentionFrame,
			deps.clampToFrame,
			deps.findElementInFrame,
			deps.riskyActionHook,
			deps.recordActivity,
			deps.getCursorStepCallback,
		);

		return {
			executor,
			mockPage,
			mockCollector,
			settings,
			events,
			artifactBuilder,
			policyEngine,
			semanticMapper,
			deps,
			pageRef,
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
	});

	// ─── Navigation ──────────────────────────────────────────────────────────

	describe("navigate", () => {
		it("calls page.goto with the URL and networkidle wait", async () => {
			const { executor, mockPage, mockCollector } = makeExecutor();
			const rulesEngine = { diffStructural: vi.fn().mockReturnValue([]), analyze: vi.fn().mockReturnValue([]) };
			const setFirstNav = vi.fn();

			const state = await executor.navigate("https://example.com", false, setFirstNav, null, rulesEngine);

			expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", { waitUntil: "networkidle" });
			expect(state).toBeDefined();
			expect(state.url).toBe("https://example.com");
		});

		it("does warmup navigation for first navigation to non-google URLs", async () => {
			const { executor, mockPage } = makeExecutor();
			const rulesEngine = { diffStructural: vi.fn().mockReturnValue([]), analyze: vi.fn().mockReturnValue([]) };
			const setFirstNav = vi.fn();

			await executor.navigate("https://example.com", true, setFirstNav, null, rulesEngine);

			// First call is about:blank warmup, second is actual URL
			expect(mockPage.goto).toHaveBeenCalledWith("about:blank");
			expect(setFirstNav).toHaveBeenCalledWith(false);
		});

		it("skips warmup for google.com URLs", async () => {
			const { executor, mockPage } = makeExecutor();
			const rulesEngine = { diffStructural: vi.fn().mockReturnValue([]), analyze: vi.fn().mockReturnValue([]) };
			const setFirstNav = vi.fn();

			await executor.navigate("https://google.com/search", true, setFirstNav, null, rulesEngine);

			// Should NOT have about:blank call first
			const aboutBlankCalls = mockPage.goto.mock.calls.filter((c: any[]) => c[0] === "about:blank");
			expect(aboutBlankCalls.length).toBe(0);
		});

		it("skips warmup for about:blank", async () => {
			const { executor, mockPage } = makeExecutor();
			const rulesEngine = { diffStructural: vi.fn().mockReturnValue([]), analyze: vi.fn().mockReturnValue([]) };
			const setFirstNav = vi.fn();

			await executor.navigate("about:blank", true, setFirstNav, null, rulesEngine);

			const aboutBlankCalls = mockPage.goto.mock.calls.filter((c: any[]) => c[0] === "about:blank");
			// Warmup is skipped (url === 'about:blank'), but the actual navigation still calls goto('about:blank')
			expect(aboutBlankCalls.length).toBe(1);
		});

		it("throws policy violation when URL is not allowed", async () => {
			const { executor, policyEngine } = makeExecutor({
				getProfile: () => ({ class: "ops" }),
			});
			// Override policyEngine on the executor's instance is tricky since it's passed in constructor
			// We already pass it. Let's use the one from makeExecutor
			policyEngine.isAllowed.mockReturnValue(false);

			const rulesEngine = { diffStructural: vi.fn().mockReturnValue([]), analyze: vi.fn().mockReturnValue([]) };

			await expect(executor.navigate("https://blocked.com", false, vi.fn(), null, rulesEngine)).rejects.toThrow(
				"Policy Violation",
			);
		});

		it("emits navigation event with state url and title", async () => {
			const { executor, events } = makeExecutor();
			const rulesEngine = { diffStructural: vi.fn().mockReturnValue([]), analyze: vi.fn().mockReturnValue([]) };

			await executor.navigate("https://example.com", false, vi.fn(), null, rulesEngine);

			expect(events.emit).toHaveBeenCalledWith(
				"navigation",
				expect.objectContaining({
					url: "https://example.com",
					title: "Test Page",
				}),
			);
		});

		it("runs structural diff and bug analysis", async () => {
			const { executor, mockCollector } = makeExecutor();
			const lastState = makeFakeState({ url: "https://old.com" });
			const rulesEngine = {
				diffStructural: vi.fn().mockReturnValue([{ id: "bug1", type: "JS_ERROR" }]),
				analyze: vi.fn().mockReturnValue([{ id: "bug2", type: "NETWORK_FAILURE" }]),
			};

			const state = await executor.navigate("https://example.com", false, vi.fn(), lastState, rulesEngine);

			expect(rulesEngine.diffStructural).toHaveBeenCalledWith(lastState, expect.anything());
			expect(rulesEngine.analyze).toHaveBeenCalled();
			expect(state.bugs.length).toBeGreaterThanOrEqual(2);
		});
	});

	// ─── Click ──────────────────────────────────────────────────────────────

	describe("click", () => {
		it("calls page.click in safe mode (raw mode)", async () => {
			const { executor, mockPage, mockCollector } = makeExecutor({ settings: { safeMode: true } });

			await executor.click("#btn");

			// The reliability pre-flight resolves the selector (mock returns ''),
			// so _clickInternal receives '' as the effective selector.
			expect(mockPage.click).toHaveBeenCalledWith("", { timeout: 5000 });
		});

		it("uses HumanMouse.click in biomechanical mode (humanStealth > 0)", async () => {
			const { HumanMouse } = await import("../../src/core/HumanMouse.js");
			const { executor, events } = makeExecutor({ settings: { humanStealth: 0.5, safeMode: false } });

			await executor.click("#btn");

			expect(HumanMouse.click).toHaveBeenCalled();
			expect(events.emit).toHaveBeenCalledWith(
				"cursorClicked",
				expect.objectContaining({
					x: expect.any(Number),
					y: expect.any(Number),
				}),
			);
		});

		it("records an artifact for the click action", async () => {
			const { executor, artifactBuilder } = makeExecutor({ settings: { safeMode: true } });

			await executor.click("#submit");

			// The reliability pre-flight resolves the selector; mock returns '' so the
			// artifact records the resolved (effective) selector, not the original.
			expect(artifactBuilder.addAction).toHaveBeenCalledWith(
				"click",
				expect.objectContaining({
					selector: "",
				}),
			);
		});

		it("records activity after click", async () => {
			const { executor, deps } = makeExecutor({ settings: { safeMode: true } });

			await executor.click("#btn");

			expect(deps.recordActivity).toHaveBeenCalled();
		});

		it("attempts recovery when click fails", async () => {
			const { executor, mockPage, deps } = makeExecutor({ settings: { safeMode: true } });
			mockPage.click.mockRejectedValueOnce(new Error("Element not found"));

			// The reliability mock should handle recovery
			await expect(executor.click("#missing")).rejects.toThrow("Element not found");
		});

		it("throws policy violation when click is not allowed", async () => {
			const { executor, policyEngine } = makeExecutor({
				settings: { safeMode: true },
				getProfile: () => ({ class: "ops" }),
			});
			policyEngine.canPerform.mockReturnValue(false);

			await expect(executor.click("#dangerous")).rejects.toThrow("Policy Violation");
		});

		it("throws when element not found in attention frame", async () => {
			const { executor, deps } = makeExecutor({
				settings: { safeMode: true },
				getAttentionFrame: () => ({ x: 0, y: 0, width: 800, height: 600 }),
			});
			deps.findElementInFrame.mockResolvedValue(null);

			await expect(executor.click("#frame-btn")).rejects.toThrow("not found within attention frame");
		});

		it("clicks via mouse.click when attention frame has targetBox", async () => {
			const { executor, mockPage, deps } = makeExecutor({
				settings: { safeMode: true },
				getAttentionFrame: () => ({ x: 0, y: 0, width: 800, height: 600 }),
			});
			deps.findElementInFrame.mockResolvedValue({ box: { x: 100, y: 200, width: 80, height: 40 } });

			await executor.click("#frame-btn");

			expect(mockPage.mouse.click).toHaveBeenCalledWith(140, 220); // center of box
		});
	});

	// ─── Type ───────────────────────────────────────────────────────────────

	describe("type", () => {
		it("calls page.type in safe mode (raw mode)", async () => {
			const { executor, mockPage } = makeExecutor({ settings: { safeMode: true } });

			await executor.type("#input", "hello");

			// The reliability pre-flight resolves the selector; mock returns ''.
			expect(mockPage.type).toHaveBeenCalledWith("", "hello", { timeout: 5000 });
		});

		it("records an artifact for the type action", async () => {
			const { executor, artifactBuilder } = makeExecutor({ settings: { safeMode: true } });

			await executor.type("#input", "hello");

			// The reliability pre-flight resolves the selector; mock returns ''.
			expect(artifactBuilder.addAction).toHaveBeenCalledWith(
				"type",
				expect.objectContaining({
					selector: "",
					text: "hello",
				}),
			);
		});

		it("records activity after typing", async () => {
			const { executor, deps } = makeExecutor({ settings: { safeMode: true } });

			await executor.type("#input", "test");

			expect(deps.recordActivity).toHaveBeenCalled();
		});

		it("throws policy violation when type is not allowed", async () => {
			const { executor, policyEngine } = makeExecutor({
				settings: { safeMode: true },
				getProfile: () => ({ class: "ops" }),
			});
			policyEngine.canPerform.mockReturnValue(false);

			await expect(executor.type("#input", "secret")).rejects.toThrow("Policy Violation");
		});

		it("throws when element not found in attention frame during type", async () => {
			const { executor, deps } = makeExecutor({
				settings: { safeMode: true },
				getAttentionFrame: () => ({ x: 0, y: 0, width: 800, height: 600 }),
			});
			deps.findElementInFrame.mockResolvedValue(null);

			await expect(executor.type("#frame-input", "text")).rejects.toThrow("not found within attention frame");
		});

		it("uses mouse.click + keyboard.type when attention frame has targetBox", async () => {
			const { executor, mockPage, deps } = makeExecutor({
				settings: { safeMode: true },
				getAttentionFrame: () => ({ x: 0, y: 0, width: 800, height: 600 }),
			});
			deps.findElementInFrame.mockResolvedValue({ box: { x: 100, y: 200, width: 200, height: 30 } });

			await executor.type("#frame-input", "test");

			expect(mockPage.mouse.click).toHaveBeenCalled();
			expect(mockPage.keyboard.type).toHaveBeenCalledWith("test");
		});
	});

	// ─── Scroll ─────────────────────────────────────────────────────────────

	describe("scrollTo", () => {
		it("scrolls element into view and calls scrollIntoView with align", async () => {
			const { executor, mockPage } = makeExecutor();
			const mockEl = createMockElement();
			mockPage.$.mockResolvedValue(mockEl);

			await executor.scrollTo("#section", "center");

			expect(mockEl.scrollIntoViewIfNeeded).toHaveBeenCalled();
			expect(mockEl.evaluate).toHaveBeenCalled();
		});

		it("throws when no active page", async () => {
			const { executor, pageRef } = makeExecutor();
			pageRef.current = null;

			await expect(executor.scrollTo("#section")).rejects.toThrow("No active page");
		});

		it("throws when element is not found", async () => {
			const { executor, mockPage } = makeExecutor();
			mockPage.$.mockResolvedValue(null);

			await expect(executor.scrollTo("#missing")).rejects.toThrow("Element not found");
		});
	});

	// ─── Mouse Move ─────────────────────────────────────────────────────────

	describe("mouseMove", () => {
		it("calls page.mouse.move in raw mode", async () => {
			const { executor, mockPage, events } = makeExecutor({ settings: { humanStealth: 0 } });

			await executor.mouseMove(300, 400);

			expect(mockPage.mouse.move).toHaveBeenCalledWith(300, 400);
			expect(events.emit).toHaveBeenCalledWith("cursorMoved", { x: 300, y: 400 });
		});

		it("uses HumanMouse.move in biomechanical mode", async () => {
			const { HumanMouse } = await import("../../src/core/HumanMouse.js");
			const { executor, deps } = makeExecutor({ settings: { humanStealth: 0.5 } });

			await executor.mouseMove(300, 400);

			expect(HumanMouse.move).toHaveBeenCalled();
		});

		it("clamps to frame when attention frame is active", async () => {
			const clampSpy = vi.fn((x: number, y: number) => ({ x: Math.min(x, 800), y: Math.min(y, 600) }));
			const { executor } = makeExecutor({
				settings: { humanStealth: 0 },
				getAttentionFrame: () => ({ x: 0, y: 0, width: 800, height: 600 }),
				clampToFrame: clampSpy,
			});

			await executor.mouseMove(900, 700);

			expect(clampSpy).toHaveBeenCalledWith(900, 700);
		});

		it("records activity after mouse move", async () => {
			const { executor, deps } = makeExecutor({ settings: { humanStealth: 0 } });

			await executor.mouseMove(100, 200);

			expect(deps.recordActivity).toHaveBeenCalled();
		});
	});

	// ─── Screenshot ─────────────────────────────────────────────────────────

	describe("screenshot", () => {
		it("takes a full page screenshot", async () => {
			const { executor, mockPage } = makeExecutor();
			const buf = Buffer.from("png-data");
			mockPage.screenshot.mockResolvedValue(buf);

			const result = await executor.screenshot();

			expect(mockPage.screenshot).toHaveBeenCalledWith(expect.objectContaining({ fullPage: true, type: "png" }));
			expect(result).toBe(buf);
		});

		it("takes element screenshot when selector provided", async () => {
			const { executor, mockPage } = makeExecutor();
			const mockEl = createMockElement();
			mockPage.$.mockResolvedValue(mockEl);

			await executor.screenshot({ selector: "#target" });

			expect(mockEl.screenshot).toHaveBeenCalledWith(expect.objectContaining({ type: "png" }));
		});

		it("throws when no active page", async () => {
			const { executor, pageRef } = makeExecutor();
			pageRef.current = null;

			await expect(executor.screenshot()).rejects.toThrow("No active page");
		});

		it("throws when selector element not found", async () => {
			const { executor, mockPage } = makeExecutor();
			mockPage.$.mockResolvedValue(null);

			await expect(executor.screenshot({ selector: "#missing" })).rejects.toThrow("Element not found");
		});
	});

	// ─── Extract Table ──────────────────────────────────────────────────────

	describe("extractTable", () => {
		it("throws when no active page", async () => {
			const { executor, pageRef } = makeExecutor();
			pageRef.current = null;

			await expect(executor.extractTable("table")).rejects.toThrow("No active page");
		});

		it("throws when table not found", async () => {
			const { executor, mockPage } = makeExecutor();
			mockPage.$.mockResolvedValue(null);

			await expect(executor.extractTable("table")).rejects.toThrow("Table not found");
		});
	});

	// ─── Find Element ───────────────────────────────────────────────────────

	describe("findElement", () => {
		it("returns null when no lastState provided", async () => {
			const { executor } = makeExecutor();

			const result = await executor.findElement("Submit", "button", null);
			expect(result).toBeNull();
		});

		it("returns null when no matching elements found", async () => {
			const { executor, semanticMapper } = makeExecutor();
			semanticMapper.mapNodes.mockReturnValue([]);

			const result = await executor.findElement("Nonexistent", "button", makeFakeState());
			expect(result).toBeNull();
		});

		it("finds element by label match and returns selector + boundingBox", async () => {
			const { executor, semanticMapper } = makeExecutor();
			const elements = [
				{
					id: "#btn1",
					label: "Submit Form",
					name: "Submit",
					confidence: 0.9,
					boundingBox: { x: 10, y: 20, width: 80, height: 30 },
				},
				{
					id: "#btn2",
					label: "Cancel",
					name: "Cancel",
					confidence: 0.7,
					boundingBox: { x: 100, y: 20, width: 80, height: 30 },
				},
			];
			semanticMapper.mapNodes.mockReturnValue(elements);
			// filterByType must return matching elements (mock returns [] by default)
			semanticMapper.filterByType.mockReturnValue(elements);

			const result = await executor.findElement("Submit", "button", makeFakeState());

			expect(result).toBeDefined();
			expect(result!.selector).toBe("#btn1");
			expect(result!.boundingBox).toEqual({ x: 10, y: 20, width: 80, height: 30 });
		});
	});

	// ─── Evaluate ───────────────────────────────────────────────────────────

	describe("evaluate", () => {
		it("calls page.evaluate with the script", async () => {
			const { executor, mockPage } = makeExecutor();
			mockPage.evaluate.mockResolvedValue(42);

			const result = await executor.evaluate("return 42");
			expect(mockPage.evaluate).toHaveBeenCalledWith("return 42");
			expect(result).toBe(42);
		});

		it("throws when no active page", async () => {
			const { executor, pageRef } = makeExecutor();
			pageRef.current = null;

			await expect(executor.evaluate("1+1")).rejects.toThrow("No active page");
		});
	});

	// ─── Wait Helpers ───────────────────────────────────────────────────────

	describe("waitForSelector", () => {
		it("calls page.waitForSelector with timeout", async () => {
			const { executor, mockPage } = makeExecutor();

			await executor.waitForSelector("#element", 5000);

			expect(mockPage.waitForSelector).toHaveBeenCalledWith("#element", { timeout: 5000 });
		});
	});

	describe("waitForLoadState", () => {
		it("calls page.waitForLoadState", async () => {
			const { executor, mockPage } = makeExecutor();

			await executor.waitForLoadState("domcontentloaded", 10000);

			expect(mockPage.waitForLoadState).toHaveBeenCalledWith("domcontentloaded", { timeout: 10000 });
		});

		it("throws when no active page", async () => {
			const { executor, pageRef } = makeExecutor();
			pageRef.current = null;

			await expect(executor.waitForLoadState("load")).rejects.toThrow("No active page");
		});
	});

	// ─── Fidget / Think ─────────────────────────────────────────────────────

	describe("fidget", () => {
		it("skips fidget when fidgetEnabled is false", async () => {
			const { executor, events } = makeExecutor({ settings: { fidgetEnabled: false, humanStealth: 0.5 } });

			await executor.fidget(1000);

			expect(events.emit).not.toHaveBeenCalledWith("agentThinking");
		});

		it("skips fidget when humanStealth is very low (<=0.3)", async () => {
			const { executor, events } = makeExecutor({ settings: { fidgetEnabled: true, humanStealth: 0.2 } });

			await executor.fidget(1000);

			expect(events.emit).not.toHaveBeenCalledWith("agentThinking");
		});

		it("emits agentThinking and calls HumanMouse.fidget when enabled", async () => {
			const { HumanMouse } = await import("../../src/core/HumanMouse.js");
			const { executor, events } = makeExecutor({ settings: { fidgetEnabled: true, humanStealth: 0.5 } });

			await executor.fidget(500);

			expect(events.emit).toHaveBeenCalledWith("agentThinking");
			expect(HumanMouse.fidget).toHaveBeenCalled();
		});
	});

	describe("think", () => {
		it("emits agentThinking and combines fidget with wait", async () => {
			const { executor, events } = makeExecutor({ settings: { fidgetEnabled: true, humanStealth: 0.5 } });

			await executor.think(1000);

			expect(events.emit).toHaveBeenCalledWith("agentThinking");
		});
	});

	// ─── Behavioral DNA Helpers ─────────────────────────────────────────────

	describe("getDNAMouseSpeed", () => {
		it("returns 1.0 when no behavioral DNA", () => {
			const { executor } = makeExecutor();
			expect(executor.getDNAMouseSpeed(null)).toBe(1.0);
		});

		it("applies precise style factor (0.8)", () => {
			const { executor, settings } = makeExecutor({ settings: { mouseSpeed: 1.0 } });
			const dna = { movementStyle: "precise" };
			const speed = executor.getDNAMouseSpeed(dna);
			expect(speed).toBeCloseTo(0.8, 5);
		});

		it("applies relaxed style factor (1.2)", () => {
			const { executor } = makeExecutor({ settings: { mouseSpeed: 1.0 } });
			const dna = { movementStyle: "relaxed" };
			const speed = executor.getDNAMouseSpeed(dna);
			expect(speed).toBeCloseTo(1.2, 5);
		});
	});

	describe("getDNATypingDelay", () => {
		it("returns settings defaults when no DNA", () => {
			const { executor } = makeExecutor();
			const delay = executor.getDNATypingDelay(null);
			expect(delay).toEqual({ min: 50, max: 150 });
		});

		it("returns fast typing delay for fast rhythm", () => {
			const { executor } = makeExecutor();
			const delay = executor.getDNATypingDelay({ typingRhythm: "fast" });
			expect(delay.min).toBe(25);
			expect(delay.max).toBe(75);
		});

		it("returns slow typing delay for slow rhythm", () => {
			const { executor } = makeExecutor();
			const delay = executor.getDNATypingDelay({ typingRhythm: "slow" });
			expect(delay.min).toBe(75);
			expect(delay.max).toBe(225);
		});

		it("returns variable typing delay for variable rhythm", () => {
			const { executor } = makeExecutor();
			const delay = executor.getDNATypingDelay({ typingRhythm: "variable" });
			expect(delay.min).toBe(15);
			expect(delay.max).toBe(300);
		});
	});

	// ─── Precision Offset ───────────────────────────────────────────────────

	describe("getPrecisionOffset", () => {
		it("returns zero offset when decay is zero", () => {
			const { executor } = makeExecutor({ settings: { precisionDecay: 0 } });
			const offset = executor.getPrecisionOffset();
			expect(offset).toEqual({ x: 0, y: 0 });
		});

		it("returns non-zero offset when decay > 0", () => {
			const { executor } = makeExecutor({ settings: { precisionDecay: 0.5 } });
			const offset = executor.getPrecisionOffset();
			// Offset should be within expected range: 0.5 to 2.5 from origin
			const distance = Math.sqrt(offset.x ** 2 + offset.y ** 2);
			expect(distance).toBeLessThanOrEqual(3);
		});
	});

	describe("setPrecisionDecay", () => {
		it("clamps decay value between 0 and 1", () => {
			const { executor } = makeExecutor();
			executor.setPrecisionDecay(5);
			expect(executor.getPrecisionDecay()).toBe(1);

			executor.setPrecisionDecay(-1);
			expect(executor.getPrecisionDecay()).toBe(0);
		});

		it("records artifact", () => {
			const { executor, artifactBuilder } = makeExecutor();
			executor.setPrecisionDecay(0.5);
			expect(artifactBuilder.addAction).toHaveBeenCalledWith("setPrecisionDecay", { precisionDecay: 0.5 });
		});
	});

	// ─── Adaptive Stealth Controls ──────────────────────────────────────────

	describe("setAdaptiveStealthEnabled", () => {
		it("sets the setting and records artifact", () => {
			const { executor, artifactBuilder } = makeExecutor();
			executor.setAdaptiveStealthEnabled(false);
			expect(artifactBuilder.addAction).toHaveBeenCalledWith("setAdaptiveStealthEnabled", { enabled: false });
		});
	});

	describe("setAdaptiveStealthSensitivity", () => {
		it("clamps sensitivity between 0.1 and 2.0", () => {
			const { executor, settings } = makeExecutor();
			executor.setAdaptiveStealthSensitivity(5.0);
			expect(settings.adaptiveStealthSensitivity).toBe(2.0);

			executor.setAdaptiveStealthSensitivity(-1);
			expect(settings.adaptiveStealthSensitivity).toBe(0.1);
		});
	});

	describe("setAdaptiveStealthRadius", () => {
		it("clamps radius between 50 and 500", () => {
			const { executor, settings } = makeExecutor();
			executor.setAdaptiveStealthRadius(1000);
			expect(settings.adaptiveStealthRadius).toBe(500);

			executor.setAdaptiveStealthRadius(10);
			expect(settings.adaptiveStealthRadius).toBe(50);
		});
	});

	// ─── Adaptive Stealth Calculations ──────────────────────────────────────

	describe("getAdaptiveMouseSpeed", () => {
		it("returns base mouseSpeed when adaptive stealth is disabled", () => {
			const { executor, settings } = makeExecutor({ settings: { adaptiveStealthEnabled: false, mouseSpeed: 2.0 } });
			expect(executor.getAdaptiveMouseSpeed(0.8)).toBe(2.0);
		});

		it("reduces speed in high-density areas", () => {
			const { executor } = makeExecutor({ settings: { adaptiveStealthEnabled: true, mouseSpeed: 1.0 } });
			const speed = executor.getAdaptiveMouseSpeed(1.0);
			expect(speed).toBeLessThan(1.0);
			expect(speed).toBeGreaterThanOrEqual(0.1);
		});
	});

	describe("getAdaptiveJitter", () => {
		it("returns 0 when adaptive stealth is disabled", () => {
			const { executor } = makeExecutor({ settings: { adaptiveStealthEnabled: false } });
			expect(executor.getAdaptiveJitter(0.5)).toBe(0);
		});

		it("increases jitter with density", () => {
			const { executor } = makeExecutor({ settings: { adaptiveStealthEnabled: true } });
			const lowJitter = executor.getAdaptiveJitter(0.1);
			const highJitter = executor.getAdaptiveJitter(0.9);
			expect(highJitter).toBeGreaterThan(lowJitter);
		});
	});

	describe("calculateElementDensity", () => {
		it("returns 0.5 when adaptive stealth is disabled", async () => {
			const { executor } = makeExecutor({ settings: { adaptiveStealthEnabled: false } });
			const density = await executor.calculateElementDensity(100, 100);
			expect(density).toBe(0.5);
		});

		it("caches density results", async () => {
			const { executor, mockPage } = makeExecutor({ settings: { adaptiveStealthEnabled: true } });
			mockPage.evaluate.mockResolvedValue(0.3);

			await executor.calculateElementDensity(100, 100);
			await executor.calculateElementDensity(100, 100);

			// evaluate should only be called once due to cache (key: 100,100)
			expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
		});
	});

	// ─── Density Cache ──────────────────────────────────────────────────────

	describe("clearDensityCache", () => {
		it("clears the density cache", async () => {
			const { executor, mockPage } = makeExecutor({ settings: { adaptiveStealthEnabled: true } });
			mockPage.evaluate.mockResolvedValue(0.3);

			await executor.calculateElementDensity(100, 100);
			executor.clearDensityCache();
			await executor.calculateElementDensity(100, 100);

			expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
		});
	});

	// ─── Diff Attachment ────────────────────────────────────────────────────

	describe("attachDiff", () => {
		it("returns curr unchanged when prev is null", () => {
			const { executor } = makeExecutor();
			const curr = makeFakeState();
			const result = executor.attachDiff(null, curr);
			expect(result).toBe(curr);
			expect(result.diff).toBeUndefined();
		});

		it("attaches diff when prev is provided", () => {
			const { executor } = makeExecutor();
			const prev = makeFakeState({ url: "https://old.com" });
			const curr = makeFakeState({ url: "https://new.com" });

			const result = executor.attachDiff(prev, curr);
			expect(result.diff).toBeDefined();
		});
	});

	// ─── Risky Action Check ─────────────────────────────────────────────────

	describe("risky action check", () => {
		it("blocks action when riskyActionHook returns false for ops profile", async () => {
			const hook = vi.fn().mockResolvedValue(false);
			const { executor } = makeExecutor({
				settings: { safeMode: true },
				getProfile: () => ({ class: "ops" }),
				riskyActionHook: hook,
			});

			await expect(executor.click("#danger")).rejects.toThrow("Human-in-the-Loop blocked risky action");
		});

		it("allows action when riskyActionHook returns true", async () => {
			const hook = vi.fn().mockResolvedValue(true);
			const { executor } = makeExecutor({
				settings: { safeMode: true },
				getProfile: () => ({ class: "ops" }),
				riskyActionHook: hook,
			});

			await executor.click("#btn");
			// Should not throw
		});
	});
});

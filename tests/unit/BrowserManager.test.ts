/**
 * Unit tests for BrowserManager — browser lifecycle, detection, context creation.
 * All Playwright/patchright dependencies are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock all Playwright/patchright modules ──────────────────────────────────
// vi.mock factories are hoisted — must use vi.fn() inline

vi.mock("patchright", () => ({
	chromium: {
		launchPersistentContext: vi.fn().mockResolvedValue({
			close: vi.fn().mockResolvedValue(undefined),
			newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
			on: vi.fn(),
		}),
	},
}));

vi.mock("playwright-core", () => ({
	chromium: {
		launchPersistentContext: vi.fn().mockResolvedValue({
			close: vi.fn().mockResolvedValue(undefined),
			newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
			on: vi.fn(),
		}),
	},
	firefox: {
		launchPersistentContext: vi.fn().mockResolvedValue({
			close: vi.fn().mockResolvedValue(undefined),
			newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
			on: vi.fn(),
		}),
	},
	webkit: {
		launchPersistentContext: vi.fn().mockResolvedValue({
			close: vi.fn().mockResolvedValue(undefined),
			newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
			on: vi.fn(),
		}),
	},
}));

vi.mock("node:fs", () => ({
	default: {
		existsSync: vi.fn().mockReturnValue(false),
		readdirSync: vi.fn().mockReturnValue([]),
		statSync: vi.fn(),
	},
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockContext() {
	return {
		close: vi.fn().mockResolvedValue(undefined),
		newPage: vi.fn().mockResolvedValue({ close: vi.fn() }),
		on: vi.fn(),
		pages: vi.fn().mockReturnValue([]),
		_browser: { close: vi.fn().mockResolvedValue(undefined) },
	};
}

let profileCounter = 0;
function createTestProfile(name = `test-profile-${++profileCounter}`) {
	return {
		id: name,
		class: "sandbox" as const,
		purpose: "testing",
		userDataDir: `/tmp/talox-${name}`,
		metadata: { createdAt: new Date().toISOString(), lastUsed: new Date().toISOString() },
	};
}

// Import after mocks are set up
import { chromium, firefox, webkit } from "playwright-core";
import { BrowserManager, DEFAULT_CONFIG, getDefaultConfig, resolveConfigDir } from "../../src/core/BrowserManager.js";

describe("BrowserManager", () => {
	let manager: BrowserManager;

	beforeEach(() => {
		vi.clearAllMocks();
		// autoDetect: false to prevent autoDetectBrowser() on CI (Linux) where no browsers are installed
		// adaptiveStealthEnabled: false so launch() uses standard playwright-core chromium mock
		manager = new BrowserManager({
			browser: { preferred: "chromium", headless: true, autoDetect: false } as any,
			settings: { adaptiveStealthEnabled: false } as any,
		});
	});

	// ─── Constructor & Config ────────────────────────────────────────────────

	describe("constructor", () => {
		it("initializes with default config when no config provided", () => {
			const mgr = new BrowserManager();
			const config = mgr.getConfig();
			expect(config.browser.preferred).toBe("chromium");
			expect(config.browser.headless).toBe(true);
			expect(config.browser.autoDetect).toBe(true);
		});

		it("merges partial config overrides with defaults", () => {
			const mgr = new BrowserManager({
				browser: { headless: false, preferred: "firefox" } as any,
			});
			const config = mgr.getConfig();
			expect(config.browser.headless).toBe(false);
			expect(config.browser.preferred).toBe("firefox");
			// Shallow merge: nested objects are replaced wholesale, so autoDetect is lost
			expect(config.browser.autoDetect).toBeUndefined();
		});

		it("does not register process handlers before owning cleanup resources", () => {
			const spy = vi.spyOn(process, "once").mockImplementation(() => process);
			new BrowserManager();
			expect(spy).not.toHaveBeenCalledWith("exit", expect.any(Function));
			expect(spy).not.toHaveBeenCalledWith("SIGINT", expect.any(Function));
			spy.mockRestore();
		});
	});

	describe("getConfig", () => {
		it("returns the current config", () => {
			const config = manager.getConfig();
			expect(config).toBeDefined();
			expect(config.browser).toBeDefined();
			expect(config.profile).toBeDefined();
			expect(config.settings).toBeDefined();
		});
	});

	describe("updateConfig", () => {
		it("merges new config into existing config", () => {
			manager.updateConfig({ browser: { headless: false } as any });
			expect(manager.getConfig().browser.headless).toBe(false);
		});
	});

	// ─── Default Config ──────────────────────────────────────────────────────

	describe("getDefaultConfig", () => {
		it("returns a deep copy of DEFAULT_CONFIG", () => {
			const cfg1 = getDefaultConfig();
			const cfg2 = getDefaultConfig();
			cfg1.browser.headless = false;
			expect(cfg2.browser.headless).toBe(true);
		});

		it("sets headless to false when TALOX_HEADLESS=false env var is set", () => {
			const original = process.env.TALOX_HEADLESS;
			process.env.TALOX_HEADLESS = "false";
			const cfg = getDefaultConfig();
			expect(cfg.browser.headless).toBe(false);
			process.env.TALOX_HEADLESS = original;
		});

		it("enables Chromium sandbox from TALOX_CHROMIUM_SANDBOX=true", () => {
			const original = process.env.TALOX_CHROMIUM_SANDBOX;
			process.env.TALOX_CHROMIUM_SANDBOX = "true";
			const cfg = getDefaultConfig();
			expect(cfg.browser.chromiumSandbox).toBe(true);
			if (original === undefined) delete process.env.TALOX_CHROMIUM_SANDBOX;
			else process.env.TALOX_CHROMIUM_SANDBOX = original;
		});
	});

	// ─── resolveConfigDir ────────────────────────────────────────────────────

	describe("resolveConfigDir", () => {
		it("returns process.cwd()", () => {
			expect(resolveConfigDir()).toBe(process.cwd());
		});
	});

	// ─── DEFAULT_CONFIG values ───────────────────────────────────────────────

	describe("DEFAULT_CONFIG", () => {
		it("has correct default settings", () => {
			expect(DEFAULT_CONFIG.browser.autoDetect).toBe(true);
			expect(DEFAULT_CONFIG.browser.preferred).toBe("chromium");
			expect(DEFAULT_CONFIG.browser.headless).toBe(true);
			expect(DEFAULT_CONFIG.browser.chromiumSandbox).toBe(false);
			expect(DEFAULT_CONFIG.profile.defaultClass).toBe("qa");
			expect(DEFAULT_CONFIG.settings.mouseSpeed).toBe(1);
			expect(DEFAULT_CONFIG.settings.safeMode).toBe(false);
		});
	});

	// ─── Launch ─────────────────────────────────────────────────────────────

	describe("launch", () => {
		it("shares one process cleanup listener pair across many active managers", async () => {
			const onceSpy = vi.spyOn(process, "once").mockImplementation(() => process);
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockImplementation(async () => createMockContext());
			const managers = Array.from(
				{ length: 12 },
				() =>
					new BrowserManager({
						browser: { preferred: "chromium", headless: true, autoDetect: false } as any,
						settings: { adaptiveStealthEnabled: false } as any,
					}),
			);

			for (const [index, mgr] of managers.entries()) {
				await mgr.launch({
					...createTestProfile(),
					id: `listener-test-${index}`,
					userDataDir: `/tmp/talox-listener-test-${index}`,
				});
			}

			expect(onceSpy.mock.calls.filter(([event]) => event === "exit")).toHaveLength(1);
			expect(onceSpy.mock.calls.filter(([event]) => event === "SIGINT")).toHaveLength(1);
			await Promise.all(managers.map((mgr) => mgr.closeAll()));
			onceSpy.mockRestore();
		});

		it("launches chromium by default and returns a context", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			const result = await manager.launch(createTestProfile());

			expect(result).toBe(mockCtx);
			expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);
		});

		it("passes headless: false when headed is true", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			// The `headed` param is unused by BrowserManager.launch(); headless is
			// controlled via extraOptions.headless or config.browser.headless.
			// Use extraOptions to set headless: false.
			await manager.launch(createTestProfile(), true, "chromium", { headless: false });

			expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ headless: false }),
			);
		});

		it("passes headless: true when headed is false", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			await manager.launch(createTestProfile(), false);

			expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ headless: true }),
			);
		});

		it("launches firefox when browserType is firefox", async () => {
			const mockCtx = createMockContext();
			(firefox.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			const result = await manager.launch(createTestProfile(), false, "firefox");

			expect(result).toBe(mockCtx);
			expect(firefox.launchPersistentContext).toHaveBeenCalledTimes(1);
		});

		it("launches webkit when browserType is webkit", async () => {
			const mockCtx = createMockContext();
			(webkit.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			const result = await manager.launch(createTestProfile(), false, "webkit");

			expect(result).toBe(mockCtx);
			expect(webkit.launchPersistentContext).toHaveBeenCalledTimes(1);
		});

		it("passes extraOptions to launch call", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			await manager.launch(createTestProfile(), false, "chromium", {
				userAgent: "TestAgent/1",
				viewport: { width: 1920, height: 1080 },
			});

			expect(chromium.launchPersistentContext).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					userAgent: "TestAgent/1",
					viewport: { width: 1920, height: 1080 },
				}),
			);
		});

		it("keeps owned Xvfb alive when launch options require a browser relaunch", async () => {
			manager.updateConfig({
				settings: { ...manager.getConfig().settings, virtualDisplay: true } as any,
			});
			const firstContext = createMockContext();
			const secondContext = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>)
				.mockResolvedValueOnce(firstContext)
				.mockResolvedValueOnce(secondContext);
			const xvfb = { kill: vi.fn() };
			(manager as any).xvfbProcess = xvfb;
			(manager as any).xvfbDisplay = ":123";

			const profile = createTestProfile();
			await manager.launch(profile, false, "chromium", { args: ["--first-launch"] });
			await manager.launch(profile, false, "chromium", { args: ["--replacement-launch"] });

			expect(firstContext.close).toHaveBeenCalledTimes(1);
			expect(xvfb.kill).not.toHaveBeenCalled();
			expect((manager as any).xvfbDisplay).toBe(":123");
			const secondLaunch = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[1][1];
			expect(secondLaunch.env).toEqual(expect.objectContaining({ DISPLAY: ":123" }));

			await manager.close();
		});

		it("stops owned Xvfb when virtualDisplay is disabled before a relaunch", async () => {
			manager.updateConfig({
				settings: { ...manager.getConfig().settings, virtualDisplay: true } as any,
			});
			const firstContext = createMockContext();
			const secondContext = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>)
				.mockResolvedValueOnce(firstContext)
				.mockResolvedValueOnce(secondContext);
			const xvfb = { kill: vi.fn() };
			(manager as any).xvfbProcess = xvfb;
			(manager as any).xvfbDisplay = ":125";

			const profile = createTestProfile();
			await manager.launch(profile, false, "chromium", { args: ["--virtual-display"] });
			manager.updateConfig({
				settings: { ...manager.getConfig().settings, virtualDisplay: false } as any,
			});
			await manager.launch(profile, false, "chromium", { args: ["--no-virtual-display"] });

			expect(firstContext.close).toHaveBeenCalledTimes(1);
			expect(xvfb.kill).toHaveBeenCalledWith("SIGTERM");
			expect((manager as any).xvfbProcess).toBeNull();
			expect((manager as any).xvfbDisplay).toBeNull();
			const secondLaunch = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[1][1];
			expect(secondLaunch.headless).toBe(true);
			expect(secondLaunch.env?.DISPLAY).not.toBe(":125");

			await manager.close();
		});

		it("relaunches when only virtualDisplay changes", async () => {
			manager.updateConfig({
				settings: { ...manager.getConfig().settings, virtualDisplay: true } as any,
			});
			const firstContext = createMockContext();
			const secondContext = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>)
				.mockResolvedValueOnce(firstContext)
				.mockResolvedValueOnce(secondContext);
			const xvfb = { kill: vi.fn() };
			(manager as any).xvfbProcess = xvfb;
			(manager as any).xvfbDisplay = ":126";

			const profile = createTestProfile();
			const launchOptions = { headless: false };
			await manager.launch(profile, false, "chromium", launchOptions);
			manager.updateConfig({
				settings: { ...manager.getConfig().settings, virtualDisplay: false } as any,
			});
			await manager.launch(profile, false, "chromium", launchOptions);

			expect(firstContext.close).toHaveBeenCalledTimes(1);
			expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2);
			expect(xvfb.kill).toHaveBeenCalledWith("SIGTERM");
			expect(manager.getContext()).toBe(secondContext);

			await manager.close();
		});

		it("pins browser launch env to the Xvfb display owned by this manager", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);
			(manager as any).xvfbDisplay = ":123";

			await manager.launch(createTestProfile(), false, "chromium");

			const callArgs = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[0][1];
			expect(callArgs.env).toEqual(expect.objectContaining({ DISPLAY: ":123" }));
		});

		it("preserves caller-provided browser env while pinning Xvfb DISPLAY", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);
			(manager as any).xvfbDisplay = ":124";

			await manager.launch(createTestProfile(), false, "chromium", {
				env: { TALOX_TEST_ONLY: "kept", PATH: "/restricted" },
			});

			const callArgs = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[0][1];
			expect(callArgs.env).toEqual({
				TALOX_TEST_ONLY: "kept",
				PATH: "/restricted",
				DISPLAY: ":124",
			});
		});

		it("includes expected chromium args", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			await manager.launch(createTestProfile(), false, "chromium");

			const callArgs = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[0][1];
			expect(callArgs.args).toContain("--no-sandbox");
			expect(callArgs.args).toContain("--disable-setuid-sandbox");
			expect(callArgs.args).toContain("--disable-dev-shm-usage");
		});

		it("enables Chromium sandbox without unsandboxed launch flags", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);
			const secureManager = new BrowserManager({
				browser: { preferred: "chromium", headless: true, autoDetect: false, chromiumSandbox: true } as any,
				settings: { adaptiveStealthEnabled: false } as any,
			});

			await secureManager.launch(createTestProfile(), false, "chromium");

			const callArgs = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[0][1];
			expect(callArgs.chromiumSandbox).toBe(true);
			expect(callArgs.args).not.toContain("--no-sandbox");
			expect(callArgs.args).not.toContain("--disable-setuid-sandbox");
			expect(callArgs.args).toContain("--disable-dev-shm-usage");
		});

		it("registers context close handler", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			await manager.launch(createTestProfile());

			expect(mockCtx.on).toHaveBeenCalledWith("close", expect.any(Function));
		});

		it("throws error when browser launch fails", async () => {
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("browser not found"));

			await expect(manager.launch(createTestProfile())).rejects.toThrow();
		});

		it("stores the context for later retrieval", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			await manager.launch(createTestProfile());
			expect(manager.getContext()).toBe(mockCtx);
		});

		it("rejects a second owner of the same persistent profile before browser launch", async () => {
			const firstContext = createMockContext();
			const secondContext = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>)
				.mockResolvedValueOnce(firstContext)
				.mockResolvedValueOnce(secondContext);
			const secondManager = new BrowserManager({
				browser: { preferred: "chromium", headless: true, autoDetect: false } as any,
				settings: { adaptiveStealthEnabled: false } as any,
			});
			const profile = createTestProfile("shared-profile");

			await manager.launch(profile);
			await expect(secondManager.launch(profile)).rejects.toThrow("PROFILE_IN_USE");
			expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);

			await manager.close();
			await expect(secondManager.launch(profile)).resolves.toBe(secondContext);
			expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2);
			await secondManager.close();
		});

		it("releases profile ownership when browser launch fails", async () => {
			const profile = createTestProfile("failed-profile");
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("browser not found"));
			await expect(manager.launch(profile)).rejects.toThrow();

			const retryContext = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(retryContext);
			const retryManager = new BrowserManager({
				browser: { preferred: "chromium", headless: true, autoDetect: false } as any,
				settings: { adaptiveStealthEnabled: false } as any,
			});
			await expect(retryManager.launch(profile)).resolves.toBe(retryContext);
			await retryManager.close();
		});

		it("keeps same-profile ownership reserved while replacing a browser context", async () => {
			const firstContext = createMockContext();
			const replacementContext = createMockContext();
			let resolveReplacement!: (ctx: ReturnType<typeof createMockContext>) => void;
			const replacementLaunch = new Promise<ReturnType<typeof createMockContext>>((resolve) => {
				resolveReplacement = resolve;
			});
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>)
				.mockResolvedValueOnce(firstContext)
				.mockImplementationOnce(() => replacementLaunch);
			const competingManager = new BrowserManager({
				browser: { preferred: "chromium", headless: true, autoDetect: false } as any,
				settings: { adaptiveStealthEnabled: false } as any,
			});
			const profile = createTestProfile("relaunch-profile");
			let relaunch: Promise<ReturnType<typeof createMockContext>> | null = null;

			try {
				await manager.launch(profile, false, "chromium", { args: ["--first-profile-launch"] });
				relaunch = manager.launch(profile, false, "chromium", { args: ["--replacement-profile-launch"] }) as Promise<ReturnType<typeof createMockContext>>;
				await vi.waitFor(() => expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2));

				await expect(competingManager.launch(profile)).rejects.toThrow("PROFILE_IN_USE");
				expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(2);

				resolveReplacement(replacementContext);
				await expect(relaunch).resolves.toBe(replacementContext);
			} finally {
				resolveReplacement(replacementContext);
				if (relaunch) await relaunch.catch(() => undefined);
				await manager.close().catch(() => undefined);
				await competingManager.close().catch(() => undefined);
			}
		});

		it("rejects concurrent launch calls on the same manager", async () => {
			const context = createMockContext();
			let resolveLaunch!: (ctx: ReturnType<typeof createMockContext>) => void;
			const pendingLaunch = new Promise<ReturnType<typeof createMockContext>>((resolve) => {
				resolveLaunch = resolve;
			});
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockImplementationOnce(() => pendingLaunch);
			const profile = createTestProfile("same-manager-concurrent");

			const firstLaunch = manager.launch(profile);
			await vi.waitFor(() => expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1));
			await expect(manager.launch(profile)).rejects.toThrow("LAUNCH_IN_PROGRESS");
			expect(chromium.launchPersistentContext).toHaveBeenCalledTimes(1);

			resolveLaunch(context);
			await expect(firstLaunch).resolves.toBe(context);
			await manager.close();
		});

	});

	// ─── Context Management ─────────────────────────────────────────────────

	describe("getContext", () => {
		it("returns null before launch", () => {
			expect(manager.getContext()).toBeNull();
		});

		it("returns the context after launch", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			await manager.launch(createTestProfile());
			expect(manager.getContext()).toBe(mockCtx);
		});
	});

	// ─── Close ──────────────────────────────────────────────────────────────

	describe("close", () => {
		it("closes the context and clears reference", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			await manager.launch(createTestProfile());
			expect(manager.getContext()).toBe(mockCtx);

			await manager.close();
			expect(mockCtx.close).toHaveBeenCalled();
			expect(manager.getContext()).toBeNull();
		});

		it("is a no-op when no context exists", async () => {
			await expect(manager.close()).resolves.toBeUndefined();
		});
	});

	// ─── closeAll ────────────────────────────────────────────────────────────

	describe("closeAll", () => {
		it("closes all tracked contexts and clears registry", async () => {
			const mockCtx1 = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx1);

			await manager.launch(createTestProfile());
			await manager.closeAll();

			expect(manager.getContext()).toBeNull();
		});
	});

	// ─── newPage ────────────────────────────────────────────────────────────

	describe("newPage", () => {
		it("throws if browser not launched", async () => {
			await expect(manager.newPage()).rejects.toThrow("Browser not launched");
		});

		it("delegates to context.newPage when launched", async () => {
			const mockCtx = createMockContext();
			const mockPage = { close: vi.fn() };
			mockCtx.newPage.mockResolvedValue(mockPage);
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			await manager.launch(createTestProfile());
			const page = await manager.newPage();
			expect(page).toBe(mockPage);
		});
	});

	// ─── Proxy Configuration ────────────────────────────────────────────────

	describe("proxy configuration", () => {
		it("passes proxy config from config to launch options", async () => {
			const proxyMgr = new BrowserManager({
				browser: {
					preferred: "chromium",
					autoDetect: false,
					headless: true,
					proxy: { server: "http://proxy:8080", username: "user", password: "pass" },
				} as any,
				settings: { adaptiveStealthEnabled: false } as any,
			});
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			await proxyMgr.launch(createTestProfile());

			const callArgs = (chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mock.calls[0][1];
			expect(callArgs.proxy).toEqual({
				server: "http://proxy:8080",
				username: "user",
				password: "pass",
			});
		});
	});

	// ─── Detected Browsers ──────────────────────────────────────────────────

	describe("getDetectedBrowsers", () => {
		it("returns empty array before detection", () => {
			expect(manager.getDetectedBrowsers()).toEqual([]);
		});
	});

	// ─── autoDetectBrowser ──────────────────────────────────────────────────

	describe("autoDetectBrowser", () => {
		it("throws NO_BROWSERS_FOUND when none detected", async () => {
			await expect(manager.autoDetectBrowser()).rejects.toThrow("NO_BROWSERS_FOUND");
		});
	});

	// ─── Context cleanup on close event ─────────────────────────────────────

	describe("context close event", () => {
		it("removes context from registry when close event fires", async () => {
			const mockCtx = createMockContext();
			(chromium.launchPersistentContext as ReturnType<typeof vi.fn>).mockResolvedValue(mockCtx);

			await manager.launch(createTestProfile());

			const closeHandler = mockCtx.on.mock.calls.find((call: any[]) => call[0] === "close")?.[1];
			expect(closeHandler).toBeDefined();
			closeHandler!();

			expect(manager.getContext()).toBeNull();
		});
	});
});

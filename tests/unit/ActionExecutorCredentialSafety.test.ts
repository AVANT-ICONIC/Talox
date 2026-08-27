import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionExecutor } from "../../src/core/controller/ActionExecutor.js";
import { setLogLevel } from "../../src/core/Logger.js";

function makeState() {
	return {
		url: "https://example.com",
		title: "Test",
		timestamp: new Date().toISOString(),
		console: { errors: [] },
		network: { failedRequests: [] },
		nodes: [],
		interactiveElements: [],
		bugs: [],
	};
}

function makeExecutor(options: {
	url?: string;
	collector?: { collect: ReturnType<typeof vi.fn> };
	profile?: any;
	policyAllowed?: boolean;
	riskyActionHook?: (action: string, target: string) => Promise<boolean>;
	verbosity?: number;
} = {}) {
	const page = {
		url: vi.fn(() => options.url ?? "https://example.com"),
		goto: vi.fn().mockResolvedValue(undefined),
		waitForLoadState: vi.fn().mockResolvedValue(undefined),
		type: vi.fn().mockResolvedValue(undefined),
		keyboard: { type: vi.fn().mockResolvedValue(undefined) },
		mouse: { click: vi.fn().mockResolvedValue(undefined) },
	};
	const collector = options.collector ?? { collect: vi.fn().mockResolvedValue(makeState()) };
	const policyEngine = {
		isAllowed: vi.fn().mockReturnValue(options.policyAllowed ?? true),
		canPerform: vi.fn().mockReturnValue(true),
	};
	const artifactBuilder = { addAction: vi.fn() };
	const executor = new ActionExecutor(
		{
			humanStealth: 0,
			safeMode: true,
			actionTimeoutMs: 5000,
			navigationWaitUntil: "networkidle",
			verbosity: options.verbosity ?? 0,
			mouseSpeed: 1,
			typingDelayMin: 10,
			typingDelayMax: 20,
			typoProbability: 0,
			fidgetEnabled: false,
			automaticThinkingEnabled: false,
			adaptiveStealthEnabled: false,
			adaptiveStealthSensitivity: 0.5,
			adaptiveStealthRadius: 100,
			precisionDecay: 0.1,
		} as any,
		{ emit: vi.fn() } as any,
		artifactBuilder as any,
		policyEngine as any,
		{ mapNodes: vi.fn().mockReturnValue([]), filterByType: vi.fn().mockReturnValue([]) } as any,
		() => page as any,
		() => collector as any,
		() => options.profile ?? null,
		() => ({ x: 0, y: 0 }),
		vi.fn(),
		() => null,
		(x: number, y: number) => ({ x, y }),
		vi.fn().mockResolvedValue(null),
		options.riskyActionHook,
		vi.fn(),
		undefined,
		undefined,
	);
	return { executor, page, collector, policyEngine, artifactBuilder };
}

const credentialUrl =
	"https://agent-user:page-password@example.com/callback?token=query-token&X-Amz-Signature=signed-url-secret&mode=debug";
const urlSecrets = ["page-password", "query-token", "signed-url-secret"];

function expectCredentialSafe(value: unknown, secrets = urlSecrets): void {
	const serialized = typeof value === "string" ? value : JSON.stringify(value);
	for (const secret of secrets) expect(serialized).not.toContain(secret);
	expect(serialized).toContain("REDACTED");
}

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	setLogLevel("info");
});

describe("ActionExecutor credential-safe error and approval paths", () => {
	it("sanitizes the synthesized click fallback state URL", async () => {
		vi.useFakeTimers();
		const collector = { collect: vi.fn().mockRejectedValue(new Error("collector unavailable")) };
		const { executor, page } = makeExecutor({ url: credentialUrl, collector });

		const pending = (executor as any).collectStateAfterClick(page);
		await vi.advanceTimersByTimeAsync(500);
		const state = await pending;

		expectCredentialSafe(state.url);
		expect(state.url).toContain("mode=debug");
	});

	it("sanitizes networkidle timeout diagnostics while preserving the raw navigation request", async () => {
		setLogLevel("debug");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { executor, page } = makeExecutor({ verbosity: 1 });
		page.goto
			.mockRejectedValueOnce(Object.assign(new Error("navigation timeout"), { name: "TimeoutError" }))
			.mockResolvedValueOnce(undefined);

		await (executor as any).performNavigation(page, credentialUrl);

		expect(page.goto).toHaveBeenNthCalledWith(1, credentialUrl, { waitUntil: "networkidle" });
		expect(page.goto).toHaveBeenNthCalledWith(2, credentialUrl, { waitUntil: "load", timeout: 30000 });
		const diagnostic = JSON.stringify(warn.mock.calls);
		expectCredentialSafe(diagnostic);
		expect(diagnostic).toContain("mode=debug");
	});

	it("sanitizes credential-bearing URLs in policy violation errors", () => {
		const { executor } = makeExecutor({ policyAllowed: false });

		expect(() => (executor as any).enforcePolicy({ class: "ops" }, credentialUrl)).toThrowError(
			expect.objectContaining({
				message: expect.not.stringContaining("signed-url-secret"),
			}),
		);
		try {
			(executor as any).enforcePolicy({ class: "ops" }, credentialUrl);
		} catch (error) {
			expectCredentialSafe((error as Error).message);
		}
	});

	it("passes credential-safe navigation targets to risky-action approval and blocked errors", async () => {
		const hook = vi.fn().mockResolvedValue(false);
		const { executor } = makeExecutor({ profile: { class: "ops" }, riskyActionHook: hook });

		let message = "";
		try {
			await (executor as any).checkRiskyAction("navigate", credentialUrl);
		} catch (error) {
			message = (error as Error).message;
		}

		expect(hook).toHaveBeenCalledTimes(1);
		const approvedTarget = hook.mock.calls[0]![1];
		expectCredentialSafe(approvedTarget);
		expect(approvedTarget).toContain("mode=debug");
		expectCredentialSafe(message);
	});

	it("never sends literal typed text to risky-action approval or blocked errors", async () => {
		const typedSecret = "opaque-password-value-7391";
		const hook = vi.fn().mockResolvedValue(false);
		const { executor } = makeExecutor({ profile: { class: "ops" }, riskyActionHook: hook });

		let message = "";
		try {
			await (executor as any)._typeInternal("#password", typedSecret);
		} catch (error) {
			message = (error as Error).message;
		}

		const approvalTarget = hook.mock.calls[0]![1];
		expect(approvalTarget).toContain("#password");
		expect(approvalTarget).toContain(String(typedSecret.length));
		expect(approvalTarget).not.toContain(typedSecret);
		expect(message).not.toContain(typedSecret);
	});
});

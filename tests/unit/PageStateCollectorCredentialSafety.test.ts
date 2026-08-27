import { afterEach, describe, expect, it, vi } from "vitest";
import { PageStateCollector } from "../../src/core/PageStateCollector.js";

const FAST_OPTS = {
	retry: { maxRetries: 0, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1 },
	useDomFallback: true,
	domFallbackThreshold: 1,
};

type Box = { x: number; y: number; width: number; height: number };

function makeBasePage(overrides: Record<string, unknown> = {}) {
	return {
		url: vi.fn(() => "https://example.com/login"),
		title: vi.fn(async () => "Login"),
		isClosed: vi.fn(() => false),
		on: vi.fn(),
		accessibility: { snapshot: vi.fn(async () => null) },
		$$: vi.fn(async () => []),
		$$eval: vi.fn(async () => []),
		evaluate: vi.fn(async () => []),
		...overrides,
	};
}

function makePasswordAwareDollarEval(passwordBoxes: Box[]) {
	return vi.fn(async (selector: string) => (selector === 'input[type="password"]' ? passwordBoxes : []));
}

const previousInput = globalThis.HTMLInputElement;
const previousTextarea = globalThis.HTMLTextAreaElement;

afterEach(() => {
	if (previousInput === undefined) delete (globalThis as Record<string, unknown>).HTMLInputElement;
	else globalThis.HTMLInputElement = previousInput;
	if (previousTextarea === undefined) delete (globalThis as Record<string, unknown>).HTMLTextAreaElement;
	else globalThis.HTMLTextAreaElement = previousTextarea;
});

function installFormControlGlobals() {
	class FakeInputElement {}
	class FakeTextAreaElement {}
	globalThis.HTMLInputElement = FakeInputElement as unknown as typeof HTMLInputElement;
	globalThis.HTMLTextAreaElement = FakeTextAreaElement as unknown as typeof HTMLTextAreaElement;
	return { FakeInputElement };
}

function makeInputHandle(options: { value: string; label?: string; placeholder?: string; ariaLabel?: string; name?: string }) {
	const { FakeInputElement } = installFormControlGlobals();
	const input = new FakeInputElement() as FakeInputElement & Record<string, any>;
	input.id = "";
	input.tagName = "INPUT";
	input.labels = options.label ? [{ textContent: options.label }] : [];
	input.placeholder = options.placeholder ?? "";
	input.value = options.value;
	input.parentElement = null;
	input.getAttribute = (name: string) => {
		if (name === "aria-label") return options.ariaLabel ?? null;
		if (name === "name") return options.name ?? "password";
		if (name === "type") return "password";
		return null;
	};

	return {
		evaluate: vi.fn(async (callback: (element: any) => unknown) => callback(input)),
		isVisible: vi.fn(async () => true),
		boundingBox: vi.fn(async () => ({ x: 1, y: 2, width: 160, height: 32 })),
		isDisabled: vi.fn(async () => false),
	};
}

describe("PageStateCollector DOM fallback credential safety", () => {
	it("does not expose an unlabeled password input live value", async () => {
		const secret = "correct-horse-battery-staple";
		const input = makeInputHandle({ value: secret });
		const page = makeBasePage({ $$: vi.fn(async () => [input]) });
		const collector = new PageStateCollector(page as any, FAST_OPTS);

		const state = await collector.collect();

		expect(state.nodes).toHaveLength(1);
		expect(state.nodes[0]?.name).toBe("");
		expect((state.interactiveElements[0] as any)?.text).toBe("");
		expect(JSON.stringify(state)).not.toContain(secret);
	});

	it("preserves useful labels without exposing the live input value", async () => {
		const secret = "typed-user-value";
		const input = makeInputHandle({ value: secret, label: "Account password" });
		const page = makeBasePage({ $$: vi.fn(async () => [input]) });
		const collector = new PageStateCollector(page as any, FAST_OPTS);

		const state = await collector.collect();

		expect(state.nodes[0]?.name).toBe("Account password");
		expect((state.interactiveElements[0] as any)?.text).toBe("Account password");
		expect(JSON.stringify(state)).not.toContain(secret);
	});
});

describe("PageStateCollector accessibility credential safety", () => {
	const passwordBox = { x: 10, y: 20, width: 200, height: 30 };
	const emailBox = { x: 10, y: 70, width: 200, height: 30 };

	it("scrubs legacy AX password values while preserving ordinary textbox values", async () => {
		const secret = "legacy-password-secret";
		const axSnapshot = {
			role: "WebArea",
			name: "",
			children: [
				{ role: "textbox", name: "Password", value: secret, box: passwordBox },
				{ role: "textbox", name: "Email", value: "user@test.com", box: emailBox },
			],
		};
		const page = makeBasePage({
			accessibility: { snapshot: vi.fn(async () => axSnapshot) },
			$$eval: makePasswordAwareDollarEval([passwordBox]),
		});
		const collector = new PageStateCollector(page as any, { ...FAST_OPTS, useDomFallback: false });

		const state = await collector.collect();

		expect(state.nodes[0]?.name).toBe("Password");
		expect(state.nodes[0]?.attributes?.value).toBeUndefined();
		expect(state.nodes[1]?.attributes?.value).toBe("user@test.com");
		expect(JSON.stringify(state)).not.toContain(secret);
	});

	it("scrubs modern ARIA textbox text for the matching password DOM box", async () => {
		const secret = "modern-password-secret";
		const ariaSnapshot = [
			`- textbox "Password" [box=10,20,200,30]: ${secret}`,
			'- textbox "Email" [box=10,70,200,30]: user@test.com',
		].join("\n");
		const page = makeBasePage({
			ariaSnapshot: vi.fn(async () => ariaSnapshot),
			accessibility: undefined,
			$$eval: makePasswordAwareDollarEval([passwordBox]),
		});
		const collector = new PageStateCollector(page as any, { ...FAST_OPTS, useDomFallback: false });

		const state = await collector.collect();

		expect(state.nodes[0]?.name).toBe("Password");
		expect(state.nodes[0]?.attributes?.text).toBeUndefined();
		expect(state.nodes[1]?.attributes?.text).toBe("user@test.com");
		expect(JSON.stringify(state)).not.toContain(secret);
	});

	it("fails closed for text-entry values when password DOM detection errors", async () => {
		const secret = "password-during-dom-error";
		const axSnapshot = {
			role: "WebArea",
			name: "",
			children: [{ role: "textbox", name: "Password", value: secret, box: passwordBox }],
		};
		const page = makeBasePage({
			accessibility: { snapshot: vi.fn(async () => axSnapshot) },
			$$eval: vi.fn(async () => {
				throw new Error("DOM unavailable");
			}),
		});
		const collector = new PageStateCollector(page as any, { ...FAST_OPTS, useDomFallback: false });

		const state = await collector.collect();

		expect(state.nodes[0]?.attributes?.value).toBeUndefined();
		expect(JSON.stringify(state)).not.toContain(secret);
	});
});

from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    return text.replace(old, new, 1)


package_path = Path("package.json")
package = package_path.read_text()
package = replace_once(package, '"@playwright/test": "^1.58.2"', '"@playwright/test": "^1.62.1"', "@playwright/test")
package = replace_once(package, '"playwright": "^1.58.2"', '"playwright": "^1.62.1"', "playwright")
package = replace_once(package, '"playwright-core": "^1.58.2"', '"playwright-core": "^1.62.1"', "playwright-core")
package_path.write_text(package)

collector_path = Path("src/core/PageStateCollector.ts")
collector = collector_path.read_text()
collector = replace_once(
    collector,
    'import type { Page, Response } from "playwright-core";\n',
    'import { load as loadYaml } from "js-yaml";\nimport type { Page, Response } from "playwright-core";\n',
    "js-yaml import",
)

marker = '\tprivate flattenAXTree(node: any, result: TaloxNode[] = []) {'
if marker not in collector:
    raise SystemExit("missing patch anchor: flattenAXTree")

modern_methods = r'''	private parseAriaDescriptor(rawDescriptor: string): {
		role: string;
		name: string;
		boundingBox?: { x: number; y: number; width: number; height: number };
		attributes: Record<string, string | boolean>;
	} | null {
		let descriptor = rawDescriptor.trim();
		if (!descriptor || descriptor === "text" || descriptor.startsWith("/")) return null;

		const attributes: Record<string, string | boolean> = {};
		let boundingBox: { x: number; y: number; width: number; height: number } | undefined;
		const attributePattern = /\s+\[([A-Za-z][\w-]*)(?:=([^\]]+))?\]$/;

		while (true) {
			const match = attributePattern.exec(descriptor);
			if (!match || match.index === undefined) break;
			const key = match[1];
			const rawValue = match[2];

			if (key === "box" && rawValue !== undefined) {
				const values = rawValue.split(",").map((value) => Number(value.trim()));
				if (values.length === 4 && values.every(Number.isFinite)) {
					boundingBox = { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! };
				}
			} else if (key) {
				attributes[key] = rawValue === undefined ? true : rawValue;
			}

			descriptor = descriptor.slice(0, match.index).trim();
		}

		const separator = descriptor.indexOf(" ");
		const role = separator === -1 ? descriptor : descriptor.slice(0, separator);
		const rawName = separator === -1 ? "" : descriptor.slice(separator + 1).trim();
		if (!role || role.startsWith("/")) return null;

		let name = "";
		if (rawName) {
			if (rawName.startsWith('"') && rawName.endsWith('"')) {
				try {
					name = JSON.parse(rawName) as string;
				} catch {
					name = rawName.slice(1, -1);
				}
			} else {
				name = rawName;
			}
		}

		return { role, name, boundingBox, attributes };
	}

	private collectAriaDirectiveAttributes(value: unknown): Record<string, string | boolean> {
		const attributes: Record<string, string | boolean> = {};
		if (!Array.isArray(value)) return attributes;

		for (const entry of value) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
			for (const [key, directiveValue] of Object.entries(entry as Record<string, unknown>)) {
				if (!key.startsWith("/") || directiveValue === null || directiveValue === undefined) continue;
				if (typeof directiveValue === "boolean") attributes[key.slice(1)] = directiveValue;
				else if (typeof directiveValue === "string" || typeof directiveValue === "number") {
					attributes[key.slice(1)] = String(directiveValue);
				}
			}
		}
		return attributes;
	}

	private flattenAriaYaml(value: unknown, result: TaloxNode[] = []): TaloxNode[] {
		if (Array.isArray(value)) {
			for (const entry of value) this.flattenAriaYaml(entry, result);
			return result;
		}

		if (typeof value === "string") {
			const descriptor = this.parseAriaDescriptor(value);
			if (descriptor?.boundingBox) {
				result.push({
					id: `aria-${result.length}`,
					role: descriptor.role,
					name: descriptor.name,
					description: "",
					boundingBox: descriptor.boundingBox,
					...(Object.keys(descriptor.attributes).length > 0 && { attributes: descriptor.attributes }),
					trust: "first-party",
				});
			}
			return result;
		}

		if (!value || typeof value !== "object") return result;

		for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
			const descriptor = this.parseAriaDescriptor(key);
			if (descriptor?.boundingBox) {
				const attributes = {
					...descriptor.attributes,
					...this.collectAriaDirectiveAttributes(child),
				};
				if (typeof child === "string" && child.trim()) attributes.text = child.trim();

				result.push({
					id: `aria-${result.length}`,
					role: descriptor.role,
					name: descriptor.name,
					description: "",
					boundingBox: descriptor.boundingBox,
					...(Object.keys(attributes).length > 0 && { attributes }),
					trust: "first-party",
				});
			}

			this.flattenAriaYaml(child, result);
		}
		return result;
	}

	private flattenModernAriaSnapshot(snapshot: string): TaloxNode[] {
		try {
			return this.flattenAriaYaml(loadYaml(snapshot));
		} catch (error) {
			throw new Error(`Failed to parse Playwright ARIA snapshot: ${(error as Error).message}`);
		}
	}

'''
collector = collector.replace(marker, modern_methods + marker, 1)

start = collector.index('\tprivate async collectWithRetry(')
end = collector.index('\n\tasync collect(): Promise<TaloxPageState> {', start)
new_collect_with_retry = r'''	private async collectWithRetry(
		nodeThreshold: number,
		maxRetriesOverride?: number,
	): Promise<{ nodes: TaloxNode[]; shouldUseFallback: boolean }> {
		const configuredMaxRetries = this.options.retry.maxRetries ?? DEFAULT_RETRY_OPTIONS.maxRetries;
		const maxRetries = maxRetriesOverride ?? configuredMaxRetries;
		let nodes: TaloxNode[] = [];
		let axSnapshot: unknown = null;
		let axTreeError: Error | null = null;

		const modernSnapshot = (this.page as unknown as {
			ariaSnapshot?: (options?: { mode?: "ai" | "default"; boxes?: boolean }) => Promise<string>;
		}).ariaSnapshot;
		const accessibility = (this.page as any).accessibility;
		const legacySnapshot = accessibility?.snapshot;

		if (typeof modernSnapshot !== "function" && typeof legacySnapshot !== "function") {
			return { nodes: [], shouldUseFallback: this.options.useDomFallback };
		}

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			this.retryStats.axTreeAttempts++;

			try {
				if (attempt > 0) {
					const delay = this.calculateBackoff(attempt - 1);
					this.retryStats.totalDelayMs += delay;
					await this.sleep(delay);
				}

				try {
					if (typeof modernSnapshot === "function") {
						axSnapshot = await modernSnapshot.call(this.page, { mode: "default", boxes: true });
						nodes = typeof axSnapshot === "string" ? this.flattenModernAriaSnapshot(axSnapshot) : [];
					} else {
						axSnapshot = await legacySnapshot.call(accessibility);
						nodes = axSnapshot ? this.flattenAXTree(axSnapshot) : [];
					}
				} catch (error_) {
					axTreeError = error_ as Error;
					axSnapshot = null;
				}

				if (axSnapshot) {
					this.retryStats.axTreeSuccesses++;
					break;
				}

				axTreeError = new Error("Accessibility snapshot returned empty output");
			} catch (err) {
				axTreeError = err as Error;
				this.retryStats.lastError = axTreeError.message;
			}
		}

		const shouldUseFallback =
			this.options.useDomFallback && (nodes.length < nodeThreshold || axTreeError !== null || axSnapshot === null);

		return { nodes, shouldUseFallback };
	}
'''
collector = collector[:start] + new_collect_with_retry + collector[end:]
collector_path.write_text(collector)

unit_path = Path("tests/unit/PageStateCollector.test.ts")
unit = unit_path.read_text()
unit = replace_once(
    unit,
    '\t\taxSnapshot: any;\n\t\taccessibilityAvailable: boolean;\n',
    '\t\taxSnapshot: any;\n\t\tariaSnapshot: string;\n\t\tmodernAriaAvailable: boolean;\n\t\taccessibilityAvailable: boolean;\n',
    "unit option types",
)
unit = replace_once(
    unit,
    '\t\taxSnapshot = null,\n\t\taccessibilityAvailable = true,\n',
    '\t\taxSnapshot = null,\n\t\tariaSnapshot = "",\n\t\tmodernAriaAvailable = false,\n\t\taccessibilityAvailable = true,\n',
    "unit defaults",
)
unit = replace_once(
    unit,
    '\t\toff: vi.fn(),\n\t\t...(accessibilityAvailable\n',
    '\t\toff: vi.fn(),\n\t\t...(modernAriaAvailable ? { ariaSnapshot: vi.fn(() => Promise.resolve(ariaSnapshot)) } : {}),\n\t\t...(accessibilityAvailable\n',
    "unit modern mock",
)

ax_marker = '\tdescribe("AX tree extraction", () => {\n\t\tit("flattens AX tree with box property into TaloxNode[]", async () => {'
if ax_marker not in unit:
    raise SystemExit("missing patch anchor: AX tests")
modern_unit = r'''	describe("AX tree extraction", () => {
		it("prefers modern Playwright ARIA YAML with boxes and preserves semantic attributes", async () => {
			const ariaSnapshot = `- main [box=0,0,800,600]:
  - heading "Dashboard" [level=1] [box=10,20,200,40]
  - textbox "Email" [disabled] [box=10,80,240,32]:
    - /placeholder: name@example.com
  - link "Home" [box=10,130,60,20]`;
			const page = makeMockPage({
				modernAriaAvailable: true,
				ariaSnapshot,
				accessibilityAvailable: false,
			});
			const collector = new PageStateCollector(page, {
				...FAST_OPTS,
				useDomFallback: false,
				domFallbackThreshold: 1,
			});

			const state = await collector.collect();

			expect(page.ariaSnapshot).toHaveBeenCalledWith({ mode: "default", boxes: true });
			expect(state.nodes.map((node) => node.role)).toEqual(["main", "heading", "textbox", "link"]);
			expect(state.nodes[1]).toMatchObject({
				name: "Dashboard",
				boundingBox: { x: 10, y: 20, width: 200, height: 40 },
			});
			expect(state.nodes[1].attributes?.level).toBe("1");
			expect(state.nodes[2].attributes?.disabled).toBe(true);
			expect(state.nodes[2].attributes?.placeholder).toBe("name@example.com");
			expect(collector.getRetryStats()).toMatchObject({ axTreeAttempts: 1, axTreeSuccesses: 1, fallbackUsed: false });
		});

		it("flattens AX tree with box property into TaloxNode[]", async () => {'''
unit = unit.replace(ax_marker, modern_unit, 1)
unit_path.write_text(unit)

real_test = r'''import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";
import { PageStateCollector } from "../../src/core/PageStateCollector.js";

describe("PageStateCollector · modern ARIA state", () => {
	let browser: Browser;
	let page: Page;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
		page = await browser.newPage({ viewport: { width: 900, height: 700 } });
		await page.setContent(`
			<main>
				<h1>Account</h1>
				<label for="email">Email address</label>
				<input id="email" placeholder="name@example.com" />
				<button disabled>Save</button>
				<a href="#next">Next</a>
				<iframe title="Embedded" srcdoc="<button>Inside frame</button>"></iframe>
			</main>
		`);
	});

	afterAll(async () => {
		await browser?.close();
	});

	it("collects semantic nodes with Playwright boxes without bypassing iframe trust", async () => {
		expect(typeof (page as any).ariaSnapshot).toBe("function");
		const raw = await (page as any).ariaSnapshot({ mode: "default", boxes: true });
		expect(raw).toContain("[box=");

		const collector = new PageStateCollector(page, {
			useDomFallback: false,
			domFallbackThreshold: 1,
			retry: { maxRetries: 0 },
		});
		const state = await collector.collect();

		const heading = state.nodes.find((node) => node.role === "heading" && node.name === "Account");
		const textbox = state.nodes.find((node) => node.role === "textbox" && node.name === "Email address");
		const button = state.nodes.find((node) => node.role === "button" && node.name === "Save");
		const link = state.nodes.find((node) => node.role === "link" && node.name === "Next");

		expect(heading?.attributes?.level).toBe("1");
		expect(textbox?.boundingBox.width).toBeGreaterThan(0);
		expect(button?.attributes?.disabled).toBe(true);
		expect(link?.boundingBox.width).toBeGreaterThan(0);
		expect(state.nodes.some((node) => node.name === "Inside frame")).toBe(false);
		expect(state.nodes.every((node) => Object.values(node.boundingBox).every(Number.isFinite))).toBe(true);
		expect(collector.getRetryStats()).toMatchObject({ axTreeAttempts: 1, axTreeSuccesses: 1, fallbackUsed: false });
	});
});
'''
Path("tests/core/page-state-modern-aria.test.ts").write_text(real_test)

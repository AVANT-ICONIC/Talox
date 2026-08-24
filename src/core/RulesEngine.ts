import type { TaloxBug, TaloxPageState } from "../types/index.js";
import { createLogger } from "./Logger.js";
import { getTaloxPluginRules } from "./plugins/PluginRegistry.js";

const logger = createLogger("Rules");
const BUG_SEVERITIES = new Set(["CRITICAL", "MAJOR", "MINOR"]);

function isTaloxBug(value: unknown): value is TaloxBug {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	if (
		candidate.confidence !== undefined &&
		(typeof candidate.confidence !== "number" ||
			!Number.isFinite(candidate.confidence) ||
			candidate.confidence < 0 ||
			candidate.confidence > 1)
	) {
		return false;
	}
	return (
		typeof candidate.id === "string" &&
		candidate.id.length > 0 &&
		typeof candidate.type === "string" &&
		candidate.type.length > 0 &&
		typeof candidate.severity === "string" &&
		BUG_SEVERITIES.has(candidate.severity) &&
		typeof candidate.description === "string" &&
		candidate.description.length > 0 &&
		candidate.evidence !== null &&
		typeof candidate.evidence === "object"
	);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
	if (value === null || typeof value !== "object") return value;
	const object = value as object;
	if (seen.has(object)) return value;
	seen.add(object);
	for (const nested of Object.values(value as Record<string, unknown>)) {
		deepFreeze(nested, seen);
	}
	return Object.freeze(value);
}

function clonePluginState(state: TaloxPageState): TaloxPageState {
	return deepFreeze(structuredClone(state));
}

function encodeIdComponent(value: string): string {
	return encodeURIComponent(value);
}

/**
 * Analyzes page states for quality-assurance bugs. Detects structural
 * regressions (missing AX-tree nodes or interactive elements between two
 * states), JavaScript console errors, overlapping UI elements, viewport
 * clipping issues, and registered synchronous community rules.
 */
export class RulesEngine {
	/**
	 * 🔍 STRUCTURAL DIFFING: Detect changes in AX-Tree or DOM between two states.
	 */
	diffStructural(oldState: TaloxPageState, newState: TaloxPageState): TaloxBug[] {
		const bugs: TaloxBug[] = [];

		// 1. AX-Tree Diffing
		const oldNodes = new Map(oldState.nodes.map((n) => [n.id, n]));
		const newNodes = new Map(newState.nodes.map((n) => [n.id, n]));

		for (const [id, oldNode] of oldNodes) {
			if (!newNodes.has(id)) {
				bugs.push({
					id: `structural-missing-${id}-${Date.now()}`,
					type: "STRUCTURAL_REGRESSION",
					severity: "MAJOR",
					description: `Node '${oldNode.role}' with name '${oldNode.name}' is missing in the new state.`,
					evidence: { oldNode },
				});
			}
		}

		// 2. DOM-based Interactive Elements Diffing (Fallback/Bonus)
		const oldInteractive = new Map(oldState.interactiveElements.map((e) => [e.id, e]));
		const newInteractive = new Map(newState.interactiveElements.map((e) => [e.id, e]));

		for (const [id, oldEl] of oldInteractive) {
			if (!newInteractive.has(id)) {
				bugs.push({
					id: `dom-missing-${id}-${Date.now()}`,
					type: "STRUCTURAL_REGRESSION",
					severity: "MAJOR",
					description: `Interactive element '${oldEl.tagName}' is missing in the new state.`,
					evidence: { oldEl },
				});
			}
		}

		return bugs;
	}

	private detectOverlaps(elements: any[], bugs: TaloxBug[]): void {
		for (let i = 0; i < elements.length; i++) {
			const elA = elements[i];
			if (!elA) continue;

			for (let j = i + 1; j < elements.length; j++) {
				const elB = elements[j];
				if (!elB) continue;

				const a = elA.boundingBox;
				const b = elB.boundingBox;

				const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
				const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
				const overlapArea = overlapX * overlapY;

				const areaA = a.width * a.height;
				const areaB = b.width * b.height;

				// If overlap is more than 30% of either element (Tighter threshold)
				if (overlapArea > Math.min(areaA, areaB) * 0.3 && areaA > 0 && areaB > 0) {
					bugs.push({
						id: `overlap-${Date.now()}-${i}-${j}`,
						type: "VISUAL_OVERLAP",
						severity: "MAJOR",
						description: `Elements '${elA.tagName}' and '${elB.tagName}' overlap significantly.`,
						evidence: { el1: elA, el2: elB, overlapArea },
					});
				}
			}
		}
	}

	private detectClipping(elements: any[], bugs: TaloxBug[]): void {
		const viewport = { width: 1280, height: 720 };
		for (const el of elements) {
			const box = el.boundingBox;
			const isClipped =
				box.x < -1 || box.y < -1 || box.x + box.width > viewport.width + 1 || box.y + box.height > viewport.height + 1;

			if (isClipped) {
				bugs.push({
					id: `clipping-${Date.now()}-${el.id}`,
					type: "VISUAL_CLIPPING",
					severity: "MINOR",
					description: `Element '${el.tagName}' is partially outside the viewport.`,
					evidence: { el, box, viewport },
				});
			}
		}
	}

	private runPluginRules(state: TaloxPageState, bugs: TaloxBug[]): void {
		for (const registration of getTaloxPluginRules()) {
			const { pluginName, pluginVersion, rule } = registration;
			try {
				// Every plugin receives an isolated, recursively frozen snapshot. This
				// protects later rules and the caller even when a JavaScript plugin
				// ignores the TypeScript read-only contract.
				const result = rule.analyze(clonePluginState(state));
				if (result == null) continue;
				if (!Array.isArray(result)) {
					logger.warn(`Plugin rule ${pluginName}/${rule.id} returned a non-array result; ignoring it.`);
					continue;
				}

				for (const bug of result) {
					if (!isTaloxBug(bug)) {
						logger.warn(`Plugin rule ${pluginName}/${rule.id} returned an invalid bug; ignoring it.`);
						continue;
					}
					bugs.push({
						...bug,
						id: `plugin:${encodeIdComponent(pluginName)}:${encodeIdComponent(rule.id)}:${encodeIdComponent(bug.id)}`,
						metadata: {
							...bug.metadata,
							taloxPlugin: { name: pluginName, version: pluginVersion, ruleId: rule.id },
						},
					});
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.warn(`Plugin rule ${pluginName}/${rule.id} failed: ${message}`);
			}
		}
	}

	analyze(state: TaloxPageState): TaloxBug[] {
		const bugs: TaloxBug[] = [];

		// 1. JS Error Rule
		for (const error of state.console.errors) {
			bugs.push({
				// sonar-disable-next-line typescript:S1874 — backward compat
				id: `js-error-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, // NOSONAR
				type: "JS_ERROR",
				severity: "CRITICAL",
				description: `Console error detected: ${error}`,
				evidence: { error },
			});
		}

		// 2. Overlap Detection (Refined with tolerance)
		this.detectOverlaps(state.interactiveElements, bugs);

		// 3. Clipping Detection (Dynamic Viewport)
		this.detectClipping(state.interactiveElements, bugs);

		// 4. Community plugin rules (isolated per plugin rule)
		this.runPluginRules(state, bugs);

		return bugs;
	}
}

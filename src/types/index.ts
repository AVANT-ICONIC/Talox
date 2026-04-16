export type ProfileClass = "qa" | "ops" | "sandbox";

/** Bug severity levels detected by the RulesEngine. */
export type BugSeverity = "CRITICAL" | "MAJOR" | "MINOR";
/** Built-in bug types detected by the RulesEngine. */
export type BugType =
	| "JS_ERROR"
	| "NETWORK_FAILURE"
	| "LAYOUT_OVERLAP"
	| "CLIPPED_ELEMENT"
	| "INVISIBLE_CTA"
	| "VISUAL_REGRESSION"
	| string;

// ─── Annotation Types ─────────────────────────────────────────────────────────
export type {
	AnnotationElement,
	AnnotationEntry,
	AnnotationLabel,
	BuiltInAnnotationLabel,
} from "./annotation.js";
export { ANNOTATION_LABEL_EMOJI, getLabelEmoji } from "./annotation.js";
// ─── Config & Settings (v2) ─────────────────────────────────────────────────
export type { TaloxConfig } from "./config.js";

// ─── Event System ─────────────────────────────────────────────────────────────
export type {
	AdaptationReason,
	AdaptedEvent,
	AnnotationAddedEvent,
	AnnotationUndoneEvent,
	SessionEndEvent,
	TaloxEvent,
	TaloxEventMap,
	TaloxEventType,
} from "./events.js";
// ─── Session Report Types ─────────────────────────────────────────────────────────
export type {
	InteractionType,
	ObserveSessionOptions,
	SessionOutputFormat,
	TaloxInteraction,
	TaloxSessionReport,
	TaloxSessionSummary,
} from "./session.js";
export type {
	BugSummaryEntry,
	EventLogEntry,
	FailureEntry,
	InteractionDiff,
	ScreenshotDescriptor,
	SessionReportExtras,
} from "./session-report.js";
export type { TaloxSettings } from "./settings.js";
export { DEFAULT_SETTINGS } from "./settings.js";

// ─── Contract Version ─────────────────────────────────────────────────────────

/**
 * Monotonic integer that increments on every breaking `TaloxPageState` change.
 * Consumers pin to this version to detect incompatible schema changes.
 *
 * **v1** fields (frozen — removal or type narrowing is a breaking change):
 * - url, title, timestamp, console, network, nodes, interactiveElements, bugs
 *
 * **v1** optional fields (additions are non-breaking):
 * - axTree, screenshots, timing, diff, profileId
 */
export const TALOX_STATE_CONTRACT_VERSION = 1 as const;

// ─── Core Types ─────────────────────────────────────────────────────────────

export interface Point {
	x: number;
	y: number;
	t?: number;
}

export interface TaloxNode {
	id: string;
	role: string;
	name: string;
	description?: string;
	boundingBox: { x: number; y: number; width: number; height: number };
	attributes?: Record<string, string | boolean>;
	children?: TaloxNode[];
}

export interface TaloxProfile {
	id: string;
	class: ProfileClass;
	purpose: string;
	userDataDir: string;
	policy?: {
		allowedDomains: string[];
		blockedActions: string[];
		extensions: string[];
	};
	metadata: {
		createdAt: string;
		lastUsed: string;
		tags?: string[];
	};
}

export interface TaloxBug {
	id: string;
	type: BugType;
	severity: BugSeverity;
	confidence?: number; // 0.0 - 1.0
	description: string;
	reproductionSteps?: string[];
	evidence: {
		url?: string;
		profile?: string;
		consoleLog?: string;
		networkLog?: string;
		screenshotRef?: string;
		cropRef?: string;
		[key: string]: any;
	};
	metadata?: Record<string, any>;
}

export interface VisualDiffResult {
	testId?: string;
	timestamp?: string;
	passed?: boolean;
	baselinePath?: string;
	currentPath?: string;
	diffPath?: string;
	similarity?: number; // 0.0 - 1.0
	mismatchedPixels: number;
	ssimScore: number;
	ocrText?: string;
	diffImageUrl?: string;
	diffRegions?: Array<{ x: number; y: number; width: number; height: number }>;
}

export interface BehavioralDNA {
	profileId?: string;
	jitterFrequency: number;
	accelerationCurve: "linear" | "ease-out" | "ease-in-out" | "bezier"; // AccelerationCurve;
	typingRhythm: "fast" | "medium" | "slow" | "variable"; // TypingRhythm;
	clickPrecision: number;
	movementStyle: "smooth" | "jerky" | "precise" | "relaxed"; // MovementStyle;
	typeBehavior?: {
		avgTypingSpeed: number; // chars per second
		errorRate: number;
		pauseBetweenWords: number;
	};
	clickPattern?: {
		doubleClickProbability: number;
		hoverDuration: number;
	};
	timingVariance?: {
		actionDelayMin: number;
		actionDelayMax: number;
	};
}

/**
 * Timing metadata attached to every `TaloxPageState`.
 * All durations are wall-clock milliseconds.
 */
export interface TaloxStateTiming {
	/** Total wall-clock time from action start to state returned, in ms. */
	totalMs: number;
	/** Time spent collecting the AX tree snapshot, in ms. */
	axMs?: number;
	/** ISO timestamp when collection completed (same as `TaloxPageState.timestamp`). */
	collectedAt: string;
}

/**
 * **TaloxPageState v1 — frozen public contract.**
 *
 * Core fields (url, title, timestamp, console, network, nodes,
 * interactiveElements, bugs) are immutable public API.
 * Optional fields may be added without a version bump.
 *
 * @see TALOX_STATE_CONTRACT_VERSION
 */
export interface TaloxPageState {
	// ── v1 frozen fields ──────────────────────────────────────────────────────
	url: string;
	title: string;
	/** ISO 8601 timestamp of when this state was collected. */
	timestamp: string;
	console: {
		errors: string[];
		warnings?: string[];
		logs?: string[];
	};
	network: {
		failedRequests: Array<{ url: string; status: number; type?: string }>;
		exceptions?: any[];
	};
	/** Flat ordered list of all AX tree nodes with bounding boxes. */
	nodes: TaloxNode[];
	interactiveElements: Array<{
		/** CSS selector usable with click()/type(). Derived from id, name, aria-label, or nth-of-type. */
		id: string;
		tagName: string;
		role?: string;
		/** Label text from <label>, aria-label, placeholder, or textContent. */
		text?: string;
		boundingBox: { x: number; y: number; width: number; height: number };
		isActionable?: boolean;
	}>;
	bugs: TaloxBug[];

	// ── v1 optional fields (non-breaking additions) ───────────────────────────
	/** Full AX-Tree root node (present when perceptionDepth: 'full'). */
	axTree?: TaloxNode;
	/** Timing metadata for this collection cycle. */
	timing?: TaloxStateTiming;
	/**
	 * State diff relative to the previous action's state.
	 * Populated by ActionExecutor when a prior state is available.
	 */
	diff?: TaloxStateDiff;
	/** Profile ID that produced this state (set by SessionManager). */
	profileId?: string;
	/** Visual artifact references produced during this action cycle. */
	screenshots?: {
		fullPage?: string;
		crops?: Array<{ id: string; path: string; reason: string }>;
	};
}

// ─── State Diff ──────────────────────────────────────────────────────────────

/**
 * First-class diff between two consecutive `TaloxPageState` snapshots.
 *
 * Produced by `diffPageState(prev, curr)` and attached to every action's
 * returned state as `state.diff` when a prior state exists.
 *
 * @example
 * ```ts
 * const state = await talox.click('#submit');
 * if (state.diff?.urlChanged) {
 *   console.log(`Navigated: ${state.diff.fromUrl} → ${state.diff.toUrl}`);
 * }
 * if (state.diff?.bugsAdded.length) {
 *   console.warn(`${state.diff.bugsAdded.length} new bugs after click`);
 * }
 * ```
 */
export interface TaloxStateDiff {
	// ── Navigation delta ──────────────────────────────────────────────────────
	fromUrl: string;
	toUrl: string;
	urlChanged: boolean;
	fromTitle: string;
	toTitle: string;
	titleChanged: boolean;

	// ── AX-tree delta ─────────────────────────────────────────────────────────
	/** Nodes present in `curr` but not in `prev` (by id). */
	nodesAdded: TaloxNode[];
	/** Nodes present in `prev` but not in `curr` (by id). */
	nodesRemoved: TaloxNode[];
	/** Nodes present in both but with changed name, role, or bounding box. */
	nodesChanged: Array<{
		id: string;
		field: "name" | "role" | "boundingBox";
		prev: string;
		curr: string;
	}>;

	// ── Interactive elements delta ────────────────────────────────────────────
	interactiveAdded: number;
	interactiveRemoved: number;

	// ── Bug delta ─────────────────────────────────────────────────────────────
	/** New bugs that appeared in `curr` that were not in `prev`. */
	bugsAdded: TaloxBug[];
	/**
	 * Bugs in `prev` that are no longer present in `curr`.
	 * Useful for tracking auto-resolved issues after interactions.
	 */
	bugsResolved: TaloxBug[];

	// ── Console / network delta ───────────────────────────────────────────────
	/** New console errors that appeared in `curr`. */
	newConsoleErrors: string[];
	/** New failed requests that appeared in `curr`. */
	newFailedRequests: Array<{ url: string; status: number }>;

	// ── Timing ────────────────────────────────────────────────────────────────
	prevTimestamp: string;
	currTimestamp: string;
	/** Elapsed ms between the two snapshots. */
	elapsedMs: number;
}

/**
 * Compute a structured diff between two consecutive page states.
 *
 * All comparisons are O(n) or O(n log n) — safe to call after every action.
 */
export function diffPageState(prev: TaloxPageState, curr: TaloxPageState): TaloxStateDiff {
	const prevNodeIds = new Set(prev.nodes.map((n) => n.id));
	const currNodeIds = new Set(curr.nodes.map((n) => n.id));
	const prevNodeMap = new Map(prev.nodes.map((n) => [n.id, n]));
	const currNodeMap = new Map(curr.nodes.map((n) => [n.id, n]));

	const nodesAdded = curr.nodes.filter((n) => !prevNodeIds.has(n.id));
	const nodesRemoved = prev.nodes.filter((n) => !currNodeIds.has(n.id));

	const nodesChanged: TaloxStateDiff["nodesChanged"] = [];
	for (const id of Array.from(prevNodeIds)) {
		if (!currNodeIds.has(id)) continue;
		const p = prevNodeMap.get(id)!;
		const c = currNodeMap.get(id)!;
		if (p.name !== c.name) {
			nodesChanged.push({ id, field: "name", prev: p.name, curr: c.name });
		}
		if (p.role !== c.role) {
			nodesChanged.push({ id, field: "role", prev: p.role, curr: c.role });
		}
	}

	const prevBugIds = new Set(prev.bugs.map((b) => b.id));
	const currBugIds = new Set(curr.bugs.map((b) => b.id));
	const bugsAdded = curr.bugs.filter((b) => !prevBugIds.has(b.id));
	const bugsResolved = prev.bugs.filter((b) => !currBugIds.has(b.id));

	const prevErrors = new Set(prev.console.errors);
	const newConsoleErrors = curr.console.errors.filter((e) => !prevErrors.has(e));

	const prevFailedUrls = new Set(prev.network.failedRequests.map((r) => `${r.url}::${r.status}`));
	const newFailedRequests = curr.network.failedRequests
		.filter((r) => !prevFailedUrls.has(`${r.url}::${r.status}`))
		.map((r) => ({ url: r.url, status: r.status }));

	const prevTs = new Date(prev.timestamp).getTime();
	const currTs = new Date(curr.timestamp).getTime();

	return {
		fromUrl: prev.url,
		toUrl: curr.url,
		urlChanged: prev.url !== curr.url,
		fromTitle: prev.title,
		toTitle: curr.title,
		titleChanged: prev.title !== curr.title,
		nodesAdded,
		nodesRemoved,
		nodesChanged,
		interactiveAdded: Math.max(0, curr.interactiveElements.length - prev.interactiveElements.length),
		interactiveRemoved: Math.max(0, prev.interactiveElements.length - curr.interactiveElements.length),
		bugsAdded,
		bugsResolved,
		newConsoleErrors,
		newFailedRequests,
		prevTimestamp: prev.timestamp,
		currTimestamp: curr.timestamp,
		elapsedMs: Number.isNaN(currTs - prevTs) ? 0 : currTs - prevTs,
	};
}

// ─── Compact State Variants ──────────────────────────────────────────────────

/**
 * Compact variant selector:
 * - `'full'`  — full TaloxPageState (same shape, no reduction)
 * - `'agent'` — URL, title, interactive elements, console errors, bugs (LLM-friendly)
 * - `'debug'` — URL, title, full nodes, console, network, bugs (forensics-friendly)
 */
export type CompactVariant = "full" | "agent" | "debug";

/** Minimal state surface suitable for passing to an LLM agent. */
export interface AgentPageState {
	url: string;
	title: string;
	timestamp: string;
	interactiveElements: TaloxPageState["interactiveElements"];
	consoleErrors: string[];
	bugs: Array<{ type: string; severity: string; description: string }>;
}

/** State surface focused on debugging — full fidelity but no screenshots. */
export interface DebugPageState {
	url: string;
	title: string;
	timestamp: string;
	nodes: TaloxNode[];
	console: TaloxPageState["console"];
	network: TaloxPageState["network"];
	bugs: TaloxBug[];
}

/**
 * Reduce a full `TaloxPageState` to a compact variant.
 *
 * @example
 * ```ts
 * const compact = compactState(state, 'agent');
 * // → { url, title, interactiveElements, consoleErrors, bugs }
 * ```
 */
export function compactState(state: TaloxPageState, variant: "full"): TaloxPageState;
export function compactState(state: TaloxPageState, variant: "agent"): AgentPageState;
export function compactState(state: TaloxPageState, variant: "debug"): DebugPageState;
export function compactState(
	state: TaloxPageState,
	variant: CompactVariant,
): TaloxPageState | AgentPageState | DebugPageState {
	switch (variant) {
		case "full":
			return state;
		case "agent":
			return {
				url: state.url,
				title: state.title,
				timestamp: state.timestamp,
				interactiveElements: state.interactiveElements,
				consoleErrors: state.console.errors,
				bugs: state.bugs.map((b) => ({ type: b.type, severity: b.severity, description: b.description })),
			};
		case "debug":
			return {
				url: state.url,
				title: state.title,
				timestamp: state.timestamp,
				nodes: state.nodes,
				console: state.console,
				network: state.network,
				bugs: state.bugs,
			};
	}
}

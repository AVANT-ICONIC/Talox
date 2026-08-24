import { createLogger } from "../Logger.js";
import type { TaloxBug, TaloxPageState } from "../../types/index.js";

const logger = createLogger("Plugins");
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

/** Context supplied to opt-in plugin vision detectors. */
export interface TaloxVisionContext {
	url?: string;
	title?: string;
	metadata?: Readonly<Record<string, unknown>>;
}

/** A structured finding returned by a plugin vision detector. */
export interface TaloxVisualDetection {
	type: string;
	description: string;
	confidence?: number;
	evidence?: Readonly<Record<string, unknown>>;
}

/** A synchronous rule that participates in the normal RulesEngine QA pass. */
export interface TaloxRule {
	id: string;
	analyze(state: Readonly<TaloxPageState>): readonly TaloxBug[] | null | undefined;
}

/** An opt-in visual detector. It is never run implicitly by getState(). */
export interface TaloxVisionDetector {
	id: string;
	detect(
		screenshot: Readonly<Buffer>,
		context: Readonly<TaloxVisionContext>,
	): Promise<readonly TaloxVisualDetection[]> | readonly TaloxVisualDetection[];
}

/** Community extension package registered with Talox. */
export interface TaloxPlugin {
	name: string;
	version: string;
	rules?: readonly TaloxRule[];
	visionDetectors?: readonly TaloxVisionDetector[];
}

/** Stable public metadata for an installed process-wide plugin. */
export interface TaloxPluginInfo {
	name: string;
	version: string;
	ruleIds: readonly string[];
	visionDetectorIds: readonly string[];
}

/** Result for one detector invocation. Plugin failures are isolated here. */
export interface TaloxVisionDetectorResult {
	pluginName: string;
	pluginVersion: string;
	detectorId: string;
	detections: readonly TaloxVisualDetection[];
	error?: string;
}

/** Internal rule registration consumed by RulesEngine. */
export interface RegisteredTaloxRule {
	pluginName: string;
	pluginVersion: string;
	rule: TaloxRule;
}

interface RegisteredPlugin {
	name: string;
	version: string;
	rules: TaloxRule[];
	visionDetectors: TaloxVisionDetector[];
}

const plugins = new Map<string, RegisteredPlugin>();

function requireText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new TypeError(`${label} must be a non-empty string.`);
	}
	return value.trim();
}

function requireIdentifier(value: unknown, label: string): string {
	const identifier = requireText(value, label);
	if (!IDENTIFIER_PATTERN.test(identifier)) {
		throw new TypeError(
			`${label} must start with an alphanumeric character and contain only letters, numbers, '.', '_', ':', '/', or '-'.`,
		);
	}
	return identifier;
}

function assertCallable(value: unknown, label: string): asserts value is (...args: never[]) => unknown {
	if (typeof value !== "function") throw new TypeError(`${label} must be a function.`);
}

function validateRuleIds(rules: readonly TaloxRule[], occupied: Set<string>): TaloxRule[] {
	const local = new Set<string>();
	return rules.map((rule, index) => {
		if (!rule || typeof rule !== "object") throw new TypeError(`rules[${index}] must be an object.`);
		const id = requireIdentifier(rule.id, `rules[${index}].id`);
		assertCallable(rule.analyze, `rules[${index}].analyze`);
		if (local.has(id)) throw new Error(`Duplicate rule id '${id}' in plugin.`);
		if (occupied.has(id)) throw new Error(`Rule id '${id}' is already registered by another plugin.`);
		local.add(id);
		return { id, analyze: rule.analyze };
	});
}

function validateDetectorIds(detectors: readonly TaloxVisionDetector[], occupied: Set<string>): TaloxVisionDetector[] {
	const local = new Set<string>();
	return detectors.map((detector, index) => {
		if (!detector || typeof detector !== "object") throw new TypeError(`visionDetectors[${index}] must be an object.`);
		const id = requireIdentifier(detector.id, `visionDetectors[${index}].id`);
		assertCallable(detector.detect, `visionDetectors[${index}].detect`);
		if (local.has(id)) throw new Error(`Duplicate vision detector id '${id}' in plugin.`);
		if (occupied.has(id)) throw new Error(`Vision detector id '${id}' is already registered by another plugin.`);
		local.add(id);
		return { id, detect: detector.detect };
	});
}

function getOccupiedRuleIds(): Set<string> {
	return new Set([...plugins.values()].flatMap((plugin) => plugin.rules.map((rule) => rule.id)));
}

function getOccupiedDetectorIds(): Set<string> {
	return new Set([...plugins.values()].flatMap((plugin) => plugin.visionDetectors.map((detector) => detector.id)));
}

function isVisualDetection(value: unknown): value is TaloxVisualDetection {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.type !== "string" || candidate.type.trim().length === 0) return false;
	if (typeof candidate.description !== "string" || candidate.description.trim().length === 0) return false;
	if (
		candidate.confidence !== undefined &&
		(typeof candidate.confidence !== "number" || !Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1)
	) {
		return false;
	}
	return candidate.evidence === undefined || (candidate.evidence !== null && typeof candidate.evidence === "object");
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Register a plugin for the current Node.js process.
 *
 * Registration is transactional: duplicate names/IDs or invalid hooks reject
 * the whole plugin without changing the registry.
 */
export function registerTaloxPlugin(plugin: TaloxPlugin): TaloxPluginInfo {
	if (!plugin || typeof plugin !== "object") throw new TypeError("plugin must be an object.");

	const name = requireText(plugin.name, "plugin.name");
	const version = requireText(plugin.version, "plugin.version");
	if (plugins.has(name)) throw new Error(`Talox plugin '${name}' is already registered.`);

	const rules = validateRuleIds(plugin.rules ?? [], getOccupiedRuleIds());
	const visionDetectors = validateDetectorIds(plugin.visionDetectors ?? [], getOccupiedDetectorIds());
	const registered: RegisteredPlugin = { name, version, rules, visionDetectors };
	plugins.set(name, registered);
	logger.debug(`Registered ${name}@${version} (${rules.length} rules, ${visionDetectors.length} vision detectors).`);
	return toPluginInfo(registered);
}

/** Remove one process-wide plugin. Returns true when it existed. */
export function unregisterTaloxPlugin(name: string): boolean {
	return plugins.delete(name);
}

/** Clear all process-wide plugins. Primarily useful for tests and isolated hosts. */
export function clearTaloxPlugins(): void {
	plugins.clear();
}

/** List registered plugins in deterministic registration order. */
export function listTaloxPlugins(): TaloxPluginInfo[] {
	return [...plugins.values()].map(toPluginInfo);
}

function toPluginInfo(plugin: RegisteredPlugin): TaloxPluginInfo {
	return {
		name: plugin.name,
		version: plugin.version,
		ruleIds: plugin.rules.map((rule) => rule.id),
		visionDetectorIds: plugin.visionDetectors.map((detector) => detector.id),
	};
}

/** Return registered community rules in deterministic plugin/rule order. */
export function getTaloxPluginRules(): RegisteredTaloxRule[] {
	return [...plugins.values()].flatMap((plugin) =>
		plugin.rules.map((rule) => ({ pluginName: plugin.name, pluginVersion: plugin.version, rule })),
	);
}

/**
 * Run every registered visual detector explicitly against a screenshot.
 *
 * Each detector receives its own Buffer copy so an unsafe community detector
 * cannot mutate the bytes observed by later detectors. A detector exception or
 * malformed result becomes an error result and never aborts the remaining run.
 */
export async function runTaloxVisionDetectors(
	screenshot: Buffer,
	context: TaloxVisionContext = {},
): Promise<TaloxVisionDetectorResult[]> {
	if (!Buffer.isBuffer(screenshot)) throw new TypeError("screenshot must be a Buffer.");

	const results: TaloxVisionDetectorResult[] = [];
	for (const plugin of plugins.values()) {
		for (const detector of plugin.visionDetectors) {
			try {
				const raw = await detector.detect(Buffer.from(screenshot), { ...context });
				if (!Array.isArray(raw) || !raw.every(isVisualDetection)) {
					throw new TypeError(`Vision detector '${detector.id}' returned an invalid detection list.`);
				}
				results.push({
					pluginName: plugin.name,
					pluginVersion: plugin.version,
					detectorId: detector.id,
					detections: [...raw],
				});
			} catch (error) {
				const message = errorMessage(error);
				logger.warn(`Vision detector ${plugin.name}/${detector.id} failed: ${message}`);
				results.push({
					pluginName: plugin.name,
					pluginVersion: plugin.version,
					detectorId: detector.id,
					detections: [],
					error: message,
				});
			}
		}
	}
	return results;
}

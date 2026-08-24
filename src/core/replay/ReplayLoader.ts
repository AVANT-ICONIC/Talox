import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { TaloxInteraction, TaloxSessionReport } from "../../types/session.js";
import type {
	BugSummaryEntry,
	FailureEntry,
	InteractionDiff,
	SessionReportExtras,
} from "../../types/session-report.js";
import type { ActionFrame } from "../ArtifactBuilder.js";

export interface ReplayBundle {
	sessionDir: string;
	report: TaloxSessionReport;
	extras: SessionReportExtras;
}

async function readJsonIfExists(filePath: string): Promise<unknown | undefined> {
	try {
		const raw = await fs.readFile(filePath, "utf-8");
		return JSON.parse(raw) as unknown;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
	return value === undefined || typeof value === "string";
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
	return value === undefined || isFiniteNumber(value);
}

function isBoundingBox(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return [value.x, value.y, value.width, value.height].every(isFiniteNumber);
}

function isInteraction(value: unknown): value is TaloxInteraction {
	if (!isRecord(value)) return false;
	const types = new Set(["click", "navigation", "input", "scroll", "rightclick"]);
	if (!isFiniteNumber(value.index) || !Number.isInteger(value.index) || value.index < 0) return false;
	if (typeof value.type !== "string" || !types.has(value.type)) return false;
	if (typeof value.timestamp !== "string" || typeof value.url !== "string") return false;
	if (!Array.isArray(value.consoleErrors) || !value.consoleErrors.every((entry) => typeof entry === "string")) return false;
	if (!Array.isArray(value.networkFailures)) return false;
	if (
		!value.networkFailures.every(
			(entry) =>
				isRecord(entry) &&
				typeof entry.url === "string" &&
				isFiniteNumber(entry.status) &&
				isOptionalString(entry.type),
		)
	) {
		return false;
	}
	if (!isOptionalString(value.screenshotBefore) || !isOptionalString(value.screenshotAfter)) return false;
	if (value.element !== undefined) {
		if (!isRecord(value.element)) return false;
		if (typeof value.element.tag !== "string" || typeof value.element.selector !== "string") return false;
		if (!isOptionalString(value.element.role) || !isOptionalString(value.element.text)) return false;
		if (!isBoundingBox(value.element.boundingBox)) return false;
	}
	return true;
}

function requireReport(value: unknown, source: string): TaloxSessionReport {
	if (!isRecord(value)) throw new TypeError(`Invalid Talox session report: ${source}`);
	if (
		typeof value.id !== "string" ||
		typeof value.startedAt !== "string" ||
		typeof value.endedAt !== "string" ||
		!isFiniteNumber(value.durationMs) ||
		value.durationMs < 0 ||
		typeof value.startUrl !== "string" ||
		!Array.isArray(value.interactions) ||
		!value.interactions.every(isInteraction) ||
		!Array.isArray(value.annotations) ||
		!isRecord(value.summary)
	) {
		throw new TypeError(`Invalid Talox session report: ${source}`);
	}

	const summary = value.summary;
	if (
		![summary.totalInteractions, summary.totalAnnotations, summary.totalConsoleErrors, summary.totalNetworkFailures].every(
			isFiniteNumber,
		) ||
		!isRecord(summary.annotationsByLabel) ||
		!Object.values(summary.annotationsByLabel).every(isFiniteNumber)
	) {
		throw new TypeError(`Invalid Talox session summary: ${source}`);
	}
	return value as unknown as TaloxSessionReport;
}

function isFailure(value: unknown): value is FailureEntry {
	return (
		isRecord(value) &&
		(value.type === "console" || value.type === "network") &&
		typeof value.message === "string" &&
		isOptionalString(value.url) &&
		isOptionalFiniteNumber(value.status) &&
		isOptionalFiniteNumber(value.interactionIndex)
	);
}

function isDiff(value: unknown): value is InteractionDiff {
	return (
		isRecord(value) &&
		isFiniteNumber(value.interactionIndex) &&
		typeof value.url === "string" &&
		typeof value.urlChanged === "boolean" &&
		isOptionalString(value.element) &&
		isOptionalString(value.notes)
	);
}

function isBug(value: unknown): value is BugSummaryEntry {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.type === "string" &&
		typeof value.severity === "string" &&
		typeof value.description === "string" &&
		isOptionalFiniteNumber(value.interactionIndex) &&
		isOptionalString(value.evidence)
	);
}

function isActionFrame(value: unknown): value is ActionFrame {
	if (!isRecord(value)) return false;
	if (
		!isFiniteNumber(value.frameIndex) ||
		typeof value.timestamp !== "string" ||
		!isFiniteNumber(value.relativeTimeMs) ||
		!isOptionalFiniteNumber(value.durationMs) ||
		typeof value.type !== "string" ||
		typeof value.action !== "string" ||
		!isRecord(value.details)
	) {
		return false;
	}
	if (value.visualContext !== undefined) {
		if (!isRecord(value.visualContext)) return false;
		for (const key of ["mouseX", "mouseY", "viewportWidth", "viewportHeight", "scrollPosition"] as const) {
			if (!isOptionalFiniteNumber(value.visualContext[key])) return false;
		}
	}
	return true;
}

function requireOptionalArray<T>(
	value: unknown,
	source: string,
	validator: (entry: unknown) => entry is T,
): T[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value) || !value.every(validator)) {
		throw new TypeError(`Invalid Talox replay artifact: ${source}`);
	}
	return value;
}

/** Load a persisted observe session from either its directory or report.json. */
export async function loadReplayBundle(inputPath: string): Promise<ReplayBundle> {
	const resolved = path.resolve(inputPath);
	const stat = await fs.stat(resolved);
	const sessionDir = stat.isDirectory() ? resolved : path.dirname(resolved);
	const reportPath = stat.isDirectory() ? path.join(resolved, "report.json") : resolved;
	const report = requireReport(await readJsonIfExists(reportPath), reportPath);

	const [rawFailures, rawDiffs, rawBugs, rawTrace] = await Promise.all([
		readJsonIfExists(path.join(sessionDir, "failures.json")),
		readJsonIfExists(path.join(sessionDir, "diffs.json")),
		readJsonIfExists(path.join(sessionDir, "bugs.json")),
		readJsonIfExists(path.join(sessionDir, "trace.json")),
	]);

	const failures = requireOptionalArray(rawFailures, path.join(sessionDir, "failures.json"), isFailure);
	const diffs = requireOptionalArray(rawDiffs, path.join(sessionDir, "diffs.json"), isDiff);
	const bugs = requireOptionalArray(rawBugs, path.join(sessionDir, "bugs.json"), isBug);
	const trace = requireOptionalArray(rawTrace, path.join(sessionDir, "trace.json"), isActionFrame);

	const extras: SessionReportExtras = {};
	if (failures) extras.failures = failures;
	if (diffs) extras.diffs = diffs;
	if (bugs) extras.bugs = bugs;
	if (trace) extras.trace = trace;

	return { sessionDir, report, extras };
}

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { TaloxSessionReport } from "../../types/session.js";
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

async function readJsonIfExists<T>(filePath: string): Promise<T | undefined> {
	try {
		const raw = await fs.readFile(filePath, "utf-8");
		return JSON.parse(raw) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

function requireReport(value: unknown, source: string): TaloxSessionReport {
	if (!value || typeof value !== "object") throw new TypeError(`Invalid Talox session report: ${source}`);
	const report = value as Partial<TaloxSessionReport>;
	if (
		typeof report.id !== "string" ||
		typeof report.startedAt !== "string" ||
		typeof report.endedAt !== "string" ||
		typeof report.durationMs !== "number" ||
		typeof report.startUrl !== "string" ||
		!Array.isArray(report.interactions) ||
		!Array.isArray(report.annotations) ||
		!report.summary ||
		typeof report.summary !== "object"
	) {
		throw new TypeError(`Invalid Talox session report: ${source}`);
	}
	return report as TaloxSessionReport;
}

/** Load a persisted observe session from either its directory or report.json. */
export async function loadReplayBundle(inputPath: string): Promise<ReplayBundle> {
	const resolved = path.resolve(inputPath);
	const stat = await fs.stat(resolved);
	const sessionDir = stat.isDirectory() ? resolved : path.dirname(resolved);
	const reportPath = stat.isDirectory() ? path.join(resolved, "report.json") : resolved;
	const report = requireReport(await readJsonIfExists<unknown>(reportPath), reportPath);

	const [failures, diffs, bugs, trace] = await Promise.all([
		readJsonIfExists<FailureEntry[]>(path.join(sessionDir, "failures.json")),
		readJsonIfExists<InteractionDiff[]>(path.join(sessionDir, "diffs.json")),
		readJsonIfExists<BugSummaryEntry[]>(path.join(sessionDir, "bugs.json")),
		readJsonIfExists<ActionFrame[]>(path.join(sessionDir, "trace.json")),
	]);

	const extras: SessionReportExtras = {};
	if (failures) extras.failures = failures;
	if (diffs) extras.diffs = diffs;
	if (bugs) extras.bugs = bugs;
	if (trace) extras.trace = trace;

	return { sessionDir, report, extras };
}

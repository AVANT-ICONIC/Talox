/**
 * @file SessionReporter.ts
 * @description Generates JSON and Markdown session reports for observe mode.
 *
 * Reports are written to `talox-sessions/` (configurable) with filenames in
 * the format `session-{id}-{timestamp}.json` / `.md`.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { AnnotationEntry } from "../../types/annotation.js";
import { getLabelEmoji } from "../../types/annotation.js";
import type { SessionOutputFormat, TaloxInteraction, TaloxSessionReport } from "../../types/session.js";
import type {
	BugSummaryEntry,
	EventLogEntry,
	FailureEntry,
	InteractionDiff,
	ScreenshotDescriptor,
	SessionReportExtras,
} from "../../types/session-report.js";

// ─── Output Paths ─────────────────────────────────────────────────────────────

export interface ReportPaths {
	json?: string | undefined;
	markdown?: string | undefined;
	html?: string | undefined;
	timeline?: string | undefined;
	eventLog?: string | undefined;
	failures?: string | undefined;
	annotations?: string | undefined;
	diffs?: string | undefined;
	bugs?: string | undefined;
	trace?: string | undefined;
	screenshotsDir?: string | undefined;
}

// ─── SessionReporter ─────────────────────────────────────────────────────────

/**
 * Writes a completed `TaloxSessionReport` to disk in the requested formats.
 *
 * Output directory is created automatically if it doesn't exist.
 */
export class SessionReporter {
	private readonly outputDir: string;

	constructor(outputDir: string = path.join(process.cwd(), "talox-sessions")) {
		this.outputDir = outputDir;
	}

	// ─── Public API ──────────────────────────────────────────────────────────────

	/**
	 * Write the session report to disk.
	 *
	 * @param report  - The completed session report.
	 * @param format  - Which file(s) to generate (`'json'`, `'markdown'`, or `'both'`).
	 * @returns       - Absolute paths to the written files.
	 */
	async write(
		report: TaloxSessionReport,
		format: SessionOutputFormat = "both",
		extras: SessionReportExtras = {},
	): Promise<ReportPaths> {
		await fs.mkdir(this.outputDir, { recursive: true });

		const timestamp = new Date(report.startedAt).toISOString().replaceAll(/[:.]/g, "-").slice(0, 19);

		const baseName = `session-${report.id}-${timestamp}`;
		const sessionDir = path.join(this.outputDir, baseName);
		await fs.mkdir(sessionDir, { recursive: true });

		const screenshotDescriptors = await this.persistScreenshots(sessionDir, report.interactions);
		const mergedExtras = this.mergeExtras(extras, screenshotDescriptors);

		const paths: ReportPaths = {
			screenshotsDir: path.join(sessionDir, "screenshots"),
		};

		const jsonPath = path.join(sessionDir, "report.json");
		await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf-8");
		paths.json = jsonPath;

		if (format === "markdown" || format === "both") {
			const mdPath = path.join(sessionDir, "report.md");
			await fs.writeFile(mdPath, this.toMarkdown(report, mergedExtras), "utf-8");
			paths.markdown = mdPath;
		}

		const htmlPath = path.join(sessionDir, "report.html");
		await fs.writeFile(htmlPath, this.toHTML(report, mergedExtras), "utf-8");
		paths.html = htmlPath;

		const timelinePath = path.join(sessionDir, "timeline.json");
		await fs.writeFile(timelinePath, JSON.stringify(report.interactions, null, 2), "utf-8");
		paths.timeline = timelinePath;

		const annotationPath = path.join(sessionDir, "annotations.json");
		await fs.writeFile(annotationPath, JSON.stringify(report.annotations, null, 2), "utf-8");
		paths.annotations = annotationPath;

		paths.eventLog = await this.writeJsonIfPresent(sessionDir, "event-log.json", mergedExtras.eventLog);
		paths.failures = await this.writeJsonIfPresent(sessionDir, "failures.json", mergedExtras.failures);
		paths.diffs = await this.writeJsonIfPresent(sessionDir, "diffs.json", mergedExtras.diffs);
		paths.bugs = await this.writeJsonIfPresent(sessionDir, "bugs.json", mergedExtras.bugs);
		paths.trace = await this.writeJsonIfPresent(sessionDir, "trace.json", mergedExtras.trace);

		console.info(`[Talox] Session report written to: ${sessionDir}`);
		return paths;
	}

	private mergeExtras(extras: SessionReportExtras, screenshots: ScreenshotDescriptor[]): SessionReportExtras {
		const merged: SessionReportExtras = { ...extras };
		const combined = [...(extras.screenshots ?? []), ...screenshots];
		if (combined.length > 0) {
			merged.screenshots = combined;
		}
		return merged;
	}

	private async persistScreenshots(
		sessionDir: string,
		interactions: TaloxInteraction[],
	): Promise<ScreenshotDescriptor[]> {
		const screenshotDir = path.join(sessionDir, "screenshots");
		await fs.mkdir(screenshotDir, { recursive: true });
		const descriptors: ScreenshotDescriptor[] = [];

		for (const interaction of interactions) {
			for (const when of ["before", "after"] as const) {
				const captured = when === "before" ? interaction.screenshotBefore : interaction.screenshotAfter;
				if (typeof captured !== "string" || !this.isBase64(captured)) continue;
				const fileName = `interaction-${interaction.index}-${when}.png`;
				const fullPath = path.join(screenshotDir, fileName);
				await fs.writeFile(fullPath, Buffer.from(captured, "base64"));
				const relativePath = path.join("screenshots", fileName);
				if (when === "before") {
					interaction.screenshotBefore = relativePath;
				} else {
					interaction.screenshotAfter = relativePath;
				}
				descriptors.push({
					interactionIndex: interaction.index,
					when,
					path: relativePath,
				});
			}
		}

		return descriptors;
	}

	private async writeJsonIfPresent(sessionDir: string, fileName: string, payload?: any): Promise<string | undefined> {
		if (!payload || (Array.isArray(payload) && payload.length === 0)) {
			return undefined;
		}
		const target = path.join(sessionDir, fileName);
		await fs.writeFile(target, JSON.stringify(payload, null, 2), "utf-8");
		return target;
	}

	private isBase64(value: string): boolean {
		if (!value) return false;
		const normalized = value.trim().replaceAll(/\\s+/g, "");
		return /^[A-Za-z0-9+/=]+$/.test(normalized) && normalized.length % 4 === 0;
	}

	// ─── Markdown Generation ─────────────────────────────────────────────────────

	/**
	 * Renders a `TaloxSessionReport` as Markdown.
	 * Designed to be pasted directly into agent chat or a PR comment.
	 */
	toMarkdown(report: TaloxSessionReport, extras: SessionReportExtras = {}): string {
		const sections: string[] = [];
		sections.push(
			...this.renderMarkdownHeader(report),
			...this.renderMarkdownSummary(report),
			...this.renderMarkdownTimeline(report),
			...this.renderMarkdownEventLog(extras.eventLog),
			...this.renderMarkdownFailures(extras.failures),
			...this.renderMarkdownDiffs(extras.diffs),
			...this.renderMarkdownBugs(extras.bugs),
			...this.renderMarkdownAnnotationsTable(report.annotations),
			...this.renderMarkdownErrorsAndFailures(report.interactions),
			...this.renderMarkdownTrace(extras.trace),
			`*Generated by Talox observe mode · ${new Date().toISOString()}*`,
		);
		return sections.join("\n");
	}

	private renderMarkdownHeader(report: TaloxSessionReport): string[] {
		const duration = this.formatDuration(report.durationMs);
		return [
			`# Talox Session Report · \`${report.id}\``,
			"",
			`**Started** ${report.startedAt}  ·  **Duration** ${duration}  ·  **URL** ${report.startUrl}`,
			"",
			"---",
		];
	}

	private renderMarkdownSummary(report: TaloxSessionReport): string[] {
		const lines: string[] = ["", "## Summary", ""];
		lines.push(
			"| Interactions | Annotations | Console Errors | Network Failures |",
			"|---|---|---|---|---|",
			`| ${report.summary.totalInteractions} ` +
				`| ${report.summary.totalAnnotations} ` +
				`| ${report.summary.totalConsoleErrors} ` +
				`| ${report.summary.totalNetworkFailures} |`,
		);

		const labelEntries = Object.entries(report.summary.annotationsByLabel);
		if (labelEntries.length > 0) {
			lines.push("", "**Annotations by label:**");
			for (const [label, count] of labelEntries) {
				lines.push(`- ${getLabelEmoji(label)} **${label}**: ${count}`);
			}
		}

		lines.push("", "---");
		return lines;
	}

	private renderMarkdownTimeline(report: TaloxSessionReport): string[] {
		const lines: string[] = ["", "## Timeline", ""];
		for (const interaction of report.interactions) {
			lines.push(this.renderInteraction(interaction, report.annotations));
		}
		return lines;
	}

	private renderMarkdownEventLog(eventLog?: EventLogEntry[]): string[] {
		if (!eventLog?.length) return [];
		const lines: string[] = ["", "---", "", "## Event Log", ""];
		for (const entry of eventLog) {
			const payload = entry.payload ? ` — ${JSON.stringify(entry.payload)}` : "";
			lines.push(`- **${entry.event}** @ ${entry.timestamp}${payload}`);
		}
		return lines;
	}

	private renderMarkdownFailures(failures?: FailureEntry[]): string[] {
		if (!failures?.length) return [];
		const lines: string[] = ["", "---", "", "## Failure Highlights", ""];
		for (const failure of failures) {
			const ctx = failure.interactionIndex ? ` (interaction ${failure.interactionIndex})` : "";
			const urlInfo = failure.url ? ` at ${failure.url}` : "";
			const status = typeof failure.status === "number" ? ` [${failure.status}]` : "";
			lines.push(`- \`${failure.type}\`${ctx}${urlInfo}${status} — ${failure.message}`);
		}
		return lines;
	}

	private renderMarkdownDiffs(diffs?: InteractionDiff[]): string[] {
		if (!diffs?.length) return [];
		const lines: string[] = ["", "---", "", "## Interaction Diffs", ""];
		for (const diff of diffs) {
			const note = diff.notes ? ` — ${diff.notes}` : "";
			const element = diff.element ? ` element: ${diff.element}` : "";
			lines.push(`- Interaction ${diff.interactionIndex}: ${diff.url} (changed: ${diff.urlChanged})${element}${note}`);
		}
		return lines;
	}

	private renderMarkdownBugs(bugs?: BugSummaryEntry[]): string[] {
		if (!bugs?.length) return [];
		const lines: string[] = ["", "---", "", "## Bug Summaries", ""];
		for (const bug of bugs) {
			const ctx = bug.interactionIndex ? ` (interaction ${bug.interactionIndex})` : "";
			lines.push(`- [${bug.severity}] ${bug.type}${ctx}: ${bug.description}`);
		}
		return lines;
	}

	private renderMarkdownAnnotationsTable(annotations: AnnotationEntry[]): string[] {
		if (annotations.length === 0) return [];
		const lines: string[] = ["", "---", "", "## Annotations", ""];
		lines.push("| # | Labels | Element | Comment |", "|---|--------|---------|---------|");
		for (const annotation of annotations) {
			const labels = annotation.labels.map((l) => `${getLabelEmoji(l)} ${l}`).join(", ");
			const element = `\`<${annotation.element.tag}>\` ${annotation.element.text ? `"${annotation.element.text}"` : ""}`;
			const comment = annotation.comment.replaceAll("|", "\\|");
			lines.push(`| ${annotation.interactionIndex} | ${labels} | ${element} | ${comment} |`);
		}
		return lines;
	}

	private renderMarkdownErrorsAndFailures(interactions: TaloxInteraction[]): string[] {
		const allErrors = interactions.flatMap((i) => i.consoleErrors);
		const allFailures = interactions.flatMap((i) => i.networkFailures);
		if (allErrors.length === 0 && allFailures.length === 0) return [];

		const lines: string[] = ["", "---", "", "## Errors & Failures"];
		if (allErrors.length > 0) {
			lines.push("", "**Console Errors:**");
			for (const error of [...new Set(allErrors)]) {
				lines.push(`- \`${error}\``);
			}
		}
		if (allFailures.length > 0) {
			lines.push("", "**Network Failures:**");
			for (const failure of allFailures) {
				lines.push(`- \`${failure.status}\` ${failure.url}`);
			}
		}
		return lines;
	}

	private renderMarkdownTrace(trace: SessionReportExtras["trace"]): string[] {
		const lines: string[] = ["", "---", ""];
		const frames = trace ?? [];
		if (frames.length === 0) return lines;

		lines.push("## Action Trace", "", "| Frame | Type | Action | Detail |", "|---|---|---|---|");
		for (let i = 0; i < Math.min(frames.length, 10); i += 1) {
			const frame = frames[i]!;
			const detail = JSON.stringify(frame.details);
			lines.push(`| ${i} | ${frame.type} | ${frame.action} | ${detail} |`);
		}
		lines.push("", `_Trace captured · ${frames.length} frames · first 10 shown._`, "", "---", "");
		return lines;
	}

	toHTML(report: TaloxSessionReport, extras: SessionReportExtras = {}): string {
		const summaryRows = `
      <tr><td>Interactions</td><td>${report.summary.totalInteractions}</td></tr>
      <tr><td>Annotations</td><td>${report.summary.totalAnnotations}</td></tr>
      <tr><td>Console Errors</td><td>${report.summary.totalConsoleErrors}</td></tr>
      <tr><td>Network Failures</td><td>${report.summary.totalNetworkFailures}</td></tr>
    `;

		const timelineItems = report.interactions
			.map((i) => `<li>${this.renderInteractionHtml(i, report.annotations)}</li>`)
			.join("");

		const eventLogHtml =
			extras.eventLog
				?.map(
					(entry) =>
						`<tr><td>${this.escapeHtml(entry.event)}</td><td>${this.escapeHtml(entry.timestamp)}</td><td>${this.escapeHtml(JSON.stringify(entry.payload ?? {}))}</td></tr>`,
				)
				.join("") ?? "";
		const failuresHtml =
			extras.failures
				?.map((failure) => `<li>${this.escapeHtml(failure.message)} (${this.escapeHtml(failure.type)})</li>`)
				.join("") ?? "";
		const diffsHtml =
			extras.diffs?.map((diff) => `<li>${this.escapeHtml(diff.url)} changed: ${diff.urlChanged}</li>`).join("") ?? "";
		const bugsHtml =
			extras.bugs
				?.map(
					(bug) =>
						`<li>[${this.escapeHtml(bug.severity)}] ${this.escapeHtml(bug.type)}: ${this.escapeHtml(bug.description)}</li>`,
				)
				.join("") ?? "";
		const traceFrames = extras.trace ?? [];
		const traceHtml = traceFrames
			.slice(0, 10)
			.map(
				(frame, index) =>
					`<tr><td>${index}</td><td>${this.escapeHtml(frame.type)}</td><td>${this.escapeHtml(frame.action)}</td><td>${this.escapeHtml(JSON.stringify(frame.details ?? {}))}</td></tr>`,
			)
			.join("");

		return `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Talox Session ${report.id}</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #111; color: #f5f5f5; padding: 24px; }
            h1, h2 { color: #9f7aea; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
            td, th { border: 1px solid #2c2c2c; padding: 8px; }
            ul { padding-left: 20px; }
            section { margin-bottom: 24px; }
            .timestamp { font-family: monospace; color: #a3e635; }
          </style>
        </head>
        <body>
          <header>
            <h1>Talox Session Report · ${this.escapeHtml(report.id)}</h1>
            <p>Started ${this.escapeHtml(report.startedAt)} · Duration ${this.escapeHtml(this.formatDuration(report.durationMs))} · URL ${this.escapeHtml(report.startUrl)}</p>
          </header>

          <section>
            <h2>Summary</h2>
            <table>${summaryRows}</table>
          </section>

          <section>
            <h2>Timeline</h2>
            <ul>${timelineItems}</ul>
          </section>

          ${eventLogHtml ? `<section><h2>Event Log</h2><table><tr><th>Event</th><th>Timestamp</th><th>Payload</th></tr>${eventLogHtml}</table></section>` : ""}
          ${failuresHtml ? `<section><h2>Failures</h2><ul>${failuresHtml}</ul></section>` : ""}
          ${diffsHtml ? `<section><h2>Diffs</h2><ul>${diffsHtml}</ul></section>` : ""}
          ${bugsHtml ? `<section><h2>Bug Summaries</h2><ul>${bugsHtml}</ul></section>` : ""}
          ${traceHtml ? `<section><h2>Action Trace</h2><table><tr><th>#</th><th>Type</th><th>Action</th><th>Details</th></tr>${traceHtml}</table><p>Showing ${Math.min(traceFrames.length, 10)} of ${traceFrames.length} frames.</p></section>` : ""}

          <section>
            <h2>Notes</h2>
            <p>Generated by Talox observe mode on ${new Date().toISOString()}.</p>
          </section>
        </body>
    </html>
  `.trim();
	}

	private renderInteractionHtml(interaction: TaloxInteraction, annotations: AnnotationEntry[]): string {
		const time = new Date(interaction.timestamp).toLocaleTimeString();
		const element = interaction.element
			? `<strong>${this.escapeHtml(interaction.element.tag)}</strong> ${this.escapeHtml(interaction.element.text ?? "")}`
			: this.capitalise(interaction.type);
		const errorBadge = interaction.consoleErrors.length ? " ⚠️ console errors recorded" : "";
		const screenshotLinks = [interaction.screenshotBefore, interaction.screenshotAfter]
			.filter(Boolean)
			.map((path) => `<a href="${this.escapeHtml(path!)}">${this.escapeHtml(path!)}</a>`)
			.join(", ");
		const annotationNotes = annotations
			.filter((a) => a.interactionIndex === interaction.index)
			.map((a) => `${a.labels.map((l) => this.escapeHtml(l)).join(", ")}: ${this.escapeHtml(a.comment)}`)
			.join("; ");
		return `
      <div>
        <span class="timestamp">${this.escapeHtml(time)}</span> — ${element}${errorBadge ? `<span> ${errorBadge}</span>` : ""}
        ${screenshotLinks ? `<div>Screenshots: ${screenshotLinks}</div>` : ""}
        ${annotationNotes ? `<div class="annotation-note">${annotationNotes}</div>` : ""}
      </div>
    `;
	}

	private escapeHtml(value: string | undefined): string {
		if (!value) return "";
		return value
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#39;");
	}

	// ─── Private Helpers ─────────────────────────────────────────────────────────

	private renderInteraction(interaction: TaloxInteraction, annotations: AnnotationEntry[]): string {
		const time = new Date(interaction.timestamp).toLocaleTimeString();
		const hasErrors = interaction.consoleErrors.length > 0;
		const errorBadge = hasErrors ? " ⚠️ _console error_" : "";

		let line: string;

		if (interaction.type === "navigation") {
			line = `${interaction.index}. **${time}** — Navigated to \`${interaction.url}\`${errorBadge}`;
		} else {
			const el = interaction.element;
			const elText = el
				? `\`<${el.tag}>\` ${el.text ? `"${el.text}"` : `[${el.role ?? el.tag}]`}`
				: `_(${interaction.type})_`;
			line = `${interaction.index}. **${time}** — ${this.capitalise(interaction.type)} ${elText}${errorBadge}`;
		}

		// Attach annotations that belong to this interaction
		const relatedAnnotations = annotations.filter((a) => a.interactionIndex === interaction.index);

		if (relatedAnnotations.length === 0) return line;

		const annotationLines = relatedAnnotations.map((a) => {
			const labels = a.labels.map((l) => `${getLabelEmoji(l)} **${l}**`).join(", ");
			return `   > ${labels} — "${a.comment}"`;
		});

		return [line, ...annotationLines].join("\n");
	}

	private formatDuration(ms: number): string {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
	}

	private capitalise(str: string): string {
		if (!str) return "";
		return str.charAt(0).toUpperCase() + str.slice(1);
	}
}

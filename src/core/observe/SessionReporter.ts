/**
 * @file SessionReporter.ts
 * @description Generates JSON and Markdown session reports for observe mode.
 *
 * Reports are written to `talox-sessions/` (configurable) with filenames in
 * the format `session-{id}-{timestamp}.json` / `.md`.
 */

import { promises as fs } from 'fs';
import path               from 'path';
import type {
  TaloxSessionReport,
  SessionOutputFormat,
  TaloxInteraction,
} from '../../types/session.js';
import type { AnnotationEntry } from '../../types/annotation.js';
import { getLabelEmoji }        from '../../types/annotation.js';

// ─── Output Paths ─────────────────────────────────────────────────────────────

export interface ReportPaths {
  json?:     string;
  markdown?: string;
}

// ─── SessionReporter ─────────────────────────────────────────────────────────

/**
 * Writes a completed `TaloxSessionReport` to disk in the requested formats.
 *
 * Output directory is created automatically if it doesn't exist.
 */
export class SessionReporter {
  private readonly outputDir: string;

  constructor(outputDir: string = path.join(process.cwd(), 'talox-sessions')) {
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
    format: SessionOutputFormat = 'both',
  ): Promise<ReportPaths> {
    await fs.mkdir(this.outputDir, { recursive: true });

    const timestamp = new Date(report.startedAt)
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);

    const baseName = `session-${report.id}-${timestamp}`;
    const paths: ReportPaths = {};

    if (format === 'json' || format === 'both') {
      const jsonPath = path.join(this.outputDir, `${baseName}.json`);
      await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf-8');
      paths.json = jsonPath;
    }

    if (format === 'markdown' || format === 'both') {
      const mdPath = path.join(this.outputDir, `${baseName}.md`);
      await fs.writeFile(mdPath, this.toMarkdown(report), 'utf-8');
      paths.markdown = mdPath;
    }

    console.info(`[Talox] Session report written to: ${this.outputDir}`);
    return paths;
  }

  // ─── Markdown Generation ─────────────────────────────────────────────────────

  /**
   * Renders a `TaloxSessionReport` as Markdown.
   * Designed to be pasted directly into agent chat or a PR comment.
   */
  toMarkdown(report: TaloxSessionReport): string {
    const duration = this.formatDuration(report.durationMs);
    const sections: string[] = [];

    // ── Header ────────────────────────────────────────────────────────────────
    sections.push(`# Talox Session Report · \`${report.id}\``);
    sections.push('');
    sections.push(
      `**Started** ${report.startedAt}  ·  ` +
      `**Duration** ${duration}  ·  ` +
      `**URL** ${report.startUrl}`,
    );
    sections.push('');
    sections.push('---');

    // ── Summary ───────────────────────────────────────────────────────────────
    sections.push('');
    sections.push('## Summary');
    sections.push('');
    sections.push(
      '| Interactions | Annotations | Console Errors | Network Failures |',
    );
    sections.push('|---|---|---|---|');
    sections.push(
      `| ${report.summary.totalInteractions} ` +
      `| ${report.summary.totalAnnotations} ` +
      `| ${report.summary.totalConsoleErrors} ` +
      `| ${report.summary.totalNetworkFailures} |`,
    );

    if (Object.keys(report.summary.annotationsByLabel).length > 0) {
      sections.push('');
      sections.push('**Annotations by label:**');
      for (const [label, count] of Object.entries(report.summary.annotationsByLabel)) {
        sections.push(`- ${getLabelEmoji(label)} **${label}**: ${count}`);
      }
    }

    sections.push('');
    sections.push('---');

    // ── Timeline ──────────────────────────────────────────────────────────────
    sections.push('');
    sections.push('## Timeline');
    sections.push('');

    for (const interaction of report.interactions) {
      sections.push(this.renderInteraction(interaction, report.annotations));
    }

    // ── Annotations Table ─────────────────────────────────────────────────────
    if (report.annotations.length > 0) {
      sections.push('');
      sections.push('---');
      sections.push('');
      sections.push('## Annotations');
      sections.push('');
      sections.push('| # | Labels | Element | Comment |');
      sections.push('|---|--------|---------|---------|');

      for (const annotation of report.annotations) {
        const labels = annotation.labels
          .map(l => `${getLabelEmoji(l)} ${l}`)
          .join(', ');
        const element = `\`<${annotation.element.tag}>\` ${annotation.element.text ? `"${annotation.element.text}"` : ''}`;
        const comment = annotation.comment.replace(/\|/g, '\\|');
        sections.push(`| ${annotation.interactionIndex} | ${labels} | ${element} | ${comment} |`);
      }
    }

    // ── Errors ────────────────────────────────────────────────────────────────
    const allErrors = report.interactions.flatMap(i => i.consoleErrors);
    const allFailures = report.interactions.flatMap(i => i.networkFailures);

    if (allErrors.length > 0 || allFailures.length > 0) {
      sections.push('');
      sections.push('---');
      sections.push('');
      sections.push('## Errors & Failures');

      if (allErrors.length > 0) {
        sections.push('');
        sections.push('**Console Errors:**');
        for (const error of [...new Set(allErrors)]) {
          sections.push(`- \`${error}\``);
        }
      }

      if (allFailures.length > 0) {
        sections.push('');
        sections.push('**Network Failures:**');
        for (const failure of allFailures) {
          sections.push(`- \`${failure.status}\` ${failure.url}`);
        }
      }
    }

    sections.push('');
    sections.push('---');
    sections.push('');
    sections.push(`*Generated by Talox observe mode · ${new Date().toISOString()}*`);

    return sections.join('\n');
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────────

  private renderInteraction(
    interaction: TaloxInteraction,
    annotations: AnnotationEntry[],
  ): string {
    const time = new Date(interaction.timestamp).toLocaleTimeString();
    const hasErrors = interaction.consoleErrors.length > 0;
    const errorBadge = hasErrors ? ' ⚠️ _console error_' : '';

    let line: string;

    if (interaction.type === 'navigation') {
      line = `${interaction.index}. **${time}** — Navigated to \`${interaction.url}\`${errorBadge}`;
    } else {
      const el = interaction.element;
      const elText = el
        ? `\`<${el.tag}>\` ${el.text ? `"${el.text}"` : `[${el.role ?? el.tag}]`}`
        : `_(${interaction.type})_`;
      line = `${interaction.index}. **${time}** — ${this.capitalise(interaction.type)} ${elText}${errorBadge}`;
    }

    // Attach annotations that belong to this interaction
    const relatedAnnotations = annotations.filter(
      a => a.interactionIndex === interaction.index,
    );

    if (relatedAnnotations.length === 0) return line;

    const annotationLines = relatedAnnotations.map(a => {
      const labels = a.labels.map(l => `${getLabelEmoji(l)} **${l}**`).join(', ');
      return `   > ${labels} — "${a.comment}"`;
    });

    return [line, ...annotationLines].join('\n');
  }

  private formatDuration(ms: number): string {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes      = Math.floor(totalSeconds / 60);
    const seconds      = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  private capitalise(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

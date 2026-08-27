import { beforeEach, describe, expect, it, vi } from "vitest";

const writtenFiles = new Map<string, string>();

vi.mock("node:fs", () => ({
	promises: {
		mkdir: vi.fn(async () => {}),
		writeFile: vi.fn(async (filePath: string, content: string | Buffer) => {
			writtenFiles.set(filePath, typeof content === "string" ? content : content.toString("utf-8"));
		}),
	},
}));

import { SessionReporter } from "../../src/core/observe/SessionReporter.js";
import type { TaloxSessionReport } from "../../src/types/session.js";
import type { SessionReportExtras } from "../../src/types/session-report.js";

const secrets = {
	userInfo: "url-password-secret",
	queryToken: "query-token-secret",
	oauthCode: "oauth-code-secret",
	consoleAuth: "console-bearer-secret",
	annotationKey: "annotation-api-key-secret",
	eventToken: "event-access-token-secret",
	failurePassword: "failure-password-secret",
	diffBearer: "diff-bearer-secret",
	bugToken: "bug-token-secret",
	tracePassword: "trace-password-secret",
};

function credentialUrl(): string {
	return `https://api-user:${secrets.userInfo}@example.com/callback?token=${secrets.queryToken}&code=${secrets.oauthCode}&mode=debug`;
}

function makeReport(): TaloxSessionReport {
	return {
		id: "credential-session",
		startedAt: "2026-08-27T00:00:00.000Z",
		endedAt: "2026-08-27T00:01:00.000Z",
		durationMs: 60_000,
		startUrl: credentialUrl(),
		interactions: [
			{
				index: 1,
				type: "navigation",
				timestamp: "2026-08-27T00:00:01.000Z",
				url: credentialUrl(),
				consoleErrors: [`Authorization: Bearer ${secrets.consoleAuth}`],
				networkFailures: [{ url: credentialUrl(), status: 401 }],
			},
		],
		annotations: [
			{
				id: "annotation-1",
				interactionIndex: 1,
				timestamp: "2026-08-27T00:00:02.000Z",
				labels: ["note"],
				comment: `api_key=${secrets.annotationKey}`,
				element: {
					tag: "body",
					selector: "body",
					boundingBox: { x: 0, y: 0, width: 100, height: 100 },
				},
			},
		],
		summary: {
			totalInteractions: 1,
			totalAnnotations: 1,
			totalConsoleErrors: 1,
			totalNetworkFailures: 1,
			annotationsByLabel: { note: 1 },
		},
	};
}

function makeExtras(): SessionReportExtras {
	return {
		eventLog: [
			{
				event: "auth",
				timestamp: "2026-08-27T00:00:03.000Z",
				payload: { access_token: secrets.eventToken, callback: credentialUrl() },
			},
		],
		failures: [
			{
				type: "network",
				message: `password=${secrets.failurePassword}`,
				url: credentialUrl(),
				status: 401,
			},
		],
		diffs: [
			{
				interactionIndex: 1,
				url: credentialUrl(),
				urlChanged: true,
				notes: `Bearer ${secrets.diffBearer}`,
			},
		],
		bugs: [
			{
				id: "bug-1",
				type: "security",
				severity: "high",
				description: `token=${secrets.bugToken}`,
			},
		],
		trace: [
			{
				frameIndex: 0,
				timestamp: "2026-08-27T00:00:04.000Z",
				relativeTimeMs: 0,
				type: "action",
				action: "submit",
				details: { password: secrets.tracePassword, redirectUrl: credentialUrl() },
			},
		],
	} as SessionReportExtras;
}

function expectNoSecrets(text: string): void {
	for (const secret of Object.values(secrets)) expect(text).not.toContain(secret);
}

describe("SessionReporter credential persistence safety", () => {
	beforeEach(() => writtenFiles.clear());

	it("keeps credentials out of every persisted text artifact", async () => {
		const reporter = new SessionReporter("/tmp/talox-safe-session");
		const paths = await reporter.write(makeReport(), "both", makeExtras());

		for (const artifactPath of Object.values(paths)) {
			if (!artifactPath || artifactPath.endsWith("screenshots")) continue;
			const content = writtenFiles.get(artifactPath);
			if (content === undefined) continue;
			expectNoSecrets(content);
		}

		const reportJson = writtenFiles.get(paths.json!)!;
		expect(reportJson).toContain("REDACTED");
		expect(reportJson).toContain("mode=debug");
	});

	it("sanitizes direct Markdown and HTML rendering too", () => {
		const reporter = new SessionReporter("/tmp/talox-safe-session");
		const report = makeReport();
		const extras = makeExtras();

		const markdown = reporter.toMarkdown(report, extras);
		const html = reporter.toHTML(report, extras);

		expectNoSecrets(markdown);
		expectNoSecrets(html);
		expect(markdown).toContain("REDACTED");
		expect(html).toContain("REDACTED");
	});
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareRelease } from "../../scripts/prepare-release.mjs";

const pkg = (version = "9.0.0") => JSON.stringify({ name: "talox", version });
const changelog = `# Changelog

## [Unreleased]

---

## [9.0.0] - 2026-08-25

### Added

- Major runtime release.

### Changed

- Node.js 20+.

---

## [8.1.0] - 2026-08-21

- Previous release.
`;

describe("prepareRelease", () => {
	it("accepts a matching semantic tag and extracts only that release section", () => {
		const release = prepareRelease("v9.0.0", pkg(), changelog);

		expect(release.version).toBe("9.0.0");
		expect(release.notes).toContain("Major runtime release.");
		expect(release.notes).toContain("Node.js 20+.");
		expect(release.notes).not.toContain("Previous release.");
		expect(release.notes).not.toContain("---");
	});

	it("rejects tags without the required v prefix", () => {
		expect(() => prepareRelease("9.0.0", pkg(), changelog)).toThrow(/v-prefixed semantic version/);
	});

	it("rejects malformed semantic versions", () => {
		expect(() => prepareRelease("v9", pkg(), changelog)).toThrow(/v-prefixed semantic version/);
	});

	it("rejects a tag that disagrees with package.json", () => {
		expect(() => prepareRelease("v9.0.0", pkg("9.0.1"), changelog)).toThrow(/does not match package\.json version 9\.0\.1/);
	});

	it("rejects a release missing from the changelog", () => {
		expect(() => prepareRelease("v9.0.0", pkg(), changelog.replace("## [9.0.0]", "## [9.0.1]"))).toThrow(
			/CHANGELOG\.md does not contain '## \[9\.0\.0\]'/,
		);
	});

	it("rejects an empty release section", () => {
		const emptyChangelog = `# Changelog\n\n## [9.0.0]\n\n---\n\n## [8.1.0]\nold`;
		expect(() => prepareRelease("v9.0.0", pkg(), emptyChangelog)).toThrow(/section for 9\.0\.0 is empty/);
	});

	it("accepts prerelease tags when package metadata and changelog match", () => {
		const prereleaseChangelog = `# Changelog\n\n## [9.1.0-rc.1]\n\n- Release candidate.\n`;
		const release = prepareRelease("v9.1.0-rc.1", pkg("9.1.0-rc.1"), prereleaseChangelog);
		expect(release.notes).toBe("- Release candidate.");
	});

	it("validates the repository's current package version against its real changelog", () => {
		const packageJsonText = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
		const changelogText = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
		const packageVersion = JSON.parse(packageJsonText).version as string;
		const release = prepareRelease(`v${packageVersion}`, packageJsonText, changelogText);

		expect(release.version).toBe(packageVersion);
		expect(release.notes.length).toBeGreaterThan(100);
		expect(release.notes).toContain("Node.js runtime baseline");
	});
});

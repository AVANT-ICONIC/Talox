#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export function prepareRelease(tag, packageJsonText, changelogText) {
	if (!TAG_PATTERN.test(tag)) {
		throw new Error(`Release tag must be a v-prefixed semantic version; received '${tag}'`);
	}

	let packageJson;
	try {
		packageJson = JSON.parse(packageJsonText);
	} catch (error) {
		throw new Error(`package.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}

	const version = tag.slice(1);
	if (packageJson.version !== version) {
		throw new Error(`Release tag ${tag} does not match package.json version ${String(packageJson.version)}`);
	}

	const marker = `## [${version}]`;
	const markerIndex = changelogText.indexOf(marker);
	if (markerIndex < 0) {
		throw new Error(`CHANGELOG.md does not contain '${marker}'`);
	}

	const afterMarker = changelogText.slice(markerIndex + marker.length);
	const nextVersionIndex = afterMarker.search(/\n## \[/);
	let notes = (nextVersionIndex >= 0 ? afterMarker.slice(0, nextVersionIndex) : afterMarker).trim();
	notes = notes.replace(/(?:^|\n)---\s*$/, "").trim();

	if (!notes) {
		throw new Error(`CHANGELOG.md section for ${version} is empty`);
	}

	return { tag, version, notes };
}

export function writeReleaseNotes(tag, outputPath = "release-notes.md") {
	const packageJsonText = readFileSync("package.json", "utf8");
	const changelogText = readFileSync("CHANGELOG.md", "utf8");
	const release = prepareRelease(tag, packageJsonText, changelogText);
	writeFileSync(outputPath, `${release.notes}\n`, "utf8");
	return release;
}

function main() {
	const tag = process.argv[2];
	const outputPath = process.argv[3] ?? "release-notes.md";
	if (!tag) {
		throw new Error("Usage: node scripts/prepare-release.mjs <vX.Y.Z> [output-file]");
	}

	const release = writeReleaseNotes(tag, outputPath);
	process.stdout.write(`Release contract OK: ${release.tag} (${outputPath})\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}

#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const workspace = mkdtempSync(join(tmpdir(), "talox-package-smoke-"));
const packDir = join(workspace, "pack");
const consumerDir = join(workspace, "consumer");

function run(command, args, options = {}) {
	return execFileSync(command, args, {
		cwd: options.cwd ?? repoRoot,
		encoding: "utf8",
		stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
		env: process.env,
	});
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

try {
	mkdirSync(packDir, { recursive: true });
	mkdirSync(consumerDir, { recursive: true });

	const packOutput = run(npmCommand, ["pack", "--json", "--pack-destination", packDir], { capture: true });
	const packResult = JSON.parse(packOutput);
	const artifact = Array.isArray(packResult) ? packResult[0] : undefined;
	assert(artifact && typeof artifact.filename === "string", "npm pack did not return a package filename");

	const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
	assert(artifact.name === packageJson.name, `packed package name mismatch: ${String(artifact.name)}`);
	assert(artifact.version === packageJson.version, `packed package version mismatch: ${String(artifact.version)}`);

	const tarballPath = join(packDir, artifact.filename);
	writeFileSync(
		join(consumerDir, "package.json"),
		JSON.stringify(
			{
				name: "talox-packed-smoke-consumer",
				private: true,
				type: "module",
				scripts: { "smoke:cli": "talox --help" },
			},
			null,
			2,
		),
		"utf8",
	);

	run(
		npmCommand,
		["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarballPath],
		{ cwd: consumerDir },
	);

	const importSmoke = `
import { TaloxController } from "talox";
import { listTaloxPlugins } from "talox/plugins";
import { BUILT_IN_PLATFORM_ADAPTERS } from "talox/adapters";
import { createLocalVisionReasoner } from "talox/local-vision";

const checks = [
  ["talox:TaloxController", typeof TaloxController === "function"],
  ["talox/plugins:listTaloxPlugins", typeof listTaloxPlugins === "function"],
  ["talox/adapters:BUILT_IN_PLATFORM_ADAPTERS", Array.isArray(BUILT_IN_PLATFORM_ADAPTERS)],
  ["talox/local-vision:createLocalVisionReasoner", typeof createLocalVisionReasoner === "function"],
];

for (const [name, ok] of checks) {
  if (!ok) throw new Error("Packed export smoke failed: " + name);
}
console.log("Packed imports OK");
`;

	run(process.execPath, ["--input-type=module", "--eval", importSmoke], { cwd: consumerDir });

	const typeSmokePath = join(consumerDir, "type-smoke.ts");
	writeFileSync(
		typeSmokePath,
		`import { TaloxController } from "talox";
import { listTaloxPlugins } from "talox/plugins";
import { BUILT_IN_PLATFORM_ADAPTERS } from "talox/adapters";
import { createLocalVisionReasoner } from "talox/local-vision";

const publicSurface = {
  TaloxController,
  listTaloxPlugins,
  BUILT_IN_PLATFORM_ADAPTERS,
  createLocalVisionReasoner,
};

void publicSurface;
`,
		"utf8",
	);

	const tscPath = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
	run(
		process.execPath,
		[
			tscPath,
			typeSmokePath,
			"--noEmit",
			"--strict",
			"--target",
			"ES2022",
			"--module",
			"NodeNext",
			"--moduleResolution",
			"NodeNext",
		],
		{ cwd: consumerDir },
	);
	process.stdout.write("Packed TypeScript declarations OK\n");

	// npm scripts prepend the consumer's local node_modules/.bin to PATH on every
	// supported platform, avoiding direct .cmd execution quirks on Windows while
	// still proving that the installed package generated a working `talox` bin.
	const cliOutput = run(npmCommand, ["run", "--silent", "smoke:cli"], { cwd: consumerDir, capture: true });
	assert(/talox/i.test(cliOutput), "Packed CLI smoke produced no Talox help output");

	const size = typeof artifact.size === "number" ? `${(artifact.size / 1024).toFixed(1)} kB` : "unknown";
	const unpacked = typeof artifact.unpackedSize === "number" ? `${(artifact.unpackedSize / 1024 / 1024).toFixed(2)} MB` : "unknown";
	const files = Array.isArray(artifact.files) ? artifact.files.length : "unknown";
	process.stdout.write(
		`Packed package smoke OK: ${artifact.name}@${artifact.version} (${size} tarball, ${unpacked} unpacked, ${files} files)\n`,
	);
} finally {
	if (process.env.TALOX_KEEP_PACKAGE_SMOKE !== "1") {
		rmSync(workspace, { recursive: true, force: true });
	} else {
		process.stdout.write(`Preserved package smoke workspace: ${workspace}\n`);
	}
}

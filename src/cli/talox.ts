#!/usr/bin/env node

import fs, { promises as fsPromises } from "node:fs";
import path from "node:path";
import type { BrowserType } from "../core/BrowserManager.js";
import { TaloxController } from "../core/controller/TaloxController.js";
import type { ProfileClass } from "../types/index.js";

const PROFILE_CLASSES: ProfileClass[] = ["ops", "qa", "sandbox"];
const OUTPUT_FORMATS = ["json", "markdown", "both"] as const;
const DEFAULT_INIT_DIR = "talox-app";

interface ObserveCommandOptions {
	profileId: string;
	profileClass: ProfileClass;
	browser: BrowserType;
	outputDir: string;
	outputFormat: (typeof OUTPUT_FORMATS)[number];
	verbosity: 2 | 3;
}

interface ParsedArgs {
	command: string | undefined;
	args: string[];
}

interface InitCommandOptions {
	targetDir: string;
}

function parseArgs(argv: string[]): ParsedArgs {
	if (argv.length === 0) {
		return { command: undefined, args: [] };
	}
	const [command, ...rest] = argv;
	return { command, args: rest };
}

function usage(): void {
	console.log(`
Usage:
  talox observe [options]
  talox init [directory]

Options:
  --profile, -p       Profile ID for the session (default: observe)
  --class, -c         Profile class (ops | qa | sandbox) (default: ops)
  --browser, -b       Browser to launch (chromium | firefox | webkit) (default: chromium)
  --output-dir        Directory where reports are written (default: ./talox-sessions)
  --format            Report format: json | markdown | both (default: both)
  --verbosity         Verbosity level (2 | 3), controls console chatter (default: 2)
  --help              Show this message

Commands:
  init [directory]    Scaffold a browser-lab project with Talox, presets, and practical tools.
`);
}

function parseObserveOptions(args: string[]): ObserveCommandOptions {
	const opts: ObserveCommandOptions = {
		profileId: "observe",
		profileClass: "ops",
		browser: "chromium",
		outputDir: path.join(process.cwd(), "talox-sessions"),
		outputFormat: "both",
		verbosity: 2,
	};

	const PROFILE_CLASSES_SET: Set<ProfileClass> = new Set(PROFILE_CLASSES);
	const OUTPUT_FORMATS_SET: ReadonlySet<string> = new Set(OUTPUT_FORMATS);
	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		switch (arg) {
			case "--profile":
			case "-p":
				opts.profileId = args[i + 1] ?? opts.profileId;
				i += 2;
				break;
			case "--class":
			case "-c":
				opts.profileClass = (args[i + 1] as ProfileClass) ?? opts.profileClass;
				i += 2;
				break;
			case "--browser":
			case "-b":
				opts.browser = (args[i + 1] as BrowserType) ?? opts.browser;
				i += 2;
				break;
			case "--output-dir":
				opts.outputDir = path.resolve(args[i + 1] ?? opts.outputDir);
				i += 2;
				break;
			case "--format":
				opts.outputFormat = (args[i + 1] as ObserveCommandOptions["outputFormat"]) ?? opts.outputFormat;
				i += 2;
				break;
			case "--verbosity":
				opts.verbosity = (Number(args[i + 1]) as ObserveCommandOptions["verbosity"]) ?? opts.verbosity;
				i += 2;
				break;
			case "--help":
				usage();
				process.exit(0);
				break;
			default:
				console.warn(`[Talox CLI] Unknown option ${arg}`);
				usage();
				process.exit(1);
		}
	}

	if (!PROFILE_CLASSES_SET.has(opts.profileClass)) {
		console.warn(`[Talox CLI] Invalid profile class: ${opts.profileClass}`);
		usage();
		process.exit(1);
	}

	if (!OUTPUT_FORMATS_SET.has(opts.outputFormat)) {
		console.warn(`[Talox CLI] Invalid format: ${opts.outputFormat}`);
		usage();
		process.exit(1);
	}

	return opts;
}

function parseInitOptions(args: string[]): InitCommandOptions {
	if (args.includes("--help") || args.includes("-h")) {
		usage();
		process.exit(0);
	}
	const explicitDir = args.find((arg) => !arg.startsWith("-"));
	const targetDir = explicitDir ? path.resolve(process.cwd(), explicitDir) : path.join(process.cwd(), DEFAULT_INIT_DIR);
	return { targetDir };
}

async function readTaloxVersion(): Promise<string> {
	const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
	const raw = await fsPromises.readFile(pkgPath, "utf-8");
	try {
		const pkg = JSON.parse(raw);
		return String(pkg.version ?? "0.0.0");
	} catch (_error) {
		return "0.0.0";
	}
}

async function runObserve(args: string[]): Promise<void> {
	const opts = parseObserveOptions(args);
	const talox = new TaloxController(process.cwd(), {
		observe: true,
		settings: {
			headed: true,
			verbosity: opts.verbosity,
			mouseSpeed: 0.5,
			typingDelayMin: 80,
			typingDelayMax: 180,
			typoProbability: 0.02,
			fidgetEnabled: true,
			humanStealth: 1,
			stealthLevel: "medium",
			adaptiveStealthEnabled: true,
			automaticThinkingEnabled: true,
			perceptionDepth: "full",
			autoHeadedEscalation: true,
			humanTakeoverEnabled: false,
			humanTakeoverTimeoutMs: 0,
			idleTimeout: 5000,
			precisionDecay: 0.1,
			adaptiveStealthSensitivity: 0.5,
			adaptiveStealthRadius: 100,
		},
	});

	const sessionEnded = new Promise<void>((resolve) => {
		const handler = async (event: { reportPath: string; sessionId: string; durationMs: number }) => {
			console.log(
				`[Talox] Observe session ${event.sessionId} completed · duration ${Math.round(event.durationMs / 1000)}s · report ${event.reportPath}`,
			);
			talox.off("sessionEnd", handler);
			await talox.stop();
			resolve();
		};
		talox.on("sessionEnd", handler);
	});

	talox.on("error", (payload) => {
		console.error("[Talox CLI] Error event:", payload);
	});

	const interrupt = async () => {
		console.log("[Talox CLI] Interrupt received — stopping the observe session...");
		await talox.stop();
		process.exit(0);
	};
	process.on("SIGINT", interrupt);

	await talox.launch(opts.profileId, opts.profileClass, opts.browser, {
		headed: true,
		overlay: true,
		record: true,
		output: opts.outputFormat,
		outputDir: opts.outputDir,
	});

	await sessionEnded;
	process.off("SIGINT", interrupt);
}

const PACKAGE_TEMPLATE = ({ name, version }: { name: string; version: string }) => `{
  "name": "${name}",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "ts-node src/browser-lab.ts",
    "playwright:install": "npx playwright install chromium"
  },
  "dependencies": {
    "talox": "^${version}"
  },
  "devDependencies": {
    "ts-node": "^10.9.2",
    "typescript": "^5.9.3",
    "@types/node": "^25.5.0"
  }
}
`;

const TSCONFIG_TEMPLATE = `{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "node",
    "lib": ["es2022", "dom"],
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  }
}
`;

const BROWSER_LAB_SCRIPT = `import fs from 'node:fs';
import path from 'node:path';
import { TaloxController, PRESETS, getPracticalTools } from 'talox';

async function main() {
  const talox = new TaloxController(path.resolve(process.cwd(), 'profiles'), {
    settings: {
      ...PRESETS.observe,
      humanTakeoverEnabled: true,
      overlay: true,
      autoHeadedEscalation: false,
      verbosity: 3,
      perceptionDepth: 'full',
    },
  });

  try {
    await talox.launch('browser-lab', 'sandbox', {
      headed: true,
      overlay: true,
      record: true,
      output: 'markdown',
      outputDir: path.resolve(process.cwd(), 'talox-sessions'),
    });

    const tools = getPracticalTools(talox);
    const state = await talox.navigate('https://example.com');
    console.log('Page title:', state.title);

    const searchHits = await tools.searchOnSite('example', 3);
    console.log('Search hits:', searchHits.map((hit) => hit.snippet).join(' | '));

    const bgTab = await tools.openBackgroundTab('https://example.com/about');
    console.log(bgTab.message);

    const api = await tools.captureApiResponse('https://example.com');
    console.log('API status:', api.status);

    await fs.promises.mkdir(path.resolve(process.cwd(), 'reports'), { recursive: true });
    const snapshot = await tools.exportMarkdownSnapshot(path.resolve(process.cwd(), 'reports/page.md'));
    console.log('Markdown snapshot:', snapshot);

    const structured = await tools.extractVisibleStructuredContent();
    console.log('Structured sections:', structured.sections.map((s) => s.heading).join(', '));
  } finally {
    await talox.stop();
  }
}

main().catch((error) => {
  console.error('Browser lab profile failed', error);
  process.exit(1);
});
`;

const README_TEMPLATE = (name: string) => `# ${name}

This repository demonstrates a **browser lab** profile built on Talox v2.

## Getting started

1. Install dependencies:
   \`\`\`bash
   npm install
   \`\`\`
2. Install Playwright browsers:
   \`\`\`bash
   npm run playwright:install
   \`\`\`
3. Run the browser lab script:
   \`\`\`bash
   npm run start
   \`\`\`

## What you get
- **Talox CLI**: Use \`npx talox observe\` to start a human-observable session and \`npx talox init\` to scaffold more labs.
- **Presets**: The browser lab uses \`PRESETS.observe\` plus human takeover support to keep experiments headed, overlayed, and recorded.
- **Practical tools**: The sample script demonstrates \`openBackgroundTab\`, \`captureApiResponse\`, \`exportMarkdownSnapshot\`,  \`searchOnSite\`, and \`extractVisibleStructuredContent\` via \`getPracticalTools(talox)\`.
- **Reports**: Sessions emit Markdown + JSON artifacts under \`talox-sessions/\` and snapshots land in \`reports/\`.

## Browser lab profile

- Profile ID: \`browser-lab\`
- Profile class: \`sandbox\`
- Purpose: safe experimentation with headed interaction, overlays, and practical toolkit commands.
- Workflow: launch, explore a page, capture evidence, and review the generated Markdown report.
`;

async function runInit(args: string[]): Promise<void> {
	const { targetDir } = parseInitOptions(args);
	if (fs.existsSync(targetDir)) {
		const existing = fs.readdirSync(targetDir);
		if (existing.length > 0) {
			console.error("[Talox CLI] Target directory is not empty. Aborting.");
			process.exit(1);
		}
	}

	await fsPromises.mkdir(targetDir, { recursive: true });
	const scriptsDir = path.join(targetDir, "src");
	await fsPromises.mkdir(scriptsDir, { recursive: true });

	const version = await readTaloxVersion();
	const pkgContent = PACKAGE_TEMPLATE({ name: path.basename(targetDir) || "talox-app", version });

	await Promise.all([
		fsPromises.writeFile(path.join(targetDir, "package.json"), pkgContent, "utf-8"),
		fsPromises.writeFile(path.join(targetDir, "tsconfig.json"), TSCONFIG_TEMPLATE, "utf-8"),
		fsPromises.writeFile(path.join(scriptsDir, "browser-lab.ts"), BROWSER_LAB_SCRIPT, "utf-8"),
		fsPromises.writeFile(
			path.join(targetDir, "README.md"),
			README_TEMPLATE(path.basename(targetDir) || "Browser Lab Starter"),
			"utf-8",
		),
	]);

	console.log("[Talox CLI] Browser lab starter created at", targetDir);
	console.log("[Talox CLI] Next steps:");
	console.log(`  cd ${path.relative(process.cwd(), targetDir) || "."}`);
	console.log("  npm install");
	console.log("  npm run playwright:install");
	console.log("  npm run start");
}

async function main(): Promise<void> {
	const { command, args } = parseArgs(process.argv.slice(2));
	switch (command) {
		case "observe":
			await runObserve(args);
			break;
		case "init":
			await runInit(args);
			break;
		default:
			usage();
			process.exit(1);
	}
}

main().catch((error) => {
	console.error("[Talox CLI] Failed", error);
	process.exit(1);
});

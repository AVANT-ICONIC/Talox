#!/usr/bin/env node

import fs, { promises as fsPromises } from "node:fs";
import * as os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { AgentCoordinator } from "../core/AgentCoordinator.js";
import type { BrowserType } from "../core/BrowserManager.js";
import { ChatSession } from "../core/chat/ChatSession.js";
import { TaloxController } from "../core/controller/TaloxController.js";
import { TaloxDaemon } from "../core/daemon/TaloxDaemon.js";
import { AutonomousLoop } from "../core/loop/AutonomousLoop.js";
import { SkillLoader } from "../core/skills/SkillLoader.js";
import { SkillWriter } from "../core/skills/SkillWriter.js";
import type { ProfileClass } from "../types/index.js";
import { formatDoctorOutput, runDoctor } from "./doctor.js";

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

interface ScreenshotCommandOptions {
	url: string | undefined;
	output: string;
	profileId: string;
	profileClass: ProfileClass;
	browser: BrowserType;
}

interface ChatCommandOptions {
	model: string;
	apiKey: string | undefined;
	baseUrl: string | undefined;
}

interface RunCommandOptions {
	goal: string;
	url: string | undefined;
	model: string;
	apiKey: string | undefined;
	baseUrl: string | undefined;
	maxIterations: number;
	strategy: "conservative" | "balanced" | "aggressive";
	skillsDir: string | undefined;
	agents: number;
}

interface ResearchCommandOptions {
	goal: string;
	domain: string;
	url: string | undefined;
	model: string;
	apiKey: string | undefined;
	baseUrl: string | undefined;
	maxIterations: number;
	strategy: "conservative" | "balanced" | "aggressive";
	skillsDir: string | undefined;
	runsPerVariant: number;
	promotionThreshold: number;
	researchDir: string;
	enableCrossDomain: boolean;
	enablePromptEvolution: boolean;
}

interface SkillCreateOptions {
	domain: string;
	name: string;
	description: string;
	file: string | undefined;
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
  talox screenshot [url] [options]
  talox chat [options]
  talox doctor [--fix]
  talox daemon [options]
  talox run "<goal>" [options]
  talox research "<goal>" --domain <domain> [options]
  talox skill create [options]

Options:
  --profile, -p       Profile ID for the session (default: observe)
  --class, -c         Profile class (ops | qa | sandbox) (default: ops)
  --browser, -b       Browser to launch (chromium | firefox | webkit) (default: chromium)
  --output-dir        Directory where reports are written (default: ./talox-sessions)
  --output, -o        Output file path for screenshot command (default: screenshot.png)
  --format            Report format: json | markdown | both (default: both)
  --verbosity         Verbosity level (2 | 3), controls console chatter (default: 2)
  --fix               Automatically fix issues found by doctor
  --help              Show this message

Chat Options:
  --model             OpenAI model ID (default: gpt-4o or OPENAI_MODEL env)
  --api-key           OpenAI API key (or OPENAI_API_KEY env)
  --url               OpenAI-compatible API base URL (or OPENAI_BASE_URL env)

Run Options:
  --url               Starting URL for the autonomous loop
  --model             OpenAI model ID (default: gpt-4o)
  --api-key           OpenAI API key (or OPENAI_API_KEY env)
  --base-url          OpenAI-compatible API base URL (or OPENAI_BASE_URL env)
  --max-iterations    Maximum loop iterations (default: 10)
  --strategy          Loop strategy: conservative | balanced | aggressive (default: balanced)
  --skills-dir        Directory containing domain skills
  --agents            Number of parallel browser agents (default: 1)

Research Options:
  --domain, -d        Target domain for experiments (required)
  --url               Starting URL for the research goal
  --model             OpenAI model ID (default: gpt-4o)
  --api-key           OpenAI API key (or OPENAI_API_KEY env)
  --base-url          OpenAI-compatible API base URL
  --max-iterations    Maximum loop iterations per run (default: 10)
  --strategy          Loop strategy: conservative | balanced | aggressive (default: balanced)
  --skills-dir        Directory for promoted strategy skills
  --runs-per-variant  Experiment runs per variant (default: 3)
  --promotion-threshold  Min improvement ratio to promote (default: 1.15)
  --research-dir      Directory for research journal (default: .talox/research)
  --enable-cross-domain  Enable cross-domain transfer learning
  --enable-prompt-evolution  Enable prompt self-evolution

Skill Create Options:
  --domain            Target domain for the skill (required)
  --name              Skill name (required)
  --description       Skill description (required)
  --file              Path to markdown file with skill content (required)

Commands:
  init [directory]    Scaffold a browser-lab project with Talox, presets, and practical tools.
  screenshot [url]    Capture an annotated screenshot with element refs.
  chat                Start an interactive chat session with browser control via LLM.
  doctor [--fix]      Run diagnostic checks on your environment.
  daemon              Start a Talox daemon for IPC control.
  run "<goal>"        Run an autonomous loop to achieve the given goal.
  research "<goal>"   Run autonomous research with A/B experiments on a domain.
  skill create        Create a new domain skill from a markdown file.
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
		/* NOSONAR */
		// Malformed package.json — return sentinel version
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

This repository demonstrates a **browser lab** profile built on Talox v8.

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

function parseScreenshotOptions(args: string[]): ScreenshotCommandOptions {
	const opts: ScreenshotCommandOptions = {
		url: undefined,
		output: "screenshot.png",
		profileId: "screenshot",
		profileClass: "ops",
		browser: "chromium",
	};

	const PROFILE_CLASSES_SET: Set<ProfileClass> = new Set(PROFILE_CLASSES);
	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		switch (arg) {
			case "--output":
			case "-o":
				opts.output = args[i + 1] ?? opts.output;
				i += 2;
				break;
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
			case "--help":
				usage();
				process.exit(0);
				break;
			default:
				if (arg && !arg.startsWith("-")) {
					opts.url = arg;
				} else {
					console.warn(`[Talox CLI] Unknown option ${arg}`);
					usage();
					process.exit(1);
				}
				i += 1;
				break;
		}
	}

	if (!PROFILE_CLASSES_SET.has(opts.profileClass)) {
		console.warn(`[Talox CLI] Invalid profile class: ${opts.profileClass}`);
		usage();
		process.exit(1);
	}

	return opts;
}

async function runScreenshot(args: string[]): Promise<void> {
	const opts = parseScreenshotOptions(args);
	const talox = new TaloxController(process.cwd());

	try {
		await talox.launch(opts.profileId, opts.profileClass, opts.browser);

		if (opts.url) {
			await talox.navigate(opts.url);
		}

		const buffer = await talox.annotatedScreenshot();
		const outputPath = path.resolve(process.cwd(), opts.output);
		await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
		await fsPromises.writeFile(outputPath, buffer);
		console.log(`[Talox CLI] Annotated screenshot saved to ${outputPath}`);
	} finally {
		await talox.stop();
	}
}

async function runDoctorCommand(args: string[]): Promise<void> {
	if (args.includes("--help") || args.includes("-h")) {
		usage();
		process.exit(0);
	}
	const fix = args.includes("--fix");
	const version = await readTaloxVersion();
	const result = await runDoctor({ fix });
	console.log(formatDoctorOutput(result, version));
	if (result.errors > 0) {
		process.exit(1);
	}
}

interface DaemonCommandOptions {
	socketPath: string | undefined;
	port: number | undefined;
}

function parseDaemonOptions(args: string[]): DaemonCommandOptions {
	if (args.includes("--help") || args.includes("-h")) {
		usage();
		process.exit(0);
	}
	const opts: DaemonCommandOptions = {
		socketPath: undefined,
		port: undefined,
	};
	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (arg === "--socket") {
			opts.socketPath = args[i + 1];
			i += 2;
		} else if (arg === "--port") {
			const raw = args[i + 1];
			if (raw !== undefined) {
				opts.port = Number(raw);
			}
			i += 2;
		} else {
			console.warn(`[Talox CLI] Unknown daemon option: ${arg}`);
			i += 1;
		}
	}
	return opts;
}

async function runDaemon(args: string[]): Promise<void> {
	const opts = parseDaemonOptions(args);
	const config: import("../core/daemon/TaloxDaemon.js").DaemonConfig = {};
	if (opts.socketPath !== undefined) {
		config.socketPath = opts.socketPath;
	}
	if (opts.port !== undefined) {
		config.port = opts.port;
	}

	const daemon = new TaloxDaemon(config);
	await daemon.start();

	const address = daemon.getAddress();
	const isTcp = os.platform() === "win32" || opts.port !== undefined;
	if (isTcp) {
		console.log(`[Talox Daemon] Listening on TCP ${address} (PID ${process.pid})`);
	} else {
		const socketPath = opts.socketPath ?? "/tmp/talox-daemon.sock";
		console.log(`[Talox Daemon] Listening on socket ${socketPath} (PID ${process.pid})`);
	}

	const gracefulShutdown = async () => {
		console.log("[Talox Daemon] Shutting down...");
		await daemon.stop();
		process.exit(0);
	};
	process.on("SIGINT", gracefulShutdown);
	process.on("SIGTERM", gracefulShutdown);
}

function parseChatOptions(args: string[]): ChatCommandOptions {
	const opts: ChatCommandOptions = {
		model: "gpt-4o",
		apiKey: undefined,
		baseUrl: undefined,
	};

	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (!arg) {
			i += 1;
			continue;
		}
		switch (arg) {
			case "--model":
				opts.model = args[i + 1] ?? opts.model;
				i += 2;
				break;
			case "--api-key":
				opts.apiKey = args[i + 1];
				i += 2;
				break;
			case "--url":
				opts.baseUrl = args[i + 1];
				i += 2;
				break;
			case "--help":
			case "-h":
				usage();
				process.exit(0);
				break;
			default:
				console.warn(`[Talox CLI] Unknown chat option: ${arg}`);
				i += 1;
				break;
		}
	}

	return opts;
}

function parseRunOptions(args: string[]): RunCommandOptions {
	const VALID_STRATEGIES = new Set<string>(["conservative", "balanced", "aggressive"]);
	const opts: RunCommandOptions = {
		goal: "",
		url: undefined,
		model: "gpt-4o",
		apiKey: undefined,
		baseUrl: undefined,
		maxIterations: 10,
		strategy: "balanced",
		skillsDir: undefined,
		agents: 1,
	};

	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (!arg) {
			i += 1;
			continue;
		}
		switch (arg) {
			case "--url":
				opts.url = args[i + 1];
				i += 2;
				break;
			case "--model":
				opts.model = args[i + 1] ?? opts.model;
				i += 2;
				break;
			case "--api-key":
				opts.apiKey = args[i + 1];
				i += 2;
				break;
			case "--base-url":
				opts.baseUrl = args[i + 1];
				i += 2;
				break;
			case "--max-iterations":
				opts.maxIterations = Number(args[i + 1]) || opts.maxIterations;
				i += 2;
				break;
			case "--strategy": {
				const raw = args[i + 1] ?? "balanced";
				opts.strategy = VALID_STRATEGIES.has(raw) ? (raw as RunCommandOptions["strategy"]) : opts.strategy;
				i += 2;
				break;
			}
			case "--skills-dir":
				opts.skillsDir = args[i + 1];
				i += 2;
				break;
			case "--agents":
				opts.agents = Number(args[i + 1]) || 1;
				i += 2;
				break;
			case "--help":
			case "-h":
				usage();
				process.exit(0);
				break;
			default:
				if (!arg.startsWith("-")) {
					opts.goal = arg;
				} else {
					console.warn(`[Talox CLI] Unknown run option: ${arg}`);
				}
				i += 1;
				break;
		}
	}

	return opts;
}

function parseSkillCreateOptions(args: string[]): SkillCreateOptions {
	const opts: SkillCreateOptions = {
		domain: "",
		name: "",
		description: "",
		file: undefined,
	};

	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (!arg) {
			i += 1;
			continue;
		}
		switch (arg) {
			case "--domain":
				opts.domain = args[i + 1] ?? opts.domain;
				i += 2;
				break;
			case "--name":
				opts.name = args[i + 1] ?? opts.name;
				i += 2;
				break;
			case "--description":
				opts.description = args[i + 1] ?? opts.description;
				i += 2;
				break;
			case "--file":
				opts.file = args[i + 1];
				i += 2;
				break;
			case "--help":
			case "-h":
				usage();
				process.exit(0);
				break;
			default:
				console.warn(`[Talox CLI] Unknown skill create option: ${arg}`);
				i += 1;
				break;
		}
	}

	return opts;
}

async function runChat(args: string[]): Promise<void> {
	const opts = parseChatOptions(args);

	if (!opts.apiKey && !process.env["OPENAI_API_KEY"]) {
		console.error("[Talox CLI] Error: No API key provided. Use --api-key or set OPENAI_API_KEY env var.");
		process.exit(1);
	}

	console.log("[Talox Chat] Starting browser...");

	const talox = new TaloxController(process.cwd(), {
		settings: {
			headed: true,
			verbosity: 1,
		},
	});

	const chatConfig: import("../core/chat/ChatSession.js").ChatConfig = {
		model: opts.model,
	};
	if (opts.apiKey) chatConfig.apiKey = opts.apiKey;
	if (opts.baseUrl) chatConfig.baseUrl = opts.baseUrl;

	const session = new ChatSession(talox, chatConfig);

	const cleanup = async () => {
		console.log("\n[Talox Chat] Shutting down...");
		await session.stop();
		process.exit(0);
	};
	process.on("SIGINT", cleanup);

	await talox.launch("chat", "sandbox", "chromium", { headed: true });

	console.log("[Talox Chat] Browser ready. Type your message (Ctrl+C to exit).\n");

	await session.start();
}

async function runRun(args: string[]): Promise<void> {
	const opts = parseRunOptions(args);

	if (!opts.goal) {
		console.error('[Talox CLI] Error: No goal provided. Usage: talox run "<goal>" [options]');
		process.exit(1);
	}

	const apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"];
	if (!apiKey) {
		console.error("[Talox CLI] Error: No API key provided. Use --api-key or set OPENAI_API_KEY env var.");
		process.exit(1);
	}

	console.log(`[Talox Run] Starting autonomous loop: "${opts.goal}"`);

	const talox = new TaloxController(process.cwd(), {
		settings: {
			headed: false,
			verbosity: 1,
		},
	});

	let totalCost = 0; // NOSONAR — mutated inside onProgress closure

	const loopOptions: import("../core/loop/types.js").AutonomousLoopOptions = {
		goal: {
			description: opts.goal,
			maxIterations: opts.maxIterations,
			strategy: opts.strategy,
		},
		planner: {
			model: opts.model,
			apiKey,
		},
		onProgress(iteration) {
			if (iteration.tokenUsage) {
				totalCost += iteration.tokenUsage.estimatedCostUsd;
			}
			const firstStep = iteration.plan.steps[0];
			if (iteration.plan.goalAchieved) {
				console.log(
					`[ iteration ${iteration.iteration} ] goal achieved \u2713 (${iteration.iteration} iterations, $${totalCost.toFixed(3)})`,
				);
			} else if (firstStep) {
				console.log(`[ iteration ${iteration.iteration} ] observing \u2192 planning \u2192 ${firstStep.action}`);
			} else {
				console.log(`[ iteration ${iteration.iteration} ] observing \u2192 planning \u2192 ${iteration.result.status}`);
			}
		},
	};

	if (opts.url !== undefined) {
		loopOptions.goal.startUrl = opts.url;
	}
	if (opts.baseUrl !== undefined) {
		loopOptions.planner.apiBaseUrl = opts.baseUrl;
	}
	if (opts.skillsDir !== undefined) {
		loopOptions.skillsDir = opts.skillsDir;
	}

	const interrupt = async () => {
		console.log("[Talox Run] Interrupt received — stopping...");
		process.exit(0);
	};
	process.on("SIGINT", interrupt);

	try {
		await talox.launch("run", "ops", "chromium");

		const loop = new AutonomousLoop(talox, loopOptions);
		const result = await loop.run();

		console.log("");
		console.log(`[Talox CLI] Run completed: ${result.status}`);
		console.log(`[Talox CLI] Stop reason: ${result.stopReason}`);
		console.log(`[Talox CLI] Iterations: ${result.totalIterations}`);
		console.log(`[Talox CLI] Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`);
		console.log(`[Talox CLI] Cost: $${result.totalCostUsd.toFixed(3)}`);
		if (result.createdSkills.length > 0) {
			console.log(`[Talox CLI] Skills created: ${result.createdSkills.join(", ")}`);
		}

		loop.dispose();
	} finally {
		process.off("SIGINT", interrupt);
		await talox.stop();
	}
}

// ─── Research Command ────────────────────────────────────────────────────────

function parseResearchOptions(args: string[]): ResearchCommandOptions {
	const VALID_STRATEGIES = new Set<string>(["conservative", "balanced", "aggressive"]);
	const opts: ResearchCommandOptions = {
		goal: "",
		domain: "",
		url: undefined,
		model: "gpt-4o",
		apiKey: undefined,
		baseUrl: undefined,
		maxIterations: 10,
		strategy: "balanced",
		skillsDir: undefined,
		runsPerVariant: 3,
		promotionThreshold: 1.15,
		researchDir: ".talox/research",
		enableCrossDomain: false,
		enablePromptEvolution: false,
	};

	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (!arg) {
			i += 1;
			continue;
		}
		switch (arg) {
			case "--domain":
			case "-d":
				opts.domain = args[i + 1] ?? opts.domain;
				i += 2;
				break;
			case "--url":
				opts.url = args[i + 1];
				i += 2;
				break;
			case "--model":
				opts.model = args[i + 1] ?? opts.model;
				i += 2;
				break;
			case "--api-key":
				opts.apiKey = args[i + 1];
				i += 2;
				break;
			case "--base-url":
				opts.baseUrl = args[i + 1];
				i += 2;
				break;
			case "--max-iterations":
				opts.maxIterations = Number(args[i + 1]) || opts.maxIterations;
				i += 2;
				break;
			case "--strategy": {
				const raw = args[i + 1] ?? "balanced";
				opts.strategy = VALID_STRATEGIES.has(raw) ? (raw as ResearchCommandOptions["strategy"]) : opts.strategy;
				i += 2;
				break;
			}
			case "--skills-dir":
				opts.skillsDir = args[i + 1];
				i += 2;
				break;
			case "--runs-per-variant":
				opts.runsPerVariant = Number(args[i + 1]) || opts.runsPerVariant;
				i += 2;
				break;
			case "--promotion-threshold":
				opts.promotionThreshold = Number(args[i + 1]) || opts.promotionThreshold;
				i += 2;
				break;
			case "--research-dir":
				opts.researchDir = args[i + 1] ?? opts.researchDir;
				i += 2;
				break;
			case "--enable-cross-domain":
				opts.enableCrossDomain = true;
				i += 1;
				break;
			case "--enable-prompt-evolution":
				opts.enablePromptEvolution = true;
				i += 1;
				break;
			case "--help":
			case "-h":
				usage();
				process.exit(0);
				break;
			default:
				if (!arg.startsWith("-")) {
					opts.goal = arg;
				} else {
					console.warn(`[Talox CLI] Unknown research option: ${arg}`);
				}
				i += 1;
				break;
		}
	}

	return opts;
}

async function runResearchCommand(args: string[]): Promise<void> {
	const opts = parseResearchOptions(args);

	if (!opts.goal) {
		console.error('[Talox CLI] Error: No goal provided. Usage: talox research "<goal>" --domain <domain> [options]');
		process.exit(1);
	}
	if (!opts.domain) {
		console.error("[Talox CLI] Error: --domain is required for research.");
		process.exit(1);
	}

	const apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"];
	if (!apiKey) {
		console.error("[Talox CLI] Error: No API key provided. Use --api-key or set OPENAI_API_KEY env var.");
		process.exit(1);
	}

	console.log(`[Talox Research] Starting research: "${opts.goal}" on domain ${opts.domain}`);
	console.log(`[Talox Research] Config: ${opts.runsPerVariant} runs/variant, threshold ${opts.promotionThreshold}`);

	const talox = new TaloxController(process.cwd(), {
		settings: {
			headed: false,
			verbosity: 1,
		},
	});

	const interrupt = async () => {
		console.log("[Talox Research] Interrupt received — stopping...");
		process.exit(0);
	};
	process.on("SIGINT", interrupt);

	try {
		await talox.launch("research", "ops", "chromium");

		const taskGoal: {
			description: string;
			maxIterations: number;
			strategy: "conservative" | "balanced" | "aggressive";
			startUrl?: string;
		} = {
			description: opts.goal,
			maxIterations: opts.maxIterations,
			strategy: opts.strategy,
		};
		if (opts.url) {
			taskGoal.startUrl = opts.url;
		}

		const result = await talox.runResearch(taskGoal, opts.domain, {
			config: {
				runsPerVariant: opts.runsPerVariant,
				promotionThreshold: opts.promotionThreshold,
				researchDir: opts.researchDir,
				enableCrossDomainTransfer: opts.enableCrossDomain,
				enablePromptEvolution: opts.enablePromptEvolution,
				excludedDomains: [],
				persistToDisk: true,
				maxConcurrentExperiments: 1,
				maxSkillVersions: 5,
				regressionTimeoutMs: 30_000,
				adaptivePriority: true,
				compositionConfidenceThreshold: 0.8,
			},
			...(opts.skillsDir ? { skillsDir: opts.skillsDir } : {}),
		});

		console.log("");
		console.log(`[Talox Research] Loop status: ${result.loopResult.status}`);
		console.log(`[Talox Research] Experiments: ${result.experiments.length}`);
		console.log(`[Talox Research] Evaluations: ${result.evaluations.length}`);
		console.log(`[Talox Research] Promotions: ${result.promotions.length}`);
		if (result.promotions.length > 0) {
			for (const promo of result.promotions) {
				console.log(`  → ${promo.strategyName} on ${promo.domain} (confidence: ${promo.evidence.length} experiments)`);
			}
		}
		console.log(`[Talox Research] Journal entries: ${result.journal.entries.length}`);
		console.log(`[Talox Research] Domains studied: ${Object.keys(result.journal.domains).join(", ") || "none"}`);
	} finally {
		process.off("SIGINT", interrupt);
		await talox.stop();
	}
}

async function runSkillCreate(args: string[]): Promise<void> {
	const opts = parseSkillCreateOptions(args);

	if (!opts.domain) {
		console.error("[Talox CLI] Error: --domain is required.");
		process.exit(1);
	}
	if (!opts.name) {
		console.error("[Talox CLI] Error: --name is required.");
		process.exit(1);
	}
	if (!opts.description) {
		console.error("[Talox CLI] Error: --description is required.");
		process.exit(1);
	}
	if (!opts.file) {
		console.error("[Talox CLI] Error: No --file provided. Supply a markdown file with skill content.");
		process.exit(1);
	}

	const content = await fsPromises.readFile(path.resolve(opts.file), "utf-8");
	const skillsDir = path.join(process.cwd(), "skills");
	const loader = new SkillLoader([skillsDir]);
	const writer = new SkillWriter(skillsDir, loader);

	const filePath = await writer.createSkill({
		name: opts.name,
		description: opts.description,
		domain: opts.domain,
		version: "1.0",
		content,
		triggerCondition: `domain == "${opts.domain}"`,
		toolUsage: [],
	});

	console.log(`[Talox CLI] Skill "${opts.name}" created for domain ${opts.domain}`);
	console.log(`[Talox CLI] File: ${filePath}`);
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
		case "screenshot":
			await runScreenshot(args);
			break;
		case "doctor":
			await runDoctorCommand(args);
			break;
		case "daemon":
			await runDaemon(args);
			break;
		case "chat":
			await runChat(args);
			break;
		case "run":
			await runRun(args);
			break;
		case "research":
			await runResearchCommand(args);
			break;
		case "skill": {
			const subcommand = args[0];
			if (subcommand === "create") {
				await runSkillCreate(args.slice(1));
			} else {
				console.error(`[Talox CLI] Unknown skill subcommand: ${subcommand ?? ""}`);
				usage();
				process.exit(1);
			}
			break;
		}
		default:
			usage();
			process.exit(1);
	}
}

try {
	await main();
} catch (error) {
	console.error("[Talox CLI] Failed", error);
	process.exit(1);
}

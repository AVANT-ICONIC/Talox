/**
 * @file FingerprintGenerator.ts
 * @description Generates internally-consistent browser fingerprint profiles
 * weighted by real-world market share distribution.
 *
 * Inspired by Camoufox's approach: fingerprints must be internally consistent
 * (Windows UA + Apple GPU = flagged). This module ensures every property in a
 * generated profile matches the expected values for the chosen OS/browser combo.
 *
 * Key properties:
 * - Market-share-weighted OS/browser/screen/GPU selection
 * - Cross-validated consistency (UA matches OS, GPU matches OS, fonts match OS)
 * - AudioContext spoofing params
 * - WebRTC leak prevention config
 * - Font fingerprint defense data
 * - Timezone + locale consistency
 */

// ─── Public Types ────────────────────────────────────────────────────────────

/** Operating system families we can emulate. */
export type FingerprintOS = "windows" | "macos" | "linux";

/** Screen resolution with market-share weight. */
export interface ScreenProfile {
	width: number;
	height: number;
	dpr: number; // device pixel ratio
	weight: number; // 0-1, relative probability
}

/** WebGL GPU identity consistent with an OS. */
export interface WebGLProfile {
	vendor: string;
	renderer: string;
}

/** AudioContext parameters to spoof. */
export interface AudioContextProfile {
	sampleRate: 44100 | 48000;
	maxChannelCount: number;
	outputLatency: number; // seconds
}

/** Font families typically available on a given OS. */
export interface FontProfile {
	systemFonts: string[];
	/** Subpixel antialiasing mode. */
	subpixelAA: "none" | "grayscale" | "rgb" | "bgr";
	/** Random letter-spacing offset range to defeat font metric fingerprinting. */
	letterSpacingOffsetRange: [number, number]; // min, max in pixels
}

/** WebRTC configuration for leak prevention. */
export interface WebRTCConfig {
	/** Local candidate IPs to block or spoof. */
	localIPMask: string;
	/** Whether to enable WebRTC at all. */
	enabled: boolean;
	/** Public IP hint for mDNS candidate generation. */
	publicIP?: string;
}

/** A complete, internally-consistent fingerprint profile. */
export interface FingerprintProfile {
	/** Unique ID for this profile (hash-derived). */
	id: string;
	/** OS family. */
	os: FingerprintOS;
	/** Full User-Agent string. */
	userAgent: string;
	/** Navigator platform string (e.g. "Win32", "MacIntel", "Linux x86_64"). */
	platform: string;
	/** Screen properties. */
	screen: ScreenProfile;
	/** WebGL vendor/renderer (consistent with OS). */
	webgl: WebGLProfile;
	/** AudioContext spoofing params. */
	audio: AudioContextProfile;
	/** Font fingerprint defense data. */
	fonts: FontProfile;
	/** WebRTC leak prevention. */
	webrtc: WebRTCConfig;
	/** Timezone (consistent with locale). */
	timezone: string;
	/** Locale string (e.g. "en-US"). */
	locale: string;
	/** Navigator.language (consistent with locale). */
	languages: string[];
	/** Hardware concurrency (CPU core count, consistent with OS/device). */
	hardwareConcurrency: number;
	/** Device memory in GB (consistent with OS/device). */
	deviceMemory: number;
	/** Battery API spoofing data. */
	battery: {
		charging: boolean;
		chargingTime: number; // seconds, Infinity if not charging
		dischargingTime: number; // seconds
		level: number; // 0-1
	};
}

// ─── OS Market Share Data ────────────────────────────────────────────────────
// Based on StatCounter global data, 2026 estimates.

const OS_WEIGHTS: Record<FingerprintOS, number> = {
	windows: 0.72,
	macos: 0.17,
	linux: 0.04,
};
// Remaining ~7% is mobile, which we don't emulate (agents need desktop viewports)

// ─── User Agent Database ─────────────────────────────────────────────────────

interface UAEntry {
	ua: string;
	platform: string;
	os: FingerprintOS;
	/** Chrome major version. */
	chromeVersion: number;
}

const USER_AGENTS: UAEntry[] = [
	// Windows
	{
		os: "windows",
		platform: "Win32",
		chromeVersion: 135,
		ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
	},
	{
		os: "windows",
		platform: "Win32",
		chromeVersion: 134,
		ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
	},
	{
		os: "windows",
		platform: "Win32",
		chromeVersion: 133,
		ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
	},
	{
		os: "windows",
		platform: "Win32",
		chromeVersion: 135,
		ua: "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
	},
	// macOS
	{
		os: "macos",
		platform: "MacIntel",
		chromeVersion: 135,
		ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
	},
	{
		os: "macos",
		platform: "MacIntel",
		chromeVersion: 134,
		ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
	},
	{
		os: "macos",
		platform: "MacIntel",
		chromeVersion: 135,
		ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
	},
	// Linux
	{
		os: "linux",
		platform: "Linux x86_64",
		chromeVersion: 135,
		ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
	},
	{
		os: "linux",
		platform: "Linux x86_64",
		chromeVersion: 134,
		ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
	},
];

// ─── Screen Profiles per OS ──────────────────────────────────────────────────

const SCREENS: Record<FingerprintOS, ScreenProfile[]> = {
	windows: [
		{ width: 1920, height: 1080, dpr: 1, weight: 0.45 },
		{ width: 1366, height: 768, dpr: 1, weight: 0.2 },
		{ width: 2560, height: 1440, dpr: 1, weight: 0.15 },
		{ width: 1536, height: 864, dpr: 1.25, weight: 0.1 },
		{ width: 1440, height: 900, dpr: 1, weight: 0.1 },
	],
	macos: [
		{ width: 1440, height: 900, dpr: 2, weight: 0.35 },
		{ width: 2560, height: 1600, dpr: 2, weight: 0.25 },
		{ width: 1680, height: 1050, dpr: 2, weight: 0.15 },
		{ width: 1920, height: 1080, dpr: 2, weight: 0.1 },
		{ width: 3024, height: 1964, dpr: 2, weight: 0.15 },
	],
	linux: [
		{ width: 1920, height: 1080, dpr: 1, weight: 0.5 },
		{ width: 2560, height: 1440, dpr: 1, weight: 0.2 },
		{ width: 1366, height: 768, dpr: 1, weight: 0.15 },
		{ width: 3840, height: 2160, dpr: 1, weight: 0.15 },
	],
};

// ─── WebGL Profiles per OS ───────────────────────────────────────────────────

const WEBGL_PROFILES: Record<FingerprintOS, WebGLProfile[]> = {
	windows: [
		{
			vendor: "Google Inc. (NVIDIA)",
			renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
		},
		{
			vendor: "Google Inc. (NVIDIA)",
			renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)",
		},
		{
			vendor: "Google Inc. (NVIDIA)",
			renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)",
		},
		{ vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
		{ vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
		{
			vendor: "Google Inc. (Intel)",
			renderer: "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)",
		},
		{
			vendor: "Google Inc. (Intel)",
			renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)",
		},
	],
	macos: [
		{ vendor: "Apple Inc.", renderer: "Apple M1" },
		{ vendor: "Apple Inc.", renderer: "Apple M2" },
		{ vendor: "Apple Inc.", renderer: "Apple M3" },
		{ vendor: "Apple Inc.", renderer: "Apple M1 Pro" },
		{ vendor: "Apple Inc.", renderer: "Apple M2 Pro" },
	],
	linux: [
		{ vendor: "Mesa", renderer: "Mesa Intel(R) UHD Graphics 620 (KBL GT2)" },
		{ vendor: "Mesa", renderer: "Mesa Intel(R) HD Graphics 530 (SKL GT2)" },
		{ vendor: "Mesa/X.org", renderer: "llvmpipe (LLVM 15.0.7, 256 bits)" },
		{ vendor: "Mesa", renderer: "NVIDIA T600/PCIe/SSE2" },
	],
};

// ─── AudioContext Profiles ───────────────────────────────────────────────────

const AUDIO_PROFILES: Record<FingerprintOS, AudioContextProfile[]> = {
	windows: [
		{ sampleRate: 48000, maxChannelCount: 2, outputLatency: 0.0116 },
		{ sampleRate: 44100, maxChannelCount: 2, outputLatency: 0.01 },
		{ sampleRate: 48000, maxChannelCount: 6, outputLatency: 0.02 },
	],
	macos: [
		{ sampleRate: 44100, maxChannelCount: 2, outputLatency: 0.0087 },
		{ sampleRate: 48000, maxChannelCount: 2, outputLatency: 0.0093 },
	],
	linux: [
		{ sampleRate: 48000, maxChannelCount: 2, outputLatency: 0.0213 },
		{ sampleRate: 44100, maxChannelCount: 2, outputLatency: 0.0189 },
	],
};

// ─── Font Profiles per OS ────────────────────────────────────────────────────

const FONT_PROFILES: Record<FingerprintOS, FontProfile> = {
	windows: {
		systemFonts: [
			"Arial",
			"Arial Black",
			"Calibri",
			"Cambria",
			"Cambria Math",
			"Comic Sans MS",
			"Consolas",
			"Courier New",
			"Georgia",
			"Impact",
			"Lucida Console",
			"Lucida Sans Unicode",
			"Microsoft Sans Serif",
			"MS Gothic",
			"MS PGothic",
			"Palatino Linotype",
			"Segoe Print",
			"Segoe Script",
			"Segoe UI",
			"Segoe UI Light",
			"Segoe UI Semibold",
			"Segoe UI Symbol",
			"SimSun",
			"Sylfaen",
			"Tahoma",
			"Times New Roman",
			"Trebuchet MS",
			"Verdana",
			"Wingdings",
		],
		subpixelAA: "rgb",
		letterSpacingOffsetRange: [-0.3, 0.3],
	},
	macos: {
		systemFonts: [
			"American Typewriter",
			"Andale Mono",
			"Apple Braille",
			"Apple Chancery",
			"Apple Color Emoji",
			"Apple SD Gothic Neo",
			"Arial",
			"Arial Black",
			"Arial Hebrew",
			"Arial Narrow",
			"Arial Rounded MT Bold",
			"Avenir",
			"Avenir Next",
			"Avenir Next Condensed",
			"Baskerville",
			"Big Caslon",
			"Brush Script MT",
			"Chalkboard",
			"Chalkboard SE",
			"Chalkduster",
			"Charter",
			"Cochin",
			"Comic Sans MS",
			"Consolas",
			"Copperplate",
			"Corbel",
			"Courier",
			"Courier New",
			"Didot",
			"Futura",
			"Geneva",
			"Georgia",
			"Gill Sans",
			"Helvetica",
			"Helvetica Neue",
			"Herculanum",
			"Hiragino Sans",
			"Hoefler Text",
			"Impact",
			"Menlo",
			"Monaco",
			"Noteworthy",
			"Optima",
			"Palatino",
			"Papyrus",
			"PingFang SC",
			"PingFang HK",
			"PingFang TC",
			"PT Sans",
			"PT Serif",
			"San Francisco",
			"SF Pro Display",
			"SF Pro Text",
			"Skia",
			"STHeiti",
			"STSong",
			"Sukhumvit Set",
			"Symbol",
			"Tahoma",
			"Times",
			"Times New Roman",
			"Trebuchet MS",
			"Verdana",
			"Zapf Dingbats",
			"Zapfino",
		],
		subpixelAA: "grayscale",
		letterSpacingOffsetRange: [-0.2, 0.2],
	},
	linux: {
		systemFonts: [
			"Arial",
			"Carlito",
			"Cantarell",
			"Caladea",
			"DejaVu Sans",
			"DejaVu Sans Mono",
			"DejaVu Serif",
			"Droid Sans",
			"Droid Sans Mono",
			"FreeMono",
			"FreeSans",
			"FreeSerif",
			"Gayathri",
			"Gubbi",
			"Jomolhari",
			"Kedage",
			"Liberation Mono",
			"Liberation Sans",
			"Liberation Serif",
			"Nakula",
			"Nimbus Mono",
			"Nimbus Roman",
			"Nimbus Sans",
			"Noto Color Emoji",
			"Noto Sans",
			"Noto Sans CJK SC",
			"Noto Serif",
			"Paducah",
			"Sahadeva",
			"Serif",
			"Standard Symbols PS",
			"Suruma",
			"Tibetan Machine Uni",
			"Ubuntu",
			"Ubuntu Condensed",
			"Ubuntu Mono",
			"URW Bookman",
			"URW Chancery",
			"URW Gothic",
			"URW Palladio",
		],
		subpixelAA: "rgb",
		letterSpacingOffsetRange: [-0.3, 0.3],
	},
};

// ─── Timezone/Locale per OS ──────────────────────────────────────────────────

interface LocaleEntry {
	locale: string;
	languages: string[];
	timezone: string;
	weight: number;
}

const LOCALES: Record<FingerprintOS, LocaleEntry[]> = {
	windows: [
		{ locale: "en-US", languages: ["en-US", "en"], timezone: "America/New_York", weight: 0.4 },
		{ locale: "en-US", languages: ["en-US", "en"], timezone: "America/Chicago", weight: 0.15 },
		{ locale: "en-US", languages: ["en-US", "en"], timezone: "America/Los_Angeles", weight: 0.15 },
		{ locale: "en-US", languages: ["en-US", "en"], timezone: "America/Denver", weight: 0.1 },
		{ locale: "en-GB", languages: ["en-GB", "en"], timezone: "Europe/London", weight: 0.1 },
		{ locale: "de-DE", languages: ["de-DE", "de", "en-US", "en"], timezone: "Europe/Berlin", weight: 0.1 },
	],
	macos: [
		{ locale: "en-US", languages: ["en-US", "en"], timezone: "America/New_York", weight: 0.4 },
		{ locale: "en-US", languages: ["en-US", "en"], timezone: "America/Los_Angeles", weight: 0.25 },
		{ locale: "en-GB", languages: ["en-GB", "en"], timezone: "Europe/London", weight: 0.15 },
		{ locale: "de-DE", languages: ["de-DE", "de", "en-US", "en"], timezone: "Europe/Berlin", weight: 0.1 },
		{ locale: "ja-JP", languages: ["ja-JP", "ja", "en-US", "en"], timezone: "Asia/Tokyo", weight: 0.1 },
	],
	linux: [
		{ locale: "en-US", languages: ["en-US", "en"], timezone: "America/New_York", weight: 0.3 },
		{ locale: "en-US", languages: ["en-US", "en"], timezone: "America/Los_Angeles", weight: 0.2 },
		{ locale: "en-US", languages: ["en-US", "en"], timezone: "UTC", weight: 0.2 },
		{ locale: "de-DE", languages: ["de-DE", "de", "en-US", "en"], timezone: "Europe/Berlin", weight: 0.15 },
		{ locale: "en-GB", languages: ["en-GB", "en"], timezone: "Europe/London", weight: 0.15 },
	],
};

// ─── Hardware Profiles per OS ────────────────────────────────────────────────

interface HardwareProfile {
	hardwareConcurrency: number;
	deviceMemory: number;
	weight: number;
}

const HARDWARE: Record<FingerprintOS, HardwareProfile[]> = {
	windows: [
		{ hardwareConcurrency: 8, deviceMemory: 8, weight: 0.3 },
		{ hardwareConcurrency: 12, deviceMemory: 16, weight: 0.25 },
		{ hardwareConcurrency: 16, deviceMemory: 16, weight: 0.2 },
		{ hardwareConcurrency: 4, deviceMemory: 4, weight: 0.15 },
		{ hardwareConcurrency: 24, deviceMemory: 32, weight: 0.1 },
	],
	macos: [
		{ hardwareConcurrency: 8, deviceMemory: 8, weight: 0.3 },
		{ hardwareConcurrency: 10, deviceMemory: 16, weight: 0.3 },
		{ hardwareConcurrency: 12, deviceMemory: 16, weight: 0.2 },
		{ hardwareConcurrency: 6, deviceMemory: 8, weight: 0.2 },
	],
	linux: [
		{ hardwareConcurrency: 8, deviceMemory: 8, weight: 0.35 },
		{ hardwareConcurrency: 4, deviceMemory: 4, weight: 0.3 },
		{ hardwareConcurrency: 12, deviceMemory: 16, weight: 0.2 },
		{ hardwareConcurrency: 16, deviceMemory: 32, weight: 0.15 },
	],
};

// ─── FingerprintGenerator ────────────────────────────────────────────────────

/**
 * Generates internally-consistent browser fingerprint profiles
 * weighted by real-world market share distribution.
 *
 * @example
 * ```typescript
 * const gen = new FingerprintGenerator();
 * const profile = gen.generate();
 * // profile.os, profile.userAgent, profile.webgl, etc. are all consistent
 *
 * // Seed for deterministic generation (useful for profile persistence)
 * const sameProfile = gen.generate("my-session-id");
 * ```
 */
export class FingerprintGenerator {
	private rng: () => number;

	/**
	 * @param seed Optional seed string for deterministic generation.
	 * Same seed always produces the same fingerprint profile.
	 */
	constructor(seed?: string) {
		if (seed) {
			let h = this.hashSeed(seed);
			this.rng = () => {
				h = (h ^ (h << 13)) & 0xffffffff;
				h = (h ^ (h >> 17)) & 0xffffffff;
				h = (h ^ (h << 5)) & 0xffffffff;
				return (h >>> 0) / 0xffffffff;
			};
		} else {
			this.rng = Math.random;
		}
	}

	/**
	 * Generate a complete, internally-consistent fingerprint profile.
	 * All properties are cross-validated to match the selected OS.
	 */
	generate(seed?: string): FingerprintProfile {
		const rng = seed ? this.createSeededRng(seed) : this.rng;

		// 1. Pick OS weighted by market share
		const os = this.weightedPick(Object.entries(OS_WEIGHTS) as [FingerprintOS, number][], rng);

		// 2. Pick UA consistent with OS
		const osUAs = USER_AGENTS.filter((ua) => ua.os === os);
		const uaEntry = osUAs[Math.floor(rng() * osUAs.length)]!;

		// 3. Pick screen consistent with OS
		const screen = this.weightedPick(SCREENS[os], rng);

		// 4. Pick WebGL consistent with OS
		const webglProfiles = WEBGL_PROFILES[os];
		const webgl = webglProfiles[Math.floor(rng() * webglProfiles.length)]!;

		// 5. Pick AudioContext consistent with OS
		const audioProfiles = AUDIO_PROFILES[os];
		const audio = audioProfiles[Math.floor(rng() * audioProfiles.length)]!;

		// 6. Font profile for OS
		const fonts = { ...FONT_PROFILES[os] };

		// 7. Pick locale/timezone consistent with OS
		const localeEntry = this.weightedPick(LOCALES[os], rng);

		// 8. Pick hardware consistent with OS
		const hw = this.weightedPick(HARDWARE[os], rng) ?? HARDWARE[os][0];

		// 9. Generate battery state
		const charging = rng() > 0.6;
		const battery = {
			charging,
			chargingTime: charging ? Math.floor(rng() * 7200) : Number.POSITIVE_INFINITY,
			dischargingTime: charging ? Number.POSITIVE_INFINITY : Math.floor(rng() * 14400) + 1800,
			level: Math.round((0.15 + rng() * 0.85) * 100) / 100,
		};

		// 10. WebRTC config
		const webrtc: WebRTCConfig = {
			enabled: true,
			localIPMask: `192.168.${Math.floor(rng() * 255)}.0/24`,
		};

		// 11. Build profile ID
		const id = this.hashSeed(`${uaEntry.ua}:${screen.width}x${screen.height}:${webgl.renderer}:${localeEntry.timezone}`)
			.toString(16)
			.padStart(8, "0");

		return {
			id,
			os,
			userAgent: uaEntry.ua,
			platform: uaEntry.platform,
			screen,
			webgl,
			audio,
			fonts,
			webrtc,
			timezone: localeEntry.timezone,
			locale: localeEntry.locale,
			languages: localeEntry.languages,
			hardwareConcurrency: hw.hardwareConcurrency,
			deviceMemory: hw.deviceMemory,
			battery,
		};
	}

	/**
	 * Validate that a fingerprint profile is internally consistent.
	 * Returns an array of consistency violations (empty = valid).
	 */
	validate(profile: FingerprintProfile): string[] {
		const violations: string[] = [];

		// UA must match OS
		if (profile.os === "windows" && !profile.userAgent.includes("Windows")) {
			violations.push("Windows OS but UA doesn't mention Windows");
		}
		if (profile.os === "macos" && !profile.userAgent.includes("Macintosh")) {
			violations.push("macOS OS but UA doesn't mention Macintosh");
		}
		if (profile.os === "linux" && !profile.userAgent.includes("Linux")) {
			violations.push("Linux OS but UA doesn't mention Linux");
		}

		// Platform must match OS
		if (profile.os === "windows" && profile.platform !== "Win32") {
			violations.push(`Windows OS but platform is ${profile.platform}`);
		}
		if (profile.os === "macos" && profile.platform !== "MacIntel") {
			violations.push(`macOS OS but platform is ${profile.platform}`);
		}
		if (profile.os === "linux" && !profile.platform.startsWith("Linux")) {
			violations.push(`Linux OS but platform is ${profile.platform}`);
		}

		// WebGL vendor must make sense for OS
		if (profile.os === "macos" && !profile.webgl.vendor.includes("Apple")) {
			violations.push(`macOS OS but WebGL vendor is ${profile.webgl.vendor}`);
		}
		if (profile.os === "windows" && profile.webgl.vendor.includes("Apple")) {
			violations.push(`Windows OS but WebGL vendor is Apple`);
		}
		if (profile.os === "linux" && profile.webgl.vendor.includes("Apple")) {
			violations.push(`Linux OS but WebGL vendor is Apple`);
		}

		// DPR must make sense for OS
		if (profile.os === "linux" && profile.screen.dpr > 1.5) {
			violations.push("Linux rarely has high-DPR displays");
		}

		// Languages must be a non-empty array
		if (!profile.languages.length) {
			violations.push("Languages array is empty");
		}

		// Hardware must be reasonable
		if (profile.hardwareConcurrency < 1 || profile.hardwareConcurrency > 64) {
			violations.push(`Unreasonable hardwareConcurrency: ${profile.hardwareConcurrency}`);
		}
		if (profile.deviceMemory < 1 || profile.deviceMemory > 128) {
			violations.push(`Unreasonable deviceMemory: ${profile.deviceMemory}`);
		}

		return violations;
	}

	// ─── Internal Helpers ──────────────────────────────────────────────────

	private weightedPick<T extends { weight: number }>(items: T[], rng: () => number): T;
	private weightedPick<T>(entries: [T, number][], rng: () => number): T;
	private weightedPick(items: any, rng: () => number): any {
		if (Array.isArray(items) && items.length > 0) {
			// Check if it's [value, weight][] or {weight}[]
			if (Array.isArray(items[0])) {
				// [value, weight][]
				const entries = items as [any, number][];
				const total = entries.reduce((sum, e) => sum + e[1], 0);
				let r = rng() * total;
				for (const [value, weight] of entries) {
					r -= weight;
					if (r <= 0) return value;
				}
				return entries[entries.length - 1]![0];
			}
			// { weight }[]
			const total = items.reduce((sum: number, item: any) => sum + item.weight, 0);
			let r = rng() * total;
			for (const item of items) {
				r -= item.weight;
				if (r <= 0) return item;
			}
			return items[items.length - 1];
		}
		return items[0];
	}

	private hashSeed(seed: string): number {
		let h = 0x811c9dc5;
		for (let i = 0; i < seed.length; i++) {
			h ^= seed.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return h >>> 0;
	}

	private createSeededRng(seed: string): () => number {
		let h = this.hashSeed(seed);
		return () => {
			h = (h ^ (h << 13)) & 0xffffffff;
			h = (h ^ (h >> 17)) & 0xffffffff;
			h = (h ^ (h << 5)) & 0xffffffff;
			return (h >>> 0) / 0xffffffff;
		};
	}
}

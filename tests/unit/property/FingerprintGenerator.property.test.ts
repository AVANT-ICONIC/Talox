/**
 * Property-based tests for FingerprintGenerator using fast-check.
 * Tests determinism, consistency, and range invariants with arbitrary seeds.
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { FingerprintGenerator } from "../../../src/core/FingerprintGenerator.js";
import type { FingerprintOS } from "../../../src/core/FingerprintGenerator.js";

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const seedArb = fc.oneof(
	fc.string({ minLength: 1, maxLength: 100 }),
	fc.constant(""),
	fc.uuid(),
	fc.webUrl(),
	fc.string({ minLength: 1, maxLength: 50 }),
);

const osArb: fc.Arbitrary<FingerprintOS> = fc.constantFrom<FingerprintOS>(
	"windows",
	"macos",
	"linux",
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OS_UA_MARKERS: Record<FingerprintOS, string> = {
	windows: "Windows",
	macos: "Macintosh",
	linux: "Linux",
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("FingerprintGenerator property tests", () => {
	// ── Determinism ─────────────────────────────────────────────────────────

	it("generate() on a fresh seeded instance always returns the same profile", () => {
		fc.assert(
			fc.property(
				seedArb.filter((s) => s.length > 0),
				(seed) => {
					const p1 = new FingerprintGenerator(seed).generate();
					const p2 = new FingerprintGenerator(seed).generate();
					expect(p1).toEqual(p2);
				},
			),
		);
	});

	it("separate seeded instances with the same seed produce identical profiles", () => {
		fc.assert(
			fc.property(
				seedArb.filter((s) => s.length > 0),
				(seed) => {
					const gen1 = new FingerprintGenerator(seed);
					const gen2 = new FingerprintGenerator(seed);
					const p1 = gen1.generate();
					const p2 = gen2.generate();
					expect(p1).toEqual(p2);
				},
			),
		);
	});

	it("generate(inlineSeed) produces identical results for the same inline seed", () => {
		fc.assert(
			fc.property(
				seedArb.filter((s) => s.length > 0),
				(seed) => {
					const gen = new FingerprintGenerator(); // unseeded constructor
					const p1 = gen.generate(seed);
					const p2 = gen.generate(seed);
					expect(p1).toEqual(p2);
				},
			),
		);
	});

	// ── OS-UA consistency ───────────────────────────────────────────────────

	it("userAgent contains the correct OS marker for the generated OS", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				const marker = OS_UA_MARKERS[profile.os];
				expect(profile.userAgent).toContain(marker);
			}),
		);
	});

	it("profile.validate() returns empty violations array for generated profiles", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				const violations = gen.validate(profile);
				expect(violations).toEqual([]);
			}),
		);
	});

	// ── hardwareConcurrency range ───────────────────────────────────────────

	it("hardwareConcurrency is always in [1, 64]", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				expect(profile.hardwareConcurrency).toBeGreaterThanOrEqual(1);
				expect(profile.hardwareConcurrency).toBeLessThanOrEqual(64);
			}),
		);
	});

	// ── deviceMemory range ──────────────────────────────────────────────────

	it("deviceMemory is always in [1, 128]", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				expect(profile.deviceMemory).toBeGreaterThanOrEqual(1);
				expect(profile.deviceMemory).toBeLessThanOrEqual(128);
			}),
		);
	});

	// ── Screen dimensions ───────────────────────────────────────────────────

	it("screen.width > 0, screen.height > 0, screen.dpr > 0", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				expect(profile.screen.width).toBeGreaterThan(0);
				expect(profile.screen.height).toBeGreaterThan(0);
				expect(profile.screen.dpr).toBeGreaterThan(0);
			}),
		);
	});

	// ── Languages non-empty ─────────────────────────────────────────────────

	it("languages is always a non-empty array", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				expect(profile.languages.length).toBeGreaterThan(0);
			}),
		);
	});

	// ── Battery level range ─────────────────────────────────────────────────

	it("battery.level is always in [0, 1]", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				expect(profile.battery.level).toBeGreaterThanOrEqual(0);
				expect(profile.battery.level).toBeLessThanOrEqual(1);
			}),
		);
	});

	// ── Profile ID is deterministic and non-empty ───────────────────────────

	it("profile.id is always a non-empty string", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				expect(profile.id.length).toBeGreaterThan(0);
			}),
		);
	});

	// ── Platform matches OS ─────────────────────────────────────────────────

	it("platform string is consistent with the selected OS", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				if (profile.os === "windows") {
					expect(profile.platform).toBe("Win32");
				} else if (profile.os === "macos") {
					expect(profile.platform).toBe("MacIntel");
				} else if (profile.os === "linux") {
					expect(profile.platform).toContain("Linux");
				}
			}),
		);
	});

	// ── WebGL vendor consistency ────────────────────────────────────────────

	it("WebGL vendor is consistent with OS (no Apple on Windows/Linux)", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				if (profile.os === "macos") {
					expect(profile.webgl.vendor).toContain("Apple");
				} else {
					expect(profile.webgl.vendor).not.toContain("Apple");
				}
			}),
		);
	});

	// ── AudioContext has valid sampleRate ───────────────────────────────────

	it("audio.sampleRate is either 44100 or 48000", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				expect([44100, 48000]).toContain(profile.audio.sampleRate);
			}),
		);
	});

	// ── Font profile is non-empty ───────────────────────────────────────────

	it("fonts.systemFonts is always non-empty", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				expect(profile.fonts.systemFonts.length).toBeGreaterThan(0);
			}),
		);
	});

	// ── OS is always one of the valid values ────────────────────────────────

	it("os is always one of 'windows', 'macos', or 'linux'", () => {
		fc.assert(
			fc.property(seedArb, (seed) => {
				const gen = new FingerprintGenerator(seed);
				const profile = gen.generate();
				expect(["windows", "macos", "linux"]).toContain(profile.os);
			}),
		);
	});
});

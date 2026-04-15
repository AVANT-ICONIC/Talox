/**
 * Tests for FingerprintGenerator — consistent fingerprint generation,
 * market-share weighting, deterministic seeding, and cross-validation.
 */
import { describe, expect, it } from "vitest";
import { FingerprintGenerator, type FingerprintOS } from "../../src/core/FingerprintGenerator.js";

describe("FingerprintGenerator", () => {
	describe("generate()", () => {
		it("generates a valid profile with all required fields", () => {
			const gen = new FingerprintGenerator();
			const fp = gen.generate();

			expect(fp.id).toBeTruthy();
			expect(fp.os).toBeDefined();
			expect(fp.userAgent).toBeTruthy();
			expect(fp.platform).toBeTruthy();
			expect(fp.screen).toBeDefined();
			expect(fp.screen.width).toBeGreaterThan(0);
			expect(fp.screen.height).toBeGreaterThan(0);
			expect(fp.screen.dpr).toBeGreaterThan(0);
			expect(fp.webgl).toBeDefined();
			expect(fp.webgl.vendor).toBeTruthy();
			expect(fp.webgl.renderer).toBeTruthy();
			expect(fp.audio).toBeDefined();
			expect(fp.audio.sampleRate).toBeGreaterThan(0);
			expect(fp.audio.maxChannelCount).toBeGreaterThan(0);
			expect(fp.audio.outputLatency).toBeGreaterThanOrEqual(0);
			expect(fp.fonts).toBeDefined();
			expect(fp.fonts.systemFonts.length).toBeGreaterThan(0);
			expect(fp.fonts.letterSpacingOffsetRange).toHaveLength(2);
			expect(fp.webrtc).toBeDefined();
			expect(fp.timezone).toBeTruthy();
			expect(fp.locale).toBeTruthy();
			expect(fp.languages.length).toBeGreaterThan(0);
			expect(fp.hardwareConcurrency).toBeGreaterThan(0);
			expect(fp.deviceMemory).toBeGreaterThan(0);
			expect(fp.battery).toBeDefined();
			expect(fp.battery.level).toBeGreaterThanOrEqual(0);
			expect(fp.battery.level).toBeLessThanOrEqual(1);
		});

		it("generates deterministic profiles with same seed", () => {
			const gen = new FingerprintGenerator();
			const a = gen.generate("test-seed-123");
			const b = gen.generate("test-seed-123");

			expect(a.id).toBe(b.id);
			expect(a.userAgent).toBe(b.userAgent);
			expect(a.os).toBe(b.os);
			expect(a.screen.width).toBe(b.screen.width);
			expect(a.screen.height).toBe(b.screen.height);
			expect(a.webgl.vendor).toBe(b.webgl.vendor);
			expect(a.webgl.renderer).toBe(b.webgl.renderer);
			expect(a.timezone).toBe(b.timezone);
			expect(a.locale).toBe(b.locale);
			expect(a.hardwareConcurrency).toBe(b.hardwareConcurrency);
			expect(a.deviceMemory).toBe(b.deviceMemory);
		});

		it("generates different profiles with different seeds", () => {
			const gen = new FingerprintGenerator();
			const a = gen.generate("seed-a");
			const b = gen.generate("seed-b");

			// At least one property should differ (statistically near-certain)
			const same =
				a.userAgent === b.userAgent &&
				a.screen.width === b.screen.width &&
				a.webgl.renderer === b.webgl.renderer &&
				a.timezone === b.timezone;
			expect(same).toBe(false);
		});

		it("generates random profiles without seed", () => {
			const gen = new FingerprintGenerator();
			const profiles = new Set<string>();
			for (let i = 0; i < 50; i++) {
				profiles.add(gen.generate().id);
			}
			// Should generate at least 30 unique profiles out of 50
			expect(profiles.size).toBeGreaterThan(30);
		});
	});

	describe("consistency", () => {
		it("Windows profiles have Windows UA and Win32 platform", () => {
			const gen = new FingerprintGenerator();
			let foundWindows = false;

			// Generate profiles until we hit Windows (72% chance per attempt)
			for (let i = 0; i < 20; i++) {
				const fp = gen.generate(`windows-test-${i}`);
				if (fp.os === "windows") {
					foundWindows = true;
					expect(fp.userAgent).toContain("Windows");
					expect(fp.platform).toBe("Win32");
					expect(fp.webgl.vendor).not.toContain("Apple");
					expect(fp.webgl.vendor).not.toContain("Mesa");
					break;
				}
			}
			expect(foundWindows).toBe(true);
		});

		it("macOS profiles have Macintosh UA and Apple GPU", () => {
			const gen = new FingerprintGenerator();
			let foundMac = false;

			for (let i = 0; i < 30; i++) {
				const fp = gen.generate(`mac-test-${i}`);
				if (fp.os === "macos") {
					foundMac = true;
					expect(fp.userAgent).toContain("Macintosh");
					expect(fp.platform).toBe("MacIntel");
					expect(fp.webgl.vendor).toContain("Apple");
					break;
				}
			}
			expect(foundMac).toBe(true);
		});

		it("Linux profiles have Linux UA and Mesa GPU", () => {
			const gen = new FingerprintGenerator();
			let foundLinux = false;

			for (let i = 0; i < 50; i++) {
				const fp = gen.generate(`linux-test-${i}`);
				if (fp.os === "linux") {
					foundLinux = true;
					expect(fp.userAgent).toContain("Linux");
					expect(fp.platform).toBe("Linux x86_64");
					// Linux should have Mesa or similar vendor, never Apple
					expect(fp.webgl.vendor).not.toContain("Apple");
					break;
				}
			}
			expect(foundLinux).toBe(true);
		});

		it("macOS profiles use grayscale subpixel AA", () => {
			const gen = new FingerprintGenerator();
			for (let i = 0; i < 30; i++) {
				const fp = gen.generate(`mac-aa-test-${i}`);
				if (fp.os === "macos") {
					expect(fp.fonts.subpixelAA).toBe("grayscale");
					break;
				}
			}
		});

		it("DPR > 1 is only for macOS (not Linux)", () => {
			const gen = new FingerprintGenerator();
			for (let i = 0; i < 50; i++) {
				const fp = gen.generate(`dpr-test-${i}`);
				if (fp.os === "linux") {
					expect(fp.screen.dpr).toBeLessThanOrEqual(1.5);
				}
			}
		});
	});

	describe("market share distribution", () => {
		it("generates roughly correct OS distribution", () => {
			const gen = new FingerprintGenerator();
			const counts: Record<FingerprintOS, number> = { windows: 0, macos: 0, linux: 0 };

			const N = 500;
			for (let i = 0; i < N; i++) {
				const fp = gen.generate(`dist-${i}`);
				counts[fp.os]++;
			}

			// Windows should be ~72% (allow ±15%)
			expect(counts.windows / N).toBeGreaterThan(0.55);
			expect(counts.windows / N).toBeLessThan(0.85);

			// macOS should be ~17% (allow ±10%)
			expect(counts.macos / N).toBeGreaterThan(0.07);

			// Linux should be ~4% (at least some)
			expect(counts.linux).toBeGreaterThan(0);
		});
	});

	describe("validate()", () => {
		it("returns no violations for a generated profile", () => {
			const gen = new FingerprintGenerator();
			for (let i = 0; i < 50; i++) {
				const fp = gen.generate(`validate-${i}`);
				const violations = gen.validate(fp);
				expect(violations).toEqual([]);
			}
		});

		it("detects OS/UA mismatch", () => {
			const gen = new FingerprintGenerator();
			const fp = gen.generate("mismatch-test");
			// Force a mismatch
			const bad = { ...fp, os: "macos" as FingerprintOS, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" };
			const violations = gen.validate(bad);
			expect(violations.length).toBeGreaterThan(0);
			expect(violations.some((v) => v.includes("UA doesn't mention"))).toBe(true);
		});

		it("detects OS/GPU mismatch", () => {
			const gen = new FingerprintGenerator();
			const fp = gen.generate("gpu-mismatch-test");
			const bad = {
				...fp,
				os: "windows" as FingerprintOS,
				platform: "Win32",
				userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
				webgl: { vendor: "Apple Inc.", renderer: "Apple M1" },
			};
			const violations = gen.validate(bad);
			expect(violations.some((v) => v.includes("Apple"))).toBe(true);
		});

		it("detects unreasonable hardware", () => {
			const gen = new FingerprintGenerator();
			const fp = gen.generate("hw-test");
			const bad = { ...fp, hardwareConcurrency: 128, deviceMemory: 256 };
			const violations = gen.validate(bad);
			expect(violations.some((v) => v.includes("hardwareConcurrency"))).toBe(true);
			expect(violations.some((v) => v.includes("deviceMemory"))).toBe(true);
		});
	});

	describe("constructor with seed", () => {
		it("produces deterministic output when constructed with seed", () => {
			const genA = new FingerprintGenerator("my-seed");
			const genB = new FingerprintGenerator("my-seed");

			const fpA = genA.generate();
			const fpB = genB.generate();

			expect(fpA.id).toBe(fpB.id);
			expect(fpA.userAgent).toBe(fpB.userAgent);
		});
	});
});

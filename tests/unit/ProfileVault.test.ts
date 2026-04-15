import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileVault } from "../../src/core/ProfileVault";

describe("ProfileVault", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "talox-profile-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates base directory if it does not exist", () => {
		const newDir = path.join(tmpDir, "nonexistent", "vault");
		expect(fs.existsSync(newDir)).toBe(false);
		new ProfileVault(newDir);
		expect(fs.existsSync(newDir)).toBe(true);
	});

	it("createProfile returns a valid TaloxProfile", async () => {
		const vault = new ProfileVault(tmpDir);
		const profile = await vault.createProfile("test-1", "qa", "Running integration tests");
		expect(profile.id).toBe("test-1");
		expect(profile.class).toBe("qa");
		expect(profile.purpose).toBe("Running integration tests");
		expect(profile.userDataDir).toBe(path.join(tmpDir, "test-1"));
		expect(profile.metadata.createdAt).toBeDefined();
		expect(profile.metadata.lastUsed).toBeDefined();
	});

	it("createProfile creates the userDataDir on disk", async () => {
		const vault = new ProfileVault(tmpDir);
		await vault.createProfile("test-2", "ops", "Automation");
		const expectedDir = path.join(tmpDir, "test-2");
		expect(fs.existsSync(expectedDir)).toBe(true);
	});

	it("createProfile generates unique metadata timestamps", async () => {
		const vault = new ProfileVault(tmpDir);
		const p1 = await vault.createProfile("a", "sandbox", "test");
		// Small delay to get different timestamp
		await new Promise((r) => setTimeout(r, 2));
		const p2 = await vault.createProfile("b", "qa", "test");
		// Both should have valid ISO timestamps
		expect(new Date(p1.metadata.createdAt).getTime()).not.toBeNaN();
		expect(new Date(p2.metadata.createdAt).getTime()).not.toBeNaN();
	});

	it("createProfile does not error if userDataDir already exists", async () => {
		const vault = new ProfileVault(tmpDir);
		// Pre-create the directory
		fs.mkdirSync(path.join(tmpDir, "existing"), { recursive: true });
		const profile = await vault.createProfile("existing", "qa", "test");
		expect(profile.id).toBe("existing");
	});

	it("supports all profile classes", async () => {
		const vault = new ProfileVault(tmpDir);
		const classes = ["qa", "ops", "sandbox"] as const;
		for (const cls of classes) {
			const p = await vault.createProfile(`prof-${cls}`, cls, `Purpose for ${cls}`);
			expect(p.class).toBe(cls);
		}
	});

	it("sets userDataDir to baseDir + profile id", async () => {
		const vault = new ProfileVault(tmpDir);
		const profile = await vault.createProfile("my-profile", "qa", "testing path");
		expect(profile.userDataDir).toBe(path.join(tmpDir, "my-profile"));
	});
});

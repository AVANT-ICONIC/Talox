import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProfileVault } from "../../src/core/ProfileVault";

async function removeDir(dir: string): Promise<void> {
	if (!fs.existsSync(dir)) return;
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch (e: any) {
		if (e.code === "ENOTEMPTY") {
			await new Promise((r) => setTimeout(r, 100));
			fs.rmSync(dir, { recursive: true, force: true });
		}
	}
}

describe("ProfileVault", () => {
	const testDir = path.join(__dirname, "../temp-profiles");

	beforeEach(async () => {
		await removeDir(testDir);
	});

	afterEach(async () => {
		await removeDir(testDir);
	});

	it("should create a new profile", async () => {
		const vault = new ProfileVault(testDir);
		const profile = await vault.createProfile("test-qa", "qa", "Testing");
		expect(profile.id).toBe("test-qa");
		expect(profile.class).toBe("qa");
		expect(fs.existsSync(path.join(testDir, "test-qa"))).toBe(true);
	});
});

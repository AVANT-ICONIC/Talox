import fs from "node:fs";
import path from "node:path";
import type { ProfileClass, TaloxProfile } from "../types/index.js";

export class ProfileVault {
	constructor(private readonly baseDir: string) {
		if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
	}

	async createProfile(id: string, profileClass: ProfileClass, purpose: string): Promise<TaloxProfile> {
		const userDataDir = path.join(this.baseDir, id);
		if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

		const profile: TaloxProfile = {
			id,
			class: profileClass,
			purpose,
			userDataDir,
			metadata: {
				createdAt: new Date().toISOString(),
				lastUsed: new Date().toISOString(),
			},
		};

		return profile;
	}
}

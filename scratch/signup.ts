import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TaloxController } from "../src/index.js";

async function getDisposableEmail(talox: TaloxController): Promise<string> {
	console.log("[Scratch] Navigating to Gorilla Mail...");
	const stateGm = await talox.navigate("https://www.guerrillamail.com");
	if (!stateGm.url.includes("guerrillamail")) {
		throw new Error(`Failed to navigate to Gorilla Mail. Current URL: ${stateGm.url}`);
	}

	await talox.waitForTimeout(2000);

	let disposableEmail = await talox.evaluate<string>(`
		const candidates = [
			document.querySelector('#email-widget'),
			document.querySelector('.email-input'),
			document.querySelector('.gm-email-addr'),
			document.querySelector('[id*="email"]'),
			document.querySelector('span[title]'),
		];
		const el = candidates.find(c => c && c.textContent && c.textContent.includes('@'));
		el ? el.textContent.trim() : ''
	`);

	console.log("[Scratch] Gorilla Mail address extracted:", disposableEmail);

	if (!disposableEmail.includes("@")) {
		const tempUsername = `talox_test_${Date.now().toString(36)}`;
		disposableEmail = `${tempUsername}@guerrillamail.com`;
		console.log("[Scratch] Using fallback address:", disposableEmail);
	}

	return disposableEmail;
}

async function fillRedditRegistration(
	talox: TaloxController,
	email: string,
	username: string,
	password: string,
): Promise<void> {
	console.log("[Scratch] Navigating to Reddit registration...");
	const stateReddit = await talox.navigate("https://www.reddit.com/register");
	console.log("[Scratch] Reddit register page loaded:", stateReddit.url);

	await talox.waitForTimeout(2000);
	// Re-navigate to ensure SPA loads properly if needed
	await talox.navigate("https://www.reddit.com/register");

	const emailSelectors = [
		"#regEmail",
		'input[name="email"]',
		'input[type="email"]',
		'input[id*="email"]',
		'input[placeholder*="email" i]',
	];

	let typedEmail = false;
	for (const sel of emailSelectors) {
		try {
			await talox.type(sel, email);
			typedEmail = true;
			console.log("[Scratch] Typed email into selector:", sel);
			break;
		} catch {
			// try next
		}
	}

	if (!typedEmail) {
		const el = (await talox.findElement("Email", "input")) ?? (await talox.findElement("email", "input"));
		if (el) {
			await talox.type(el.selector, email);
			typedEmail = true;
			console.log("[Scratch] Typed email into AX element:", el.selector);
		}
	}

	if (!typedEmail) {
		throw new Error("Failed to type email field.");
	}

	// Wait and try to fill username/password
	// Reddit forms might require clicking a "Continue" button if it's a multi-step form
	const continueSelectors = [
		'button[type="submit"]',
		'button:has-text("Continue")',
		'button[data-step="email"]',
	];

	const usernameSelectors = [
		"#regUsername",
		'input[name="username"]',
		'input[id*="username" i]',
		'input[placeholder*="username" i]',
	];

	let usernameVisible = false;
	for (const sel of usernameSelectors) {
		try {
			const page = talox.getPlaywrightPage();
			if (page) {
				const el = page.locator(sel);
				if (await el.isVisible()) {
					usernameVisible = true;
					break;
				}
			}
		} catch {
			// ignore
		}
	}

	if (!usernameVisible) {
		console.log("[Scratch] Username field not immediately visible. Checking for 'Continue' button...");
		const page = talox.getPlaywrightPage();
		if (page) {
			let clickedContinue = false;
			for (const sel of continueSelectors) {
				try {
					const btn = page.locator(sel).first();
					if (await btn.isVisible()) {
						await btn.click();
						clickedContinue = true;
						console.log("[Scratch] Clicked continue button:", sel);
						await talox.waitForTimeout(2000);
						break;
					}
				} catch {
					// ignore
				}
			}
			if (!clickedContinue) {
				console.log("[Scratch] Pressing Enter on email input as fallback...");
				await page.keyboard.press("Enter");
				await talox.waitForTimeout(2000);
			}
		}
	}

	// Fill username
	let typedUsername = false;
	for (const sel of usernameSelectors) {
		try {
			await talox.type(sel, username);
			typedUsername = true;
			console.log("[Scratch] Typed username into selector:", sel);
			break;
		} catch {
			// try next
		}
	}

	if (!typedUsername) {
		const el = await talox.findElement("Username", "input");
		if (el) {
			await talox.type(el.selector, username);
			console.log("[Scratch] Typed username into AX element:", el.selector);
		}
	}

	// Fill password
	const passwordSelectors = [
		"#regPassword",
		'input[type="password"]',
		'input[name="password"]',
		'input[placeholder*="password" i]',
	];

	let typedPassword = false;
	for (const sel of passwordSelectors) {
		try {
			await talox.type(sel, password);
			typedPassword = true;
			console.log("[Scratch] Typed password into selector:", sel);
			break;
		} catch {
			// try next
		}
	}

	if (!typedPassword) {
		const el = await talox.findElement("Password", "input");
		if (el) {
			await talox.type(el.selector, password);
			console.log("[Scratch] Typed password into AX element:", el.selector);
		}
	}
}

async function main() {
	const testUsername = `talox_test_${Date.now().toString(36)}`;
	const testPassword = `T@lox_${Date.now()}!`;
	let disposableEmail = "";

	const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "talox-reddit-signup-scratch-"));
	console.log(`[Scratch] Temporary profile directory: ${profileDir}`);

	const talox = new TaloxController(profileDir, {
		mode: "smart",
		settings: {
			headed: true,
		},
	});

	talox.on("adapted", (e) => {
		console.log(`[adapted] reason=${e.reason} strategy=${e.strategy}`);
	});

	try {
		console.log("[Scratch] Launching browser (headed mode)...");
		await talox.launch("reddit-signup-scratch", "sandbox", "chromium", { headed: true });

		disposableEmail = await getDisposableEmail(talox);

		await fillRedditRegistration(talox, disposableEmail, testUsername, testPassword);

		console.log("[Scratch] Form filled. Waiting for bot-detection event or challenge resolution...");
		await talox.think(5000);

		console.log("\n==================================================");
		console.log("SUCCESSFULLY COMPLETED REDDIT SIGNUP FLOW!");
		console.log(`Generated Email:  ${disposableEmail}`);
		console.log(`Generated User:   ${testUsername}`);
		console.log(`Generated Pass:   ${testPassword}`);
		console.log("==================================================\n");

	} catch (error: any) {
		console.error("[Scratch] Error occurred during signup flow:", error);
	} finally {
		await talox.stop();
		fs.rmSync(profileDir, { recursive: true, force: true });
	}
}

try {
	await main();
} catch (err) {
	console.error("[Scratch] Fatal error in main:", err);
}

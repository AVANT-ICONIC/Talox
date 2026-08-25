import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TaloxController } from "../../../src/core/controller/TaloxController.js";

describe("default navigation readiness", () => {
	let talox: TaloxController;
	let profileDir: string;
	let server: http.Server;
	let origin: string;

	beforeAll(async () => {
		server = http.createServer((req, res) => {
			if (req.url === "/hang") {
				res.writeHead(200, { "content-type": "text/plain" });
				res.write("connection intentionally left open");
				return;
			}

			res.writeHead(200, { "content-type": "text/html" });
			res.end(`<!doctype html>
<html>
<head><title>spa-ready</title></head>
<body>
	<h1>Ready while background network stays busy</h1>
	<label for="email">Email</label>
	<input id="email" name="email" type="email" />
	<script>fetch('/hang').catch(() => {});</script>
</body>
</html>`);
		});

		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address() as AddressInfo;
		origin = `http://127.0.0.1:${address.port}`;

		profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "talox-default-navigation-"));
		talox = new TaloxController(profileDir, {
			settings: {
				automaticThinkingEnabled: false,
				humanStealth: 0,
				fidgetEnabled: false,
				safeMode: true,
			},
		});
		await talox.launch("default-navigation-readiness", "sandbox", "chromium");

		// Consume first-navigation warmup outside the timed assertion. This test is
		// specifically about completion semantics once a modern SPA starts loading.
		await talox.navigate("about:blank");
	});

	afterAll(async () => {
		await talox?.stop().catch(() => {});
		server?.closeAllConnections();
		await new Promise<void>((resolve) => server?.close(() => resolve()));
		if (profileDir) fs.rmSync(profileDir, { recursive: true, force: true });
	});

	it("returns actionable page state without waiting for background network to become idle", async () => {
		expect(talox.settings.navigationWaitUntil).toBe("domcontentloaded");

		const startedAt = Date.now();
		const state = await talox.navigate(origin);
		const elapsedMs = Date.now() - startedAt;

		expect(state.url).toContain(origin);
		expect(state.title).toBe("spa-ready");
		expect(state.nodes.some((node) => node.role === "textbox" || node.id === "#email")).toBe(true);
		expect(elapsedMs).toBeLessThan(5_000);
	});
});

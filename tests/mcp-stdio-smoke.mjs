import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

const child = spawn(process.execPath, ["dist/cli/entry.js", "mcp"], {
	cwd: process.cwd(),
	stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuffer = "";
let stderrBuffer = "";
const pending = new Map();

function failPending(error) {
	for (const entry of pending.values()) {
		clearTimeout(entry.timer);
		entry.reject(error);
	}
	pending.clear();
}

child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
	stderrBuffer += chunk;
});

child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
	stdoutBuffer += chunk;
	for (;;) {
		const newline = stdoutBuffer.indexOf("\n");
		if (newline < 0) break;
		const line = stdoutBuffer.slice(0, newline).trim();
		stdoutBuffer = stdoutBuffer.slice(newline + 1);
		if (!line) continue;

		let message;
		try {
			message = JSON.parse(line);
		} catch (error) {
			failPending(new Error(`Talox MCP wrote non-JSON data to stdout: ${line}`, { cause: error }));
			continue;
		}

		const entry = pending.get(message.id);
		if (!entry) continue;
		clearTimeout(entry.timer);
		pending.delete(message.id);
		entry.resolve(message);
	}
});

child.once("error", failPending);
child.once("exit", (code, signal) => {
	if (pending.size > 0) {
		failPending(new Error(`Talox MCP exited before responding (code=${code}, signal=${signal}). stderr: ${stderrBuffer}`));
	}
});

function write(message) {
	child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(id, method, params = {}) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`Timed out waiting for MCP response to ${method}. stderr: ${stderrBuffer}`));
		}, 7_500);
		entryUnref(timer);
		pending.set(id, { resolve, reject, timer });
		write({ jsonrpc: "2.0", id, method, params });
	});
}

function entryUnref(timer) {
	timer.unref?.();
}

async function stopChild() {
	if (child.exitCode !== null || child.signalCode !== null) return;
	child.kill("SIGTERM");
	const timeout = new Promise((resolve) => {
		const timer = setTimeout(() => resolve("timeout"), 5_000);
		entryUnref(timer);
	});
	const outcome = await Promise.race([once(child, "exit").then(() => "exit"), timeout]);
	if (outcome === "timeout") {
		child.kill("SIGKILL");
		await once(child, "exit");
		throw new Error(`Talox MCP did not shut down after SIGTERM. stderr: ${stderrBuffer}`);
	}
}

try {
	const initialized = await request(1, "initialize", {
		protocolVersion: "2025-11-25",
		capabilities: {},
		clientInfo: { name: "talox-stdio-smoke", version: "1.0.0" },
	});
	assert.equal(initialized.error, undefined, JSON.stringify(initialized.error));
	assert.equal(initialized.result?.serverInfo?.name, "talox");

	write({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

	const tools = await request(2, "tools/list");
	assert.equal(tools.error, undefined, JSON.stringify(tools.error));
	const names = new Set((tools.result?.tools ?? []).map((tool) => tool.name));
	for (const name of [
		"launch_session",
		"stop_session",
		"list_sessions",
		"health",
		"navigate",
		"click",
		"type",
		"get_state",
		"screenshot",
	]) {
		assert(names.has(name), `Missing MCP tool: ${name}`);
	}

	const health = await request(3, "tools/call", { name: "health", arguments: {} });
	assert.equal(health.error, undefined, JSON.stringify(health.error));
	assert.notEqual(health.result?.isError, true);
	assert.equal(health.result?.structuredContent?.status, "ok");
	assert.equal(health.result?.structuredContent?.activeSessions, 0);

	assert.match(stderrBuffer, /Talox MCP.*stdio/i);
	console.log("Talox MCP stdio smoke passed");
} finally {
	await stopChild();
}

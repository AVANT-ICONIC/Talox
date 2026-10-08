import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserResourceUsage } from "./types.js";

const run = promisify(execFile);

/** Samples only explicitly identified, owned browser processes. Missing readings stay unread. */
export async function sampleBrowserProcesses(pids: readonly number[]): Promise<BrowserResourceUsage> {
	if (pids.length === 0)
		return { rssBytes: null, cpuPercent: null, status: "unread", error: "No active browser process" };
	if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) throw new Error("Invalid browser PID");
	if (process.platform === "win32")
		return { rssBytes: null, cpuPercent: null, status: "unread", error: "Resource sampling supports macOS and Linux" };
	const { stdout } = await run("ps", ["-o", "pid=,rss=,pcpu=", "-p", Array.from(new Set(pids)).join(",")], {
		timeout: 2000,
		maxBuffer: 128 * 1024,
	});
	const lines = stdout.trim().split("\n");
	if (!stdout.trim() || lines.length !== new Set(pids).size) throw new Error("Incomplete browser resource reading");
	let rssBytes = 0;
	let cpuPercent = 0;
	for (const line of lines) {
		const [pid, rss, cpu] = line.trim().split(/\s+/).map(Number);
		if (
			!pids.includes(pid ?? 0) ||
			rss === undefined ||
			cpu === undefined ||
			!Number.isFinite(rss) ||
			!Number.isFinite(cpu) ||
			rss < 0 ||
			cpu < 0
		)
			throw new Error("Unread browser resource reading");
		rssBytes += rss * 1024;
		cpuPercent += cpu;
	}
	return { rssBytes, cpuPercent, status: "available" };
}

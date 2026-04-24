/**
 * @file helpers.ts
 * @description Local fixture HTTP server for E2E tests.
 * Serves static HTML files from tests/e2e/fixtures/ and tests/manual/.
 * Zero external dependencies — uses Node's built-in http module.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
};

export interface FixtureServer {
	/** Base URL of the running server, e.g. http://localhost:3210 */
	url: string;
	/** Stop the server and release the port */
	close: () => Promise<void>;
}

/**
 * Start a local HTTP server that serves fixture files.
 *
 * Serves from two directories in order:
 * 1. tests/e2e/fixtures/
 * 2. tests/manual/  (fallback)
 *
 * @param port - Port number to listen on (default: 3210)
 * @returns { url, close } — the base URL and a cleanup function
 */
export function startFixtureServer(port = 0): Promise<FixtureServer> {
	const fixturesDir = path.resolve(__dirname, "fixtures");
	const manualDir = path.resolve(__dirname, "..", "manual");

	const server = http.createServer((req, res) => {
		const urlPath = req.url?.split("?")[0] || "/";
		// Default to index.html for root
		const filePath = urlPath === "/" ? "/index.html" : urlPath;

		const fullPath = path.join(fixturesDir, filePath);
		const manualPath = path.join(manualDir, filePath);

		// Try fixtures first, then manual
		const resolvedPath = fs.existsSync(fullPath) ? fullPath : manualPath;

		if (!fs.existsSync(resolvedPath)) {
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not Found");
			return;
		}

		const ext = path.extname(resolvedPath);
		const contentType = MIME_TYPES[ext] || "application/octet-stream";

		try {
			const content = fs.readFileSync(resolvedPath);
			res.writeHead(200, { "Content-Type": contentType });
			res.end(content);
		} catch {
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	});

	return new Promise((resolve, reject) => {
		server.on("error", reject);
		server.listen(port, () => {
			const addr = server.address();
			const actualPort = typeof addr === "object" && addr ? addr.port : port;
			resolve({
				url: `http://localhost:${actualPort}`,
				close: () =>
					new Promise<void>((res, rej) => {
						server.close((err) => (err ? rej(err) : res()));
					}),
			});
		});
	});
}

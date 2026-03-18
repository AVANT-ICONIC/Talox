// tests/e2e/fixtures/server.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = path.join(__dirname, 'pages');
const PORT = 9999;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
};

http.createServer((req, res) => {
  // Special route: always returns 429 — used by rate-limit.html tests
  if (req.url === '/api/data') {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Too Many Requests' }));
  }

  // Strip query string to prevent path corruption
  const pathname = new URL(req.url, 'http://x').pathname;
  const filePath = path.join(PAGES_DIR, pathname === '/' ? 'index.html' : pathname);

  // Prevent path traversal
  if (!filePath.startsWith(PAGES_DIR + path.sep) && filePath !== PAGES_DIR) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const ext = path.extname(filePath);

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'text/plain' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () =>
  console.log(`[Talox fixtures] http://localhost:${PORT}`)
);

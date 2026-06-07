// Minimal zero-dependency static server for the Password Manager login test.
// Usage (Windows or any OS):  node tools/login-test/serve.mjs
// Then open in Alpha:         localhost:8099/login.html
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 8099;

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/login.html';
    // Prevent path traversal: resolve within ROOT only.
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    const body = await readFile(filePath);
    res.statusCode = 200;
    res.setHeader('content-type', TYPES[extname(filePath)] ?? 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[login-test] serving ${ROOT} at http://localhost:${PORT}/login.html`);
});

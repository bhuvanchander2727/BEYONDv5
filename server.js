// BEYOND - Local Development Server
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const DEFAULT_PORT = parseInt(process.env.PORT, 10) || 3000;
const ROOT_DIR = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

function safeResolve(reqPath) {
  try {
    const decoded = decodeURIComponent(reqPath);
    const normalized = path.normalize(decoded).replace(/^(\.\.[\/\\])+/, '');
    const fullPath = path.join(ROOT_DIR, normalized);
    if (!fullPath.startsWith(ROOT_DIR)) {
      return null;
    }
    return fullPath;
  } catch {
    return null;
  }
}

function resolveFile(pathname) {
  let candidate = safeResolve(pathname);
  if (!candidate) return null;

  // 1. Exact match file
  if (fs.existsSync(candidate)) {
    const stat = fs.statSync(candidate);
    if (stat.isFile()) return candidate;
    if (stat.isDirectory()) {
      const idx = path.join(candidate, 'index.html');
      if (fs.existsSync(idx)) return idx;
    }
  }

  // 2. Clean URLs (e.g. /admin -> /admin/index.html or /about -> /about.html)
  const htmlCandidate = candidate + '.html';
  if (fs.existsSync(htmlCandidate) && fs.statSync(htmlCandidate).isFile()) {
    return htmlCandidate;
  }

  // 3. Rewrites based on vercel.json:
  // /admin/* -> /admin/index.html
  if (pathname.startsWith('/admin')) {
    const adminIndex = path.join(ROOT_DIR, 'admin', 'index.html');
    if (fs.existsSync(adminIndex)) return adminIndex;
  }

  // 4. Fallback for SPA routing if no file extension
  if (!path.extname(pathname)) {
    const rootIndex = path.join(ROOT_DIR, 'index.html');
    if (fs.existsSync(rootIndex)) return rootIndex;
  }

  return null;
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);
  const pathname = parsedUrl.pathname || '/';

  // Support CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  const targetFile = resolveFile(pathname);

  if (!targetFile || !fs.existsSync(targetFile)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="en">
      <head><title>404 Not Found</title></head>
      <body style="font-family:sans-serif;background:#0d0d0d;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;">
          <h1 style="font-size:3rem;margin-bottom:0.5rem;">404</h1>
          <p style="color:#888;">Resource not found: ${pathname}</p>
          <a href="/" style="color:#fff;text-decoration:underline;">Return to Storefront</a>
        </div>
      </body>
      </html>
    `);
    return;
  }

  const ext = path.extname(targetFile).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const stat = fs.statSync(targetFile);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(targetFile);
    stream.pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error: ' + err.message);
  }
});

function startServer(port) {
  server.listen(port, () => {
    console.log('\n==================================================');
    console.log('  ⚡ BEYOND Local Development Server Running');
    console.log('==================================================');
    console.log(`  ➜ Local Storefront:  http://localhost:${port}/`);
    console.log(`  ➜ Admin Portal:      http://localhost:${port}/admin/`);
    console.log('==================================================\n');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(DEFAULT_PORT);

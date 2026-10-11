// Server demo lokal tanpa akun apa pun: Redis, JayaPay, dan GitHub palsu (dari test/mocks.js).
// Berguna untuk melihat tampilan dan alur: node test/ui-server.js  ->  http://localhost:3000
// Kontrol pembayaran palsu: /__mock?status=settlement | expire, /__mock?advance=10000, /__mock?release=ORDER_ID
const http = require('http');
const fs = require('fs');
const path = require('path');
const { jp, gh, advance } = require('./mocks');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function api(url) {
  const m = /^\/api\/([\w-]+)(?:\/([\w-]+))?$/.exec(url.pathname);
  if (!m) return null;
  const [, a, b] = m;
  const file = b ? path.join(ROOT, 'api', a, '[action].js') : path.join(ROOT, 'api', a + '.js');
  return fs.existsSync(file) ? { handler: require(file), action: b } : null;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__mock') {
    if (url.searchParams.get('status')) jp.status = url.searchParams.get('status');
    if (url.searchParams.get('advance')) advance(Number(url.searchParams.get('advance')));
    if (url.searchParams.get('release')) gh.released.add(url.searchParams.get('release'));
    res.end('ok');
    return;
  }
  const hit = api(url);
  if (hit) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      req.query = Object.fromEntries(url.searchParams);
      if (hit.action) req.query.action = hit.action;
      try { req.body = raw ? JSON.parse(raw) : undefined; } catch { req.body = raw; }
      res.status = (c) => { res.statusCode = c; return res; };
      res.json = (j) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(j)); return res; };
      Promise.resolve(hit.handler(req, res)).catch((e) => { console.error(e); res.statusCode = 500; res.end('error'); });
    });
    return;
  }
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = path.join(ROOT, 'public', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (file.startsWith(path.join(ROOT, 'public')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    return res.end(fs.readFileSync(file));
  }
  res.statusCode = 404;
  res.end('not found');
}).listen(PORT, () => console.log(`Demo di http://localhost:${PORT} (admin: bos / rahasia-admin-123)`));

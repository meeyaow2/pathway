// Minimal static server that mimics GitHub Pages for local testing: serves public/ under /pathway/,
// gzip-compresses text assets and sends Cache-Control: max-age=600. No dependencies.
// Usage: node tests/serve.js [port]   → http://127.0.0.1:8765/pathway/
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..', 'public'), PORT = Number(process.argv[2] || 8765), BASE = '/pathway/';
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.gz': 'application/gzip'};
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/pathway') { res.writeHead(301, {Location: BASE}); return res.end(); }
  if (!url.pathname.startsWith(BASE)) { res.writeHead(404); return res.end('Not found'); }
  let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname.slice(BASE.length))));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const headers = {'Content-Type': type, 'Cache-Control': 'max-age=600'};
    if (/text|javascript|json|svg|wasm/.test(type) && /gzip/.test(req.headers['accept-encoding'] || '')) { headers['Content-Encoding'] = 'gzip'; data = zlib.gzipSync(data); }
    res.writeHead(200, headers); res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log('Pathway at http://127.0.0.1:' + PORT + BASE));

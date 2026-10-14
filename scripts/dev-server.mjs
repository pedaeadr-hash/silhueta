// Servidor local sem dependências:  node scripts/dev-server.mjs [porta]
// Envia os mesmos cabeçalhos do vercel.json (inclusive o isolamento que libera múltiplas threads no WASM).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 5173);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    let file = normalize(join(root, path));
    if (!file.startsWith(root)) { res.writeHead(403).end('403'); return; }
    let info = await stat(file).catch(() => null);
    if (info && info.isDirectory()) { file = join(file, 'index.html'); info = await stat(file).catch(() => null); }   // /prototipos → prototipos/index.html
    if (!info && !extname(file)) { file += '.html'; info = await stat(file).catch(() => null); }   // /converter → converter.html
    if (!info || !info.isFile()) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404'); return; }
    res.writeHead(200, {
      'content-type': types[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp'
    });
    res.end(await readFile(file));
  } catch (err) { res.writeHead(500).end(String(err)); }
}).on('error', err => {
  if (err.code === 'EADDRINUSE') console.error(`A porta ${port} já está em uso (o Silhueta provavelmente já está rodando). Abra http://localhost:${port} ou use outra porta: node scripts/dev-server.mjs 5200`);
  else console.error(err);
  process.exit(1);
}).listen(port, () => console.log(`Silhueta em http://localhost:${port}  (Ctrl+C para parar)`));

/**
 * Local dev server for China networks:
 * - Serves static files from public/
 * - Routes /api/* to Pages Functions (same modules as production)
 * - Uses undici ProxyAgent so outbound fetch works via system HTTP proxy
 *
 * Usage:
 *   node scripts/local-dev.mjs
 *   # open http://127.0.0.1:8788
 *
 * Optional .dev.vars:
 *   GMGN_API_KEY=...
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.HOST || '127.0.0.1';

// --- Proxy for outbound API calls (Dex / GT / GMGN) ---
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  process.env.https_proxy ||
  process.env.http_proxy ||
  '';
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[local-dev] using proxy ${proxyUrl}`);
} else {
  console.log('[local-dev] no HTTP_PROXY set — outbound may fail in restricted networks');
}

// Patch global fetch so Pages Function modules use undici+proxy
globalThis.fetch = undiciFetch;

// --- Load .dev.vars ---
function loadDevVars() {
  const env = { ...process.env };
  const p = path.join(ROOT, '.dev.vars');
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}
const env = loadDevVars();
if (env.GMGN_API_KEY) console.log('[local-dev] GMGN_API_KEY loaded from .dev.vars');
else console.log('[local-dev] GMGN_API_KEY not set — public backup sources only');

// --- API routes map to functions/api/*.js ---
const API_ROUTES = {
  '/api/trending': '../functions/api/trending.js',
  '/api/smartmoney': '../functions/api/trending.js',
  '/api/kol': '../functions/api/trending.js',
  '/api/token-info': '../functions/api/trending.js',
  '/api/chains': '../functions/api/chains.js',
  '/api/othercoin': '../functions/api/othercoin.js',
  '/api/bitcoin': '../functions/api/bitcoin.js',
  '/api/btc': '../functions/api/btc.js',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function buildContext(req, url) {
  return {
    request: req,
    env,
    waitUntil() {},
    passThroughOnException() {},
  };
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  // match exact or trending-style multi-route file
  let modPath = API_ROUTES[pathname];
  if (!modPath && pathname.startsWith('/api/')) {
    // fallback: /api/foo → functions/api/foo.js
    const name = pathname.replace(/^\/api\//, '').split('/')[0];
    const candidate = path.join(ROOT, 'functions', 'api', `${name}.js`);
    if (fs.existsSync(candidate)) modPath = `../functions/api/${name}.js`;
  }
  if (!modPath) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path: pathname }));
    return;
  }

  try {
    const abs = path.resolve(__dirname, modPath);
    // bust cache so edits hot-reload
    const href = pathToFileURL(abs).href + `?t=${Date.now()}`;
    const mod = await import(href);
    if (typeof mod.onRequest !== 'function') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'onRequest missing' }));
      return;
    }

    // Reconstruct Fetch API Request for the function
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v != null) headers.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const body =
      req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : await new Promise((resolve, reject) => {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
          });

    const fullUrl = `http://${HOST}:${PORT}${url.pathname}${url.search}`;
    const fetchReq = new Request(fullUrl, { method: req.method, headers, body });
    const context = { request: fetchReq, env, waitUntil() {}, passThroughOnException() {} };
    const response = await mod.onRequest(context);

    const outHeaders = {};
    response.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    res.writeHead(response.status, outHeaders);
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (e) {
    console.error('[api]', pathname, e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: e.message || String(e) }));
  }
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  const t0 = Date.now();
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end('Internal error');
    }
  } finally {
    console.log(`${req.method} ${url.pathname}${url.search} ${Date.now() - t0}ms`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[local-dev] http://${HOST}:${PORT}`);
  console.log('[local-dev] multi-source: GMGN → DexScreener search/boosts → GeckoTerminal');
});

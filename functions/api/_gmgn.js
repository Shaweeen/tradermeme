/**
 * GMGN OpenAPI client for Cloudflare Pages Functions.
 *
 * Mirrors gmgn-cli's OpenApiClient.sign() logic but works in the
 * Workers/V8 isolate runtime (no Node crypto.sign, no PEM from fs).
 *
 * Auth modes (per gmgn-cli's OpenApiClient.js):
 *   - Exist: just X-APIKEY header + `timestamp` + `client_id` query params.
 *     Used for: market/token/track/portfolio read-only endpoints.
 *   - Signed: Exist + X-Signature header. Required for trade/swap/order/portfolio
 *     holdings. NOT IMPLEMENTED HERE (would need a private key, and putting a
 *     signing key on CF Pages is a non-starter for most setups).
 *
 * Endpoint host: https://openapi.gmgn.ai (per config.js).
 *
 * Reads credentials from (in order):
 *   - context.env.GMGN_API_KEY + context.env.GMGN_PRIVATE_KEY (preferred)
 *   - Wrangler Pages secret binding of the same names
 *
 * You must NOT bake keys into wrangler.toml; use `wrangler pages secret put GMGN_API_KEY`.
 */

const GMGN_HOST = 'https://openapi.gmgn.ai';

/**
 * Build timestamp + client_id per signer.js buildAuthQuery().
 */
function buildAuthQuery() {
  return {
    timestamp: Math.floor(Date.now() / 1000),
    client_id: crypto.randomUUID(),
  };
}

/**
 * Make an authenticated read-only request to GMGN OpenAPI. Uses Exist auth.
 *
 * @param {string} apiKey - GMGN API key (X-APIKEY).
 * @param {string} method - HTTP method.
 * @param {string} path - Path relative to host (must start with `/`).
 * @param {object} [query] - Query params (no timestamp/client_id needed; we add).
 * @param {object|null} [body] - JSON body or null.
 */
async function gmgnFetch(apiKey, method, path, query = {}, body = null) {
  if (!apiKey) {
    throw new Error('GMGN_API_KEY is missing. Set it with `npx wrangler pages secret put GMGN_API_KEY`.');
  }
  const { timestamp, client_id } = buildAuthQuery();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      for (const item of v) qs.append(k, String(item));
    } else {
      qs.append(k, String(v));
    }
  }
  qs.append('timestamp', String(timestamp));
  qs.append('client_id', client_id);

  const url = `${GMGN_HOST}${path}?${qs.toString()}`;
  const headers = {
    'X-APIKEY': apiKey,
    'Content-Type': 'application/json',
    'User-Agent': 'memecoin-monitor/2.0 (gmgn-openapi)',
  };

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`gmgn fetch(${method} ${path}) failed: ${e?.message || e}`);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`gmgn ${path}: HTTP ${res.status} non-JSON response`);
  }

  if (!res.ok || (payload?.code != null && payload.code !== 0)) {
    const code = payload?.code ?? res.status;
    const msg = payload?.message || payload?.msg || res.statusText;
    const err = new Error(`gmgn ${path} error ${code}: ${msg}`);
    err.gmgn = { code, message: msg, payload };
    throw err;
  }

  // unwrap `data` envelope (gmgn wraps data in { code, data })
  return payload.data ?? payload;
}

/**
 * Look up Creds from a CF Pages Function `context` (which exposes env).
 */
function credsFromContext(context) {
  const env = (context && context.env) || {};
  const apiKey = env.GMGN_API_KEY || '';
  return { apiKey };
}

/**
 * High-level helper that pulls apiKey from context and JSON-decodes.
 * Throws { status: ... }-able Error you can catch in onRequest.
 */
async function gmgnRequest(context, method, path, query, body) {
  const { apiKey } = credsFromContext(context);
  return gmgnFetch(apiKey, method, path, query, body);
}

// ============== Endpoint wrappers (typed, return payload.data) ==============

/**
 * Get trending memecoins by swaps volume per interval.
 * Mirrors `gmgn-cli market trending --chain X --interval I`.
 */
async function getTrendingSwaps(apiKey, chain, interval = '5m', extra = {}) {
  return gmgnFetch(apiKey, 'GET', '/v1/market/rank', { chain, interval, ...extra });
}

/**
 * Trenches list (pump.fun, four.meme, letsbonk, raydium …).
 * Mirrors `gmgn-cli market trenches --chain X`.
 *
 * @param {object} [options]
 * @param {string[]} [options.types]
 * @param {string[]} [options.platforms]
 * @param {number} [options.limit]
 * @param {string[]} [options.filters]
 */
async function getTrenches(apiKey, chain, options = {}) {
  return gmgnFetch(apiKey, 'POST', '/v1/trenches', { chain }, {
    chain,
    ...(options.types && { types: options.types }),
    ...(options.platforms && { platforms: options.platforms }),
    ...(options.limit != null && { limit: options.limit }),
    ...(options.filters && { filters: options.filters }),
  });
}

/**
 * Hot-searches ranking (most-searched tokens per interval).
 * Mirrors `gmgn-cli market hot-searches`.
 */
async function getHotSearches(apiKey, params) {
  return gmgnFetch(apiKey, 'POST', '/v1/market/hot_searches', {}, { params });
}

/**
 * Token signal scanner (multi-source token alerts).
 * Mirrors `gmgn-cli market signal --chain X`.
 */
async function getTokenSignalV2(apiKey, chain, groups = []) {
  return gmgnFetch(apiKey, 'POST', '/v1/market/token_signal', {}, { chain, groups });
}

/**
 * Smart Money recent activity (platform-tagged profitable wallets).
 * Mirrors `gmgn-cli track smartmoney --chain X --limit N`.
 */
async function getSmartMoney(apiKey, chain = 'sol', limit = 50) {
  return gmgnFetch(apiKey, 'GET', '/v1/user/smartmoney', chain ? { chain, limit } : { limit });
}

/**
 * KOL recent activity (influencer wallets).
 * Mirrors `gmgn-cli track kol --chain X --limit N`.
 */
async function getKol(apiKey, chain = 'sol', limit = 50) {
  return gmgnFetch(apiKey, 'GET', '/v1/user/kol', chain ? { chain, limit } : { limit });
}

/**
 * Token detail (price, mcap, liquidity, holder count…).
 * Mirrors `gmgn-cli token info --chain X --address A`.
 */
async function getTokenInfo(apiKey, chain, address) {
  return gmgnFetch(apiKey, 'GET', '/v1/token/info', { chain, address });
}

/**
 * Token security (honeypot, renounced, top10 holder rate, rug ratio…).
 * Mirrors `gmgn-cli token security`.
 */
async function getTokenSecurity(apiKey, chain, address) {
  return gmgnFetch(apiKey, 'GET', '/v1/token/security', { chain, address });
}

/**
 * Token K-line (candlestick).
 * Mirrors `gmgn-cli market kline`.
 */
async function getTokenKline(apiKey, chain, address, resolution, from, to) {
  const q = { chain, address, resolution };
  if (from != null) q.from = from;
  if (to != null) q.to = to;
  return gmgnFetch(apiKey, 'GET', '/v1/market/token_kline', q);
}

export {
  GMGN_HOST,
  gmgnRequest,
  gmgnFetch,
  credsFromContext,
  // endpoint surface — keep one import per consumer
  getTrendingSwaps,
  getTrenches,
  getHotSearches,
  getTokenSignalV2,
  getSmartMoney,
  getKol,
  getTokenInfo,
  getTokenSecurity,
  getTokenKline,
};
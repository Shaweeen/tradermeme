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
const GMGN_TIMEOUT_MS = 4000;

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GMGN_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    const reason = e?.name === 'AbortError' ? `timeout after ${GMGN_TIMEOUT_MS}ms` : (e?.message || e);
    throw new Error(`gmgn fetch(${method} ${path}) failed: ${reason}`);
  } finally {
    clearTimeout(timeout);
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
  // GMGN returns: {code: 0, data: {code: 0, data: {rank: [...]}}}
  // We return the raw payload so endpoint wrappers can handle the nesting
  return payload;
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
  const payload = await gmgnFetch(apiKey, 'GET', '/v1/market/rank', { chain, interval, ...extra });
  // GMGN returns: {code: 0, data: {code: 0, data: {rank: [...]}}}
  // gmgnFetch now returns raw payload (no unwrapping)
  // Try different response structures
  if (!payload || typeof payload !== 'object') {
    console.log('GMGN payload not an object');
    return [];
  }

  // Deep unwrap: payload.data.data.rank
  try {
    const inner = payload?.data?.data || payload?.data;
    if (inner) {
      if (Array.isArray(inner.rank)) {
        console.log(`GMGN: found ${inner.rank.length} via data.data.rank`);
        return inner.rank;
      }
      if (Array.isArray(inner.list)) {
        console.log(`GMGN: found ${inner.list.length} via data.data.list`);
        return inner.list;
      }
      if (Array.isArray(inner.tokens)) {
        console.log(`GMGN: found ${inner.tokens.length} via data.data.tokens`);
        return inner.tokens;
      }
    }

    // Try payload.data directly (one level unwrap)
    if (payload.data) {
      const d = payload.data;
      if (Array.isArray(d)) {
        console.log(`GMGN: found ${d.length} via payload.data (array)`);
        return d;
      }
    }

    // Try payload.rank (flat structure)
    if (Array.isArray(payload.rank)) {
      console.log(`GMGN: found ${payload.rank.length} via payload.rank`);
      return payload.rank;
    }

    // Debug: dump all keys
    const keyTypes = Object.entries(payload).map(([k, v]) =>
      `${k}: ${Array.isArray(v) ? `Array(${v.length})` : typeof v}`
    ).join(', ');
    console.log(`GMGN payload keys: ${keyTypes}`);

    // Try any array field at any level
    const found = findFirstArray(payload);
    if (found) return found;
  } catch (e) {
    console.log(`GMGN unwrap error: ${e.message}`);
  }

  return [];
}

/** Recursively find the first array property in an object (depth-first) */
function findFirstArray(obj, depth = 0) {
  if (depth > 4) return null;
  if (!obj || typeof obj !== 'object') return null;
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v) && v.length > 0) return v;
    if (typeof v === 'object') {
      const found = findFirstArray(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
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
  const result = await gmgnFetch(apiKey, 'GET', '/v1/user/smartmoney', chain ? { chain, limit } : { limit });
  // GMGN nested response: {code:0, data: {users: [...]}}
  if (result && Array.isArray(result.users)) return result.users;
  if (result && Array.isArray(result.data)) return result.data;
  if (Array.isArray(result)) return result;
  return [];
}

/**
 * KOL recent activity (influencer wallets).
 * Mirrors `gmgn-cli track kol --chain X --limit N`.
 */
async function getKol(apiKey, chain = 'sol', limit = 50) {
  const result = await gmgnFetch(apiKey, 'GET', '/v1/user/kol', chain ? { chain, limit } : { limit });
  // GMGN nested response: {code:0, data: {users: [...]}}
  if (result && Array.isArray(result.users)) return result.users;
  if (result && Array.isArray(result.data)) return result.data;
  if (Array.isArray(result)) return result;
  return [];
}

/**
 * Token detail (price, mcap, liquidity, holder count…).
 * Mirrors `gmgn-cli token info --chain X --address A`.
 */
async function getTokenInfo(apiKey, chain, address) {
  const result = await gmgnFetch(apiKey, 'GET', '/v1/token/info', { chain, address });
  // GMGN nested response: {code:0, data: {token: {...}}}
  if (result && result.token) return result.token;
  if (result && result.data) return result.data;
  return result || null;
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
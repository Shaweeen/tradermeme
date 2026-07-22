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
const GMGN_TIMEOUT_MS = 8000;

// --- Rate-limit shield (module scope, warm isolate) ---
// Production 429s came from multi-interval rank fanout + security stampede.
const GMGN_MAX_CONCURRENT = 3;
const GMGN_CIRCUIT_BASE_MS = 20_000;
const GMGN_CIRCUIT_MAX_MS = 180_000;

/** @type {Map<string, { data: any, expiresAt: number, staleUntil: number, cachedAt: number }>} */
const gmgnResponseCache = new Map();
/** @type {Map<string, Promise<any>>} */
const gmgnInflight = new Map();
/** @type {Array<() => void>} */
const gmgnWaitQueue = [];
let gmgnActive = 0;
let gmgnCircuitOpenUntil = 0;
let gmgnLast429At = 0;
let gmgnConsecutive429 = 0;
let gmgnCacheHits = 0;
let gmgnCacheMisses = 0;
let gmgnStaleServes = 0;

function stableQueryKey(query = {}) {
  const keys = Object.keys(query).sort();
  return keys
    .map((k) => {
      const v = query[k];
      if (Array.isArray(v)) return `${k}=${v.map(String).sort().join(',')}`;
      return `${k}=${v == null ? '' : String(v)}`;
    })
    .join('&');
}

function buildCacheKey(method, path, query = {}, body = null) {
  const bodyKey = body == null ? '' : JSON.stringify(body);
  return `${method.toUpperCase()}:${path}?${stableQueryKey(query)}#${bodyKey}`;
}

/** Fresh TTL by endpoint class (ms). */
function ttlForPath(path = '') {
  if (path.includes('/security')) return 5 * 60_000; // security is sticky
  if (path.includes('wallet_stats')) return 5 * 60_000; // wallet profile lazy-load
  if (path.includes('/smartmoney') || path.includes('/kol')) return 60_000;
  if (path.includes('/token_signal')) return 45_000;
  if (path.includes('/rank')) return 45_000;
  if (path.includes('/trenches') || path.includes('hot_search')) return 90_000;
  if (path.includes('/token/info') || path.includes('token_kline')) return 60_000;
  return 45_000;
}

/** How long stale cache may be served while rate-limited. */
function staleTtlForPath(path = '') {
  return Math.max(ttlForPath(path) * 10, 10 * 60_000);
}

function isRateLimitPayload(status, payload) {
  if (status === 429) return true;
  const code = payload?.code;
  if (code === 429 || code === '429') return true;
  const msg = String(payload?.message || payload?.msg || payload?.error || '').toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('too many request') ||
    msg.includes('temporarily banned') ||
    msg.includes('ip is temporarily') ||
    msg.includes('quota')
  );
}

function openCircuit(reason = '429') {
  const now = Date.now();
  gmgnConsecutive429 += 1;
  gmgnLast429At = now;
  const backoff = Math.min(
    GMGN_CIRCUIT_MAX_MS,
    GMGN_CIRCUIT_BASE_MS * Math.pow(2, Math.min(gmgnConsecutive429 - 1, 3))
  );
  gmgnCircuitOpenUntil = Math.max(gmgnCircuitOpenUntil, now + backoff);
  console.warn(
    `GMGN circuit OPEN ${Math.round(backoff / 1000)}s (streak=${gmgnConsecutive429}) reason=${reason}`
  );
}

function clearCircuitOnSuccess() {
  if (gmgnConsecutive429 > 0 || gmgnCircuitOpenUntil > Date.now()) {
    console.log('GMGN circuit CLEAR after success');
  }
  gmgnConsecutive429 = 0;
  gmgnCircuitOpenUntil = 0;
}

function isCircuitOpen(now = Date.now()) {
  return now < gmgnCircuitOpenUntil;
}

function getRateLimitState() {
  const now = Date.now();
  return {
    circuitOpen: isCircuitOpen(now),
    circuitOpenUntil: gmgnCircuitOpenUntil,
    circuitRemainingMs: Math.max(0, gmgnCircuitOpenUntil - now),
    consecutive429: gmgnConsecutive429,
    last429At: gmgnLast429At,
    active: gmgnActive,
    maxConcurrent: GMGN_MAX_CONCURRENT,
    cacheSize: gmgnResponseCache.size,
    cacheHits: gmgnCacheHits,
    cacheMisses: gmgnCacheMisses,
    staleServes: gmgnStaleServes,
  };
}

/** Test helper — do not use in production paths. */
function resetRateLimitStateForTests() {
  gmgnResponseCache.clear();
  gmgnInflight.clear();
  gmgnWaitQueue.length = 0;
  gmgnActive = 0;
  gmgnCircuitOpenUntil = 0;
  gmgnLast429At = 0;
  gmgnConsecutive429 = 0;
  gmgnCacheHits = 0;
  gmgnCacheMisses = 0;
  gmgnStaleServes = 0;
}

function pruneCache(now = Date.now()) {
  if (gmgnResponseCache.size < 200) return;
  for (const [k, v] of gmgnResponseCache) {
    if (v.staleUntil < now) gmgnResponseCache.delete(k);
  }
  // hard cap
  if (gmgnResponseCache.size > 300) {
    const entries = [...gmgnResponseCache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt);
    for (let i = 0; i < entries.length - 200; i++) gmgnResponseCache.delete(entries[i][0]);
  }
}

function acquireGmgnSlot() {
  if (gmgnActive < GMGN_MAX_CONCURRENT) {
    gmgnActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    gmgnWaitQueue.push(() => {
      gmgnActive += 1;
      resolve();
    });
  });
}

function releaseGmgnSlot() {
  gmgnActive = Math.max(0, gmgnActive - 1);
  const next = gmgnWaitQueue.shift();
  if (next) next();
}

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
 * Low-level HTTP once concurrency slot is held. No cache.
 */
async function gmgnFetchRaw(apiKey, method, path, query = {}, body = null) {
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
    'User-Agent': 'memecoin-monitor/2.1 (gmgn-openapi; rate-shield)',
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
    const err = new Error(`gmgn ${path}: HTTP ${res.status} non-JSON response`);
    err.status = res.status;
    if (res.status === 429) {
      err.rateLimited = true;
      openCircuit(`HTTP ${res.status}`);
    }
    throw err;
  }

  if (isRateLimitPayload(res.status, payload)) {
    const msg = payload?.message || payload?.msg || res.statusText || 'rate limited';
    openCircuit(msg);
    const err = new Error(`gmgn ${path} error 429: ${msg}`);
    err.gmgn = { code: 429, message: msg, payload };
    err.rateLimited = true;
    err.status = 429;
    throw err;
  }

  if (!res.ok || (payload?.code != null && payload.code !== 0)) {
    const code = payload?.code ?? res.status;
    const msg = payload?.message || payload?.msg || res.statusText;
    const err = new Error(`gmgn ${path} error ${code}: ${msg}`);
    err.gmgn = { code, message: msg, payload };
    err.status = res.status;
    throw err;
  }

  clearCircuitOnSuccess();
  return payload;
}

/**
 * Make an authenticated read-only request to GMGN OpenAPI. Uses Exist auth.
 * Adds: response cache, in-flight coalescing, concurrency cap, 429 circuit + stale serve.
 *
 * @param {string} apiKey - GMGN API key (X-APIKEY).
 * @param {string} method - HTTP method.
 * @param {string} path - Path relative to host (must start with `/`).
 * @param {object} [query] - Query params (no timestamp/client_id needed; we add).
 * @param {object|null} [body] - JSON body or null.
 * @param {object} [opts]
 * @param {boolean} [opts.skipCache] - force network
 * @param {boolean} [opts.allowStale=true] - serve stale when circuit open / after 429
 */
async function gmgnFetch(apiKey, method, path, query = {}, body = null, opts = {}) {
  if (!apiKey) {
    throw new Error('GMGN_API_KEY is missing. Set it with `npx wrangler pages secret put GMGN_API_KEY`.');
  }
  const allowStale = opts.allowStale !== false;
  const skipCache = opts.skipCache === true;
  const key = buildCacheKey(method, path, query, body);
  const now = Date.now();
  pruneCache(now);

  const cached = gmgnResponseCache.get(key);

  // Circuit open: never hit network — serve any usable cache (fresh or within stale window)
  if (isCircuitOpen(now)) {
    if (allowStale && cached && cached.staleUntil > now) {
      gmgnStaleServes += 1;
      return cached.data;
    }
    const err = new Error(
      `gmgn ${path} circuit open (~${Math.ceil((gmgnCircuitOpenUntil - now) / 1000)}s) — rate limit cooldown`
    );
    err.rateLimited = true;
    err.circuitOpen = true;
    err.status = 429;
    throw err;
  }

  if (!skipCache && cached && cached.expiresAt > now) {
    gmgnCacheHits += 1;
    return cached.data;
  }

  if (gmgnInflight.has(key)) {
    return gmgnInflight.get(key);
  }

  gmgnCacheMisses += 1;
  const job = (async () => {
    await acquireGmgnSlot();
    try {
      // Double-check fresh cache after wait
      const again = gmgnResponseCache.get(key);
      const t2 = Date.now();
      if (!skipCache && again && again.expiresAt > t2) {
        gmgnCacheHits += 1;
        return again.data;
      }
      if (isCircuitOpen(t2) && allowStale && again && again.staleUntil > t2) {
        gmgnStaleServes += 1;
        return again.data;
      }

      try {
        const payload = await gmgnFetchRaw(apiKey, method, path, query, body);
        const ttl = ttlForPath(path);
        const stale = staleTtlForPath(path);
        const savedAt = Date.now();
        gmgnResponseCache.set(key, {
          data: payload,
          expiresAt: savedAt + ttl,
          staleUntil: savedAt + stale,
          cachedAt: savedAt,
        });
        return payload;
      } catch (e) {
        // After 429, serve stale if we have it
        if (e?.rateLimited && allowStale) {
          const staleHit = gmgnResponseCache.get(key);
          if (staleHit && staleHit.staleUntil > Date.now()) {
            gmgnStaleServes += 1;
            return staleHit.data;
          }
        }
        throw e;
      }
    } finally {
      releaseGmgnSlot();
      gmgnInflight.delete(key);
    }
  })();

  gmgnInflight.set(key, job);
  return job;
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
 * Unwrap GMGN rank/list payloads from nested envelopes.
 */
function unwrapRankPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  try {
    const inner = payload?.data?.data || payload?.data;
    if (inner) {
      if (Array.isArray(inner.rank)) return inner.rank;
      if (Array.isArray(inner.list)) return inner.list;
      if (Array.isArray(inner.tokens)) return inner.tokens;
      if (Array.isArray(inner)) return inner;
    }
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.rank)) return payload.rank;
    if (Array.isArray(payload.list)) return payload.list;
    const found = findFirstArray(payload);
    if (found) return found;
  } catch (e) {
    console.log(`GMGN unwrap error: ${e.message}`);
  }
  return [];
}

/**
 * Get trending memecoins by swaps volume per interval.
 * Mirrors `gmgn-cli market trending --chain X --interval I`.
 */
async function getTrendingSwaps(apiKey, chain, interval = '5m', extra = {}) {
  const payload = await gmgnFetch(apiKey, 'GET', '/v1/market/rank', { chain, interval, ...extra });
  const rank = unwrapRankPayload(payload);
  if (rank.length) console.log(`GMGN rank ${chain}/${interval}: ${rank.length}`);
  return rank;
}

/**
 * Multi-interval GMGN rank merge.
 * Rate-shield: fewer intervals, sequential when circuit is warm, no orderby stampede.
 */
async function getTrendingSwapsMulti(apiKey, chain, limit = 30) {
  // Primary windows only — was 4 intervals × 3 orderbys = up to 12 parallel 429s
  const primaryIntervals =
    chain === 'sol' || chain === 'solana'
      ? ['1h', '5m']
      : ['1h', '24h'];
  // Secondary only if thin and circuit closed
  const secondaryIntervals =
    chain === 'sol' || chain === 'solana' ? [] : ['5m', '6h'];

  const byAddr = new Map();
  const errors = [];
  let rateLimited = false;

  function vol24(t = {}) {
    return Math.max(
      0,
      Number(t.volume_24h) || 0,
      Number(t.volume24h) || 0,
      Number(t.volume_usd_24h) || 0,
      Number(t.volume) || 0
    );
  }

  /** Merge rows: keep best volume/liquidity/smart fields across intervals */
  function upsert(interval, t) {
    const addr = String(t.address || t.token_address || t.base_address || '').toLowerCase();
    if (!addr) return;
    const prev = byAddr.get(addr);
    if (!prev) {
      byAddr.set(addr, { ...t, _rank_interval: interval });
      return;
    }
    const next = { ...prev };
    if (vol24(t) > vol24(prev)) {
      Object.assign(next, t, { _rank_interval: interval });
    } else {
      for (const k of Object.keys(t)) {
        const pv = prev[k];
        const nv = t[k];
        if ((pv == null || pv === '' || pv === 0) && nv != null && nv !== '' && nv !== 0) next[k] = nv;
      }
    }
    next.smart_count = Math.max(Number(prev.smart_count) || 0, Number(t.smart_count) || 0, Number(prev.smart_degen_count) || 0, Number(t.smart_degen_count) || 0);
    next.smart_degen_count = next.smart_count;
    next.holder_count = Math.max(Number(prev.holder_count) || 0, Number(t.holder_count) || 0);
    next.liquidity = Math.max(Number(prev.liquidity) || 0, Number(t.liquidity) || 0);
    byAddr.set(addr, next);
  }

  async function fetchInterval(interval) {
    if (rateLimited || isCircuitOpen()) {
      errors.push(`${interval}:skipped-circuit`);
      return { interval, list: [] };
    }
    try {
      const list = await getTrendingSwaps(apiKey, chain, interval, { limit: Math.max(limit, 40) });
      return { interval, list };
    } catch (e) {
      if (e?.rateLimited || e?.circuitOpen) rateLimited = true;
      errors.push(`${interval}:${e.message}`);
      return { interval, list: [] };
    }
  }

  // When circuit is closed and healthy: allow limited parallel (≤2).
  // After any 429 in this request: sequential + stop early.
  const sequential = isCircuitOpen() || gmgnConsecutive429 > 0;
  if (sequential) {
    for (const interval of primaryIntervals) {
      const { list } = await fetchInterval(interval);
      for (const t of list || []) upsert(interval, t);
      if (rateLimited) break;
    }
  } else {
    // Cap concurrency: fetch first interval, then remaining in parallel of 1–2
    const [first, ...rest] = primaryIntervals;
    const firstRes = await fetchInterval(first);
    for (const t of firstRes.list || []) upsert(first, t);
    if (!rateLimited && rest.length) {
      const restResults = await Promise.all(rest.map((iv) => fetchInterval(iv)));
      for (const { interval, list } of restResults) {
        for (const t of list || []) upsert(interval, t);
      }
    }
  }

  // Thin fill: at most one secondary interval, only if not rate-limited
  if (!rateLimited && !isCircuitOpen() && byAddr.size < Math.min(limit, 12) && secondaryIntervals.length) {
    for (const interval of secondaryIntervals) {
      const { list } = await fetchInterval(interval);
      for (const t of list || []) upsert(interval, t);
      if (byAddr.size >= Math.min(limit, 15) || rateLimited) break;
    }
  }

  // Single volume-orderby retry if still thin (was 6 parallel extras)
  if (!rateLimited && !isCircuitOpen() && byAddr.size < Math.min(limit, 10)) {
    try {
      const list = await getTrendingSwaps(apiKey, chain, '1h', {
        limit: Math.max(limit, 40),
        orderby: 'volume',
        direction: 'desc',
      });
      for (const t of list || []) upsert('1h-vol', t);
    } catch (e) {
      if (e?.rateLimited || e?.circuitOpen) rateLimited = true;
      errors.push(`1h/volume:${e.message}`);
    }
  }

  const merged = Array.from(byAddr.values())
    .sort((a, b) => vol24(b) - vol24(a))
    .slice(0, Math.max(limit, 30));
  console.log(
    `GMGN multi-rank ${chain}: ${merged.length} unique (errors=${errors.length}, rateLimited=${rateLimited}, circuit=${isCircuitOpen()})`
  );
  return { list: merged, errors, rateLimited };
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
  // GMGN responses observed as {code:0,data:{list:[...]}} or {code:0,data:{users:[...]}}
  if (result && Array.isArray(result.list)) return result.list;
  if (result && Array.isArray(result.users)) return result.users;
  if (result && Array.isArray(result.data)) return result.data;
  if (result?.data && Array.isArray(result.data.list)) return result.data.list;
  if (result?.data && Array.isArray(result.data.users)) return result.data.users;
  if (Array.isArray(result)) return result;
  return [];
}

/**
 * KOL recent activity (influencer wallets).
 * Mirrors `gmgn-cli track kol --chain X --limit N`.
 */
async function getKol(apiKey, chain = 'sol', limit = 50) {
  const result = await gmgnFetch(apiKey, 'GET', '/v1/user/kol', chain ? { chain, limit } : { limit });
  // GMGN responses observed as {code:0,data:{list:[...]}} or {code:0,data:{users:[...]}}
  if (result && Array.isArray(result.list)) return result.list;
  if (result && Array.isArray(result.users)) return result.users;
  if (result && Array.isArray(result.data)) return result.data;
  if (result?.data && Array.isArray(result.data.list)) return result.data.list;
  if (result?.data && Array.isArray(result.data.users)) return result.data.users;
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
 * Wallet trading stats (winrate, realized/unrealized PnL, buy/sell counts).
 * Mirrors `gmgn-cli portfolio stats --chain X --wallet W --period 7d|30d`.
 * Exist auth only (no private key).
 */
async function getWalletStats(apiKey, chain, wallet, period = '7d') {
  // GMGN OpenAPI expects wallet_address (cli: --wallet)
  const payload = await gmgnFetch(
    apiKey,
    'GET',
    '/v1/user/wallet_stats',
    {
      chain,
      wallet_address: wallet,
      wallet, // some deployments accept either
      period: period === '30d' ? '30d' : '7d',
    }
  );
  // Possible envelopes: {code,data:{...stats}} or {code,data:{data:{...}}} or array
  const root = payload?.data?.data || payload?.data || payload;
  if (Array.isArray(root)) return root[0] || null;
  if (root && typeof root === 'object') {
    // batch shape { wallets: [...] }
    if (Array.isArray(root.wallets) && root.wallets.length) return root.wallets[0];
    if (Array.isArray(root.list) && root.list.length) return root.list[0];
    return root;
  }
  return null;
}

/**
 * Normalize wallet_stats payload into a stable profile for the AI panel.
 */
function normalizeWalletStats(raw = {}, meta = {}) {
  const common = raw.common && typeof raw.common === 'object' ? raw.common : {};
  const winrate = Number(raw.winrate ?? raw.win_rate ?? raw.winRate);
  const realized = Number(raw.realized_profit ?? raw.realized_pnl ?? raw.realizedPnl);
  const unrealized = Number(raw.unrealized_profit ?? raw.unrealized_pnl ?? raw.unrealizedPnl);
  const totalCost = Number(raw.total_cost ?? raw.totalCost ?? raw.cost);
  const pnlRatio = Number(raw.pnl ?? raw.pnl_ratio);
  const buyCount = Number(raw.buy_count ?? raw.buyCount ?? raw.buys) || 0;
  const sellCount = Number(raw.sell_count ?? raw.sellCount ?? raw.sells) || 0;
  const tags = [];
  if (Array.isArray(common.tags)) tags.push(...common.tags.map(String));
  if (common.tag) tags.push(String(common.tag));
  if (meta.role) tags.push(meta.role === 'kol' ? 'kol' : 'smart_money');

  const wr = Number.isFinite(winrate) ? (winrate > 1 ? winrate / 100 : winrate) : null;
  const style = rateTradingStyle({
    winrate: wr,
    pnl: Number.isFinite(pnlRatio) ? pnlRatio : null,
    buyCount,
    sellCount,
    realized: Number.isFinite(realized) ? realized : null,
  });

  return {
    wallet: meta.wallet || raw.wallet || raw.address || common.address || '',
    chain: meta.chain || raw.chain || '',
    period: meta.period || '7d',
    winrate: wr,
    winratePct: wr == null ? null : Math.round(wr * 1000) / 10,
    realizedProfit: Number.isFinite(realized) ? realized : null,
    unrealizedProfit: Number.isFinite(unrealized) ? unrealized : null,
    totalCost: Number.isFinite(totalCost) ? totalCost : null,
    pnlRatio: Number.isFinite(pnlRatio) ? pnlRatio : null,
    buyCount,
    sellCount,
    tradeCount: buyCount + sellCount,
    name: common.name || common.ens || meta.name || '',
    twitter: common.twitter_username || common.twitter || meta.twitter || '',
    avatar: common.avatar || '',
    tags: [...new Set(tags.map((t) => String(t).toLowerCase()))].slice(0, 8),
    followCount: Number(common.follow_count) || 0,
    createdAt: Number(common.created_at) || 0,
    style,
    source: 'gmgn-wallet-stats',
  };
}

function rateTradingStyle({ winrate, pnl, buyCount, sellCount, realized }) {
  const wr = winrate == null ? null : winrate;
  const trades = (buyCount || 0) + (sellCount || 0);
  if (wr == null && !trades) return { grade: '未知', label: '样本不足', score: 0 };
  let score = 40;
  if (wr != null) score += wr * 40;
  if (pnl != null) {
    if (pnl >= 1) score += 18;
    else if (pnl >= 0.3) score += 10;
    else if (pnl < 0) score -= 12;
  }
  if (realized != null && realized > 10_000) score += 8;
  if (trades >= 30) score += 5;
  else if (trades < 5) score -= 8;
  score = Math.max(0, Math.min(100, Math.round(score)));

  let grade = 'C';
  let label = '普通交易';
  if (score >= 78 && wr != null && wr >= 0.55) {
    grade = 'A';
    label = '高胜优质';
  } else if (score >= 65) {
    grade = 'B';
    label = wr != null && wr >= 0.5 ? '稳健聪明钱' : '进攻型';
  } else if (score >= 45) {
    grade = 'C';
    label = wr != null && wr < 0.4 ? '高波动' : '观察级';
  } else {
    grade = 'D';
    label = '低胜/高风险';
  }
  // Frequency hint
  if (trades >= 80) label += '·高频';
  else if (trades > 0 && trades <= 8) label += '·低频精选';
  return { grade, label, score };
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
  unwrapRankPayload,
  // rate-limit shield
  isCircuitOpen,
  getRateLimitState,
  resetRateLimitStateForTests,
  // endpoint surface — keep one import per consumer
  getTrendingSwaps,
  getTrendingSwapsMulti,
  getTrenches,
  getHotSearches,
  getTokenSignalV2,
  getSmartMoney,
  getKol,
  getTokenInfo,
  getTokenSecurity,
  getTokenKline,
  getWalletStats,
  normalizeWalletStats,
  rateTradingStyle,
};
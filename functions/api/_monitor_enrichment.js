/**
 * GMGN Monitor-style enrichment:
 *  - Smart Net Inflow  (smartmoney + token_signal smart_degen)
 *  - KOL Net Inflow    (track kol only — same source as gmgn.ai/monitor KOL tab)
 *
 * Dedup: if a KOL's X handle is also on the personal watchlist, GMGN is the
 * single data source (watchlist does not double-count the same person).
 */

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.list)) return payload.list;
  if (Array.isArray(payload.rank)) return payload.rank;
  if (Array.isArray(payload.users)) return payload.users;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === 'object') {
    if (Array.isArray(payload.data.list)) return payload.data.list;
    if (Array.isArray(payload.data.rank)) return payload.data.rank;
    if (Array.isArray(payload.data.users)) return payload.data.users;
    if (payload.data.data && typeof payload.data.data === 'object') {
      if (Array.isArray(payload.data.data.list)) return payload.data.data.list;
      if (Array.isArray(payload.data.data.rank)) return payload.data.data.rank;
      if (Array.isArray(payload.data.data.users)) return payload.data.data.users;
    }
  }
  return [];
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function tokenAddressFromEvent(event = {}) {
  return String(event.token_address || event.address || event.base_address || event.data?.address || event.data?.base_address || '').toLowerCase();
}

function tradeTokenAddress(trade = {}) {
  return String(trade.base_address || trade.token_address || trade.address || trade.base_token?.address || '').toLowerCase();
}

function tradeAmountUsd(trade = {}) {
  return Math.max(0, num(trade.amount_usd ?? trade.buy_amount ?? trade.usd_amount ?? trade.value_usd));
}

function tradeTwitter(trade = {}) {
  const info = trade.maker_info || trade.user || trade.wallet_info || {};
  return normalizeHandle(
    info.twitter_username || info.twitter || trade.twitter_username || trade.twitter || ''
  );
}

function normalizeHandle(raw) {
  return String(raw || '')
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, '')
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
}

/** Normalize sec/ms timestamps to seconds. */
function toUnixSec(ts, nowSec) {
  let t = num(ts);
  if (!(t > 0)) return 0;
  if (t > 1e12) t = Math.floor(t / 1000);
  if (nowSec > 0 && (t > nowSec + 3600 || nowSec - t > 7 * 24 * 3600)) return 0;
  return t;
}

function addSmartNet(bucket, windowName, amount, wallet) {
  bucket[`smartNetInflow${windowName}`] += amount;
  if (wallet) bucket[`smartWalletSet${windowName}`].add(wallet);
}

function addKolNet(bucket, windowName, amount, wallet, twitter = '') {
  bucket[`kolNetInflow${windowName}`] += amount;
  if (wallet) bucket[`kolWalletSet${windowName}`].add(wallet);
  if (twitter) bucket.kolTwitterAll.add(twitter);
}

/**
 * Aggregate SM/KOL wallets that touched this token (for AI 钱包画像).
 * @param {object} bucket
 * @param {string} wallet
 * @param {'smart'|'kol'} role
 * @param {number} amount signed USD (sell negative)
 * @param {object} [meta]
 */
function recordWalletActivity(bucket, wallet, role, amount, meta = {}) {
  const addr = String(wallet || '').trim();
  // Allow short test fixtures; real Sol/EVM addresses are much longer
  if (!addr || addr.length < 2) return;
  if (!bucket.walletActivity) bucket.walletActivity = new Map();
  const key = addr.toLowerCase();
  let row = bucket.walletActivity.get(key);
  if (!row) {
    row = {
      address: addr,
      role,
      buyUsd: 0,
      sellUsd: 0,
      netUsd: 0,
      tradeCount: 0,
      twitter: '',
      name: '',
      tags: [],
      lastTs: 0,
    };
    bucket.walletActivity.set(key, row);
  }
  // Prefer kol label if same wallet appears in both
  if (role === 'kol') row.role = 'kol';
  else if (row.role !== 'kol') row.role = 'smart';
  const abs = Math.abs(Number(amount) || 0);
  if (amount >= 0) row.buyUsd += abs;
  else row.sellUsd += abs;
  row.netUsd = row.buyUsd - row.sellUsd;
  row.tradeCount += 1;
  if (meta.twitter && !row.twitter) row.twitter = normalizeHandle(meta.twitter);
  if (meta.name && !row.name) row.name = String(meta.name).slice(0, 40);
  if (Array.isArray(meta.tags) && meta.tags.length) {
    const merged = new Set([...(row.tags || []), ...meta.tags.map((t) => String(t).toLowerCase())]);
    row.tags = [...merged].slice(0, 6);
  }
  const ts = Number(meta.ts) || 0;
  if (ts > row.lastTs) row.lastTs = ts;
}

function tradeMakerMeta(trade = {}) {
  const info = trade.maker_info || trade.user || trade.wallet_info || {};
  const tags = [];
  if (Array.isArray(info.tags)) tags.push(...info.tags);
  else if (info.tag) tags.push(info.tag);
  if (trade.tag) tags.push(trade.tag);
  return {
    twitter: tradeTwitter(trade),
    name: info.name || info.ens || info.twitter_name || '',
    tags,
    ts: toUnixSec(trade.timestamp || trade.time || trade.created_at, 0),
  };
}

/** Top wallets by |netUsd| then buyUsd — max N for UI. */
function buildTopWallets(bucket, max = 6) {
  if (!bucket?.walletActivity || !(bucket.walletActivity instanceof Map)) return [];
  return [...bucket.walletActivity.values()]
    .filter((w) => w.tradeCount > 0 && (w.buyUsd > 0 || w.sellUsd > 0))
    .sort((a, b) => Math.abs(b.netUsd) - Math.abs(a.netUsd) || b.buyUsd - a.buyUsd || b.tradeCount - a.tradeCount)
    .slice(0, max)
    .map((w) => ({
      address: w.address,
      role: w.role,
      buyUsd: Math.round(w.buyUsd * 100) / 100,
      sellUsd: Math.round(w.sellUsd * 100) / 100,
      netUsd: Math.round(w.netUsd * 100) / 100,
      tradeCount: w.tradeCount,
      side: w.netUsd >= 0 ? (w.sellUsd > 0 && w.buyUsd > 0 ? 'mixed' : 'buy') : 'sell',
      twitter: w.twitter || '',
      name: w.name || '',
      tags: w.tags || [],
      lastTs: w.lastTs || 0,
    }));
}

/**
 * Prefer GMGN KOL as the only source when handle also exists on personal X watchlist.
 * Returns { gmgnHandles, watchlistOnlyHandles, sharedHandles }
 */
function dedupeKolSources(gmgnHandles = [], watchlistHandles = []) {
  const gmgn = new Set((gmgnHandles || []).map(normalizeHandle).filter(Boolean));
  const wl = new Set((watchlistHandles || []).map(normalizeHandle).filter(Boolean));
  const shared = [];
  const watchlistOnly = [];
  for (const h of wl) {
    if (gmgn.has(h)) shared.push(h);
    else watchlistOnly.push(h);
  }
  return {
    gmgnHandles: [...gmgn],
    sharedHandles: shared,
    // Personal list only contributes handles NOT already covered by GMGN
    watchlistOnlyHandles: watchlistOnly,
    // Canonical unique handles for display: GMGN first, then watchlist-only
    uniqueHandles: [...gmgn, ...watchlistOnly],
  };
}

function applyMonitorSignalEnrichment(tokens = [], options = {}) {
  const nowSec = num(options.nowSec) || Math.floor(Date.now() / 1000);
  const tokenSignals = unwrapList(options.tokenSignals || []);
  const smartTrades = unwrapList(options.smartTrades || []);
  const kolTrades = unwrapList(options.kolTrades || []);
  // Personal X watchlist (optional) — only used after GMGN KOL dedupe
  let watchlistSet = options.watchlistHandles;
  if (!watchlistSet && options.loadWatchlist) {
    try {
      // dynamic optional — may fail in some runtimes
    } catch (_) {
      watchlistSet = [];
    }
  }
  if (!Array.isArray(watchlistSet)) watchlistSet = [];

  const buckets = new Map();
  for (const token of tokens) {
    const key = String(token.address || '').toLowerCase();
    if (!key) continue;
    buckets.set(key, {
      smartNetInflow5m: num(token.smartNetInflow5m),
      smartNetInflow15m: num(token.smartNetInflow15m),
      smartNetInflow1h: num(token.smartNetInflow1h),
      kolNetInflow5m: num(token.kolNetInflow5m),
      kolNetInflow15m: num(token.kolNetInflow15m),
      kolNetInflow1h: num(token.kolNetInflow1h),
      volume5m: num(token.volume5m),
      volume15m: num(token.volume15m),
      volume1h: num(token.volume1h),
      newWallets5m: num(token.newWallets5m),
      newWallets15m: num(token.newWallets15m),
      smartWalletSet5m: new Set(),
      smartWalletSet15m: new Set(),
      smartWalletSet1h: new Set(),
      kolWalletSet5m: new Set(),
      kolWalletSet15m: new Set(),
      kolWalletSet1h: new Set(),
      kolTwitterAll: new Set(),
      smartWalletBase5m: num(token.smartWallets5m),
      smartWalletBase15m: num(token.smartWallets15m),
      smartWalletBase1h: num(token.smartWallets1h),
      kolWalletBase5m: num(token.kolWallets5m),
      kolWalletBase15m: num(token.kolWallets15m),
      kolWalletBase1h: num(token.kolWallets1h),
      walletActivity: new Map(),
    });
  }

  for (const event of tokenSignals) {
    const key = tokenAddressFromEvent(event);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const data = event.data || {};
    const eventTs = toUnixSec(event.trigger_at || data.trigger_at || data.created_timestamp || data.open_timestamp, nowSec);
    const age = nowSec - eventTs;
    const in5m = eventTs > 0 && age >= 0 && age <= 5 * 60;
    const in15m = eventTs > 0 && age >= 0 && age <= 15 * 60;
    const in1h = eventTs > 0 && age >= 0 && age <= 60 * 60;
    const volume1m = num(data.volume_1m || data.volume1m);
    const volume1h = num(data.volume_1h || data.volume1h || data.volume || event.volume);
    if (in5m) bucket.volume5m = Math.max(bucket.volume5m, volume1m || volume1h);
    if (in15m) bucket.volume15m = Math.max(bucket.volume15m, volume1h || volume1m);
    if (in1h) bucket.volume1h = Math.max(bucket.volume1h, volume1h || volume1m);
    const holders = num(data.holder_count || event.cur_data?.holder_count);
    const freshRate = num(data.fresh_wallet_rate);
    if (freshRate > 0 && holders > 0) {
      const freshWallets = Math.round(freshRate * holders);
      if (in5m) bucket.newWallets5m = Math.max(bucket.newWallets5m, freshWallets);
      if (in15m) bucket.newWallets15m = Math.max(bucket.newWallets15m, freshWallets);
    }
    const renownedCount = num(data.renowned_count);
    if (renownedCount > 0) {
      if (in5m) bucket.kolWalletBase5m = Math.max(bucket.kolWalletBase5m, renownedCount);
      if (in15m) bucket.kolWalletBase15m = Math.max(bucket.kolWalletBase15m, renownedCount);
      if (in1h) bucket.kolWalletBase1h = Math.max(bucket.kolWalletBase1h, renownedCount);
    }
    // Smart degen buys → Smart Net Inflow only (not KOL net)
    for (const buy of (Array.isArray(data.smart_degen_wallets) ? data.smart_degen_wallets : [])) {
      const ts = toUnixSec(buy.buy_timestamp || buy.timestamp, nowSec);
      const amount = Math.max(0, num(buy.buy_amount || buy.amount_usd));
      const wallet = String(buy.address || buy.wallet || buy.maker || '');
      const buyAge = nowSec - ts;
      if (ts > 0 && buyAge >= 0 && buyAge <= 5 * 60) addSmartNet(bucket, '5m', amount, wallet);
      if (ts > 0 && buyAge >= 0 && buyAge <= 15 * 60) addSmartNet(bucket, '15m', amount, wallet);
      if (ts > 0 && buyAge >= 0 && buyAge <= 60 * 60) addSmartNet(bucket, '1h', amount, wallet);
      if (ts > 0 && buyAge >= 0 && buyAge <= 60 * 60) {
        recordWalletActivity(bucket, wallet, 'smart', amount, {
          twitter: buy.twitter_username || buy.twitter || '',
          name: buy.name || '',
          tags: buy.tags || ['smart_degen'],
          ts,
        });
      }
    }
  }

  // Smart Money trades → Smart Net Inflow only
  for (const trade of smartTrades) {
    const key = tradeTokenAddress(trade);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const ts = toUnixSec(trade.timestamp || trade.time || trade.created_at, nowSec);
    const age = nowSec - ts;
    if (!(ts > 0 && age >= 0 && age <= 60 * 60)) continue;
    const side = String(trade.side || '').toLowerCase();
    const amount = tradeAmountUsd(trade) * (side === 'sell' ? -1 : 1);
    const wallet = String(trade.maker || trade.wallet_address || trade.address || '');
    if (age <= 5 * 60) addSmartNet(bucket, '5m', amount, wallet);
    if (age <= 15 * 60) addSmartNet(bucket, '15m', amount, wallet);
    addSmartNet(bucket, '1h', amount, wallet);
    recordWalletActivity(bucket, wallet, 'smart', amount, tradeMakerMeta(trade));
  }

  // KOL trades → KOL Net Inflow only (gmgn.ai/monitor KOL Net Inflow)
  for (const trade of kolTrades) {
    const key = tradeTokenAddress(trade);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    const ts = toUnixSec(trade.timestamp || trade.time || trade.created_at, nowSec);
    const age = nowSec - ts;
    if (!(ts > 0 && age >= 0 && age <= 60 * 60)) continue;
    const side = String(trade.side || '').toLowerCase();
    const amount = tradeAmountUsd(trade) * (side === 'sell' ? -1 : 1);
    const wallet = String(trade.maker || trade.wallet_address || trade.address || '');
    const tw = tradeTwitter(trade);
    if (age <= 5 * 60) addKolNet(bucket, '5m', amount, wallet, tw);
    if (age <= 15 * 60) addKolNet(bucket, '15m', amount, wallet, tw);
    addKolNet(bucket, '1h', amount, wallet, tw);
    recordWalletActivity(bucket, wallet, 'kol', amount, tradeMakerMeta(trade));
  }

  return tokens.map((token) => {
    const key = String(token.address || '').toLowerCase();
    const bucket = buckets.get(key);
    if (!bucket) return token;

    const gmgnHandles = [...bucket.kolTwitterAll];
    const sources = dedupeKolSources(gmgnHandles, watchlistSet);
    const topWallets = buildTopWallets(bucket, 6);

    return {
      ...token,
      // Smart Net Inflow (Monitor)
      smartNetInflow5m: Math.round(bucket.smartNetInflow5m * 100) / 100,
      smartNetInflow15m: Math.round(bucket.smartNetInflow15m * 100) / 100,
      smartNetInflow1h: Math.round(bucket.smartNetInflow1h * 100) / 100,
      // KOL Net Inflow (Monitor) — separate from smart
      kolNetInflow5m: Math.round(bucket.kolNetInflow5m * 100) / 100,
      kolNetInflow15m: Math.round(bucket.kolNetInflow15m * 100) / 100,
      kolNetInflow1h: Math.round(bucket.kolNetInflow1h * 100) / 100,
      volume5m: Math.max(num(token.volume5m), bucket.volume5m),
      volume15m: Math.max(num(token.volume15m), bucket.volume15m),
      volume1h: Math.max(num(token.volume1h), bucket.volume1h),
      newWallets5m: Math.max(num(token.newWallets5m), bucket.newWallets5m),
      newWallets15m: Math.max(num(token.newWallets15m), bucket.newWallets15m),
      smartWallets5m: Math.max(num(token.smartWallets5m), bucket.smartWalletBase5m + bucket.smartWalletSet5m.size),
      smartWallets15m: Math.max(num(token.smartWallets15m), bucket.smartWalletBase15m + bucket.smartWalletSet15m.size),
      smartWallets1h: Math.max(num(token.smartWallets1h), bucket.smartWalletBase1h + bucket.smartWalletSet1h.size),
      kolWallets5m: Math.max(num(token.kolWallets5m), bucket.kolWalletBase5m + bucket.kolWalletSet5m.size),
      kolWallets15m: Math.max(num(token.kolWallets15m), bucket.kolWalletBase15m + bucket.kolWalletSet15m.size),
      kolWallets1h: Math.max(num(token.kolWallets1h), bucket.kolWalletBase1h + bucket.kolWalletSet1h.size),
      // Deduped identity sources (GMGN wins on overlap with personal X list)
      kolHandlesGmgn: sources.gmgnHandles,
      kolHandlesWatchlistOnly: sources.watchlistOnlyHandles,
      kolHandlesShared: sources.sharedHandles,
      kolHandlesUnique: sources.uniqueHandles,
      kolSource: sources.gmgnHandles.length ? 'gmgn-kol-net-inflow' : (sources.watchlistOnlyHandles.length ? 'x-watchlist' : 'none'),
      // Top SM/KOL wallets that traded this token in 1h (AI 钱包画像)
      topWallets,
    };
  });
}

export {
  applyMonitorSignalEnrichment,
  unwrapList,
  dedupeKolSources,
  normalizeHandle,
  tradeTwitter,
  buildTopWallets,
  recordWalletActivity,
};

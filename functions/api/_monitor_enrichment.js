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

/** Normalize sec/ms timestamps to seconds. */
function toUnixSec(ts, nowSec) {
  let t = num(ts);
  if (!(t > 0)) return 0;
  // ms epoch (~1e12+) → seconds
  if (t > 1e12) t = Math.floor(t / 1000);
  // reject absurd future/past relative to now
  if (nowSec > 0 && (t > nowSec + 3600 || nowSec - t > 7 * 24 * 3600)) return 0;
  return t;
}

function addNet(bucket, windowName, amount, wallet, isKol = false) {
  bucket[`smartNetInflow${windowName}`] += amount;
  if (wallet) bucket[`smartWalletSet${windowName}`].add(wallet);
  if (isKol && wallet) bucket[`kolWalletSet${windowName}`].add(wallet);
}

function applyMonitorSignalEnrichment(tokens = [], options = {}) {
  const nowSec = num(options.nowSec) || Math.floor(Date.now() / 1000);
  const tokenSignals = unwrapList(options.tokenSignals || []);
  const smartTrades = unwrapList(options.smartTrades || []);
  const kolTrades = unwrapList(options.kolTrades || []);

  const buckets = new Map();
  for (const token of tokens) {
    const key = String(token.address || '').toLowerCase();
    if (!key) continue;
    buckets.set(key, {
      smartNetInflow5m: num(token.smartNetInflow5m),
      smartNetInflow15m: num(token.smartNetInflow15m),
      smartNetInflow1h: num(token.smartNetInflow1h),
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
      smartWalletBase5m: num(token.smartWallets5m),
      smartWalletBase15m: num(token.smartWallets15m),
      smartWalletBase1h: num(token.smartWallets1h),
      kolWalletBase5m: num(token.kolWallets5m),
      kolWalletBase15m: num(token.kolWallets15m),
      kolWalletBase1h: num(token.kolWallets1h),
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
    }
    for (const buy of (Array.isArray(data.smart_degen_wallets) ? data.smart_degen_wallets : [])) {
      const ts = toUnixSec(buy.buy_timestamp || buy.timestamp, nowSec);
      const amount = Math.max(0, num(buy.buy_amount || buy.amount_usd));
      const wallet = String(buy.address || buy.wallet || buy.maker || '');
      const buyAge = nowSec - ts;
      if (ts > 0 && buyAge >= 0 && buyAge <= 5 * 60) addNet(bucket, '5m', amount, wallet, false);
      if (ts > 0 && buyAge >= 0 && buyAge <= 15 * 60) addNet(bucket, '15m', amount, wallet, false);
      if (ts > 0 && buyAge >= 0 && buyAge <= 60 * 60) addNet(bucket, '1h', amount, wallet, false);
    }
  }

  function applyTrades(trades, isKol) {
    for (const trade of trades) {
      const key = tradeTokenAddress(trade);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const ts = toUnixSec(trade.timestamp || trade.time || trade.created_at, nowSec);
      const age = nowSec - ts;
      // Collect up to 1h for Monitor 5m/15m/1h heat windows
      if (!(ts > 0 && age >= 0 && age <= 60 * 60)) continue;
      const side = String(trade.side || '').toLowerCase();
      const amount = tradeAmountUsd(trade) * (side === 'sell' ? -1 : 1);
      const wallet = String(trade.maker || trade.wallet_address || trade.address || '');
      if (age <= 5 * 60) addNet(bucket, '5m', amount, wallet, isKol);
      if (age <= 15 * 60) addNet(bucket, '15m', amount, wallet, isKol);
      addNet(bucket, '1h', amount, wallet, isKol);
    }
  }
  applyTrades(smartTrades, false);
  applyTrades(kolTrades, true);

  return tokens.map((token) => {
    const key = String(token.address || '').toLowerCase();
    const bucket = buckets.get(key);
    if (!bucket) return token;
    return {
      ...token,
      smartNetInflow5m: Math.round(bucket.smartNetInflow5m * 100) / 100,
      smartNetInflow15m: Math.round(bucket.smartNetInflow15m * 100) / 100,
      smartNetInflow1h: Math.round(bucket.smartNetInflow1h * 100) / 100,
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
    };
  });
}

export { applyMonitorSignalEnrichment, unwrapList };

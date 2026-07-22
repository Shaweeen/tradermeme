/**
 * Bitcoin API - Cloudflare Pages Function
 *
 * Multi-source BTC market data with:
 * - Price sources: Binance, Bybit, CoinGecko, HyperLiquid
 * - Futures: Funding rate, OI (Bybit, Binance, HyperLiquid)
 * - Long/Short Ratio: Binance, Bybit
 * - Liquidations: Binance, Bybit, OKX, Gate（交易所及时爆仓/清算报价）
 * - Sentiment: BTC dominance, total market cap
 *
 * Endpoints:
 *   GET /api/bitcoin              - All BTC market data
 *   GET /api/bitcoin?source=auto  - Auto-select best source
 *   GET /api/bitcoin?source=binance - Prefer Binance
 */

const BINANCE_BASE = 'https://api.binance.com';
const BINANCE_FUTURES = 'https://fapi.binance.com';
const BYBIT_BASE = 'https://api.bybit.com';
const OKX_BASE = 'https://www.okx.com';
const BITGET_BASE = 'https://api.bitget.com';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const COINPAPRIKA_BASE = 'https://api.coinpaprika.com/v1';
const ALTERNATIVE_ME_BASE = 'https://api.alternative.me';
const COINGLASS_OPEN_API = 'https://open-api-v4.coinglass.com';
const HYPERLIQUID_BASE = 'https://api.hyperliquid.xyz';
/** Lighter (zkLighter) DEX perps public API */
const LIGHTER_BASE = 'https://mainnet.zklighter.elliot.ai/api/v1';
const LIGHTER_BTC_MARKET_ID = 1;
/** Gate.io USDT-M futures (public liquidation orders) */
const GATE_FUTURES = 'https://api.gateio.ws/api/v4/futures/usdt';
const SOURCE_TIMEOUT = 8000;

/** Platform venue registry: CEX + DEX perps (self-signal mean pool) */
const PLATFORM_VENUE_KEYS = [
  'binance',
  'bybit',
  'okx',
  'bitget',
  'hyperLiquid',
  'lighter',
];

async function safeFetch(url, timeoutMs = SOURCE_TIMEOUT, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() =>controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const data = await response.json();
    return { data, error: null };
  } catch (e) {
    clearTimeout(timeout);
    return { error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

async function safePost(url, body, timeoutMs = SOURCE_TIMEOUT) {
  const controller = new AbortController();
  const timeout = setTimeout(() =>controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const data = await response.json();
    return { data, error: null };
  } catch (e) {
    clearTimeout(timeout);
    return { error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

// ===================================================================================
// PRICE SOURCES
// ===================================================================================

async function fetchBinance() {
  const result = await safeFetch(`${BINANCE_BASE}/api/v3/ticker/24hr?symbol=BTCUSDT`);
  if (result.error || !result.data) return { available: false, error: result.error, data: null };
  const d = result.data;
  return {
    available: true, healthy: true, timestamp: Date.now(),
    data: {
      price: parseFloat(d.lastPrice) || 0,
      priceChange24h: parseFloat(d.priceChangePercent) || 0,
      volume24h: parseFloat(d.quoteVolume) || 0,
      high24h: parseFloat(d.highPrice) || 0,
      low24h: parseFloat(d.lowPrice) || 0,
    },
  };
}

async function fetchBybit() {
  const [tickerResult, fundingResult] = await Promise.all([
    safeFetch(`${BYBIT_BASE}/v5/market/tickers?category=linear&symbol=BTCUSDT`),
    safeFetch(`${BYBIT_BASE}/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1`),
  ]);
  if (tickerResult.error || !tickerResult.data?.result?.list?.[0]) {
    return { available: false, error: tickerResult.error, data: null };
  }
  const t = tickerResult.data.result.list[0];
  const currentFr = parseFloat(t.fundingRate) || 0;
  return {
    available: true, healthy: true, timestamp: Date.now(),
    data: {
      price: parseFloat(t.markPrice) || 0,
      indexPrice: parseFloat(t.indexPrice) || 0,
      fundingRate: currentFr,
      annualFundingRate: currentFr * 3 * 365 * 100,
      nextFundingTime: t.nextFundingTime ? (() => {
        let n = parseInt(t.nextFundingTime);
        if (n >0 && n < 1e12) n *= 1000;
        return n;
      })() : null,
      openInterest: parseFloat(t.openInterest) || 0,
      openInterestValue: parseFloat(t.openInterest) * (parseFloat(t.indexPrice) || 1),
      volume24h: parseFloat(t.volume24h) || 0,
      high24h: parseFloat(t.highPrice24h) || 0,
      low24h: parseFloat(t.lowPrice24h) || 0,
    },
  };
}

async function fetchCoinGecko() {
  const result = await safeFetch(
    `${COINGECKO_BASE}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
  );
  if (result.error || !result.data?.bitcoin) return { available: false, error: result.error, data: null };
  const d = result.data.bitcoin;
  return {
    available: true, healthy: true, timestamp: Date.now(),
    data: { price: d.usd || 0, priceChange24h: d.usd_24h_change || 0, volume24h: d.usd_24h_vol || 0, marketCap: d.usd_market_cap || 0 },
  };
}

// ===================================================================================
// HYPERLIQUID
// ===================================================================================

async function fetchHyperLiquid() {
  // Get all mids (mid prices)
  const midsResult = await safePost(`${HYPERLIQUID_BASE}/info`, { type: 'allMids' });
  // Get all open interests
  const oiResult = await safePost(`${HYPERLIQUID_BASE}/info`, { type: 'openInterests' });
  // Get predicted fundings
  const predictedResult = await safePost(`${HYPERLIQUID_BASE}/info`, { type: 'predictedFundings' });
  // Get funding history for BTC
  const fundingHistResult = await safePost(`${HYPERLIQUID_BASE}/info`, { type: 'fundingHistory', coin: 'BTC' });

  if (midsResult.error && oiResult.error) {
    return { available: false, error: 'HyperLiquid API unreachable', data: null };
  }

  const mids = midsResult.data || {};
  const oiData = oiResult.data || [];
  const predicted = predictedResult.data || [];
  const fundingHist = fundingHistResult.data || [];

  // Find BTC in the responses
  const btcPrice = mids?.BTC ? parseFloat(mids.BTC) : 0;

  // Find BTC OI
  let btcOi = 0;
  if (Array.isArray(oiData)) {
    const btcOiEntry = oiData.find(o =>o.coin === 'BTC' || o.name === 'BTC');
    if (btcOiEntry) btcOi = parseFloat(btcOiEntry.oi) || parseFloat(btcOiEntry.openInterest) || 0;
  }

  // Find BTC predicted funding
  let predictedFr = 0;
  if (Array.isArray(predicted)) {
    const btcPred = predicted.find(p =>p.coin === 'BTC' || p.name === 'BTC');
    if (btcPred) predictedFr = parseFloat(btcPred.funding) || 0;
  }

  // Find latest funding rate from history
  let fundingRate = 0;
  if (Array.isArray(fundingHist) && fundingHist.length >0) {
    const latest = fundingHist[fundingHist.length - 1];
    fundingRate = parseFloat(latest.fundingRate) || parseFloat(latest.sx) || 0;
  }

  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data: {
      price: btcPrice,
      fundingRate,
      predictedFundingRate: predictedFr,
      annualFundingRate: fundingRate * 3 * 365 * 100,
      openInterest: btcOi,
      openInterestUsd: btcOi * (btcPrice || 1),
    },
    note: btcPrice ? undefined : 'HyperLiquid BTC数据有限',
  };
}

// ===================================================================================
// LONG/SHORT RATIO (Binance Futures + Bybit)
// ===================================================================================

async function fetchBinanceLSRatio() {
  const [globalRatio, topRatio] = await Promise.all([
    safeFetch(`${BINANCE_FUTURES}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=2`),
    safeFetch(`${BINANCE_FUTURES}/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=5m&limit=2`),
  ]);

  const parseRatioData = (res) => {
    if (res.error || !Array.isArray(res.data) || res.data.length === 0) return null;
    const latest = res.data[res.data.length - 1];
    return {
      ratio: parseFloat(latest.longShortRatio) || 0,
      longAccount: parseFloat(latest.longAccount) || 0,
      shortAccount: parseFloat(latest.shortAccount) || 0,
      timestamp: parseInt(latest.timestamp) || Date.now(),
    };
  };

  const global = parseRatioData(globalRatio);
  const top = parseRatioData(topRatio);

  if (!global && !top) {
    return { available: false, error: globalRatio.error || 'No data', data: null };
  }

  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data: {
      globalAccountRatio: global?.ratio || 0,
      globalLongPct: global ? (global.longAccount * 100).toFixed(1) : 0,
      globalShortPct: global ? (global.shortAccount * 100).toFixed(1) : 0,
      topTraderRatio: top?.ratio || 0,
      topTraderLongPct: top ? (top.longAccount * 100).toFixed(1) : 0,
      topTraderShortPct: top ? (top.shortAccount * 100).toFixed(1) : 0,
      signal: global?.ratio >1.2 ? '多空偏多' : global?.ratio < 0.8 ? '多空偏空' : '中性',
    },
  };
}

async function fetchBybitLSRatio() {
  const result = await safeFetch(
    `${BYBIT_BASE}/v5/market/account-ratio?category=linear&symbol=BTCUSDT&period=5m&limit=1`
  );
  if (result.error || !result.data?.result?.list?.length) {
    return { available: false, error: result.error, data: null };
  }
  const d = result.data.result.list[0];
  const longPct = parseFloat(d.buyRatio) || 0;
  const shortPct = parseFloat(d.sellRatio) || 0;
  const ratio = shortPct >0 ? longPct / shortPct : 0;

  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data: {
      ratio,
      longPct: (longPct * 100).toFixed(1),
      shortPct: (shortPct * 100).toFixed(1),
      signal: ratio >1.2 ? '多空偏多' : ratio < 0.8 ? '多空偏空' : '中性',
    },
  };
}

// ===================================================================================
// LIQUIDATIONS — 全数据源交易所及时爆仓 / 清算报价列表
// Binance forceOrders · Bybit market/liquidation · OKX public/liquidation-orders · Gate liq_orders
// 不使用 Coinglass
// ===================================================================================

/** 当前 4 小时资金费计费窗（与 period board 4h 对齐） */
const LIQ_WINDOW_4H_MS = 4 * 60 * 60 * 1000;

function liqWindow4hBounds(now = Date.now()) {
  const end = now;
  const start = end - LIQ_WINDOW_4H_MS;
  return { start, end, windowMs: LIQ_WINDOW_4H_MS, label: '4h' };
}

function normalizeLiqTs(ts) {
  let t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (t < 1e12) t *= 1000;
  return t;
}

/** 统一清算聚合结果 */
function buildLiqVenueResult({
  venue,
  longPrices,
  shortPrices,
  start,
  end,
  windowMs,
  label,
}) {
  const totalLong = longPrices.reduce((s, r) => s + (Number(r.usd) || 0), 0);
  const totalShort = shortPrices.reduce((s, r) => s + (Number(r.usd) || 0), 0);
  const totalUsd = totalLong + totalShort;
  const count = longPrices.length + shortPrices.length;
  // 单价列表：同价合并后按金额排序取 Top，再按价格排
  const cluster = (arr, side) => {
    const m = new Map();
    for (const r of arr) {
      const p = Number(r.price);
      if (!Number.isFinite(p) || p <= 0) continue;
      const k = p.toFixed(1);
      const prev = m.get(k) || {
        price: p,
        usd: 0,
        qty: 0,
        venue: r.venue || venue,
        source: r.source || venue,
        time: r.time || null,
      };
      prev.usd += Number(r.usd) || 0;
      prev.qty += Number(r.qty) || 0;
      if (r.time && (!prev.time || r.time > prev.time)) prev.time = r.time;
      m.set(k, prev);
    }
    const list = [...m.values()].sort((a, b) => (b.usd || 0) - (a.usd || 0)).slice(0, 24);
    list.sort((a, b) => (side === 'long' ? b.price - a.price : a.price - b.price));
    return list;
  };
  const L = cluster(longPrices, 'long');
  const S = cluster(shortPrices, 'short');
  return {
    available: count > 0 || totalUsd > 0,
    healthy: true,
    timestamp: Date.now(),
    data: {
      venue,
      totalUsd,
      totalLong,
      totalShort,
      count,
      longPct: totalUsd > 0 ? ((totalLong / totalUsd) * 100).toFixed(1) : 0,
      shortPct: totalUsd > 0 ? ((totalShort / totalUsd) * 100).toFixed(1) : 0,
      side:
        totalLong > totalShort
          ? '多头清算偏多'
          : totalShort > totalLong
            ? '空头清算偏多'
            : '均衡',
      longPrices: L,
      shortPrices: S,
      window4h: {
        label,
        windowMs,
        start,
        end,
        totalUsd,
        totalLong,
        totalShort,
        count,
      },
    },
  };
}

/**
 * Binance 强平单（需 API Key 时可能 -2014；无 key 则标记不可用）
 * GET /fapi/v1/forceOrders
 */
async function fetchBinanceLiquidations() {
  const { start, end, windowMs, label } = liqWindow4hBounds();
  const result = await safeFetch(
    `${BINANCE_FUTURES}/fapi/v1/forceOrders?symbol=BTCUSDT&limit=100&autoCloseType=BOTH&startTime=${start}&endTime=${end}`,
    6000
  );
  const fallback =
    result.error || !Array.isArray(result.data)
      ? await safeFetch(
          `${BINANCE_FUTURES}/fapi/v1/forceOrders?symbol=BTCUSDT&limit=100&autoCloseType=BOTH`,
          6000
        )
      : null;
  const rows = Array.isArray(result.data)
    ? result.data
    : Array.isArray(fallback?.data)
      ? fallback.data
      : null;
  if (!rows) {
    return {
      available: false,
      error: result.error || fallback?.error || 'binance forceOrders unavailable',
      data: null,
    };
  }
  const longPrices = [];
  const shortPrices = [];
  for (const order of rows) {
    if (!order.price || !order.origQty) continue;
    const ts = normalizeLiqTs(order.time ?? order.updateTime ?? order.T);
    if (ts != null && (ts < start || ts > end)) continue;
    const price = parseFloat(order.price);
    const qty = parseFloat(order.origQty);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty)) continue;
    const usdValue = price * qty;
    const row = { price, usd: usdValue, qty, time: ts, venue: 'binance', source: 'binance' };
    if (order.side === 'BUY') shortPrices.push(row);
    else if (order.side === 'SELL') longPrices.push(row);
  }
  return buildLiqVenueResult({
    venue: 'binance',
    longPrices,
    shortPrices,
    start,
    end,
    windowMs,
    label,
  });
}

/**
 * Bybit 线性合约清算
 * GET /v5/market/liquidation
 */
async function fetchBybitLiquidations() {
  const { start, end, windowMs, label } = liqWindow4hBounds();
  const result = await safeFetch(
    `${BYBIT_BASE}/v5/market/liquidation?category=linear&symbol=BTCUSDT&limit=100`,
    6000
  );
  const list = result.data?.result?.list;
  if (result.error || !Array.isArray(list) || !list.length) {
    return {
      available: false,
      error: result.error || 'bybit liquidation empty',
      data: null,
    };
  }
  const longPrices = [];
  const shortPrices = [];
  for (const item of list) {
    const ts = normalizeLiqTs(item.updatedTime ?? item.time ?? item.T);
    if (ts != null && (ts < start || ts > end)) continue;
    const price = parseFloat(item.price) || 0;
    const qty = parseFloat(item.size) || 0;
    if (!price || !qty) continue;
    const usdValue = price * qty;
    const row = { price, usd: usdValue, qty, time: ts, venue: 'bybit', source: 'bybit' };
    if (item.side === 'Buy' || item.side === 'BUY') shortPrices.push(row);
    else longPrices.push(row);
  }
  return buildLiqVenueResult({
    venue: 'bybit',
    longPrices,
    shortPrices,
    start,
    end,
    windowMs,
    label,
  });
}

/**
 * OKX 公开清算订单（及时爆仓报价）
 * GET /api/v5/public/liquidation-orders
 * BTC-USDT-SWAP ctVal=0.01 BTC → usd = |sz| * 0.01 * bkPx
 */
async function fetchOkxLiquidations() {
  const { start, end, windowMs, label } = liqWindow4hBounds();
  const CT_VAL = 0.01; // BTC-USDT-SWAP
  const result = await safeFetch(
    `${OKX_BASE}/api/v5/public/liquidation-orders?instType=SWAP&uly=BTC-USDT&state=filled&limit=100`,
    8000
  );
  if (result.error || result.data?.code !== '0') {
    return {
      available: false,
      error: result.error || result.data?.msg || 'okx liquidation unavailable',
      data: null,
    };
  }
  const longPrices = [];
  const shortPrices = [];
  const blocks = Array.isArray(result.data?.data) ? result.data.data : [];
  for (const block of blocks) {
    const details = Array.isArray(block.details) ? block.details : [];
    for (const item of details) {
      const ts = normalizeLiqTs(item.ts ?? item.time);
      if (ts != null && (ts < start || ts > end)) continue;
      const price = parseFloat(item.bkPx) || parseFloat(item.px) || 0;
      const sz = Math.abs(parseFloat(item.sz) || 0);
      if (!price || !sz) continue;
      const qtyBtc = sz * CT_VAL;
      const usdValue = qtyBtc * price;
      const row = {
        price,
        usd: usdValue,
        qty: qtyBtc,
        time: ts,
        venue: 'okx',
        source: 'okx',
        posSide: item.posSide || null,
      };
      const pos = String(item.posSide || '').toLowerCase();
      const side = String(item.side || '').toLowerCase();
      // 多头被强平：posSide=long 或 side=sell 平多
      if (pos === 'long' || (pos !== 'short' && side === 'sell')) longPrices.push(row);
      else shortPrices.push(row);
    }
  }
  const out = buildLiqVenueResult({
    venue: 'okx',
    longPrices,
    shortPrices,
    start,
    end,
    windowMs,
    label,
  });
  if (!out.data.count) {
    return { available: false, error: 'okx liquidation empty in 4h window', data: null };
  }
  return out;
}

/**
 * Gate.io USDT 永续清算订单
 * GET /api/v4/futures/usdt/liq_orders
 * BTC_USDT quanto_multiplier=0.0001 → usd = |size| * 0.0001 * fill_price
 * size < 0：平多（多头清算）；size > 0：平空（空头清算）
 */
async function fetchGateLiquidations() {
  const { start, end, windowMs, label } = liqWindow4hBounds();
  const QUANTO = 0.0001;
  const result = await safeFetch(
    `${GATE_FUTURES}/liq_orders?contract=BTC_USDT&limit=100`,
    8000
  );
  if (result.error || !Array.isArray(result.data)) {
    return {
      available: false,
      error: result.error || 'gate liq_orders unavailable',
      data: null,
    };
  }
  const longPrices = [];
  const shortPrices = [];
  for (const item of result.data) {
    const ts = normalizeLiqTs(item.time ?? item.create_time);
    if (ts != null && (ts < start || ts > end)) continue;
    const price = parseFloat(item.fill_price) || parseFloat(item.order_price) || 0;
    const rawSize = parseFloat(item.size) || 0;
    const absSize = Math.abs(rawSize);
    if (!price || !absSize) continue;
    const qtyBtc = absSize * QUANTO;
    const usdValue = qtyBtc * price;
    const row = {
      price,
      usd: usdValue,
      qty: qtyBtc,
      time: ts,
      venue: 'gate',
      source: 'gate',
    };
    if (rawSize < 0) longPrices.push(row);
    else shortPrices.push(row);
  }
  const out = buildLiqVenueResult({
    venue: 'gate',
    longPrices,
    shortPrices,
    start,
    end,
    windowMs,
    label,
  });
  if (!out.data.count) {
    return { available: false, error: 'gate liquidation empty in 4h window', data: null };
  }
  return out;
}

/**
 * 合并多交易所清算报价列表（按价格聚合）
 */
function mergeExchangeLiquidationPrices(liqAgg, side) {
  const rows = [];
  for (const v of Object.values(liqAgg || {})) {
    const list = side === 'long' ? v?.longPrices : v?.shortPrices;
    if (Array.isArray(list)) rows.push(...list);
  }
  const map = new Map();
  for (const r of rows) {
    const p = Number(r.price);
    if (!Number.isFinite(p) || p <= 0) continue;
    const key = p.toFixed(1);
    const prev = map.get(key) || {
      price: p,
      usd: 0,
      qty: 0,
      venues: new Set(),
      source: 'exchange',
      time: null,
    };
    prev.usd += Number(r.usd) || 0;
    prev.qty += Number(r.qty) || 0;
    if (r.venue) prev.venues.add(r.venue);
    if (r.time && (!prev.time || r.time > prev.time)) prev.time = r.time;
    map.set(key, prev);
  }
  return [...map.values()]
    .map((r) => ({
      price: r.price,
      usd: r.usd,
      qty: r.qty,
      venue: [...r.venues].join('+') || 'exchange',
      source: 'exchange_force_orders',
      time: r.time,
    }))
    .sort((a, b) => (b.usd || 0) - (a.usd || 0))
    .slice(0, 20)
    .sort((a, b) => (side === 'long' ? b.price - a.price : a.price - b.price));
}

// ===================================================================================
// OPEN INTEREST (Binance Futures)
// ===================================================================================

async function fetchBinanceOI() {
  const result = await safeFetch(`${BINANCE_FUTURES}/fapi/v1/openInterest?symbol=BTCUSDT`);
  if (result.error || !result.data) return { available: false, error: result.error, data: null };
  const oi = parseFloat(result.data.openInterest) || 0;
  // For USD value, we need the mark price - fetch it
  const priceResult = await safeFetch(`${BINANCE_FUTURES}/fapi/v1/ticker?symbol=BTCUSDT`, 5000);
  const markPrice = priceResult.data?.markPrice ? parseFloat(priceResult.data.markPrice) : 0;
  return {
    available: true, healthy: true, timestamp: Date.now(),
    data: { openInterest: oi, openInterestUsd: oi * markPrice, markPrice },
  };
}

// ===================================================================================
// HISTORICAL FUNDING RATE (Binance Futures)
// ===================================================================================

async function fetchBinanceFundingHistory() {
  // Get premium index for current funding rate
  const premiumResult = await safeFetch(`${BINANCE_FUTURES}/fapi/v1/premiumIndex?symbol=BTCUSDT`);
  // Get last 100 funding rate records (about 8+ hours at 30min intervals)
  const historyResult = await safeFetch(`${BINANCE_FUTURES}/fapi/v1/fundingRate?symbol=BTCUSDT&limit=100`);
  
  if (!premiumResult.data && !historyResult.data) {
    return { available: false, error: premiumResult.error || 'No data', data: null };
  }

  const current = premiumResult.data || {};
  const currentFr = parseFloat(current.lastFundingRate) || 0;
  let nextTime = parseInt(current.nextFundingTime) || null;
  // Binance returns ms; normalize if ever seconds
  if (nextTime && nextTime < 1e12) nextTime *= 1000;

  // Parse history
  let history = [];
  if (historyResult.data && Array.isArray(historyResult.data)) {
    history = historyResult.data.map(entry => ({
      time: parseInt(entry.fundingTime) || 0,
      rate: parseFloat(entry.fundingRate) || 0,
      markPrice: parseFloat(entry.markPrice) || 0,
    }));
  }

  // Calculate stats
  const rates = history.map(h =>h.rate);
  const high = rates.length >0 ? Math.max(...rates) : currentFr;
  const low = rates.length >0 ? Math.min(...rates) : currentFr;
  const avg = rates.length >0 ? rates.reduce((s, r) =>s + r, 0) / rates.length : currentFr;

  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data: {
      current: currentFr,
      nextFundingTime: nextTime,
      annualized: currentFr * 3 * 365 * 100,
      history,
      stats: {
        high24h: high,
        low24h: low,
        avg24h: avg,
        count: history.length,
      },
    },
    note: history.length === 0 ? '历史数据不足' : null,
  };
}

// ===================================================================================
// DOMINANCE & MARKET OVERVIEW（多源：Coinpaprika / Alternative.me / CoinGecko）
// ===================================================================================

function normalizeDominancePayload(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  let btcDominance = 0;
  let totalMarketCap = 0;
  let totalVolume24h = 0;
  let marketCapChange24h = 0;
  let fearGreed = null;
  let fearGreedLabel = null;

  if (source === 'coinpaprika') {
    btcDominance = Number(raw.bitcoin_dominance_percentage) || 0;
    totalMarketCap = Number(raw.market_cap_usd) || 0;
    totalVolume24h = Number(raw.volume_24h_usd) || 0;
    marketCapChange24h = Number(raw.market_cap_change_24h) || 0;
  } else if (source === 'alternative') {
    const d = raw.data || raw;
    // fraction 0.63 → 63%
    const dom = Number(d.bitcoin_percentage_of_market_cap);
    btcDominance = dom > 0 && dom <= 1 ? dom * 100 : dom || 0;
    totalMarketCap = Number(d.quotes?.USD?.total_market_cap) || 0;
    totalVolume24h = Number(d.quotes?.USD?.total_volume_24h) || 0;
  } else if (source === 'coingecko') {
    const d = raw.data || raw;
    // 正确字段：market_cap_percentage.btc（非 btc_dominance_percentage）
    btcDominance =
      Number(d.market_cap_percentage?.btc) ||
      Number(d.btc_dominance_percentage) ||
      0;
    totalMarketCap = Number(d.total_market_cap?.usd) || 0;
    totalVolume24h = Number(d.total_volume?.usd) || 0;
    marketCapChange24h = Number(d.market_cap_change_percentage_24h_usd) || 0;
  } else if (source === 'feargreed') {
    const row = Array.isArray(raw.data) ? raw.data[0] : raw.data;
    if (!row) return null;
    fearGreed = Number(row.value);
    fearGreedLabel = row.value_classification || null;
    if (!Number.isFinite(fearGreed)) return null;
    return { fearGreed, fearGreedLabel, source };
  }

  if (!(totalMarketCap > 0) && !(btcDominance > 0) && !(totalVolume24h > 0)) return null;
  return {
    btcDominance,
    totalMarketCap,
    totalVolume24h,
    marketCapChange24h,
    fearGreed,
    fearGreedLabel,
    source,
  };
}

async function fetchDominance() {
  // 优先 Coinpaprika（稳定、无 key）；CoinGecko 常 429 且旧字段名错误
  const attempts = [
    { tag: 'coinpaprika', url: `${COINPAPRIKA_BASE}/global` },
    { tag: 'alternative', url: `${ALTERNATIVE_ME_BASE}/v2/global/` },
    { tag: 'coingecko', url: `${COINGECKO_BASE}/global` },
  ];
  const errors = [];
  let best = null;
  for (const a of attempts) {
    const r = await safeFetch(a.url, 8000);
    if (r.error) {
      errors.push(`${a.tag}:${r.error}`);
      continue;
    }
    const parsed = normalizeDominancePayload(r.data, a.tag);
    if (parsed) {
      best = parsed;
      break;
    }
    errors.push(`${a.tag}:empty`);
  }

  // 恐惧贪婪指数（独立、免费）
  let fear = null;
  const fg = await safeFetch(`${ALTERNATIVE_ME_BASE}/fng/?limit=1`, 6000);
  if (!fg.error && fg.data) {
    fear = normalizeDominancePayload(fg.data, 'feargreed');
  }

  if (!best && !fear) {
    return {
      available: false,
      error: errors.slice(0, 3).join(' · ') || 'global market unavailable',
      data: null,
    };
  }

  const data = {
    btcDominance: best?.btcDominance || 0,
    totalMarketCap: best?.totalMarketCap || 0,
    totalVolume24h: best?.totalVolume24h || 0,
    marketCapChange24h: best?.marketCapChange24h || 0,
    fearGreed: fear?.fearGreed ?? null,
    fearGreedLabel: fear?.fearGreedLabel ?? null,
    source: best?.source || fear?.source || 'unknown',
    sources: [best?.source, fear ? 'feargreed' : null].filter(Boolean),
  };

  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data,
  };
}

// ===================================================================================
// BTC 周期：彩虹图 · 减半周期 · 200 日均线
// ===================================================================================

/** 创世块参考日（UTC）— 彩虹回归常用 2009-01-03 / 减半时间表用块高 */
const BTC_GENESIS_UTC = Date.UTC(2009, 0, 3);
/** 减半块高：210k / 420k / 630k / 840k / 1050k … */
const BTC_HALVING_HEIGHTS = [210000, 420000, 630000, 840000, 1050000, 1260000, 1470000];
/** 彩虹色带名（自下而上，冷→热） */
const RAINBOW_BANDS = [
  { key: 'fire_sale', label: 'Fire Sale', color: '#3b82f6' },
  { key: 'buy', label: 'BUY!', color: '#22d3ee' },
  { key: 'accumulate', label: 'Accumulate', color: '#22c55e' },
  { key: 'still_cheap', label: 'Still cheap', color: '#84cc16' },
  { key: 'hodl', label: 'HODL', color: '#eab308' },
  { key: 'hold', label: 'Is this a bubble?', color: '#f59e0b' },
  { key: 'fomo', label: 'FOMO intensifies', color: '#f97316' },
  { key: 'sell', label: 'Sell. Seriously, sell!', color: '#ef4444' },
  { key: 'max_bubble', label: 'Maximum bubble', color: '#b91c1c' },
];

/**
 * 彩虹图对数回归（Bitbo / 减半回归系公开公式）
 * log10(price) = 2.6521 * ln(days) - 18.163
 * days 自 2009-01-09 起；9 色带在 log10 空间等距展开
 */
function computeRainbowBand(priceUsd, nowMs = Date.now()) {
  const price = Number(priceUsd);
  if (!(price > 0)) return null;
  // Bitbo 常用创世日 2009-01-09
  const genesis = Date.UTC(2009, 0, 9);
  const days = Math.max(1, (nowMs - genesis) / 86400000);
  // 回归中枢
  const centerLog10 = 2.6521 * Math.log(days) - 18.163;
  // 9 带：HODL 为中心，步长约 0.28 log10（~1.9x）
  const step = 0.28;
  const midIdx = 4;
  const bandLogs = RAINBOW_BANDS.map((_, i) => centerLog10 + (i - midIdx) * step);
  const priceLog = Math.log10(price);

  // 落在相邻中枢中点之间的色带
  let idx = midIdx;
  for (let i = 0; i < bandLogs.length; i++) {
    const lo = i === 0 ? -Infinity : (bandLogs[i - 1] + bandLogs[i]) / 2;
    const hi =
      i === bandLogs.length - 1 ? Infinity : (bandLogs[i] + bandLogs[i + 1]) / 2;
    if (priceLog >= lo && priceLog < hi) {
      idx = i;
      break;
    }
  }
  if (priceLog >= bandLogs[bandLogs.length - 1]) idx = bandLogs.length - 1;
  if (priceLog < bandLogs[0]) idx = 0;

  const band = RAINBOW_BANDS[idx];
  const bandMid = Math.pow(10, bandLogs[idx]);
  const distPct = ((price - bandMid) / bandMid) * 100;
  // 0–100：相对最冷→最热色带的位置
  const cold = bandLogs[0];
  const hot = bandLogs[bandLogs.length - 1];
  const heatPct = Number(
    (Math.max(0, Math.min(1, (priceLog - cold) / (hot - cold))) * 100).toFixed(1)
  );

  return {
    bandIndex: idx,
    bandKey: band.key,
    bandLabel: band.label,
    bandColor: band.color,
    bandMidPrice: Number(bandMid.toFixed(2)),
    distancePct: Number(distPct.toFixed(2)),
    heatPct,
    daysSinceGenesis: Math.floor(days),
    centerPrice: Number(Math.pow(10, centerLog10).toFixed(2)),
    formula: 'log10(p)=2.6521*ln(days)-18.163',
  };
}

/**
 * 减半周期：用链上 tip 高度；失败时用时间表估算
 */
async function computeHalvingCycle() {
  const HEIGHTS = BTC_HALVING_HEIGHTS;
  // tip 高度
  let height = null;
  const tip = await safeFetch('https://mempool.space/api/blocks/tip/height', 8000);
  if (!tip.error && tip.data != null) {
    const h = Number(tip.data);
    if (Number.isFinite(h) && h > 0) height = h;
  }
  if (height == null) {
    const tip2 = await safeFetch('https://blockchain.info/q/getblockcount', 8000);
    if (!tip2.error && tip2.data != null) {
      const h = Number(tip2.data);
      if (Number.isFinite(h) && h > 0) height = h;
    }
  }

  // 已知减半时间（UTC 近似，作进度补充）
  const HALVING_DATES = [
    Date.UTC(2012, 10, 28),
    Date.UTC(2016, 6, 9),
    Date.UTC(2020, 4, 11),
    Date.UTC(2024, 3, 19), // 2024-04-19
  ];
  // 下一次减半：若有高度用 210k 块 ≈ 4 年
  let epoch = 0;
  let lastHeight = 0;
  let nextHeight = HEIGHTS[0];
  if (height != null) {
    for (let i = 0; i < HEIGHTS.length; i++) {
      if (height >= HEIGHTS[i]) {
        epoch = i + 1;
        lastHeight = HEIGHTS[i];
        nextHeight = HEIGHTS[i + 1] || HEIGHTS[i] + 210000;
      }
    }
  } else {
    const now = Date.now();
    for (let i = 0; i < HALVING_DATES.length; i++) {
      if (now >= HALVING_DATES[i]) epoch = i + 1;
    }
    lastHeight = epoch > 0 ? HEIGHTS[epoch - 1] : 0;
    nextHeight = HEIGHTS[epoch] || lastHeight + 210000;
  }

  const blocksInEpoch = nextHeight - lastHeight || 210000;
  const blocksDone = height != null ? Math.max(0, Math.min(blocksInEpoch, height - lastHeight)) : null;
  const blocksLeft = height != null ? Math.max(0, nextHeight - height) : null;
  // 约 10 分钟一块
  const daysLeft =
    blocksLeft != null ? Number(((blocksLeft * 10) / (60 * 24)).toFixed(1)) : null;
  const progressPct =
    blocksDone != null
      ? Number(((blocksDone / blocksInEpoch) * 100).toFixed(2))
      : (() => {
          const lastDate = HALVING_DATES[epoch - 1] || BTC_GENESIS_UTC;
          const nextDate =
            epoch < HALVING_DATES.length
              ? HALVING_DATES[epoch]
              : lastDate + 4 * 365.25 * 86400000;
          const p = ((Date.now() - lastDate) / (nextDate - lastDate)) * 100;
          return Number(Math.max(0, Math.min(100, p)).toFixed(2));
        })();

  const lastDateMs = HALVING_DATES[Math.max(0, epoch - 1)] || null;
  const daysSinceHalving = lastDateMs
    ? Math.floor((Date.now() - lastDateMs) / 86400000)
    : null;

  return {
    height,
    epoch, // 已完成减半次数
    lastHalvingHeight: lastHeight || null,
    nextHalvingHeight: nextHeight,
    blocksLeft,
    daysLeft,
    progressPct,
    daysSinceHalving,
    cycleLabel: `第 ${epoch + 1} 周期`, // 当前处于第 N 个减半周期（创世为 1）
    source: height != null ? 'mempool/blockchain' : 'calendar_estimate',
  };
}

/**
 * 200 日移动平均（Binance 现货日 K）
 */
async function computeMa200(priceHint = 0) {
  const res = await safeFetch(
    `${BINANCE_BASE}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=220`,
    10000
  );
  if (res.error || !Array.isArray(res.data) || res.data.length < 50) {
    // 回退 futures
    const res2 = await safeFetch(
      `${BINANCE_FUTURES}/fapi/v1/klines?symbol=BTCUSDT&interval=1d&limit=220`,
      10000
    );
    if (res2.error || !Array.isArray(res2.data) || res2.data.length < 50) {
      return {
        available: false,
        ma200: null,
        price: priceHint || null,
        vsPct: null,
        side: null,
        error: res.error || res2.error || 'klines unavailable',
      };
    }
    res.data = res2.data;
  }
  const closes = res.data.map((k) => parseFloat(k[4])).filter((n) => Number.isFinite(n) && n > 0);
  if (closes.length < 200) {
    // 不足 200 用全样本 SMA
    const n = closes.length;
    const ma = closes.reduce((a, b) => a + b, 0) / n;
    const price = closes[closes.length - 1] || priceHint;
    const vsPct = ma > 0 ? ((price - ma) / ma) * 100 : null;
    return {
      available: true,
      ma200: Number(ma.toFixed(2)),
      period: n,
      price: Number(price.toFixed(2)),
      vsPct: vsPct != null ? Number(vsPct.toFixed(2)) : null,
      side: vsPct == null ? null : vsPct >= 0 ? 'above' : 'below',
      partial: true,
      source: 'binance',
    };
  }
  const window = closes.slice(-200);
  const ma = window.reduce((a, b) => a + b, 0) / 200;
  const price = closes[closes.length - 1] || priceHint;
  const vsPct = ma > 0 ? ((price - ma) / ma) * 100 : null;
  return {
    available: true,
    ma200: Number(ma.toFixed(2)),
    period: 200,
    price: Number(price.toFixed(2)),
    vsPct: vsPct != null ? Number(vsPct.toFixed(2)) : null,
    side: vsPct == null ? null : vsPct >= 0 ? 'above' : 'below',
    partial: false,
    source: 'binance',
  };
}

/**
 * 聚合：彩虹周期 + 减半 + MA200
 */
async function fetchBtcCycleMetrics(priceUsd = 0) {
  const [halving, ma200] = await Promise.all([
    computeHalvingCycle().catch((e) => ({ error: e.message })),
    computeMa200(priceUsd).catch((e) => ({ available: false, error: e.message })),
  ]);
  const price =
    Number(ma200?.price) ||
    Number(priceUsd) ||
    0;
  const rainbow = computeRainbowBand(price);

  return {
    available: !!(rainbow || ma200?.available || halving?.progressPct != null),
    healthy: true,
    timestamp: Date.now(),
    data: {
      available: true,
      price,
      rainbow,
      halving,
      ma200,
      source: 'rainbow+halving+ma200',
    },
  };
}

// ===================================================================================
// MULTI-TIMEFRAME VENUE METRICS (funding / OI / volume)
// 资金费率标准计费看板：1h · 2h · 4h（不再用 1d/1w 冒充费率周期）
// ===================================================================================

const PERIOD_DEFS = {
  '1h': {
    label: '1小时',
    ms: 60 * 60 * 1000,
    bnKline: '5m',
    bnKlineLimit: 12,
    bnOiPeriod: '5m',
    bnOiLimit: 12,
    byInterval: '5',
    byOi: '5min',
    byLimit: 12,
    okxBar: '5m',
    okxOiPeriod: '5m',
    okxLimit: 12,
    bgGranularity: '5m',
    bgLimit: 12,
  },
  '2h': {
    label: '2小时',
    ms: 2 * 60 * 60 * 1000,
    bnKline: '5m',
    bnKlineLimit: 24,
    bnOiPeriod: '5m',
    bnOiLimit: 24,
    byInterval: '5',
    byOi: '5min',
    byLimit: 24,
    okxBar: '5m',
    okxOiPeriod: '5m',
    okxLimit: 24,
    bgGranularity: '5m',
    bgLimit: 24,
  },
  '4h': {
    label: '4小时',
    ms: 4 * 60 * 60 * 1000,
    bnKline: '15m',
    bnKlineLimit: 16,
    bnOiPeriod: '15m',
    bnOiLimit: 16,
    byInterval: '15',
    byOi: '15min',
    byLimit: 16,
    okxBar: '15m',
    okxOiPeriod: '5m',
    okxLimit: 16,
    bgGranularity: '15m',
    bgLimit: 16,
  },
};

function periodKeys() {
  return Object.keys(PERIOD_DEFS);
}

function resolvePeriod(raw) {
  const k = String(raw || '1h').toLowerCase();
  const aliases = {
    '1hour': '1h',
    hour: '1h',
    '2hour': '2h',
    '2hours': '2h',
    '4hour': '4h',
    // 旧 UI 周期映射到最近计费窗口，避免脏参数报错
    day: '4h',
    '1d': '4h',
    '1day': '4h',
    '3d': '4h',
    '3day': '4h',
    week: '4h',
    '1w': '4h',
    '1week': '4h',
    '3w': '4h',
    '3week': '4h',
    '21d': '4h',
  };
  const key = aliases[k] || k;
  return PERIOD_DEFS[key] ? key : '1h';
}

/**
 * 从资金费历史中只取 [startMs, now] 内结算样本再平均。
 * 窗口内无结算 → avg=null（禁止用现价冒充窗口均）。
 */
function fundingStatsInWindow(entries = [], startMs = 0) {
  const rates = [];
  for (const e of entries) {
    if (!e) continue;
    const rate = Number(e.rate);
    const t = Number(e.t) || 0;
    if (!Number.isFinite(rate)) continue;
    if (t && startMs && t < startMs) continue;
    rates.push(rate);
  }
  if (!rates.length) return { avg: null, sum: null, last: null, count: 0, rates: [] };
  const sum = rates.reduce((a, b) => a + b, 0);
  return {
    avg: sum / rates.length,
    sum,
    last: rates[rates.length - 1],
    count: rates.length,
    rates,
  };
}

function sumQuoteVolumeFromBnKlines(rows = []) {
  // [ openTime, o, h, l, c, vol, closeTime, quoteVol, ... ]
  let quote = 0;
  let base = 0;
  let open = 0;
  let close = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    base += parseFloat(r[5]) || 0;
    quote += parseFloat(r[7]) || 0;
    if (i === 0) open = parseFloat(r[1]) || 0;
    if (i === rows.length - 1) close = parseFloat(r[4]) || 0;
  }
  return { volumeBase: base, volumeQuote: quote, open, close, priceChangePct: open >0 ? ((close - open) / open) * 100 : 0 };
}

function oiChangeFromSeries(points = [], valueKey = 'sumOpenInterestValue') {
  if (!Array.isArray(points) || points.length < 2) {
    const last = points?.[points.length - 1];
    const v = last ? parseFloat(last[valueKey] ?? last.openInterest ?? last.oi) || 0 : 0;
    return { start: v, end: v, changePct: 0, changeAbs: 0 };
  }
  const first = points[0];
  const last = points[points.length - 1];
  const start = parseFloat(first[valueKey] ?? first.openInterest ?? first.oi) || 0;
  const end = parseFloat(last[valueKey] ?? last.openInterest ?? last.oi) || 0;
  const changeAbs = end - start;
  const changePct = start >0 ? (changeAbs / start) * 100 : 0;
  return { start, end, changePct, changeAbs };
}

function fundingStats(rates = []) {
  const nums = rates.map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return { avg: null, sum: null, last: null, count: 0, rates: [] };
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    avg: sum / nums.length,
    sum,
    last: nums[nums.length - 1],
    count: nums.length,
    rates: nums,
  };
}

async function fetchBinancePeriodMetrics(periodKey) {
  const def = PERIOD_DEFS[periodKey];
  const startMs = Date.now() - def.ms;
  const [klinesRes, oiRes, fundRes, premiumRes] = await Promise.all([
    safeFetch(
      `${BINANCE_FUTURES}/fapi/v1/klines?symbol=BTCUSDT&interval=${def.bnKline}&limit=${def.bnKlineLimit}`,
      10000
    ),
    safeFetch(
      `${BINANCE_FUTURES}/futures/data/openInterestHist?symbol=BTCUSDT&period=${def.bnOiPeriod}&limit=${def.bnOiLimit}`,
      10000
    ),
    safeFetch(
      `${BINANCE_FUTURES}/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=${startMs}&limit=1000`,
      10000
    ),
    safeFetch(`${BINANCE_FUTURES}/fapi/v1/premiumIndex?symbol=BTCUSDT`, 8000),
  ]);

  if (klinesRes.error && oiRes.error && fundRes.error) {
    return { available: false, error: klinesRes.error || oiRes.error || fundRes.error };
  }

  const klines = Array.isArray(klinesRes.data) ? klinesRes.data : [];
  const vol = sumQuoteVolumeFromBnKlines(klines);
  const oiRows = Array.isArray(oiRes.data) ? oiRes.data : [];
  // API fields: sumOpenInterest, sumOpenInterestValue, timestamp
  const oi = oiChangeFromSeries(oiRows, 'sumOpenInterestValue');
  const oiBtc = oiChangeFromSeries(oiRows, 'sumOpenInterest');
  const fundRows = Array.isArray(fundRes.data) ? fundRes.data : [];
  const fundEntries = fundRows.map((r) => ({
    t: parseInt(r.fundingTime, 10) || 0,
    rate: parseFloat(r.fundingRate),
  }));
  const fund = fundingStatsInWindow(fundEntries, startMs);
  const currentFr = premiumRes.data ? parseFloat(premiumRes.data.lastFundingRate) : null;

  return {
    available: true,
    venue: 'binance',
    label: 'Binance',
    lastPrice: vol.close || null,
    close: vol.close || null,
    funding: {
      // current = 最新结算/预测；avg = 窗口内结算样本均值（无样本则为 null，禁止冒充）
      current: Number.isFinite(currentFr) ? currentFr : fund.last,
      avg: fund.avg,
      sum: fund.sum,
      count: fund.count,
      windowMs: def.ms,
      annualizedAvg: fund.avg != null ? fund.avg * 3 * 365 * 100 : null,
    },
    oi: {
      startUsd: oi.start,
      endUsd: oi.end,
      changeUsd: oi.changeAbs,
      changePct: oi.changePct,
      endBtc: oiBtc.end,
      changeBtcPct: oiBtc.changePct,
    },
    volume: {
      quoteUsd: vol.volumeQuote,
      baseBtc: vol.volumeBase,
      priceChangePct: vol.priceChangePct,
      close: vol.close || null,
    },
    errors: [klinesRes.error, oiRes.error, fundRes.error].filter(Boolean),
  };
}

async function fetchBybitPeriodMetrics(periodKey) {
  const def = PERIOD_DEFS[periodKey];
  const startMs = Date.now() - def.ms;
  const [klineRes, oiRes, fundRes, tickRes] = await Promise.all([
    safeFetch(
      `${BYBIT_BASE}/v5/market/kline?category=linear&symbol=BTCUSDT&interval=${def.byInterval}&limit=${def.byLimit}`,
      10000
    ),
    safeFetch(
      `${BYBIT_BASE}/v5/market/open-interest?category=linear&symbol=BTCUSDT&intervalTime=${def.byOi}&limit=${def.byLimit}`,
      10000
    ),
    safeFetch(
      `${BYBIT_BASE}/v5/market/funding/history?category=linear&symbol=BTCUSDT&startTime=${startMs}&limit=200`,
      10000
    ),
    safeFetch(`${BYBIT_BASE}/v5/market/tickers?category=linear&symbol=BTCUSDT`, 8000),
  ]);

  if (klineRes.error && oiRes.error && fundRes.error) {
    return { available: false, error: klineRes.error || oiRes.error || fundRes.error };
  }

  const klist = klineRes.data?.result?.list || [];
  // Bybit returns newest first: [start, open, high, low, close, volume, turnover]
  const chrono = [...klist].reverse();
  let volumeQuote = 0;
  let volumeBase = 0;
  let open = 0;
  let close = 0;
  for (let i = 0; i < chrono.length; i++) {
    const r = chrono[i];
    volumeBase += parseFloat(r[5]) || 0;
    volumeQuote += parseFloat(r[6]) || 0;
    if (i === 0) open = parseFloat(r[1]) || 0;
    if (i === chrono.length - 1) close = parseFloat(r[4]) || 0;
  }

  const oiListRaw = oiRes.data?.result?.list || [];
  // newest first typically
  const oiChrono = [...oiListRaw].reverse().map((row) => ({
    openInterest: parseFloat(row.openInterest) || 0,
    timestamp: parseInt(row.timestamp) || 0,
  }));
  // Convert BTC OI to USD with mark if possible
  const mark = parseFloat(tickRes.data?.result?.list?.[0]?.markPrice) || close || 0;
  const oiUsdSeries = oiChrono.map((r) => ({
    sumOpenInterestValue: r.openInterest * (mark || 1),
    sumOpenInterest: r.openInterest,
  }));
  const oi = oiChangeFromSeries(oiUsdSeries, 'sumOpenInterestValue');
  const oiBtc = oiChangeFromSeries(oiUsdSeries, 'sumOpenInterest');

  const fundList = fundRes.data?.result?.list || [];
  const fundEntries = fundList.map((r) => ({
    t: parseInt(r.fundingRateTimestamp || r.fundingTime || r.timestamp, 10) || 0,
    rate: parseFloat(r.fundingRate),
  }));
  const fund = fundingStatsInWindow(fundEntries, startMs);
  const currentFr = parseFloat(tickRes.data?.result?.list?.[0]?.fundingRate);

  return {
    available: true,
    venue: 'bybit',
    label: 'Bybit',
    lastPrice: close || mark || null,
    close: close || null,
    funding: {
      current: Number.isFinite(currentFr) ? currentFr : fund.last,
      avg: fund.avg,
      sum: fund.sum,
      count: fund.count,
      windowMs: def.ms,
      annualizedAvg: fund.avg != null ? fund.avg * 3 * 365 * 100 : null,
    },
    oi: {
      startUsd: oi.start,
      endUsd: oi.end,
      changeUsd: oi.changeAbs,
      changePct: oi.changePct,
      endBtc: oiBtc.end,
      changeBtcPct: oiBtc.changePct,
      mark,
    },
    volume: {
      quoteUsd: volumeQuote,
      baseBtc: volumeBase,
      priceChangePct: open >0 ? ((close - open) / open) * 100 : 0,
      close: close || null,
    },
    errors: [klineRes.error, oiRes.error, fundRes.error].filter(Boolean),
  };
}

async function fetchOkxPeriodMetrics(periodKey) {
  const def = PERIOD_DEFS[periodKey];
  const instId = 'BTC-USDT-SWAP';
  const startMs = Date.now() - def.ms;
  const [candleRes, fundHistRes, fundNowRes, oiHistRes, oiNowRes] = await Promise.all([
    safeFetch(
      `${OKX_BASE}/api/v5/market/candles?instId=${instId}&bar=${encodeURIComponent(def.okxBar)}&limit=${def.okxLimit}`,
      10000
    ),
    safeFetch(
      `${OKX_BASE}/api/v5/public/funding-rate-history?instId=${instId}&limit=100`,
      10000
    ),
    safeFetch(`${OKX_BASE}/api/v5/public/funding-rate?instId=${instId}`, 8000),
    safeFetch(
      `${OKX_BASE}/api/v5/rubik/stat/contracts/open-interest-history?instId=${instId}&period=${encodeURIComponent(def.okxOiPeriod)}`,
      10000
    ),
    safeFetch(`${OKX_BASE}/api/v5/public/open-interest?instType=SWAP&instId=${instId}`, 8000),
  ]);

  if (candleRes.error && fundHistRes.error && oiHistRes.error && oiNowRes.error) {
    return { available: false, error: candleRes.error || fundHistRes.error || oiHistRes.error };
  }

  // Candles newest first: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
  const candles = Array.isArray(candleRes.data?.data) ? candleRes.data.data : [];
  const chrono = [...candles].reverse();
  let volumeQuote = 0;
  let volumeBase = 0;
  let open = 0;
  let close = 0;
  for (let i = 0; i < chrono.length; i++) {
    const r = chrono[i];
    volumeBase += parseFloat(r[5]) || 0;
    // volCcyQuote preferred (USDT), fallback volCcy
    volumeQuote += parseFloat(r[7]) || parseFloat(r[6]) || 0;
    if (i === 0) open = parseFloat(r[1]) || 0;
    if (i === chrono.length - 1) close = parseFloat(r[4]) || 0;
  }

  const fundRows = Array.isArray(fundHistRes.data?.data) ? fundHistRes.data.data : [];
  const fundEntries = fundRows.map((r) => ({
    t: parseInt(r.fundingTime || r.ts, 10) || 0,
    rate: parseFloat(r.fundingRate),
  }));
  const fund = fundingStatsInWindow(fundEntries, startMs);
  const currentFr = parseFloat(fundNowRes.data?.data?.[0]?.fundingRate);

  // OI history shapes vary: [[ts, oi], ...] or [{ts, oi}]
  let oiPoints = [];
  const oiRaw = oiHistRes.data?.data;
  if (Array.isArray(oiRaw)) {
    oiPoints = oiRaw
      .map((row) => {
        if (Array.isArray(row)) {
          return { ts: parseInt(row[0]) || 0, oi: parseFloat(row[1]) || 0 };
        }
        return {
          ts: parseInt(row.ts || row.timestamp) || 0,
          oi: parseFloat(row.oi || row.openInterest || row.oiCcy) || 0,
        };
      })
      .filter((p) => p.oi > 0)
      .sort((a, b) => a.ts - b.ts);
    // window filter when denser than period
    if (startMs > 0) oiPoints = oiPoints.filter((p) => !p.ts || p.ts >= startMs);
  }
  const mark = close || open || 0;
  const oiNowBtc = parseFloat(oiNowRes.data?.data?.[0]?.oi || oiNowRes.data?.data?.[0]?.oiCcy) || 0;
  if (!oiPoints.length && oiNowBtc > 0) {
    oiPoints = [{ ts: Date.now(), oi: oiNowBtc }];
  }
  const oiUsdSeries = oiPoints.map((p) => ({
    sumOpenInterest: p.oi,
    sumOpenInterestValue: p.oi * (mark || 1),
  }));
  const oi = oiChangeFromSeries(oiUsdSeries, 'sumOpenInterestValue');
  const oiBtc = oiChangeFromSeries(oiUsdSeries, 'sumOpenInterest');

  return {
    available: true,
    venue: 'okx',
    label: 'OKX',
    lastPrice: close || mark || null,
    close: close || null,
    funding: {
      current: Number.isFinite(currentFr) ? currentFr : fund.last,
      avg: fund.avg,
      sum: fund.sum,
      count: fund.count,
      windowMs: def.ms,
      annualizedAvg: fund.avg != null ? fund.avg * 3 * 365 * 100 : null,
    },
    oi: {
      startUsd: oi.start,
      endUsd: oi.end || oiNowBtc * (mark || 1),
      changeUsd: oi.changeAbs,
      changePct: oi.changePct,
      endBtc: oiBtc.end || oiNowBtc,
      changeBtcPct: oiBtc.changePct,
      mark,
    },
    volume: {
      quoteUsd: volumeQuote,
      baseBtc: volumeBase,
      priceChangePct: open >0 ? ((close - open) / open) * 100 : 0,
      close: close || null,
    },
    errors: [candleRes.error, fundHistRes.error, oiHistRes.error, oiNowRes.error].filter(Boolean),
  };
}

async function fetchBitgetPeriodMetrics(periodKey) {
  const def = PERIOD_DEFS[periodKey];
  const symbol = 'BTCUSDT';
  const productType = 'USDT-FUTURES';
  const startMs = Date.now() - def.ms;
  const [candleRes, fundNowRes, fundHistRes, oiRes, tickerRes] = await Promise.all([
    safeFetch(
      `${BITGET_BASE}/api/v2/mix/market/candles?symbol=${symbol}&productType=${productType}&granularity=${encodeURIComponent(def.bgGranularity)}&limit=${def.bgLimit}`,
      10000
    ),
    safeFetch(
      `${BITGET_BASE}/api/v2/mix/market/current-fund-rate?symbol=${symbol}&productType=${productType}`,
      8000
    ),
    safeFetch(
      `${BITGET_BASE}/api/v2/mix/market/history-fund-rate?symbol=${symbol}&productType=${productType}&pageSize=100`,
      10000
    ),
    safeFetch(
      `${BITGET_BASE}/api/v2/mix/market/open-interest?symbol=${symbol}&productType=${productType}`,
      8000
    ),
    safeFetch(
      `${BITGET_BASE}/api/v2/mix/market/ticker?symbol=${symbol}&productType=${productType}`,
      8000
    ),
  ]);

  if (candleRes.error && fundHistRes.error && oiRes.error) {
    return { available: false, error: candleRes.error || fundHistRes.error || oiRes.error };
  }

  // Candles: often [[ts, o, h, l, c, baseVol, quoteVol], ...] ascending or descending
  let candles = candleRes.data?.data;
  if (!Array.isArray(candles)) candles = [];
  // Normalize chronological
  if (candles.length >= 2) {
    const t0 = parseInt(candles[0][0] || candles[0].ts) || 0;
    const t1 = parseInt(candles[candles.length - 1][0] || candles[candles.length - 1].ts) || 0;
    if (t0 >t1) candles = [...candles].reverse();
  }
  let volumeQuote = 0;
  let volumeBase = 0;
  let open = 0;
  let close = 0;
  for (let i = 0; i < candles.length; i++) {
    const r = candles[i];
    const row = Array.isArray(r)
      ? r
      : [r.ts, r.open, r.high, r.low, r.close, r.baseVolume, r.quoteVolume];
    volumeBase += parseFloat(row[5]) || 0;
    volumeQuote += parseFloat(row[6]) || 0;
    if (i === 0) open = parseFloat(row[1]) || 0;
    if (i === candles.length - 1) close = parseFloat(row[4]) || 0;
  }

  const fundHist = fundHistRes.data?.data || [];
  const fundList = Array.isArray(fundHist) ? fundHist : fundHist?.result || [];
  const fundEntries = (Array.isArray(fundList) ? fundList : []).map((r) => ({
    t: parseInt(r.fundingTime || r.cTime || r.ts, 10) || 0,
    rate: parseFloat(r.fundingRate ?? r.fundRate),
  }));
  const fund = fundingStatsInWindow(fundEntries, startMs);
  const currentFr = parseFloat(
    fundNowRes.data?.data?.[0]?.fundingRate ??
      fundNowRes.data?.data?.fundingRate ??
      tickerRes.data?.data?.[0]?.fundingRate
  );

  const oiRaw = oiRes.data?.data;
  let oiBtc = 0;
  let oiUsdDirect = 0;
  const pickOi = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    const btc = parseFloat(
      obj.amount ?? obj.openInterestSize ?? obj.holdVolume ?? obj.openInterest ?? obj.size ?? obj.oi
    );
    const usd = parseFloat(obj.openInterestUsd ?? obj.holdAmountUsd ?? obj.value);
    if (Number.isFinite(btc) && btc >0) oiBtc = btc;
    if (Number.isFinite(usd) && usd >0) oiUsdDirect = usd;
  };
  if (Array.isArray(oiRaw)) pickOi(oiRaw[0]);
  else if (oiRaw && typeof oiRaw === 'object') {
    if (Array.isArray(oiRaw.openInterestList)) pickOi(oiRaw.openInterestList[0]);
    else if (Array.isArray(oiRaw.list)) pickOi(oiRaw.list[0]);
    else pickOi(oiRaw);
  }
  const tick0 = Array.isArray(tickerRes.data?.data) ? tickerRes.data.data[0] : tickerRes.data?.data;
  if (!oiBtc && tick0) {
    oiBtc = parseFloat(tick0.holdingAmount || tick0.openInterest || 0) || 0;
  }
  const mark = parseFloat(tick0?.lastPr || tick0?.markPrice || tick0?.last) || close || 0;
  // Bitget public OI is typically snapshot-only for this endpoint
  const oiUsd = oiUsdDirect || (oiBtc >0 && mark >0 ? oiBtc * mark : 0);

  return {
    available: true,
    venue: 'bitget',
    label: 'Bitget',
    lastPrice: close || mark || null,
    close: close || null,
    funding: {
      current: Number.isFinite(currentFr) ? currentFr : fund.last,
      avg: fund.avg,
      sum: fund.sum,
      count: fund.count,
      windowMs: def.ms,
      annualizedAvg: fund.avg != null ? fund.avg * 3 * 365 * 100 : null,
    },
    oi: {
      startUsd: null,
      endUsd: oiUsd > 0 ? oiUsd : null,
      changeUsd: null,
      changePct: null,
      endBtc: oiBtc > 0 ? oiBtc : null,
      changeBtcPct: null,
      mark,
    },
    volume: {
      quoteUsd: volumeQuote,
      baseBtc: volumeBase,
      priceChangePct: open > 0 ? ((close - open) / open) * 100 : 0,
      close: close || null,
    },
    note: 'OI 为快照（公开接口无完整历史序列）',
    errors: [candleRes.error, fundHistRes.error, oiRes.error, fundNowRes.error].filter(Boolean),
  };
}

async function fetchHyperLiquidPeriodMetrics(periodKey) {
  // HL: hourly funding — 用 fundingHistory 窗口内样本均值，禁止用现价冒充
  const def = PERIOD_DEFS[periodKey];
  const startMs = Date.now() - def.ms;
  const [midsRes, metaRes, fundRes] = await Promise.all([
    safePost(`${HYPERLIQUID_BASE}/info`, { type: 'allMids' }),
    safePost(`${HYPERLIQUID_BASE}/info`, { type: 'metaAndAssetCtxs' }),
    safePost(`${HYPERLIQUID_BASE}/info`, {
      type: 'fundingHistory',
      coin: 'BTC',
      startTime: startMs,
    }),
  ]);

  if (midsRes.error && metaRes.error) {
    return { available: false, error: midsRes.error || metaRes.error, note: 'HyperLiquid 历史深度有限' };
  }

  const price = midsRes.data?.BTC ? parseFloat(midsRes.data.BTC) : 0;
  let oiBtc = 0;
  let fundingCurrent = null;
  let dayNtlVlm = 0;
  try {
    const meta = metaRes.data;
    // metaAndAssetCtxs → [universe meta, asset ctxs array]
    const ctxs = Array.isArray(meta?.[1]) ? meta[1] : Array.isArray(meta) ? meta : [];
    const universe = meta?.[0]?.universe || [];
    const idx = universe.findIndex((u) => u?.name === 'BTC');
    const ctx = idx >= 0 ? ctxs[idx] : ctxs.find((c) => c?.coin === 'BTC') || null;
    if (ctx) {
      oiBtc = parseFloat(ctx.openInterest) || 0;
      const fr = parseFloat(ctx.funding);
      fundingCurrent = Number.isFinite(fr) ? fr : null;
      dayNtlVlm = parseFloat(ctx.dayNtlVlm) || 0;
    }
  } catch (_) {
    /* ignore */
  }

  const fundHist = Array.isArray(fundRes.data) ? fundRes.data : [];
  const fundEntries = fundHist.map((r) => ({
    t: parseInt(r.time || r.fundingTime || r.ts, 10) || 0,
    rate: parseFloat(r.fundingRate ?? r.funding),
  }));
  const fund = fundingStatsInWindow(fundEntries, startMs);

  // Volume: HL only guarantees 24h dayNtlVlm publicly — scale roughly for other windows
  const scale = def.ms / (24 * 60 * 60 * 1000);
  const volumeQuote = dayNtlVlm > 0 ? dayNtlVlm * Math.min(scale, 1) : null;

  return {
    available: true,
    venue: 'hyperLiquid',
    label: 'HyperLiquid',
    lastPrice: price || null,
    close: price || null,
    funding: {
      current: fundingCurrent != null ? fundingCurrent : fund.last,
      avg: fund.avg,
      sum: fund.sum,
      count: fund.count,
      windowMs: def.ms,
      annualizedAvg:
        fund.avg != null
          ? fund.avg * 24 * 365 * 100
          : fundingCurrent != null
            ? fundingCurrent * 24 * 365 * 100
            : null,
    },
    oi: {
      startUsd: null,
      endUsd: oiBtc * (price || 1),
      changeUsd: null,
      changePct: null,
      endBtc: oiBtc,
      changeBtcPct: null,
      mark: price || null,
    },
    volume: {
      quoteUsd: volumeQuote,
      baseBtc: price >0 && volumeQuote ? volumeQuote / price : null,
      priceChangePct: null,
      close: price || null,
      note: periodKey === '1d' ? 'dayNtlVlm' : '由 24h 名义量按窗口近似',
    },
    note: 'OI 变动与精确成交量历史有限',
    errors: [midsRes.error, metaRes.error, fundRes.error].filter(Boolean),
  };
}

/**
 * Lighter DEX perps — BTC market_id=1
 * Public: orderBookDetails (mark/OI/volume) + funding-rates (exchange=lighter)
 */
async function fetchLighterPeriodMetrics(periodKey) {
  const def = PERIOD_DEFS[periodKey];
  const startMs = Date.now() - def.ms;
  const [detailRes, fundRes, fundHistRes, statsRes] = await Promise.all([
    safeFetch(`${LIGHTER_BASE}/orderBookDetails?market_id=${LIGHTER_BTC_MARKET_ID}`, 10000),
    safeFetch(`${LIGHTER_BASE}/funding-rates`, 10000),
    // 历史资金费：按 market_id 拉取后按窗口过滤
    safeFetch(
      `${LIGHTER_BASE}/fundings?market_id=${LIGHTER_BTC_MARKET_ID}&limit=100&count_back=100`,
      10000
    ),
    safeFetch(`${LIGHTER_BASE}/exchangeStats`, 10000),
  ]);

  if (detailRes.error && fundRes.error && statsRes.error) {
    return {
      available: false,
      venue: 'lighter',
      label: 'Lighter',
      error: detailRes.error || fundRes.error || statsRes.error,
      healthy: false,
    };
  }

  const details = Array.isArray(detailRes.data?.order_book_details)
    ? detailRes.data.order_book_details
    : [];
  const d =
    details.find((x) => Number(x.market_id) === LIGHTER_BTC_MARKET_ID || x.symbol === 'BTC') ||
    details[0] ||
    null;

  const statsList = Array.isArray(statsRes.data?.order_book_stats)
    ? statsRes.data.order_book_stats
    : [];
  const st = statsList.find((x) => x.symbol === 'BTC') || null;

  const mark = d ? parseFloat(d.mark_price) || 0 : 0;
  const last = d
    ? parseFloat(d.last_trade_price) || mark
    : st
      ? parseFloat(st.last_trade_price) || 0
      : 0;
  const price = last || mark;
  const oiBtc = d ? parseFloat(d.open_interest) || 0 : 0;
  const vol24 =
    (d && parseFloat(d.daily_quote_token_volume)) ||
    (st && parseFloat(st.daily_quote_token_volume)) ||
    0;
  const pxCh24 =
    (d && parseFloat(d.daily_price_change)) ||
    (st && parseFloat(st.daily_price_change)) ||
    null;

  // 现价：funding-rates 表中 exchange=lighter
  let fundingCurrent = null;
  const rates = Array.isArray(fundRes.data?.funding_rates) ? fundRes.data.funding_rates : [];
  const lit = rates.find(
    (r) =>
      String(r.exchange || '').toLowerCase() === 'lighter' &&
      (Number(r.market_id) === LIGHTER_BTC_MARKET_ID || r.symbol === 'BTC')
  );
  if (lit && Number.isFinite(Number(lit.rate))) fundingCurrent = Number(lit.rate);

  // 窗口均：历史 fundings（若接口可用）；否则窗口内无样本 → avg=null（不拿现价冒充）
  let fundHistRaw =
    fundHistRes.data?.fundings ||
    fundHistRes.data?.data ||
    fundHistRes.data?.funding_rates ||
    fundHistRes.data;
  if (!Array.isArray(fundHistRaw)) fundHistRaw = [];
  const fundEntries = fundHistRaw.map((r) => ({
    t: parseInt(r.timestamp || r.time || r.funding_time || r.ts, 10) || 0,
    rate: parseFloat(r.rate ?? r.funding_rate ?? r.fundingRate),
  }));
  const fund = fundingStatsInWindow(fundEntries, startMs);

  // 成交量：按窗口比例缩放 24h 名义量（仅近似量，不影响费率）
  const scale = def.ms / (24 * 60 * 60 * 1000);
  const volumeQuote = vol24 > 0 ? vol24 * Math.min(scale, 1) : null;

  const available = price > 0 || oiBtc > 0 || fundingCurrent != null || fund.count > 0 || vol24 > 0;
  if (!available) {
    return {
      available: false,
      venue: 'lighter',
      label: 'Lighter',
      error: 'no BTC fields',
      healthy: false,
      errors: [detailRes.error, fundRes.error, fundHistRes.error, statsRes.error].filter(Boolean),
    };
  }

  return {
    available: true,
    healthy: true,
    venue: 'lighter',
    label: 'Lighter',
    kind: 'dex_perps',
    lastPrice: price || null,
    close: price || null,
    funding: {
      current: fundingCurrent != null ? fundingCurrent : fund.last,
      avg: fund.avg, // 窗口内无结算则为 null
      sum: fund.sum,
      count: fund.count,
      windowMs: def.ms,
      annualizedAvg:
        fund.avg != null
          ? fund.avg * 24 * 365 * 100
          : fundingCurrent != null
            ? fundingCurrent * 24 * 365 * 100
            : null,
    },
    oi: {
      startUsd: null,
      endUsd: oiBtc > 0 && price > 0 ? oiBtc * price : null,
      changeUsd: null,
      changePct: null,
      endBtc: oiBtc || null,
      changeBtcPct: null,
      mark: mark || price || null,
    },
    volume: {
      quoteUsd: volumeQuote,
      baseBtc: price > 0 && volumeQuote ? volumeQuote / price : null,
      priceChangePct: Number.isFinite(pxCh24) ? pxCh24 : null,
      close: price || null,
      note: '由 24h 名义量按窗口比例近似',
    },
    note: 'DEX perps · 费率窗口无结算样本时 avg 为空，不参与均费率',
    errors: [detailRes.error, fundRes.error, fundHistRes.error, statsRes.error].filter(Boolean),
  };
}

/** Mean of finite numbers (sum then / n of available sources only). */
function meanNums(arr) {
  const nums = (arr || []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function sumNums(arr) {
  const nums = (arr || []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0);
}

/** BN / By / OKX / Bitget / HyperLiquid / Lighter — 缺源用剩余有效源均值；恢复后重新纳入 */
const EXPECTED_VENUE_SLOTS = PLATFORM_VENUE_KEYS.length;

/**
 * Funding settlement interval (hours) for 8h-equivalent averaging.
 * - CEX: native 8h rate
 * - HyperLiquid: hourly → ×8
 * - Lighter: public funding-rates 与 CEX 同量级并列，按 8h 口径（不 ×8）
 */
const FUNDING_INTERVAL_HOURS = {
  binance: 8,
  bybit: 8,
  okx: 8,
  bitget: 8,
  hyperLiquid: 1,
  lighter: 8,
};

const VENUE_DISPLAY_LABEL = {
  binance: 'Binance',
  bybit: 'Bybit',
  okx: 'OKX',
  bitget: 'Bitget',
  hyperLiquid: 'HyperLiquid',
  lighter: 'Lighter',
};

/** Convert native funding rate → 8h-equivalent (CEX standard) for fair mean. */
function toFunding8h(rate, venueKey) {
  const r = Number(rate);
  if (!Number.isFinite(r)) return null;
  const h = FUNDING_INTERVAL_HOURS[venueKey] || 8;
  return r * (8 / h);
}

/**
 * 资金费率稳健均值：
 * 1) 各所原始费率换算为 8h 等价
 * 2) 先算全样本均值
 * 3) 偏离均值相对幅度 > 10% 的节点剔除并单独标注
 * 4) 剩余节点再相加取平均作为平台专业值
 * 负费率本身合法（空头付多 / 多头收资金费），不因正负剔除。
 */
function buildRobustFundingMean(venues = {}, field = 'current') {
  const samples = [];
  for (const [key, v] of Object.entries(venues)) {
    if (!v || v.available === false) continue;
    // avg 字段：只用窗口内结算样本均值，禁止用 current 冒充
    // current 字段：只用最新快照
    let raw = null;
    if (field === 'avg') {
      if (v.funding?.avg == null || !Number.isFinite(Number(v.funding.avg))) continue;
      if ((v.funding?.count || 0) < 1) continue;
      raw = Number(v.funding.avg);
    } else {
      if (v.funding?.current == null || !Number.isFinite(Number(v.funding.current))) continue;
      raw = Number(v.funding.current);
    }
    const n8 = toFunding8h(raw, key);
    if (n8 == null) continue;
    samples.push({
      key,
      label: VENUE_DISPLAY_LABEL[key] || v.label || key,
      raw,
      rate8h: n8,
      intervalHours: FUNDING_INTERVAL_HOURS[key] || 8,
      sampleCount: v.funding?.count || 0,
    });
  }
  if (!samples.length) {
    return {
      mean: null,
      meanRaw: null,
      inliers: [],
      outliers: [],
      sampleN: 0,
      inlierN: 0,
      outlierN: 0,
      thresholdPct: 10,
      unit: '8h_equivalent',
      note: '无有效资金费率样本',
    };
  }

  const rates = samples.map((s) => s.rate8h);
  const meanRaw = meanNums(rates);
  const mar = meanNums(rates.map((r) => Math.abs(r))) || 0;

  const medianOf = (arr) => {
    const a = [...arr].sort((x, y) => x - y);
    if (!a.length) return 0;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  const mad = medianOf(rates.map((r) => Math.abs(r - meanRaw))); // median abs dev

  const rowOf = (s, center) => {
    const dev = s.rate8h - center;
    const scale = Math.max(Math.abs(center), mar, 1e-8);
    const devPct = (Math.abs(dev) / scale) * 100;
    return {
      ...s,
      deviation: dev,
      deviationPct: Number(devPct.toFixed(2)),
      rate8hPct: s.rate8h * 100,
      rawPct: s.raw * 100,
    };
  };

  /**
   * 规则：
   * 1) meanRaw = 全部有效源相加 / n（必须先全样本平均）
   * 2) 异常 = 同时满足：
   *    - 相对全样本均值偏离 > 10%（尺度 max(|mean|, mar)）
   *    - 且 |费率| 超过「|费率| 中位数」的 1.5 倍（幅度极端，避免多空分化误杀）
   * 3) 平台专业值 = 剔除异常后剩余再平均；若无异常则 = meanRaw
   * 4) 负费率正常（空付多），不因符号剔除
   */
  const medAbs = medianOf(rates.map((r) => Math.abs(r))) || mar || 1e-8;
  const scale = Math.max(Math.abs(meanRaw), mar, 1e-8);
  const bandRel = scale * 0.1; // ±10% of scale
  const magGate = medAbs * 1.5; // 幅度极端门闩

  const inliers = [];
  const outliers = [];
  for (const s of samples) {
    const row = rowOf(s, meanRaw);
    const absDev = Math.abs(s.rate8h - meanRaw);
    const relHit = absDev > bandRel;
    const magHit = Math.abs(s.rate8h) > magGate;
    // 相对偏离>10% 且幅度极端 → 异常；否则保留入均
    if (relHit && magHit) outliers.push(row);
    else inliers.push(row);
  }

  let used = inliers;
  let mean = meanNums(inliers.map((s) => s.rate8h));
  if (inliers.length < 2) {
    // 保证至少能出平台值：只剔除偏离最大者
    if (samples.length >= 3) {
      const peeled = [...samples].sort(
        (a, b) => Math.abs(b.rate8h - meanRaw) - Math.abs(a.rate8h - meanRaw)
      )[0];
      used = samples.filter((s) => s.key !== peeled.key).map((s) => rowOf(s, meanRaw));
      mean = meanNums(used.map((s) => s.rate8h));
      outliers.length = 0;
      outliers.push(rowOf(peeled, meanRaw));
    } else {
      used = samples.map((s) => rowOf(s, meanRaw));
      mean = meanRaw;
      outliers.length = 0;
    }
  }

  const relPct = (r) => (Math.abs(r - meanRaw) / scale) * 100;
  for (const o of outliers) o.deviationPct = Number(relPct(o.rate8h).toFixed(2));
  for (const o of used) o.deviationPct = Number(relPct(o.rate8h).toFixed(2));

  return {
    mean,
    meanRaw,
    inliers: used,
    outliers,
    sampleN: samples.length,
    inlierN: used.length,
    outlierN: outliers.length,
    thresholdPct: 10,
    unit: '8h_equivalent',
    band: bandRel,
    magGate,
    scale,
    mad,
    medAbs,
    note:
      outliers.length > 0
        ? `特别提醒：${outliers
            .map(
              (o) =>
                `${o.label} ${(o.rate8h * 100).toFixed(4)}%（偏离全样本均值 ${Math.abs(o.deviationPct).toFixed(0)}%，幅度异常）`
            )
            .join('、')} 已剔除；平台专业值 = 其余 ${used.length} 源再平均。负费率=空头付多，属正常。`
        : `全 ${samples.length} 源费率纳入均值（8h 等价）。当前为负属正常（空头付多）。`,
  };
}

/**
 * Platform self-signal average: price / funding / OI / volume.
 * 全选有效源相加再取平均；无信号源剔除；恢复链接后重新加入平衡。
 * 资金费率：8h 等价 + 偏离 ±10% 异常单独标注后重均。
 */
function buildFiveVenueAverage(venues = {}) {
  const allKeys = PLATFORM_VENUE_KEYS;
  const list = Object.values(venues).filter((v) => v && v.available !== false);
  const prices = list
    .map((v) => v.price?.last ?? v.lastPrice ?? v.close)
    .filter((n) => n != null && Number(n) > 0);
  const oiEnd = list.map((v) => v.oi?.endUsd).filter((n) => n != null && Number(n) > 0);
  const oiCh = list
    .map((v) => v.oi?.changePct)
    .filter((n) => n != null && Number.isFinite(Number(n)));
  const vols = list.map((v) => v.volume?.quoteUsd).filter((n) => n != null && Number(n) > 0);
  const pxCh = list
    .map((v) => v.volume?.priceChangePct)
    .filter((n) => n != null && Number.isFinite(Number(n)));

  const fundCurRobust = buildRobustFundingMean(venues, 'current');
  const fundAvgRobust = buildRobustFundingMean(venues, 'avg');

  const venueCount = list.length;
  const missing = Math.max(0, EXPECTED_VENUE_SLOTS - venueCount);
  const degraded = missing > 0 || prices.length < venueCount || fundCurRobust.outlierN > 0;

  // Per-venue stability snapshot (periodic health for rejoin)
  const stability = {};
  for (const key of allKeys) {
    const v = venues[key];
    const ok = !!(v && v.available !== false);
    stability[key] = {
      ok,
      healthy: ok && v.healthy !== false,
      kind: v?.kind || (key === 'hyperLiquid' || key === 'lighter' ? 'dex_perps' : 'cex'),
      lastError: ok ? null : v?.error || 'missing',
      has: {
        price: ok && !!(v.price?.last ?? v.lastPrice ?? v.close),
        funding: ok && (v.funding?.current != null || v.funding?.avg != null),
        oi: ok && v.oi?.endUsd != null,
        volume: ok && v.volume?.quoteUsd != null,
      },
    };
  }
  const okKeys = allKeys.filter((k) => stability[k].ok);
  const offlineKeys = allKeys.filter((k) => !stability[k].ok);

  return {
    signalSource: '自信号源',
    venueCount,
    expectedVenues: EXPECTED_VENUE_SLOTS,
    missingVenues: missing,
    degraded,
    venueKeys: okKeys,
    offlineKeys,
    // 报价 / OI / 成交量：有效源相加取平均
    priceAvg: meanNums(prices),
    // 资金费率：8h 等价 + 异常剔除后再平均（平台专业值）
    // 计费窗专业值优先 windowAvg（结算样本）；current 仅作最新快照
    fundingAvg: fundAvgRobust.mean,
    fundingCurrentAvg: fundCurRobust.mean,
    fundingAvgRaw: fundAvgRobust.meanRaw,
    fundingCurrentAvgRaw: fundCurRobust.meanRaw,
    fundingRobust: {
      current: fundCurRobust,
      windowAvg: fundAvgRobust,
    },
    fundingOutliers:
      fundAvgRobust.outlierN > 0 ? fundAvgRobust.outliers : fundCurRobust.outliers,
    fundingInliers:
      fundAvgRobust.inlierN > 0 ? fundAvgRobust.inliers : fundCurRobust.inliers,
    oiEndAvg: meanNums(oiEnd),
    oiChangePctAvg: meanNums(oiCh),
    volumeQuoteAvg: meanNums(vols),
    volumeQuoteSum: sumNums(vols),
    priceChangePctAvg: meanNums(pxCh),
    sample: {
      priceN: prices.length,
      fundingN: fundAvgRobust.sampleN || fundCurRobust.sampleN,
      fundingInlierN: fundAvgRobust.inlierN || fundCurRobust.inlierN,
      fundingOutlierN: fundAvgRobust.outlierN || fundCurRobust.outlierN,
      fundingWindowN: fundAvgRobust.sampleN,
      oiN: oiEnd.length,
      volumeN: vols.length,
    },
    stability: {
      checkedAt: Date.now(),
      policy:
        '计费窗内结算样本均值；缺源剔除；费率偏离全样本 ±10% 且幅度异常则剔除后重均；恢复后重新纳入',
      expected: allKeys,
      online: okKeys,
      offline: offlineKeys,
      venues: stability,
    },
    qualityLabel:
      missing === 0 && fundAvgRobust.outlierN === 0 && fundAvgRobust.sampleN > 0
        ? '自信号源 · 全量'
        : fundAvgRobust.sampleN === 0
          ? `自信号源 · 窗内无费率结算样本`
          : fundAvgRobust.outlierN > 0
            ? `自信号源 · 费率${fundAvgRobust.inlierN}/${fundAvgRobust.sampleN} 入均 · ${fundAvgRobust.outlierN} 异常`
            : `自信号源 · ${venueCount}/${EXPECTED_VENUE_SLOTS} 有效`,
  };
}

function attachVenueLastPrice(venue, lastPrice) {
  if (!venue || !venue.available) return venue;
  const p = Number(lastPrice);
  if (Number.isFinite(p) && p >0) {
    venue.price = { ...(venue.price || {}), last: p };
    venue.lastPrice = p;
  }
  return venue;
}

/**
 * Multi-venue funding / OI / volume for a selected timeframe.
 */
async function fetchPeriodVenueBoard(periodRaw = '1h') {
  const period = resolvePeriod(periodRaw);
  const def = PERIOD_DEFS[period];
  // CEX + DEX perps in parallel; failures become unavailable slots (excluded from mean)
  const [bn, by, okx, bg, hl, lit] = await Promise.all([
    fetchBinancePeriodMetrics(period).catch((e) => ({ available: false, venue: 'binance', error: e.message })),
    fetchBybitPeriodMetrics(period).catch((e) => ({ available: false, venue: 'bybit', error: e.message })),
    fetchOkxPeriodMetrics(period).catch((e) => ({ available: false, venue: 'okx', error: e.message })),
    fetchBitgetPeriodMetrics(period).catch((e) => ({ available: false, venue: 'bitget', error: e.message })),
    fetchHyperLiquidPeriodMetrics(period).catch((e) => ({
      available: false,
      venue: 'hyperLiquid',
      error: e.message,
    })),
    fetchLighterPeriodMetrics(period).catch((e) => ({ available: false, venue: 'lighter', error: e.message })),
  ]);

  const venues = {};
  // Keep offline stubs for stability board (so missing keys still report offline)
  const pack = { binance: bn, bybit: by, okx: okx, bitget: bg, hyperLiquid: hl, lighter: lit };
  for (const [key, raw] of Object.entries(pack)) {
    if (raw?.available) {
      venues[key] = attachVenueLastPrice(
        { ...raw, kind: raw.kind || (key === 'hyperLiquid' || key === 'lighter' ? 'dex_perps' : 'cex') },
        raw.lastPrice || raw.close || raw.price
      );
    } else {
      venues[key] = {
        available: false,
        venue: key,
        label: raw?.label || key,
        error: raw?.error || 'unavailable',
        healthy: false,
        kind: key === 'hyperLiquid' || key === 'lighter' ? 'dex_perps' : 'cex',
      };
    }
  }

  // Backfill lastPrice from metrics internals if helpers set close on volume side
  for (const v of Object.values(venues)) {
    if (!v.available) continue;
    if (!v.lastPrice && v.volume?.close > 0) attachVenueLastPrice(v, v.volume.close);
    if (!v.lastPrice && v.oi?.mark > 0) attachVenueLastPrice(v, v.oi.mark);
  }

  // Only available venues enter mean; stubs stay for stability offline list
  const liveVenues = Object.fromEntries(
    Object.entries(venues).filter(([, v]) => v && v.available !== false)
  );
  // Pass full map so stability can see offline
  const aggregate = buildFiveVenueAverage(venues);
  // recompute pure mean only on live (available already filtered inside)
  void liveVenues;

  return {
    period,
    label: def.label,
    windowMs: def.ms,
    venues: liveVenues, // UI 不展示单所；稳定性用 aggregate.stability
    venueStability: aggregate.stability || null,
    aggregate,
    // alias for UI clarity
    fiveVenueAvg: aggregate,
    platformAvg: aggregate,
    options: periodKeys().map((k) => ({ key: k, label: PERIOD_DEFS[k].label })),
  };
}

// ===================================================================================
// 自信号源三量历史序列：资金费率 / 成交量 / 合约开仓量(OI)
// 横轴时间粒度：时 / 日 / 月 / 年
// ===================================================================================

const SERIES_UNITS = {
  hour: {
    key: 'hour',
    label: '时',
    bnKline: '1h',
    klineLimit: 72,
    bnOiPeriod: '1h',
    oiLimit: 72,
    byInterval: '60',
    byLimit: 72,
  },
  day: {
    key: 'day',
    label: '日',
    bnKline: '1d',
    klineLimit: 60,
    bnOiPeriod: '1d',
    oiLimit: 60,
    byInterval: 'D',
    byLimit: 60,
  },
  month: {
    key: 'month',
    label: '月',
    bnKline: '1d',
    klineLimit: 366,
    bnOiPeriod: '1d',
    oiLimit: 366,
    byInterval: 'D',
    byLimit: 200,
    rollup: 'month',
  },
  year: {
    key: 'year',
    label: '年',
    bnKline: '1d',
    klineLimit: 1000,
    bnOiPeriod: '1d',
    oiLimit: 500,
    byInterval: 'D',
    byLimit: 200,
    rollup: 'year',
  },
};

function resolveSeriesUnit(raw) {
  const k = String(raw || 'day').toLowerCase();
  const aliases = {
    h: 'hour',
    hour: 'hour',
    '1h': 'hour',
    时: 'hour',
    d: 'day',
    day: 'day',
    '1d': 'day',
    日: 'day',
    m: 'month',
    month: 'month',
    mon: 'month',
    月: 'month',
    y: 'year',
    year: 'year',
    年: 'year',
  };
  const key = aliases[k] || k;
  return SERIES_UNITS[key] ? key : 'day';
}

function bucketKey(tsMs, unit) {
  const d = new Date(tsMs);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const h = d.getUTCHours();
  if (unit === 'hour') {
    return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(h).padStart(2, '0')}`;
  }
  if (unit === 'day') {
    return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (unit === 'month') return `${y}-${String(mo).padStart(2, '0')}`;
  return `${y}`;
}

function bucketLabel(key, unit) {
  if (unit === 'hour') {
    // 03-21 14h
    const m = key.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})/);
    return m ? `${m[2]}-${m[3]} ${m[4]}时` : key;
  }
  if (unit === 'day') {
    const m = key.match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}-${m[3]}` : key;
  }
  if (unit === 'month') {
    const m = key.match(/(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : key;
  }
  return key;
}

/**
 * 自信号源三量历史：多节点数据按时间桶对齐后相加取平均。
 * series: funding / volume / oi  + price(单价) for Y axis context
 */
async function fetchSelfSignalTriSeries(unitRaw = 'day') {
  const unit = resolveSeriesUnit(unitRaw);
  const def = SERIES_UNITS[unit];
  const startMs = Date.now() - def.klineLimit * (
    unit === 'hour' ? 3600_000 : 86_400_000
  );

  const [bnK, byK, fundRes, oiRes, premRes] = await Promise.all([
    safeFetch(
      `${BINANCE_FUTURES}/fapi/v1/klines?symbol=BTCUSDT&interval=${def.bnKline}&limit=${def.klineLimit}`,
      12000
    ),
    safeFetch(
      `${BYBIT_BASE}/v5/market/kline?category=linear&symbol=BTCUSDT&interval=${def.byInterval}&limit=${def.byLimit}`,
      12000
    ),
    safeFetch(
      `${BINANCE_FUTURES}/fapi/v1/fundingRate?symbol=BTCUSDT&startTime=${Math.max(0, startMs)}&limit=1000`,
      12000
    ),
    safeFetch(
      `${BINANCE_FUTURES}/futures/data/openInterestHist?symbol=BTCUSDT&period=${def.bnOiPeriod}&limit=${def.oiLimit}`,
      12000
    ),
    safeFetch(`${BINANCE_FUTURES}/fapi/v1/premiumIndex?symbol=BTCUSDT`, 8000),
  ]);

  /** @type {Map<string, { t: number, prices: number[], volumes: number[], ois: number[], funds: number[] }>} */
  const buckets = new Map();

  const ensure = (key, t) => {
    if (!buckets.has(key)) {
      buckets.set(key, { t, prices: [], volumes: [], ois: [], funds: [] });
    }
    return buckets.get(key);
  };

  // Binance klines: price + volume
  if (Array.isArray(bnK.data)) {
    for (const row of bnK.data) {
      const t = parseInt(row[0]) || 0;
      if (!t) continue;
      const key = bucketKey(t, unit);
      const b = ensure(key, t);
      const close = parseFloat(row[4]) || 0;
      const quote = parseFloat(row[7]) || 0;
      if (close >0) b.prices.push(close);
      if (quote >0) b.volumes.push(quote);
      b.t = Math.max(b.t, t);
    }
  }

  // Bybit klines volume (newest first)
  const byList = byK.data?.result?.list || [];
  for (const row of [...byList].reverse()) {
    const t = parseInt(row[0]) || 0;
    if (!t) continue;
    const key = bucketKey(t, unit);
    const b = ensure(key, t);
    const close = parseFloat(row[4]) || 0;
    const turnover = parseFloat(row[6]) || 0;
    if (close >0) b.prices.push(close);
    if (turnover >0) b.volumes.push(turnover);
    b.t = Math.max(b.t, t);
  }

  // Funding rates
  if (Array.isArray(fundRes.data)) {
    for (const row of fundRes.data) {
      const t = parseInt(row.fundingTime) || 0;
      if (!t) continue;
      const key = bucketKey(t, unit);
      const b = ensure(key, t);
      const rate = parseFloat(row.fundingRate);
      if (Number.isFinite(rate)) b.funds.push(rate);
      b.t = Math.max(b.t, t);
    }
  }

  // OI history
  if (Array.isArray(oiRes.data)) {
    for (const row of oiRes.data) {
      const t = parseInt(row.timestamp) || 0;
      if (!t) continue;
      const key = bucketKey(t, unit);
      const b = ensure(key, t);
      const oiUsd = parseFloat(row.sumOpenInterestValue) || 0;
      if (oiUsd >0) b.ois.push(oiUsd);
      b.t = Math.max(b.t, t);
    }
  }

  const series = [...buckets.entries()]
    .map(([key, b]) => {
      const price = meanNums(b.prices);
      const volume = meanNums(b.volumes); // 自节点成交量均值
      const oi = meanNums(b.ois); // 自节点合约开仓量均值
      const funding = meanNums(b.funds);
      return {
        t: b.t,
        key,
        label: bucketLabel(key, unit),
        price,
        funding,
        volume,
        oi,
        nodes: {
          price: b.prices.length,
          volume: b.volumes.length,
          oi: b.ois.length,
          funding: b.funds.length,
        },
      };
    })
    .filter((p) =>p.price != null || p.volume != null || p.oi != null || p.funding != null)
    .sort((a, b) =>a.t - b.t);

  // Forward-fill funding/OI gaps for chart continuity (optional light fill)
  let lastFund = null;
  let lastOi = null;
  let lastPrice = null;
  for (const p of series) {
    if (p.funding != null) lastFund = p.funding;
    else if (lastFund != null) p.funding = lastFund;
    if (p.oi != null) lastOi = p.oi;
    else if (lastOi != null) p.oi = lastOi;
    if (p.price != null) lastPrice = p.price;
    else if (lastPrice != null) p.price = lastPrice;
  }

  const last = series[series.length - 1] || null;
  const curFund = premRes.data ? parseFloat(premRes.data.lastFundingRate) : last?.funding;

  return {
    signalSource: '自信号源',
    unit,
    unitLabel: def.label,
    series,
    latest: {
      price: last?.price ?? null,
      funding: Number.isFinite(curFund) ? curFund : last?.funding ?? null,
      volume: last?.volume ?? null,
      oi: last?.oi ?? null,
    },
    seriesMeta: {
      count: series.length,
      metrics: [
        { key: 'funding', label: '资金费率', color: '#06b6d4' },
        { key: 'volume', label: '成交量', color: '#22c55e' },
        { key: 'oi', label: '合约开仓量', color: '#f59e0b' },
      ],
      yAxis: { left: '单价', right: '费率 / 量 / OI（归一化）' },
      note: '①资金费率 ②自节点成交量 ③自节点合约开仓量 · 缺节点剔除后均值 · 横轴时/日/月/年',
    },
    options: Object.keys(SERIES_UNITS).map((k) => ({
      key: k,
      label: SERIES_UNITS[k].label,
    })),
  };
}

/**
 * 标准计费窗 1h / 2h / 4h 并行 + 当前选中主看板。
 * 各窗独立拉历史结算样本再均，禁止复用现价。
 */
async function fetchPeriodVenueBoardWithStages(periodRaw = '1h') {
  const period = resolvePeriod(periodRaw);
  const stageKeys = ['1h', '2h', '4h'];
  const need = [...new Set([period, ...stageKeys])];
  const pairs = await Promise.all(
    need.map(async (p) => {
      try {
        return [p, await fetchPeriodVenueBoard(p)];
      } catch (e) {
        return [p, null];
      }
    })
  );
  const map = Object.fromEntries(pairs.filter(([, b]) => b));
  const main = map[period] || (await fetchPeriodVenueBoard(period));
  const stageAverages = stageKeys.map((p) => {
    const b = map[p];
    return {
      period: p,
      label: PERIOD_DEFS[p]?.label || p,
      aggregate: b?.aggregate || buildFiveVenueAverage(b?.venues || {}),
      venueCount: b?.aggregate?.venueCount || 0,
      fundingSampleN: b?.aggregate?.sample?.fundingN || 0,
      available: !!b,
    };
  });
  return {
    ...main,
    signalSource: '自信号源',
    stageAverages,
    billingWindows: stageKeys,
  };
}

// ===================================================================================
// SOURCE REGISTRY
// ===================================================================================

const SOURCES = {
  binance: { name: 'Binance', icon: '', fetch: fetchBinance, priority: 1 },
  bybit: { name: 'Bybit', icon: '', fetch: fetchBybit, priority: 2 },
  coingecko: { name: 'CoinGecko', icon: '', fetch: fetchCoinGecko, priority: 3 },
  hyperliquid: { name: 'HyperLiquid', icon: '', fetch: fetchHyperLiquid, priority: 4 },
  dominance: { name: 'Market Global', icon: '', fetch: fetchDominance, priority: 5 },
  funding_history: { name: 'Funding History', icon: '', fetch: fetchBinanceFundingHistory, priority: 6 },
  ls_binance: { name: 'L/S Binance', icon: '', fetch: fetchBinanceLSRatio, priority: 7 },
  ls_bybit: { name: 'L/S Bybit', icon: '', fetch: fetchBybitLSRatio, priority: 8 },
  liq_binance: { name: 'Liq Binance', icon: '', fetch: fetchBinanceLiquidations, priority: 9 },
  liq_bybit: { name: 'Liq Bybit', icon: '', fetch: fetchBybitLiquidations, priority: 10 },
  liq_okx: { name: 'Liq OKX', icon: '', fetch: fetchOkxLiquidations, priority: 11 },
  liq_gate: { name: 'Liq Gate', icon: '', fetch: fetchGateLiquidations, priority: 12 },
  oi_binance: { name: 'OI Binance', icon: '', fetch: fetchBinanceOI, priority: 13 },
};

// ===================================================================================
// STALENESS CHECK
// ===================================================================================

function isStale(sourceResult, maxAgeMs = 60000) {
  if (!sourceResult || !sourceResult.available || !sourceResult.healthy) return true;
  if (!sourceResult.timestamp) return true;
  return (Date.now() - sourceResult.timestamp) >maxAgeMs;
}

function normalizeFundingTs(ts) {
  let t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (t < 1e12) t *= 1000; // sec → ms
  return t;
}

/**
 * 综合偏向：仅按资金费率相对「默认资金费率 0」二分，无中性档。
 * - fundingRate > 0  → 看多（多头付费，市场情绪偏多）
 * - fundingRate <= 0 → 看空（空头付费/零费率，市场情绪偏空）
 * score 0–100：以 50 为界，|费率| 越大偏离越强（展示用）。
 */
const DEFAULT_FUNDING_RATE = 0;

function computeMarketBias({
  fundingRate = 0,
  lsAvg = 1,
  liqLongPct = 50,
  liqShortPct = 50,
  priceChange24h = 0,
  defaultFundingRate = DEFAULT_FUNDING_RATE,
}) {
  const fr = Number(fundingRate);
  const base = Number(defaultFundingRate);
  const rate = Number.isFinite(fr) ? fr : 0;
  const def = Number.isFinite(base) ? base : 0;
  const delta = rate - def;

  // 无中性：严格正数看多，否则看空
  const isBull = delta > 0;
  const label = isBull ? '看多' : '看空';
  const tone = isBull ? 'bull' : 'bear';

  // 强度：|delta| 约 0.01%→弱，0.1%→强（封顶）
  const intensity = Math.min(50, Math.abs(delta) * 500_000); // 0.0001 → 50
  const score = Math.max(
    0,
    Math.min(100, Math.round(isBull ? 50 + Math.max(8, intensity) : 50 - Math.max(8, intensity)))
  );

  const frPct = `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(4)}%`;
  const drivers = [
    isBull
      ? `资金费率 ${frPct} > 默认 ${def === 0 ? '0' : (def * 100).toFixed(4) + '%'} · 情绪看多`
      : `资金费率 ${frPct} ≤ 默认 ${def === 0 ? '0' : (def * 100).toFixed(4) + '%'} · 情绪看空`,
  ];

  // 辅助上下文（不参与看多/看空判定）
  const ls = Number(lsAvg) || 0;
  if (ls >= 1.2) drivers.push('账户多空比偏多');
  if (ls > 0 && ls <= 0.85) drivers.push('账户多空比偏空');
  if (Number(liqLongPct) >= 60) drivers.push('多头清算偏多');
  if (Number(liqShortPct) >= 60) drivers.push('空头清算偏多');
  const ch = Number(priceChange24h) || 0;
  if (ch >= 2) drivers.push('24h 走强');
  if (ch <= -2) drivers.push('24h 走弱');

  return {
    score,
    label,
    tone,
    fundingRate: rate,
    defaultFundingRate: def,
    drivers: drivers.slice(0, 3),
    summary: isBull
      ? `资金费率正数 · 市场情绪看多`
      : `资金费率非正 · 市场情绪看空`,
  };
}

// ===================================================================================
// MAIN AGGREGATION
// ===================================================================================

async function getBtcMarketData(
  preferredSource = 'auto',
  periodRaw = '1h',
  seriesUnitRaw = 'day',
  env = {}
) {
  const results = {};
  const fetchPromises = {};
  for (const [key, source] of Object.entries(SOURCES)) {
    fetchPromises[key] = source.fetch().then((r) => {
      results[key] = r;
      return r;
    });
  }
  // Multi-venue funding / OI / volume + 计费窗 stage averages
  const periodBoardPromise = fetchPeriodVenueBoardWithStages(periodRaw).catch((e) => ({
    period: resolvePeriod(periodRaw),
    error: e.message,
    venues: {},
    aggregate: { venueCount: 0 },
    fiveVenueAvg: { venueCount: 0 },
    stageAverages: [],
    options: periodKeys().map((k) => ({ key: k, label: PERIOD_DEFS[k].label })),
  }));
  const triSeriesPromise = fetchSelfSignalTriSeries(seriesUnitRaw).catch((e) => ({
    signalSource: '自信号源',
    unit: resolveSeriesUnit(seriesUnitRaw),
    error: e.message,
    series: [],
    latest: {},
  }));
  // 先并行主源；周期指标在拿到现价后再算（MA200 自带价格）
  const cyclePromise = fetchBtcCycleMetrics(0).catch((e) => ({
    available: false,
    data: { available: false, error: e.message },
  }));
  await Promise.allSettled([
    ...Object.values(fetchPromises),
    periodBoardPromise,
    triSeriesPromise,
    cyclePromise,
  ]);
  const periodBoard = await periodBoardPromise;
  const selfTriSeries = await triSeriesPromise;
  const cycleMetrics = (await cyclePromise)?.data || null;

  // Determin active source (price)
  let activeSource = preferredSource;
  if (preferredSource !== 'auto' && results[preferredSource]) {
    if (isStale(results[preferredSource])) activeSource = 'auto';
  }
  if (activeSource === 'auto') {
    const pricePriority = ['binance', 'bybit', 'coingecko', 'hyperliquid'];
    for (const key of pricePriority) {
      if (results[key] && results[key].available && results[key].healthy && !isStale(results[key])) {
        activeSource = key;
        break;
      }
    }
    if (activeSource === 'auto') {
      for (const key of pricePriority) {
        if (results[key] && results[key].available) { activeSource = key; break; }
      }
    }
  }

  // Source health
  const sourceHealth = {};
  for (const [key, result] of Object.entries(results)) {
    sourceHealth[key] = {
      available: result?.available || false,
      healthy: result?.healthy || false,
      stale: !result?.available ? null : isStale(result),
      error: result?.error || null,
      note: result?.note || null,
    };
  }

  const binance = results.binance?.data || null;
  const bybit = results.bybit?.data || null;
  const gecko = results.coingecko?.data || null;
  const hl = results.hyperliquid?.data || null;
  const dominance = results.dominance?.data || null;
  const fundingHistory = results.funding_history?.data || null;
  const lsBinance = results.ls_binance?.data || null;
  const lsBybit = results.ls_bybit?.data || null;
  const liqBinance = results.liq_binance?.data || null;
  const liqBybit = results.liq_bybit?.data || null;
  const liqOkx = results.liq_okx?.data || null;
  const liqGate = results.liq_gate?.data || null;
  const oiBinance = results.oi_binance?.data || null;

  // Aggregate price
  const priceFromActive =
    activeSource === 'binance' ? binance?.price :
    activeSource === 'bybit' ? (bybit?.indexPrice || bybit?.price) :
    activeSource === 'coingecko' ? gecko?.price :
    activeSource === 'hyperliquid' ? hl?.price :
    (binance?.price || gecko?.price || bybit?.indexPrice || bybit?.price || hl?.price || 0);

  const changeFromActive =
    (binance?.priceChange24h ?? gecko?.priceChange24h ?? 0);

  const volumeFromActive =
    (binance?.volume24h ?? gecko?.volume24h ?? bybit?.volume24h ?? 0);

  // 用现货/标记价校正彩虹带定位
  if (cycleMetrics && priceFromActive > 0) {
    const rb = computeRainbowBand(priceFromActive);
    if (rb) cycleMetrics.rainbow = rb;
    cycleMetrics.price = priceFromActive;
    if (cycleMetrics.ma200 && cycleMetrics.ma200.ma200 > 0) {
      const ma = Number(cycleMetrics.ma200.ma200);
      const vs = ((priceFromActive - ma) / ma) * 100;
      cycleMetrics.ma200 = {
        ...cycleMetrics.ma200,
        price: Number(priceFromActive.toFixed(2)),
        vsPct: Number(vs.toFixed(2)),
        side: vs >= 0 ? 'above' : 'below',
      };
    }
  }

  // Aggregate OI from multiple sources
  const oiAgg = {
    binance: oiBinance ? { oi: oiBinance.openInterest, usd: oiBinance.openInterestUsd } : null,
    bybit: bybit?.openInterest != null ? { oi: bybit.openInterest, usd: bybit.openInterestValue } : null,
    hyperLiquid: hl?.openInterest != null ? { oi: hl.openInterest, usd: hl.openInterestUsd } : null,
  };
  const totalOiUsd = Object.values(oiAgg).reduce((sum, v) =>sum + (v?.usd || 0), 0);

  // Aggregate L/S ratio
  const lsAgg = {};
  if (lsBinance) lsAgg.binance = { ratio: lsBinance.globalAccountRatio, longPct: lsBinance.globalLongPct, shortPct: lsBinance.globalShortPct, signal: lsBinance.signal, source: '全网账户' };
  if (lsBybit) lsAgg.bybit = { ratio: lsBybit.ratio, longPct: lsBybit.longPct, shortPct: lsBybit.shortPct, signal: lsBybit.signal, source: 'Bybit' };

  // Aggregate liquidations — 全数据源交易所及时爆仓（Binance / Bybit / OKX / Gate）
  const liqAgg = {};
  if (liqBinance) liqAgg.binance = liqBinance;
  if (liqBybit) liqAgg.bybit = liqBybit;
  if (liqOkx) liqAgg.okx = liqOkx;
  if (liqGate) liqAgg.gate = liqGate;
  const totalLiqUsd = Object.values(liqAgg).reduce((sum, v) => sum + (v?.totalUsd || 0), 0);
  const totalLiqLong = Object.values(liqAgg).reduce((sum, v) => sum + (v?.totalLong || 0), 0);
  const totalLiqShort = Object.values(liqAgg).reduce((sum, v) => sum + (v?.totalShort || 0), 0);
  const liqLongPct = totalLiqUsd > 0 ? (totalLiqLong / totalLiqUsd) * 100 : 50;
  const liqShortPct = totalLiqUsd > 0 ? (totalLiqShort / totalLiqUsd) * 100 : 50;

  // Multi-venue funding: prefer period-board self-signal mean (CEX+DEX), else spot samples
  const boardAgg = periodBoard?.fiveVenueAvg || periodBoard?.aggregate || null;

  const fundingBybit = bybit?.fundingRate != null ? Number(bybit.fundingRate) : null;
  const fundingBinance = fundingHistory?.current != null ? Number(fundingHistory.current) : null;
  const fundingHl = hl?.fundingRate != null ? Number(hl.fundingRate) : null;
  const fundingSamples = [fundingBybit, fundingBinance, fundingHl].filter(
    (x) => x != null && Number.isFinite(x)
  );
  const fundingAvgFromBoard =
    boardAgg?.fundingCurrentAvg != null
      ? Number(boardAgg.fundingCurrentAvg)
      : boardAgg?.fundingAvg != null
        ? Number(boardAgg.fundingAvg)
        : null;
  const fundingAvg =
    fundingAvgFromBoard != null && Number.isFinite(fundingAvgFromBoard)
      ? fundingAvgFromBoard
      : fundingSamples.length > 0
        ? fundingSamples.reduce((s, v) => s + v, 0) / fundingSamples.length
        : 0;
  const primaryFunding = fundingAvg || fundingBinance || fundingBybit || fundingHl || 0;
  const nextFundingTime =
    normalizeFundingTs(fundingHistory?.nextFundingTime) ||
    normalizeFundingTs(bybit?.nextFundingTime) ||
    null;

  const lsValues = Object.values(lsAgg).map((v) =>Number(v.ratio) || 0).filter((x) =>x >0);
  const lsAvg = lsValues.length ? lsValues.reduce((s, v) =>s + v, 0) / lsValues.length : 1;

  const marketBias = computeMarketBias({
    fundingRate: primaryFunding || fundingAvg,
    lsAvg,
    liqLongPct,
    liqShortPct,
    priceChange24h: changeFromActive || 0,
  });

  return {
    success: true,
    timestamp: Date.now(),
    source: {
      active: activeSource,
      preferred: preferredSource,
      autoFallback: preferredSource !== 'auto' && activeSource !== preferredSource,
      label: SOURCES[activeSource]?.name || 'Unknown',
      icon: SOURCES[activeSource]?.icon || '',
    },
    sourceHealth,
    data: {
      // Price data (existing)
      price: {
        index: bybit?.indexPrice || priceFromActive || 0,
        mark: bybit?.price || oiBinance?.markPrice || hl?.price || 0,
        spot: priceFromActive || 0,
        high24h: binance?.high24h || bybit?.high24h || 0,
        low24h: binance?.low24h || bybit?.low24h || 0,
      },
      changes: {
        priceChange24h: changeFromActive || 0,
        volume24h: volumeFromActive || 0,
      },

      // 合约数据（自信号源：CEX + DEX Perps 有效节点相加取平均）
      futures: {
        fundingRate: primaryFunding || fundingAvg,
        annualFundingRate: (primaryFunding || fundingAvg) * 3 * 365 * 100,
        avgFundingRate: fundingAvg,
        nextFundingTime,
        openInterest: oiBinance?.openInterest || bybit?.openInterest || hl?.openInterest || 0,
        openInterestUsd:
          boardAgg?.oiEndAvg != null
            ? boardAgg.oiEndAvg
            : totalOiUsd ||
              oiBinance?.openInterestUsd ||
              bybit?.openInterestValue ||
              hl?.openInterestUsd ||
              0,
        volumeQuoteAvg: boardAgg?.volumeQuoteAvg ?? null,
        priceAvg: boardAgg?.priceAvg ?? null,
        venueCount: boardAgg?.venueCount ?? null,
        expectedVenues: boardAgg?.expectedVenues ?? EXPECTED_VENUE_SLOTS,
        stability: boardAgg?.stability || periodBoard?.venueStability || null,
        qualityLabel: boardAgg?.qualityLabel || '自信号源',
        // 内部诊断用（页面不渲染品牌名）
        fundingVenues: {
          binance: fundingBinance,
          bybit: fundingBybit,
          hyperLiquid: fundingHl,
          platformMean: fundingAvg,
        },
      },

      // Composite bias strip for UI
      marketBias,

      // 市场情绪：市占/市值 + 彩虹/减半/MA200 周期
      sentiment: {
        btcDominance: dominance?.btcDominance || 0,
        totalMarketCap: dominance?.totalMarketCap || 0,
        totalVolume24h: dominance?.totalVolume24h || 0,
        marketCapChange24h: dominance?.marketCapChange24h || 0,
        fearGreed: dominance?.fearGreed ?? null,
        fearGreedLabel: dominance?.fearGreedLabel ?? null,
        source: dominance?.source || null,
        sources: dominance?.sources || [],
        cycle: cycleMetrics
          ? {
              available: !!cycleMetrics.available,
              rainbow: cycleMetrics.rainbow || null,
              halving: cycleMetrics.halving || null,
              ma200: cycleMetrics.ma200 || null,
              source: cycleMetrics.source || 'rainbow+halving+ma200',
            }
          : { available: false, rainbow: null, halving: null, ma200: null },
      },

      // HyperLiquid detailed data
      hyperLiquid: hl || null,

      // Long/Short Ratio
      longShortRatio: {
        sources: lsAgg,
        summary: {
          available: Object.keys(lsAgg).length >0,
          avgRatio: lsValues.length ? Number(lsAvg.toFixed(3)) : 0,
          signal: lsBinance?.signal || lsBybit?.signal || '数据不足',
        },
      },

      // Liquidations — 全数据源交易所及时爆仓 / 清算报价列表（无 Coinglass）
      liquidations: (() => {
        const markPx =
          Number(boardAgg?.priceAvg) ||
          Number(bybit?.price) ||
          Number(binance?.price) ||
          Number(hl?.price) ||
          0;

        let longPrices = mergeExchangeLiquidationPrices(liqAgg, 'long');
        let shortPrices = mergeExchangeLiquidationPrices(liqAgg, 'short');

        // 相对现价切分：下方≈多头清算簇 · 上方≈空头清算簇
        if (markPx > 0 && (longPrices.length || shortPrices.length)) {
          const L = longPrices.filter((r) => Number(r.price) <= markPx * 1.002);
          const S = shortPrices.filter((r) => Number(r.price) >= markPx * 0.998);
          // 仅在切分后仍有数据时应用，避免误清空
          if (L.length) longPrices = L;
          if (S.length) shortPrices = S;
        }

        const venueNames = Object.keys(liqAgg);
        const priceSource = venueNames.length ? 'exchange_force_orders' : 'none';
        const priceSourceLabel = venueNames.length
          ? `交易所清算报价 · ${venueNames.join(' / ')}`
          : '暂无交易所清算样本';

        // 4h 计费窗合计：优先各所强平 window4h；无样本时用 4h OI×多空比作报仓参考
        const { start: w4Start, end: w4End, windowMs: w4Ms, label: w4Label } = liqWindow4hBounds();
        let winLong = 0;
        let winShort = 0;
        let winCount = 0;
        const byExchange = [];
        for (const [name, v] of Object.entries(liqAgg)) {
          const w = v?.window4h;
          const tL = Number(w?.totalLong ?? v?.totalLong) || 0;
          const tS = Number(w?.totalShort ?? v?.totalShort) || 0;
          const tC = Number(w?.count ?? v?.count) || 0;
          winLong += tL;
          winShort += tS;
          winCount += tC;
          byExchange.push({
            exchange: name,
            totalLong: tL,
            totalShort: tS,
            totalUsd: tL + tS,
            count: tC,
          });
        }
        const hasExchangeWindow = winLong > 0 || winShort > 0 || winCount > 0;

        const stage4hAgg =
          (Array.isArray(periodBoard?.stageAverages)
            ? periodBoard.stageAverages.find((s) => s?.period === '4h')
            : null)?.aggregate || null;
        const oi4h =
          Number(stage4hAgg?.oiEndAvg) ||
          Number(periodBoard?.period === '4h' ? boardAgg?.oiEndAvg : 0) ||
          Number(boardAgg?.oiEndAvg) ||
          Number(totalOiUsd) ||
          0;
        let longShare = 0.5;
        let shortShare = 0.5;
        if (lsAvg > 0) {
          longShare = lsAvg / (1 + lsAvg);
          shortShare = 1 / (1 + lsAvg);
        }
        const reportLong = oi4h > 0 ? oi4h * longShare : 0;
        const reportShort = oi4h > 0 ? oi4h * shortShare : 0;

        const window4h = {
          label: w4Label,
          windowMs: w4Ms,
          start: w4Start,
          end: w4End,
          totalLong: hasExchangeWindow ? winLong : reportLong,
          totalShort: hasExchangeWindow ? winShort : reportShort,
          totalUsd: 0,
          count: hasExchangeWindow ? winCount : 0,
          oiUsd: oi4h,
          longShare: Number((longShare * 100).toFixed(2)),
          shortShare: Number((shortShare * 100).toFixed(2)),
          source: hasExchangeWindow ? 'exchange_force_orders_4h' : 'oi_ls_report_4h',
          note: hasExchangeWindow
            ? `当前 4h 计费窗交易所及时爆仓合计 · ${venueNames.join('+') || '—'}`
            : '当前 4h 计费窗 OI×多空比报仓合计（交易所暂无强平样本）',
          byExchange: byExchange.length ? byExchange : null,
        };
        window4h.totalUsd = window4h.totalLong + window4h.totalShort;

        const totalLong = window4h.totalLong;
        const totalShort = window4h.totalShort;
        const totalUsd = window4h.totalUsd || totalLiqUsd;

        return {
          sources: liqAgg,
          venues: venueNames,
          summary: {
            available:
              longPrices.length > 0 ||
              shortPrices.length > 0 ||
              Object.keys(liqAgg).length > 0,
            totalUsd,
            totalLong,
            totalShort,
            longPct:
              totalUsd > 0
                ? Number(((totalLong / totalUsd) * 100).toFixed(1))
                : Number(liqLongPct.toFixed(1)),
            shortPct:
              totalUsd > 0
                ? Number(((totalShort / totalUsd) * 100).toFixed(1))
                : Number(liqShortPct.toFixed(1)),
            side:
              totalLong > totalShort
                ? '多头清算偏多'
                : totalShort > totalLong
                  ? '空头清算偏多'
                  : '均衡',
            count: longPrices.length + shortPrices.length,
            longPrices,
            shortPrices,
            priceSource,
            priceSourceLabel,
            markPrice: markPx || null,
            window4h,
          },
        };
      })(),

      // Open Interest per exchange
      openInterest: {
        sources: oiAgg,
        totalOiUsd: totalOiUsd,
        totalOiBtc: Object.values(oiAgg).reduce((sum, v) =>sum + (v?.oi || 0), 0),
      },

      // Historical Funding Rate
      fundingHistory: fundingHistory || null,

      // Multi-timeframe venue board (1h/4h/1d/3d/1w/3w)
      periodBoard: periodBoard || null,

      // 自信号源三量图：资金费率 / 成交量 / 合约开仓量
      selfTriSeries: selfTriSeries || null,

      gecko: gecko || null,
    },
    sources: Object.keys(results).filter(k =>results[k]?.available),
  };
}

// ===================================================================================
// REQUEST HANDLER
// ===================================================================================

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (url.pathname === '/api/bitcoin' && request.method === 'GET') {
    try {
      const preferredSource = url.searchParams.get('source') || 'auto';
      const period = url.searchParams.get('period') || url.searchParams.get('tf') || '1d';
      const seriesUnit = url.searchParams.get('seriesUnit') || url.searchParams.get('unit') || 'day';
      const result = await getBtcMarketData(preferredSource, period, seriesUnit, context.env || {});
      return new Response(
        JSON.stringify(result),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, s-maxage=15',
            ...corsHeaders,
          },
        }
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message, success: false }),
        { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: 'Not found' }),
    { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

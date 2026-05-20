/**
 * Bitcoin API - Cloudflare Pages Function
 *
 * Multi-source BTC market data with:
 * - Price sources: Binance, Bybit, CoinGecko, HyperLiquid
 * - Futures: Funding rate, OI (Bybit, Binance, HyperLiquid)
 * - Long/Short Ratio: Binance, Bybit
 * - Liquidations: Binance, Bybit
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
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const HYPERLIQUID_BASE = 'https://api.hyperliquid.xyz';
const SOURCE_TIMEOUT = 8000;

async function safeFetch(url, timeoutMs = SOURCE_TIMEOUT, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
      nextFundingTime: t.nextFundingTime ? parseInt(t.nextFundingTime) : null,
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
    const btcOiEntry = oiData.find(o => o.coin === 'BTC' || o.name === 'BTC');
    if (btcOiEntry) btcOi = parseFloat(btcOiEntry.oi) || parseFloat(btcOiEntry.openInterest) || 0;
  }

  // Find BTC predicted funding
  let predictedFr = 0;
  if (Array.isArray(predicted)) {
    const btcPred = predicted.find(p => p.coin === 'BTC' || p.name === 'BTC');
    if (btcPred) predictedFr = parseFloat(btcPred.funding) || 0;
  }

  // Find latest funding rate from history
  let fundingRate = 0;
  if (Array.isArray(fundingHist) && fundingHist.length > 0) {
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
      signal: global?.ratio > 1.2 ? '多空偏多' : global?.ratio < 0.8 ? '多空偏空' : '中性',
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
  const ratio = shortPct > 0 ? longPct / shortPct : 0;

  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data: {
      ratio,
      longPct: (longPct * 100).toFixed(1),
      shortPct: (shortPct * 100).toFixed(1),
      signal: ratio > 1.2 ? '多空偏多' : ratio < 0.8 ? '多空偏空' : '中性',
    },
  };
}

// ===================================================================================
// LIQUIDATIONS
// ===================================================================================

async function fetchBinanceLiquidations() {
  // Binance force orders (recent liquidations)
  const result = await safeFetch(
    `${BINANCE_FUTURES}/fapi/v1/forceOrders?symbol=BTCUSDT&limit=50&autoCloseType=BOTH`,
    6000
  );
  if (result.error || !Array.isArray(result.data)) {
    return { available: false, error: result.error, data: null };
  }

  let totalLong = 0;
  let totalShort = 0;
  let totalUsd = 0;
  let count = 0;

  for (const order of result.data) {
    if (!order.price || !order.origQty) continue;
    const price = parseFloat(order.price);
    const qty = parseFloat(order.origQty);
    const usdValue = price * qty;
    totalUsd += usdValue;
    count++;
    if (order.side === 'BUY') {
      totalShort += usdValue; // BUY side = short squeeze (shorts being liquidated)
    } else if (order.side === 'SELL') {
      totalLong += usdValue;  // SELL side = longs being liquidated
    }
  }

  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data: {
      totalUsd,
      totalLong,
      totalShort,
      count,
      longPct: totalUsd > 0 ? (totalLong / totalUsd * 100).toFixed(1) : 0,
      shortPct: totalUsd > 0 ? (totalShort / totalUsd * 100).toFixed(1) : 0,
      side: totalLong > totalShort ? '多头清算偏多' : totalShort > totalLong ? '空头清算偏多' : '均衡',
    },
  };
}

async function fetchBybitLiquidations() {
  const result = await safeFetch(
    `${BYBIT_BASE}/v5/market/liquidation?category=linear&symbol=BTCUSDT&limit=50`,
    6000
  );
  if (result.error || !result.data?.result?.list?.length) {
    return { available: false, error: result.error, data: null };
  }

  let totalLong = 0;
  let totalShort = 0;
  let totalUsd = 0;
  let count = 0;

  for (const item of result.data.result.list) {
    const price = parseFloat(item.price) || 0;
    const qty = parseFloat(item.size) || 0;
    const usdValue = price * qty;
    totalUsd += usdValue;
    count++;
    if (item.side === 'Buy' || item.side === 'BUY') {
      totalShort += usdValue;
    } else {
      totalLong += usdValue;
    }
  }

  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data: {
      totalUsd,
      totalLong,
      totalShort,
      count,
      longPct: totalUsd > 0 ? (totalLong / totalUsd * 100).toFixed(1) : 0,
      shortPct: totalUsd > 0 ? (totalShort / totalUsd * 100).toFixed(1) : 0,
      side: totalLong > totalShort ? '多头清算偏多' : totalShort > totalLong ? '空头清算偏多' : '均衡',
    },
  };
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
  const nextTime = parseInt(current.nextFundingTime) || null;

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
  const rates = history.map(h => h.rate);
  const high = rates.length > 0 ? Math.max(...rates) : currentFr;
  const low = rates.length > 0 ? Math.min(...rates) : currentFr;
  const avg = rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : currentFr;

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
// DOMINANCE & MARKET OVERVIEW
// ===================================================================================

async function fetchDominance() {
  const result = await safeFetch(`${COINGECKO_BASE}/global`);
  if (result.error || !result.data?.data) return { available: false, error: result.error, data: null };
  const d = result.data.data;
  return {
    available: true, healthy: true, timestamp: Date.now(),
    data: {
      btcDominance: d.btc_dominance_percentage || 0,
      totalMarketCap: d.total_market_cap?.usd || 0,
      totalVolume24h: d.total_volume?.usd || 0,
      marketCapChange24h: d.market_cap_change_percentage_24h_usd || 0,
    },
  };
}

// ===================================================================================
// SOURCE REGISTRY
// ===================================================================================

const SOURCES = {
  binance: { name: 'Binance', icon: '📊', fetch: fetchBinance, priority: 1 },
  bybit: { name: 'Bybit', icon: '📈', fetch: fetchBybit, priority: 2 },
  coingecko: { name: 'CoinGecko', icon: '🦎', fetch: fetchCoinGecko, priority: 3 },
  hyperliquid: { name: 'HyperLiquid', icon: '⚡', fetch: fetchHyperLiquid, priority: 4 },
  dominance: { name: 'CG Global', icon: '🌐', fetch: fetchDominance, priority: 5 },
  funding_history: { name: 'Funding History', icon: '📜', fetch: fetchBinanceFundingHistory, priority: 6 },
  ls_binance: { name: 'L/S Binance', icon: '📊', fetch: fetchBinanceLSRatio, priority: 7 },
  ls_bybit: { name: 'L/S Bybit', icon: '📊', fetch: fetchBybitLSRatio, priority: 8 },
  liq_binance: { name: 'Liq Binance', icon: '💥', fetch: fetchBinanceLiquidations, priority: 9 },
  liq_bybit: { name: 'Liq Bybit', icon: '💥', fetch: fetchBybitLiquidations, priority: 10 },
  oi_binance: { name: 'OI Binance', icon: '📊', fetch: fetchBinanceOI, priority: 11 },
};

// ===================================================================================
// STALENESS CHECK
// ===================================================================================

function isStale(sourceResult, maxAgeMs = 60000) {
  if (!sourceResult || !sourceResult.available || !sourceResult.healthy) return true;
  if (!sourceResult.timestamp) return true;
  return (Date.now() - sourceResult.timestamp) > maxAgeMs;
}

// ===================================================================================
// MAIN AGGREGATION
// ===================================================================================

async function getBtcMarketData(preferredSource = 'auto') {
  const results = {};
  const fetchPromises = {};
  for (const [key, source] of Object.entries(SOURCES)) {
    fetchPromises[key] = source.fetch().then(r => { results[key] = r; return r; });
  }
  await Promise.allSettled(Object.values(fetchPromises));

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

  // Aggregate OI from multiple sources
  const oiAgg = {
    binance: oiBinance ? { oi: oiBinance.openInterest, usd: oiBinance.openInterestUsd } : null,
    bybit: bybit?.openInterest != null ? { oi: bybit.openInterest, usd: bybit.openInterestValue } : null,
    hyperLiquid: hl?.openInterest != null ? { oi: hl.openInterest, usd: hl.openInterestUsd } : null,
  };
  const totalOiUsd = Object.values(oiAgg).reduce((sum, v) => sum + (v?.usd || 0), 0);

  // Aggregate L/S ratio
  const lsAgg = {};
  if (lsBinance) lsAgg.binance = { ratio: lsBinance.globalAccountRatio, longPct: lsBinance.globalLongPct, shortPct: lsBinance.globalShortPct, signal: lsBinance.signal, source: '全网账户' };
  if (lsBybit) lsAgg.bybit = { ratio: lsBybit.ratio, longPct: lsBybit.longPct, shortPct: lsBybit.shortPct, signal: lsBybit.signal, source: 'Bybit' };

  // Aggregate liquidations
  const liqAgg = {};
  if (liqBinance) liqAgg.binance = liqBinance;
  if (liqBybit) liqAgg.bybit = liqBybit;
  const totalLiqUsd = Object.values(liqAgg).reduce((sum, v) => sum + (v?.totalUsd || 0), 0);
  const totalLiqLong = Object.values(liqAgg).reduce((sum, v) => sum + (v?.totalLong || 0), 0);
  const totalLiqShort = Object.values(liqAgg).reduce((sum, v) => sum + (v?.totalShort || 0), 0);

  return {
    success: true,
    timestamp: Date.now(),
    source: {
      active: activeSource,
      preferred: preferredSource,
      autoFallback: preferredSource !== 'auto' && activeSource !== preferredSource,
      label: SOURCES[activeSource]?.name || 'Unknown',
      icon: SOURCES[activeSource]?.icon || '❓',
    },
    sourceHealth,
    data: {
      // Price data (existing)
      price: {
        index: bybit?.indexPrice || priceFromActive || 0,
        mark: bybit?.price || hl?.price || 0,
        spot: priceFromActive || 0,
        high24h: binance?.high24h || bybit?.high24h || 0,
        low24h: binance?.low24h || bybit?.low24h || 0,
      },
      changes: {
        priceChange24h: changeFromActive || 0,
        volume24h: volumeFromActive || 0,
      },

      // Futures data (existing + enhanced)
      futures: {
        fundingRate: bybit?.fundingRate || hl?.fundingRate || 0,
        annualFundingRate: bybit?.annualFundingRate || hl?.annualFundingRate || 0,
        avgFundingRate: bybit?.fundingRate || hl?.fundingRate || 0,
        nextFundingTime: bybit?.nextFundingTime || null,
        openInterest: oiBinance?.openInterest || bybit?.openInterest || hl?.openInterest || 0,
        openInterestUsd: totalOiUsd || oiBinance?.openInterestUsd || bybit?.openInterestValue || hl?.openInterestUsd || 0,
      },

      // Sentiment (existing)
      sentiment: {
        btcDominance: dominance?.btcDominance || 0,
        totalMarketCap: dominance?.totalMarketCap || 0,
        totalVolume24h: dominance?.totalVolume24h || 0,
        marketCapChange24h: dominance?.marketCapChange24h || 0,
      },

      // NEW: HyperLiquid detailed data
      hyperLiquid: hl || null,

      // NEW: Long/Short Ratio
      longShortRatio: {
        sources: lsAgg,
        summary: {
          available: Object.keys(lsAgg).length > 0,
          avgRatio: Object.keys(lsAgg).length > 0
            ? (Object.values(lsAgg).reduce((s, v) => s + v.ratio, 0) / Object.keys(lsAgg).length).toFixed(3)
            : 0,
          signal: lsBinance?.signal || lsBybit?.signal || '数据不足',
        },
      },

      // NEW: Liquidations
      liquidations: {
        sources: liqAgg,
        summary: {
          available: Object.keys(liqAgg).length > 0,
          totalUsd: totalLiqUsd,
          totalLong: totalLiqLong,
          totalShort: totalLiqShort,
          longPct: totalLiqUsd > 0 ? (totalLiqLong / totalLiqUsd * 100).toFixed(1) : 0,
          shortPct: totalLiqUsd > 0 ? (totalLiqShort / totalLiqUsd * 100).toFixed(1) : 0,
          side: totalLiqLong > totalLiqShort ? '多头清算偏多' : totalLiqShort > totalLiqLong ? '空头清算偏多' : '均衡',
          count: Object.values(liqAgg).reduce((s, v) => s + (v?.count || 0), 0),
        },
      },

      // NEW: Open Interest per exchange
      openInterest: {
        sources: oiAgg,
        totalOiUsd: totalOiUsd,
        totalOiBtc: Object.values(oiAgg).reduce((sum, v) => sum + (v?.oi || 0), 0),
      },

      // Historical Funding Rate
      fundingHistory: fundingHistory || null,

      gecko: gecko || null,
    },
    sources: Object.keys(results).filter(k => results[k]?.available),
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
      const result = await getBtcMarketData(preferredSource);
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

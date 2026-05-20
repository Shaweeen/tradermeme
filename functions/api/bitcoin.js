/**
 * Bitcoin API - Cloudflare Pages Function
 *
 * Multi-source BTC market data with source selection and health detection.
 * Supports ?source= query param: binance, bybit, coingecko, auto
 *
 * Endpoints:
 *   GET /api/bitcoin          - All BTC market data (auto mode)
 *   GET /api/bitcoin?source=binance  - Prefer Binance, fallback if stale
 */

const BINANCE_BASE = 'https://api.binance.com';
const BYBIT_BASE = 'https://api.bybit.com';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
const COINGLASS_BASE = 'https://open-api.coinglass.com/api/pro/v1';

const SOURCE_TIMEOUT = 8000; // 8s per source

async function safeFetch(url, timeoutMs = SOURCE_TIMEOUT) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const data = await response.json();
    return { data, error: null };
  } catch (e) {
    clearTimeout(timeout);
    return { error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

// ---- Individual Source Fetchers ----

async function fetchBinance() {
  const result = await safeFetch(`${BINANCE_BASE}/api/v3/ticker/24hr?symbol=BTCUSDT`);
  if (result.error || !result.data) return { available: false, error: result.error, data: null };
  const d = result.data;
  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
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
  const nextFt = t.nextFundingTime ? parseInt(t.nextFundingTime) : null;

  let avgFundingRate = currentFr;
  if (fundingResult.data?.result?.list?.length > 0) {
    const rates = fundingResult.data.result.list.map(r => parseFloat(r.fundingRate) || 0);
    if (rates.length > 0) {
      avgFundingRate = rates.reduce((a, b) => a + b, 0) / rates.length;
    }
  }

  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data: {
      price: parseFloat(t.markPrice) || 0,
      indexPrice: parseFloat(t.indexPrice) || 0,
      fundingRate: currentFr,
      avgFundingRate,
      annualFundingRate: currentFr * 3 * 365 * 100,
      nextFundingTime: nextFt,
      openInterest: parseFloat(t.openInterest) || 0,
      openInterestValue: parseFloat(t.openInterest) * (parseFloat(t.indexPrice) || 1) || 0,
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
  if (result.error || !result.data?.bitcoin) {
    return { available: false, error: result.error, data: null };
  }
  const d = result.data.bitcoin;
  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data: {
      price: d.usd || 0,
      priceChange24h: d.usd_24h_change || 0,
      volume24h: d.usd_24h_vol || 0,
      marketCap: d.usd_market_cap || 0,
    },
  };
}

async function fetchCoinglass() {
  const [price, oi, ls] = await Promise.all([
    safeFetch(`${COINGLASS_BASE}/futures/price/bitcoin`),
    safeFetch(`${COINGLASS_BASE}/futures/openInterest/bitcoin?interval=ALL`),
    safeFetch(`${COINGLASS_BASE}/futures/longShortRatio/bitcoin?interval=1h`),
  ]);

  const hasData = (price.data?.data || oi.data?.data || ls.data?.data);
  return {
    available: hasData ? true : false,
    healthy: hasData ? true : false,
    timestamp: Date.now(),
    data: hasData ? { price: price.data?.data, openInterest: oi.data?.data, longShortRatio: ls.data?.data } : null,
    note: !hasData ? 'Coinglass 可能需要 API Key，已自动使用其他数据源' : null,
  };
}

async function fetchDominance() {
  const result = await safeFetch(`${COINGECKO_BASE}/global`);
  if (result.error || !result.data?.data) {
    return { available: false, error: result.error, data: null };
  }
  const d = result.data.data;
  return {
    available: true,
    healthy: true,
    timestamp: Date.now(),
    data: {
      btcDominance: d.btc_dominance_percentage || 0,
      totalMarketCap: d.total_market_cap?.usd || 0,
      totalVolume24h: d.total_volume?.usd || 0,
      marketCapChange24h: d.market_cap_change_percentage_24h_usd || 0,
    },
  };
}

// ---- Source Registry ----

const SOURCES = {
  binance: { name: 'Binance', icon: '📊', fetch: fetchBinance, priority: 1, priorityData: ['price', 'volume', 'highLow'] },
  bybit: { name: 'Bybit', icon: '📈', fetch: fetchBybit, priority: 2, priorityData: ['funding', 'oi', 'markPrice'] },
  coingecko: { name: 'CoinGecko', icon: '🦎', fetch: fetchCoinGecko, priority: 3, priorityData: ['price', 'marketCap', 'volume'] },
  coinglass: { name: 'Coinglass', icon: '📡', fetch: fetchCoinglass, priority: 4, priorityData: ['lsRatio', 'coinglassData'] },
  dominance: { name: 'CoinGecko Global', icon: '🌐', fetch: fetchDominance, priority: 5, priorityData: ['dominance', 'totalMarketCap'] },
};

// ---- Staleness Check ----

function isStale(sourceResult, maxAgeMs = 30000) {
  if (!sourceResult || !sourceResult.available || !sourceResult.healthy) return true;
  if (!sourceResult.timestamp) return true;
  return (Date.now() - sourceResult.timestamp) > maxAgeMs;
}

// ---- Main Data Aggregation ----

async function getBtcMarketData(preferredSource = 'auto') {
  // Fetch all sources in parallel
  const results = {};
  const fetchPromises = {};
  for (const [key, source] of Object.entries(SOURCES)) {
    fetchPromises[key] = source.fetch().then(r => { results[key] = r; return r; });
  }
  await Promise.allSettled(Object.values(fetchPromises));

  // Determine active source
  let activeSource = preferredSource;
  if (preferredSource !== 'auto' && results[preferredSource]) {
    if (isStale(results[preferredSource])) {
      // Selected source is stale — auto-fallback
      activeSource = 'auto';
    }
  }
  if (activeSource === 'auto') {
    // Find the best available healthy source by priority: binance > bybit > coingecko > coinglass
    const priorityOrder = ['binance', 'bybit', 'coingecko', 'coinglass'];
    for (const key of priorityOrder) {
      if (results[key] && results[key].available && results[key].healthy && !isStale(results[key])) {
        activeSource = key;
        break;
      }
    }
    if (activeSource === 'auto') {
      // Nothing healthy — just use whatever returned something
      for (const key of priorityOrder) {
        if (results[key] && results[key].available) {
          activeSource = key;
          break;
        }
      }
    }
  }

  // Collect health info for all sources
  const sourceHealth = {};
  for (const [key, result] of Object.entries(results)) {
    sourceHealth[key] = {
      available: result?.available || false,
      healthy: result?.healthy || false,
      stale: !result?.available ? null : isStale(result),
      timestamp: result?.timestamp || null,
      error: result?.error || null,
      note: result?.note || null,
    };
  }

  const binance = results.binance?.data || null;
  const bybit = results.bybit?.data || null;
  const gecko = results.coingecko?.data || null;
  const coinglass = results.coinglass?.data || null;
  const dominance = results.dominance?.data || null;

  // Build response using best available data
  const priceFromActive =
    activeSource === 'binance' ? binance?.price :
    activeSource === 'bybit' ? (bybit?.indexPrice || bybit?.price) :
    activeSource === 'coingecko' ? gecko?.price :
    (binance?.price || gecko?.price || bybit?.indexPrice || bybit?.price || 0);

  const changeFromActive =
    activeSource === 'binance' ? binance?.priceChange24h :
    activeSource === 'coingecko' ? gecko?.priceChange24h :
    (binance?.priceChange24h ?? gecko?.priceChange24h ?? 0);

  const volumeFromActive =
    activeSource === 'binance' ? binance?.volume24h :
    activeSource === 'bybit' ? bybit?.volume24h :
    activeSource === 'coingecko' ? gecko?.volume24h :
    (binance?.volume24h ?? gecko?.volume24h ?? 0);

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
      price: {
        index: bybit?.indexPrice || priceFromActive || 0,
        mark: bybit?.price || 0,
        spot: priceFromActive || 0,
        high24h: binance?.high24h || bybit?.high24h || 0,
        low24h: binance?.low24h || bybit?.low24h || 0,
      },
      changes: {
        priceChange24h: changeFromActive || 0,
        volume24h: volumeFromActive || 0,
      },
      futures: {
        fundingRate: bybit?.fundingRate || 0,
        annualFundingRate: bybit?.annualFundingRate || 0,
        avgFundingRate: bybit?.avgFundingRate || 0,
        nextFundingTime: bybit?.nextFundingTime || null,
        openInterest: bybit?.openInterest || 0,
        openInterestUsd: bybit?.openInterestValue || 0,
      },
      sentiment: {
        btcDominance: dominance?.btcDominance || 0,
        totalMarketCap: dominance?.totalMarketCap || 0,
        totalVolume24h: dominance?.totalVolume24h || 0,
        marketCapChange24h: dominance?.marketCapChange24h || 0,
      },
      coinglass: coinglass || null,
      gecko: gecko || null,
    },
    sources: Object.keys(results).filter(k => results[k]?.available),
  };
}

// ---- Request Handler ----

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

/**
 * Bitcoin API - Cloudflare Pages Function
 *
 * Fetches Bitcoin market data from Coinglass (free/proxied), Binance, Bybit, and CoinGecko.
 * Provides BTC index price, funding rate, open interest, and liquidations.
 *
 * Endpoints:
 *   GET /api/bitcoin   - All BTC market data
 */

const COINGLASS_BASE = 'https://open-api.coinglass.com/api/pro/v1';
const BINANCE_BASE = 'https://api.binance.com';
const BYBIT_BASE = 'https://api.bybit.com';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

/**
 * Fetch with timeout and error handling
 */
async function safeFetch(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return response.json();
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Fetch Bitcoin price from Binance
 */
async function getBinanceBtcTicker() {
  const data = await safeFetch(`${BINANCE_BASE}/api/v3/ticker/24hr?symbol=BTCUSDT`);
  if (!data) return null;

  return {
    price: parseFloat(data.lastPrice) || 0,
    priceChange24h: parseFloat(data.priceChangePercent) || 0,
    volume24h: parseFloat(data.volume) || 0,
    quoteVolume24h: parseFloat(data.quoteVolume) || 0,
    high24h: parseFloat(data.highPrice) || 0,
    low24h: parseFloat(data.lowPrice) || 0,
    source: 'binance',
  };
}

/**
 * Fetch BTC funding rate from Bybit
 */
async function getBybitFundingRate() {
  const data = await safeFetch(`${BYBIT_BASE}/v5/market/tickers?category=linear&symbol=BTCUSDT`);
  if (!data?.result?.list?.[0]) return null;

  const ticker = data.result.list[0];
  return {
    fundingRate: parseFloat(ticker.fundingRate) || 0,
    nextFundingTime: ticker.nextFundingTime ? parseInt(ticker.nextFundingTime) : null,
    openInterest: parseFloat(ticker.openInterest) || 0,
    markPrice: parseFloat(ticker.markPrice) || 0,
    indexPrice: parseFloat(ticker.indexPrice) || 0,
    source: 'bybit',
  };
}

/**
 * Fetch BTC futures data from Coinglass
 */
async function getCoinglassData() {
  // Try without API key first (some endpoints may work)
  const [price, oiSummary, longShortRatio] = await Promise.all([
    safeFetch(`${COINGLASS_BASE}/futures/price/bitcoin`),
    safeFetch(`${COINGLASS_BASE}/futures/openInterest/bitcoin?interval=ALL`),
    safeFetch(`${COINGLASS_BASE}/futures/longShortRatio/bitcoin?interval=1h`),
  ]);

  return {
    coinglassPrice: price,
    coinglassOi: oiSummary,
    coinglassLsRatio: longShortRatio,
    source: 'coinglass',
  };
}

/**
 * Fetch BTC data from CoinGecko
 */
async function getCoinGeckoBtc() {
  const data = await safeFetch(
    `${COINGECKO_BASE}/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`
  );
  if (!data?.bitcoin) return null;

  return {
    price: data.bitcoin.usd || 0,
    priceChange24h: data.bitcoin.usd_24h_change || 0,
    volume24h: data.bitcoin.usd_24h_vol || 0,
    marketCap: data.bitcoin.usd_market_cap || 0,
    source: 'coingecko',
  };
}

/**
 * Fetch BTC dominance data
 */
async function getBtcDominance() {
  // CoinGecko global data for BTC dominance
  const data = await safeFetch(`${COINGECKO_BASE}/global`);
  if (!data?.data) return null;

  return {
    btcDominance: data.data.btc_dominance_percentage || 0,
    totalMarketCap: data.data.total_market_cap?.usd || 0,
    totalVolume24h: data.data.total_volume?.usd || 0,
    altcoinMarketCap: data.data.altcoin_market_cap?.usd || 0,
    altcoinVolume24h: data.data.altcoin_volume?.usd || 0,
    marketCapChange24h: data.data.market_cap_change_percentage_24h_usd || 0,
    source: 'coingecko',
  };
}

/**
 * Get comprehensive Bitcoin market data from all sources
 */
async function getBtcMarketData() {
  const results = await Promise.allSettled([
    getBinanceBtcTicker(),
    getBybitFundingRate(),
    getCoinglassData(),
    getCoinGeckoBtc(),
    getBtcDominance(),
  ]);

  const binanceData = results[0].status === 'fulfilled' ? results[0].value : null;
  const bybitData = results[1].status === 'fulfilled' ? results[1].value : null;
  const coinglassData = results[2].status === 'fulfilled' ? results[2].value : null;
  const geckoData = results[3].status === 'fulfilled' ? results[3].value : null;
  const dominanceData = results[4].status === 'fulfilled' ? results[4].value : null;

  // Determine primary price source (prefer Coinglass index, then Bybit mark, then Binance)
  const indexPrice = bybitData?.indexPrice || binanceData?.price || geckoData?.price || 0;
  const markPrice = bybitData?.markPrice || 0;
  const spotPrice = binanceData?.price || geckoData?.price || 0;

  return {
    success: true,
    timestamp: Date.now(),
    data: {
      // Price Data
      price: {
        index: indexPrice,
        mark: markPrice,
        spot: spotPrice,
        high24h: binanceData?.high24h || 0,
        low24h: binanceData?.low24h || 0,
      },
      // Price Changes
      changes: {
        priceChange24h: binanceData?.priceChange24h ?? geckoData?.priceChange24h ?? 0,
        volume24h: binanceData?.quoteVolume24h ?? geckoData?.volume24h ?? 0,
      },
      // Futures Data
      futures: {
        fundingRate: bybitData?.fundingRate || 0,
        annualFundingRate: bybitData?.fundingRate ? (bybitData.fundingRate * 3 * 365 * 100) : 0,
        nextFundingTime: bybitData?.nextFundingTime || null,
        openInterest: bybitData?.openInterest || 0,
        openInterestUsd: bybitData?.openInterest ? (bybitData.openInterest * indexPrice) : 0,
      },
      // Market Sentiment
      sentiment: {
        btcDominance: dominanceData?.btcDominance || 0,
        totalMarketCap: dominanceData?.totalMarketCap || 0,
        totalVolume24h: dominanceData?.totalVolume24h || 0,
        marketCapChange24h: dominanceData?.marketCapChange24h || 0,
      },
      // Coinglass specifics
      coinglass: {
        price: coinglassData?.coinglassPrice,
        openInterest: coinglassData?.coinglassOi,
        longShortRatio: coinglassData?.coinglassLsRatio,
      },
      // Sources
      sources: {
        binance: !!binanceData,
        bybit: !!bybitData,
        coinglass: !!coinglassData,
        coingecko: !!geckoData,
      },
    },
    sources: ['binance', 'bybit', 'coinglass', 'coingecko'].filter((s) => {
      if (s === 'binance') return !!binanceData;
      if (s === 'bybit') return !!bybitData;
      if (s === 'coinglass') return !!coinglassData;
      if (s === 'coingecko') return !!geckoData;
      return false;
    }),
  };
}

/**
 * Handle API requests
 */
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
      const result = await getBtcMarketData();
      return new Response(
        JSON.stringify(result),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, s-maxage=30',
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

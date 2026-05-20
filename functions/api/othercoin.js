/**
 * Othercoin API - Cloudflare Pages Function
 *
 * Fetches top non-meme cryptocurrency data from CoinGecko free API.
 * Returns the same data format as /api/trending for compatibility.
 *
 * Endpoints:
 *   GET /api/othercoin?limit=20      - Top non-meme coins by market cap
 *   GET /api/othercoin/search?q=eth  - Search for specific coins
 */

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// Top non-meme coins to track (by market cap rank)
const TOP_COINS = [
  'bitcoin', 'ethereum', 'solana', 'ripple', 'cardano',
  'avalanche-2', 'polkadot', 'chainlink', 'polygon', 'near',
  'aptos', 'arbitrum', 'optimism', 'sui', 'render-token',
  'injective-protocol', 'sei-network', 'celestia', 'dydx-chain', 'ondo-finance',
  'thorchain', 'vechain', 'algorand', 'filecoin', 'stellar',
  'internet-computer', 'immutable-x', 'aave', 'maker', 'uniswap',
];

/**
 * Fetch from CoinGecko API
 */
async function fetchCoinGecko(path) {
  const url = `${COINGECKO_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
    cf: {
      cacheTtl: 60,
      cacheEverything: true,
    },
  });

  if (!response.ok) {
    throw new Error(`CoinGecko API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get top coins market data from CoinGecko
 * Maps to same data format as trending API
 */
async function getTopCoins(limit = 20) {
  try {
    const data = await fetchCoinGecko(
      `/coins/markets?vs_currency=usd&ids=${TOP_COINS.join(',')}&order=market_cap_desc&per_page=100&sparkline=true&price_change_percentage=1h%2C24h`
    );

    if (!Array.isArray(data)) {
      throw new Error('Invalid response from CoinGecko');
    }

    return data
      .filter((c) => c.current_price != null)
      .slice(0, limit)
      .map((c) => ({
        address: c.id,
        symbol: (c.symbol || '').toUpperCase(),
        name: c.name || '',
        chain: 'ethereum',  // CoinGecko is cross-chain, use ethereum as default chain
        icon: c.image || '',
        priceUsd: c.current_price || 0,
        priceChange1h: c.price_change_percentage_1h_in_currency ?? c.price_change_percentage_24h ?? 0,
        priceChange24h: c.price_change_percentage_24h ?? 0,
        volume1h: c.total_volume ? c.total_volume / 24 : 0,  // Approximate 1h volume
        volume24h: c.total_volume || 0,
        liquidity: c.market_cap || 0,
        fdv: c.fully_diluted_valuation || c.market_cap || 0,
        marketCap: c.market_cap || 0,
        marketCapRank: c.market_cap_rank || 999,
        totalSupply: c.total_supply || 0,
        circulatingSupply: c.circulating_supply || 0,
        ath: c.ath || 0,
        athChange24h: c.ath_change_percentage || 0,
        source: 'coingecko',
        txns1h: { buys: 0, sells: 0, total: 0 },
        txns24h: { buys: 0, sells: 0, total: 0 },
        url: `https://www.coingecko.com/en/coins/${c.id}`,
        description: c.description?.en || '',
      }));
  } catch (e) {
    console.error('CoinGecko error:', e);
    // Fallback: try fetching by page without specific IDs
    try {
      const fallbackData = await fetchCoinGecko(
        `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=true&price_change_percentage=1h%2C24h`
      );
      if (!Array.isArray(fallbackData)) throw new Error('Invalid fallback response');
      return fallbackData
        .filter((c) => c.current_price != null)
        .slice(0, limit)
        .map((c) => ({
          address: c.id,
          symbol: (c.symbol || '').toUpperCase(),
          name: c.name || '',
          chain: 'ethereum',
          icon: c.image || '',
          priceUsd: c.current_price || 0,
          priceChange1h: c.price_change_percentage_1h_in_currency ?? c.price_change_percentage_24h ?? 0,
          priceChange24h: c.price_change_percentage_24h ?? 0,
          volume1h: c.total_volume ? c.total_volume / 24 : 0,
          volume24h: c.total_volume || 0,
          liquidity: c.market_cap || 0,
          fdv: c.fully_diluted_valuation || c.market_cap || 0,
          marketCap: c.market_cap || 0,
          marketCapRank: c.market_cap_rank || 999,
          source: 'coingecko',
          txns1h: { buys: 0, sells: 0, total: 0 },
          txns24h: { buys: 0, sells: 0, total: 0 },
          url: `https://www.coingecko.com/en/coins/${c.id}`,
        }));
    } catch (e2) {
      console.error('CoinGecko fallback error:', e2);
      return [];
    }
  }
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

  // Main endpoint
  if (url.pathname === '/api/othercoin' && request.method === 'GET') {
    const limit = parseInt(url.searchParams.get('limit')) || 20;

    try {
      const tokens = await getTopCoins(limit);
      return new Response(
        JSON.stringify({
          success: true,
          source: 'coingecko',
          count: tokens.length,
          timestamp: Date.now(),
          data: tokens,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, s-maxage=60',
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

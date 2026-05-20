/**
 * Memecoin Monitor - Cloudflare Pages Function
 *
 * Fetches trending memecoin data from multiple sources across Solana, Base, and BSC chains.
 * Primary source: gmgn.ai API (proxied through Cloudflare)
 * Secondary source: DexScreener API (reliable fallback)
 *
 * Endpoints:
 *   GET /api/trending?chain=solana      - Top trending memecoins on Solana
 *   GET /api/trending?chain=base        - Top trending memecoins on Base
 *   GET /api/trending?chain=bsc         - Top trending memecoins on BSC
 *   GET /api/trending?chain=all         - Trending memecoins across all chains
 *   GET /api/gmgn/proxy?path=...        - Proxy to gmgn.ai API
 */

const CHAIN_MAP = {
  solana: { gmgn: 'sol', dexscreener: 'solana' },
  base: { gmgn: 'base', dexscreener: 'base' },
  bsc: { gmgn: 'bsc', dexscreener: 'bsc' },
};

const GMGN_BASE = 'https://gmgn.ai';
const DEXSCREENER_BASE = 'https://api.dexscreener.com';

// Cache durations in seconds
const CACHE_SHORT = 30;
const CACHE_MEDIUM = 60;
const CACHE_LONG = 120;

/**
 * Fetch from gmgn.ai API with proper headers
 */
async function fetchGmgnApi(path, cf) {
  const url = `${GMGN_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; MemecoinMonitor/1.0; +https://memecoin-monitor.pages.dev)',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://gmgn.ai/',
      'Origin': 'https://gmgn.ai',
    },
    cf: {
      cacheTtl: CACHE_SHORT,
      cacheEverything: true,
      ...cf,
    },
  });

  if (!response.ok) {
    throw new Error(`gmgn.ai API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Fetch from DexScreener API
 */
async function fetchDexScreener(path) {
  const url = `${DEXSCREENER_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`DexScreener API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Get trending tokens from DexScreener token profiles
 * Returns the latest token profiles that are most active
 */
async function getDexScreenerTrending(chain) {
  try {
    const chainParam = CHAIN_MAP[chain]?.dexscreener || chain;
    const data = await fetchDexScreener('/token-profiles/latest/v1');

    if (!data || !Array.isArray(data)) {
      return [];
    }

    // Filter by chain and map to our format
    return data
      .filter((t) => {
        if (chain === 'all') return true;
        return t.chainId === chainParam;
      })
      .slice(0, 50)
      .map((t) => ({
        id: t.tokenAddress || t.url,
        address: t.tokenAddress || '',
        symbol: t.symbol || '',
        name: t.name || '',
        chain: t.chainId || chain,
        icon: t.icon || '',
        url: t.url || '',
        source: 'dexscreener',
        description: t.description || '',
      }));
  } catch (e) {
    console.error('DexScreener profiles error:', e);
    return [];
  }
}

/**
 * Get detailed pair data from DexScreener for tokens
 */
async function getDexScreenerPairs(tokenAddresses) {
  if (!tokenAddresses.length) return [];

  try {
    // DexScreener allows batch queries with comma-separated addresses
    const addresses = tokenAddresses.slice(0, 30).join(',');
    const data = await fetchDexScreener(`/latest/dex/tokens/${addresses}`);

    if (!data || !data.pairs) return [];

    return data.pairs.map((p) => ({
      address: p.baseToken?.address || '',
      symbol: p.baseToken?.symbol || '',
      name: p.baseToken?.name || '',
      chain: p.chainId || '',
      dex: p.dexId || '',
      pairAddress: p.pairAddress || '',
      priceUsd: parseFloat(p.priceUsd) || 0,
      priceChange1h: parseFloat(p.priceChange?.h1) || 0,
      priceChange24h: parseFloat(p.priceChange?.h24) || 0,
      volume1h: parseFloat(p.volume?.h1) || 0,
      volume24h: parseFloat(p.volume?.h24) || 0,
      volume1hRaw: p.volume?.h1,
      volume24hRaw: p.volume?.h24,
      liquidity: parseFloat(p.liquidity?.usd) || 0,
      fdv: parseFloat(p.fdv) || 0,
      txns1h: {
        buys: p.txns?.h1?.buys || 0,
        sells: p.txns?.h1?.sells || 0,
        total: (p.txns?.h1?.buys || 0) + (p.txns?.h1?.sells || 0),
      },
      txns24h: {
        buys: p.txns?.h24?.buys || 0,
        sells: p.txns?.h24?.sells || 0,
        total: (p.txns?.h24?.buys || 0) + (p.txns?.h24?.sells || 0),
      },
      createdAt: p.pairCreatedAt || null,
      url: p.url || '',
      source: 'dexscreener',
      liquidityUsd: parseFloat(p.liquidity?.usd) || 0,
    }));
  } catch (e) {
    console.error('DexScreener pairs error:', e);
    return [];
  }
}

/**
 * Get trending memecoins from multiple data sources
 */
async function getTrendingMemecoins(chain, limit = 30) {
  // Step 1: Get token profiles from DexScreener
  const profiles = await getDexScreenerTrending(chain);
  const tokenAddresses = profiles.map((t) => t.address).filter(Boolean);

  // Step 2: Get detailed pair data
  let pairs = await getDexScreenerPairs(tokenAddresses);

  // Step 3: Also try gmgn.ai for additional data
  let gmgnData = [];
  try {
    const gmgnChain = CHAIN_MAP[chain]?.gmgn || chain;
    const gmgnResponse = await fetchGmgnApi(`/api/v1/rank/${gmgnChain}/swaps/1h`, {
      cacheTtl: 30,
    });

    // gmgn response structure varies, try to extract tokens
    if (gmgnResponse?.data?.rank) {
      gmgnData = gmgnResponse.data.rank.map((t) => ({
        address: t.address || '',
        symbol: t.symbol || '',
        name: t.name || '',
        chain: chain,
        priceUsd: parseFloat(t.price) || 0,
        priceChange1h: parseFloat(t.priceChange1h) || 0,
        priceChange24h: parseFloat(t.priceChange24h) || 0,
        volume1h: parseFloat(t.volume1h) || 0,
        volume24h: parseFloat(t.volume24h) || 0,
        volume1hRaw: t.volume1h,
        volume24hRaw: t.volume24h,
        liquidity: parseFloat(t.liquidity) || 0,
        fdv: parseFloat(t.fdv) || 0,
        holders: t.holderCount || 0,
        makerCount: t.makerCount || 0,
        txns1h: {
          buys: parseInt(t.buy1h) || 0,
          sells: parseInt(t.sell1h) || 0,
          total: (parseInt(t.buy1h) || 0) + (parseInt(t.sell1h) || 0),
        },
        age: t.age || '',
        source: 'gmgn',
        url: `https://gmgn.ai/${gmgnChain}/token/${t.address}`,
        icon: t.logo || '',
      }));
    }
  } catch (e) {
    console.error('gmgn.ai fetch error:', e.message);
    // Fallback to DexScreener only
  }

  // Step 4: For tokens we have gmgn data for, try to get DexScreener details too
  const gmgnAddresses = gmgnData.map((t) => t.address).filter(Boolean);
  const missingAddresses = gmgnAddresses.filter(
    (addr) => !pairs.some((p) => p.address.toLowerCase() === addr.toLowerCase())
  );

  if (missingAddresses.length > 0) {
    const extraPairs = await getDexScreenerPairs(missingAddresses);
    pairs = [...pairs, ...extraPairs];
  }

  // Step 5: Merge data from both sources
  const mergedMap = new Map();

  // Add DexScreener data
  for (const pair of pairs) {
    const key = pair.address.toLowerCase();
    mergedMap.set(key, pair);
  }

  // Add gmgn data (overrides DexScreener for same tokens)
  for (const token of gmgnData) {
    const key = token.address.toLowerCase();
    if (mergedMap.has(key)) {
      const existing = mergedMap.get(key);
      mergedMap.set(key, { ...existing, ...token });
    } else {
      mergedMap.set(key, token);
    }
  }

  // Step 6: Sort by 24h volume (fallback to 1h if 24h unavailable) and limit
  const merged = Array.from(mergedMap.values())
    .sort((a, b) => {
      const bVol = b.volume24hRaw != null ? b.volume24h : (b.volume1hRaw != null ? b.volume1h : 0);
      const aVol = a.volume24hRaw != null ? a.volume24h : (a.volume1hRaw != null ? a.volume1h : 0);
      return bVol - aVol;
    })
    .slice(0, limit);

  return merged;
}

/**
 * Proxy request to gmgn.ai API
 */
async function proxyGmgnRequest(url) {
  const path = url.searchParams.get('path') || '/api/v1/meme/top?chain=sol&limit=20';

  try {
    const data = await fetchGmgnApi(path);
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': `public, s-maxage=${CACHE_SHORT}`,
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e.message, source: 'gmgn-proxy' }),
      {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

/**
 * Handle API requests
 */
export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Route: GET /api/trending
  if (pathname === '/api/trending' && request.method === 'GET') {
    const chain = url.searchParams.get('chain') || 'solana';
    const limit = parseInt(url.searchParams.get('limit')) || 30;

    if (!CHAIN_MAP[chain] && chain !== 'all') {
      return new Response(
        JSON.stringify({
          error: `Unsupported chain: ${chain}. Supported: ${Object.keys(CHAIN_MAP).join(', ')}, all`,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    try {
      const tokens = await getTrendingMemecoins(chain, limit);
      return new Response(
        JSON.stringify({
          success: true,
          chain,
          count: tokens.length,
          timestamp: Date.now(),
          data: tokens,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, s-maxage=${CACHE_SHORT}`,
            ...corsHeaders,
          },
        }
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ error: e.message, success: false }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }
  }

  // Route: GET /api/gmgn/proxy - proxy to gmgn.ai
  if (pathname === '/api/gmgn/proxy' && request.method === 'GET') {
    return proxyGmgnRequest(url);
  }

  // Route: GET /api/chains - list supported chains
  if (pathname === '/api/chains' && request.method === 'GET') {
    return new Response(
      JSON.stringify({
        chains: Object.entries(CHAIN_MAP).map(([key, val]) => ({
          id: key,
          name: key.charAt(0).toUpperCase() + key.slice(1),
          gmgnSlug: val.gmgn,
          dexscreenerSlug: val.dexscreener,
        })),
      }),
      {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }

  // 404 for unknown API routes
  return new Response(
    JSON.stringify({ error: 'Not found', available: ['/api/trending', '/api/gmgn/proxy', '/api/chains'] }),
    {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

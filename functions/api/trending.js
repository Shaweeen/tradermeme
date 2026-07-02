/**
 * Memecoin Monitor - Cloudflare Pages Function
 *
 * Multi-source data aggregation:
 *   - GMGN OpenAPI (primary, authenticated)
 *   - DexScreener API (fallback, no auth needed)
 *
 * Endpoints:
 *   GET /api/trending?chain=solana      - Top trending memecoins (GMGN + DexScreener)
 *   GET /api/trending?chain=ethereum    - Ethereum memecoins (DexScreener)
 *   GET /api/smartmoney?chain=sol       - Smart Money activity (GMGN)
 *   GET /api/kol?chain=sol              - KOL activity (GMGN)
 *   GET /api/token-info?chain=sol&address=... - Token detail (GMGN + DexScreener)
 *   GET /api/chains                      - List supported chains
 */

// Use dynamic import for ESM compatibility in CF Workers
let gmgn;
let dexscreener;
async function initGmgn() {
  if (!gmgn) gmgn = await import('./_gmgn.js');
  return gmgn;
}
async function initDex() {
  if (!dexscreener) dexscreener = await import('./_dexscreener.js');
  return dexscreener;
}

const CHAIN_MAP = {
  solana: { gmgn: 'sol', dexscreener: 'solana', label: 'Solana', icon: '🪙' },
  ethereum: { gmgn: null, dexscreener: 'ethereum', label: 'Ethereum', icon: '🔷' },
  base: { gmgn: 'base', dexscreener: 'base', label: 'Base', icon: '🔵' },
  bsc: { gmgn: 'bsc', dexscreener: 'bsc', label: 'BSC', icon: '🟡' },
};

const CACHE_SHORT = 30;

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(), ...extraHeaders },
  });
}

// Transform GMGN rank response to internal format
function transformGmgnRank(data, chain, gmgnSlug) {
  if (!Array.isArray(data)) return [];
  return data.map((t, idx) => ({
    rank: idx + 1,
    address: t.address || '',
    symbol: t.symbol || '',
    name: t.name || '',
    chain: chain,
    icon: t.icon_url || t.logo || '',
    priceUsd: parseFloat(t.price) || 0,
    priceChange1h: parseFloat(t.price_1h) || 0,
    priceChange24h: parseFloat(t.price_24h) || 0,
    volume1h: parseFloat(t.volume_1h) || 0,
    volume24h: parseFloat(t.volume_24h) || 0,
    liquidity: parseFloat(t.liquidity) || 0,
    fdv: parseFloat(t.fdv) || 0,
    marketCap: parseFloat(t.market_cap) || 0,
    holders: t.holder_count || 0,
    makerCount: t.buy_count_1h ? t.buy_count_1h + t.sell_count_1h : 0,
    txns1h: {
      buys: parseInt(t.buy_count_1h) || 0,
      sells: parseInt(t.sell_count_1h) || 0,
      total: (parseInt(t.buy_count_1h) || 0) + (parseInt(t.sell_count_1h) || 0),
    },
    txns24h: {
      buys: parseInt(t.buy_count_24h) || 0,
      sells: parseInt(t.sell_count_24h) || 0,
      total: (parseInt(t.buy_count_24h) || 0) + (parseInt(t.sell_count_24h) || 0),
    },
    source: 'gmgn-openapi',
    url: `https://gmgn.ai/${gmgnSlug}/token/${t.address}`,
    firstTradeTimestamp: t.first_trade_timestamp,
    firstTradePrice: parseFloat(t.first_trade_price) || 0,
    smartBalance: parseFloat(t.smart_balance) || 0,
    smartCount: t.smart_count || 0,
    smartRatio: parseFloat(t.smart_ratio) || 0,
    top10Holders: parseFloat(t.top10) || 0,
    age: t.age || '',
    isBan: t.is_ban || false,
    isRug: t.is_rug || false,
    isHoneypot: t.is_honeypot || false,
  }));
}

/**
 * Try GMGN first, fall back to DexScreener.
 * For chains without GMGN support (ethereum), use DexScreener directly.
 */
async function getTrendingMemecoins(context, chain, limit = 30) {
  const chainsToFetch = chain === 'all' ? Object.keys(CHAIN_MAP) : [chain];
  const apiKey = context?.env?.GMGN_API_KEY || '';
  const gmgnMod = await initGmgn();
  const dexMod = await initDex();

  const allResults = await Promise.allSettled(
    chainsToFetch.map(async (c) => {
      const gmgnSlug = CHAIN_MAP[c]?.gmgn;
      const dexSlug = CHAIN_MAP[c]?.dexscreener;

      try {
        let tokens = [];

        // Try GMGN first (authenticated, richer data)
        if (gmgnSlug && apiKey) {
          try {
            const rankData = await gmgnMod.getTrendingSwaps(apiKey, gmgnSlug, '5m', { limit });
            if (Array.isArray(rankData) && rankData.length > 0) {
              tokens = transformGmgnRank(rankData, c, gmgnSlug);
              console.log(`GMGN returned ${tokens.length} tokens for ${c}`);
            }
          } catch (gmgnErr) {
            console.error(`GMGN error for ${c}:`, gmgnErr.message);
          }
        }

        // If GMGN returned nothing, try DexScreener as fallback
        if (tokens.length === 0 && dexSlug) {
          try {
            const dexData = await dexMod.getTrendingPairs(c, limit);
            if (dexData && Array.isArray(dexData.tokens) && dexData.tokens.length > 0) {
              tokens = dexMod.transformDexScreenerPairs(dexData.tokens, c);
              console.log(`DexScreener returned ${tokens.length} tokens for ${c}`);
            }
          } catch (dexErr) {
            console.error(`DexScreener error for ${c}:`, dexErr.message);
          }
        }

        return { chain: c, tokens };
      } catch (e) {
        console.error(`Fetch error for ${c}:`, e.message);
        return { chain: c, tokens: [] };
      }
    })
  );

  const mergedMap = new Map();
  for (const result of allResults) {
    if (result.status !== 'fulfilled') continue;
    for (const token of result.value.tokens) {
      const key = token.address.toLowerCase() + ':' + token.chain;
      mergedMap.set(key, token);
    }
  }

  const merged = Array.from(mergedMap.values())
    .sort((a, b) => {
      const bScore = (b.holders || 0) * 100 +
                     (b.liquidity || 0) +
                     ((b.txns24h?.total || 0) * 10) +
                     (b.smartCount || 0) * 1000;
      const aScore = (a.holders || 0) * 100 +
                     (a.liquidity || 0) +
                     ((a.txns24h?.total || 0) * 10) +
                     (a.smartCount || 0) * 1000;
      return bScore - aScore;
    })
    .slice(0, limit);

  return merged;
}

async function getSmartMoneyActivity(context, chain, limit = 50) {
  const apiKey = context?.env?.GMGN_API_KEY || '';
  const gmgnChain = CHAIN_MAP[chain]?.gmgn || 'sol';
  if (!CHAIN_MAP[chain]?.gmgn) return []; // No GMGN support for this chain
  const gmgnMod = await initGmgn();

  try {
    const data = await gmgnMod.getSmartMoney(apiKey, gmgnChain, limit);
    if (!Array.isArray(data)) return [];

    return data.map((w) => ({
      walletAddress: w.address || w.wallet_address || '',
      tag: w.tag || '',
      platform: w.platform || w.source || gmgnChain,
      chain: chain,
      balance: parseFloat(w.balance) || 0,
      pnl24h: parseFloat(w.pnl_24h) || parseFloat(w.profit) || 0,
      winRate: parseFloat(w.win_rate) || 0,
      tradeCount: w.trade_count || 0,
      realizedPnl: parseFloat(w.realized_pnl) || 0,
      avgRoi: parseFloat(w.avg_roi) || 0,
      tokensTraded: w.tokens_traded || 0,
      followers: w.followers || 0,
      lastActive: w.last_active || 0,
      source: 'gmgn-smartmoney',
    }));
  } catch (e) {
    console.error('SmartMoney fetch error:', e.message);
    return [];
  }
}

async function getKolActivity(context, chain, limit = 50) {
  const apiKey = context?.env?.GMGN_API_KEY || '';
  const gmgnChain = CHAIN_MAP[chain]?.gmgn || 'sol';
  if (!CHAIN_MAP[chain]?.gmgn) return [];
  const gmgnMod = await initGmgn();

  try {
    const data = await gmgnMod.getKol(apiKey, gmgnChain, limit);
    if (!Array.isArray(data)) return [];

    return data.map((w) => ({
      walletAddress: w.address || w.wallet_address || '',
      tag: w.tag || w.name || '',
      platform: w.platform || w.source || gmgnChain,
      chain: chain,
      balance: parseFloat(w.balance) || 0,
      pnl24h: parseFloat(w.pnl_24h) || parseFloat(w.profit) || 0,
      winRate: parseFloat(w.win_rate) || 0,
      tradeCount: w.trade_count || 0,
      realizedPnl: parseFloat(w.realized_pnl) || 0,
      avgRoi: parseFloat(w.avg_roi) || 0,
      followers: w.followers || 0,
      twitterHandle: w.twitter || '',
      source: 'gmgn-kol',
    }));
  } catch (e) {
    console.error('KOL fetch error:', e.message);
    return [];
  }
}

async function getTokenDetails(context, chain, address) {
  const apiKey = context?.env?.GMGN_API_KEY || '';
  const gmgnChain = CHAIN_MAP[chain]?.gmgn || chain;
  const gmgnMod = await initGmgn();

  // Try GMGN first
  if (gmgnChain && apiKey) {
    try {
      const tokenData = await gmgnMod.getTokenInfo(apiKey, gmgnChain, address);
      if (tokenData) {
        return {
          address,
          chain,
          symbol: tokenData?.symbol || '',
          name: tokenData?.name || '',
          icon: tokenData?.icon_url || tokenData?.logo || '',
          priceUsd: parseFloat(tokenData?.price) || 0,
          priceChange1h: parseFloat(tokenData?.price_1h) || 0,
          priceChange24h: parseFloat(tokenData?.price_24h) || 0,
          volume24h: parseFloat(tokenData?.volume_24h) || 0,
          liquidity: parseFloat(tokenData?.liquidity) || 0,
          marketCap: parseFloat(tokenData?.market_cap) || 0,
          fdv: parseFloat(tokenData?.fdv) || 0,
          holders: tokenData?.holder_count || 0,
          top10Holders: parseFloat(tokenData?.top10) || 0,
          smartCount: tokenData?.smart_count || 0,
          smartRatio: parseFloat(tokenData?.smart_ratio) || 0,
          firstTradeTimestamp: tokenData?.first_trade_timestamp,
          source: 'gmgn-openapi',
        };
      }
    } catch (e) {
      console.error('Token info fetch error:', e.message);
    }
  }

  return null;
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const pathname = url.pathname;
  const corsHeaders = getCorsHeaders();

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Route: GET /api/trending
  if (pathname === '/api/trending' && request.method === 'GET') {
    const chain = url.searchParams.get('chain') || 'solana';
    const limit = parseInt(url.searchParams.get('limit')) || 30;

    if (!CHAIN_MAP[chain] && chain !== 'all') {
      return jsonResponse({
        error: `Unsupported chain: ${chain}. Supported: ${Object.keys(CHAIN_MAP).join(', ')}, all`,
        supported: Object.keys(CHAIN_MAP),
      }, 400);
    }

    try {
      const tokens = await getTrendingMemecoins(context, chain, limit);
      return jsonResponse({
        success: true,
        chain,
        count: tokens.length,
        timestamp: Date.now(),
        source: tokens.some(t => t.source === 'dexscreener') ? 'dexscreener+gmgn' : 'gmgn-openapi',
        data: tokens,
      }, 200, { 'Cache-Control': `public, s-maxage=${CACHE_SHORT}` });
    } catch (e) {
      return jsonResponse({ error: e.message, success: false }, 500);
    }
  }

  // Route: GET /api/smartmoney
  if (pathname === '/api/smartmoney' && request.method === 'GET') {
    const chain = url.searchParams.get('chain') || 'solana';
    const limit = parseInt(url.searchParams.get('limit')) || 50;

    try {
      const wallets = await getSmartMoneyActivity(context, chain, limit);
      return jsonResponse({
        success: true,
        chain,
        count: wallets.length,
        timestamp: Date.now(),
        source: 'gmgn-smartmoney',
        data: wallets,
      }, 200);
    } catch (e) {
      return jsonResponse({ error: e.message, success: false }, 500);
    }
  }

  // Route: GET /api/kol
  if (pathname === '/api/kol' && request.method === 'GET') {
    const chain = url.searchParams.get('chain') || 'solana';
    const limit = parseInt(url.searchParams.get('limit')) || 50;

    try {
      const wallets = await getKolActivity(context, chain, limit);
      return jsonResponse({
        success: true,
        chain,
        count: wallets.length,
        timestamp: Date.now(),
        source: 'gmgn-kol',
        data: wallets,
      }, 200);
    } catch (e) {
      return jsonResponse({ error: e.message, success: false }, 500);
    }
  }

  // Route: GET /api/token-info
  if (pathname === '/api/token-info' && request.method === 'GET') {
    const chain = url.searchParams.get('chain');
    const address = url.searchParams.get('address');

    if (!chain || !address) {
      return jsonResponse({ error: 'Missing chain or address parameter' }, 400);
    }

    try {
      const token = await getTokenDetails(context, chain, address);
      if (!token) {
        return jsonResponse({ error: 'Token not found' }, 404);
      }
      return jsonResponse({
        success: true,
        timestamp: Date.now(),
        data: token,
      }, 200);
    } catch (e) {
      return jsonResponse({ error: e.message, success: false }, 500);
    }
  }

  // Route: GET /api/chains
  if (pathname === '/api/chains' && request.method === 'GET') {
    return jsonResponse({
      chains: Object.entries(CHAIN_MAP).map(([key, val]) => ({
        id: key,
        name: val.label,
        icon: val.icon,
        gmgnSlug: val.gmgn,
        dexscreenerSlug: val.dexscreener,
        hasGmgn: !!val.gmgn,
        hasDexScreener: true,
      })),
    }, 200);
  }

  return jsonResponse({
    error: 'Not found',
    available: ['/api/trending', '/api/smartmoney', '/api/kol', '/api/token-info', '/api/chains'],
  }, 404);
}
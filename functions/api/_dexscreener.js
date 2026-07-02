/**
 * DexScreener client for Cloudflare Pages Functions.
 *
 * Uses the public DexScreener API (no auth needed) as a fallback/alternative
 * to GMGN OpenAPI for memecoin data.
 *
 * Endpoints:
 *   - GET /dex/token-profiles/latest/v1  — Latest token profiles (new pairs)
 *   - GET /dex/search?q=                 — Search tokens by symbol/address
 *   - GET /token/{chain}/{address}       — Token pairs by chain + address
 *
 * DexScreener chain slugs:
 *   solana  → solana
 *   ethereum → ethereum
 *   base    → base
 *   bsc     → bsc
 */

const DEXSCREENER_BASE = 'https://api.dexscreener.com';

/** Fetch with timeout */
async function safeFetch(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
    clearTimeout(timeout);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    return { data, error: null };
  } catch (e) {
    clearTimeout(timeout);
    return { error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

/**
 * Map our chain names to DexScreener chain slugs.
 */
const CHAIN_SLUG = {
  solana: 'solana',
  ethereum: 'ethereum',
  base: 'base',
  bsc: 'bsc',
};

/**
 * Get latest token profiles from DexScreener.
 * Returns the most recently created pairs with some metadata.
 */
async function getLatestTokenProfiles(limit = 50) {
  const result = await safeFetch(`${DEXSCREENER_BASE}/dex/token-profiles/latest/v1`, 10000);
  if (result.error || !Array.isArray(result.data)) {
    return { error: result.error || 'Invalid response', tokens: [] };
  }
  return { tokens: result.data.slice(0, limit) };
}

/**
 * Search tokens by symbol on DexScreener.
 */
async function searchTokens(query, limit = 30) {
  const result = await safeFetch(`${DEXSCREENER_BASE}/dex/search?q=${encodeURIComponent(query)}`, 10000);
  if (result.error || !result.data?.pairs) {
    return { error: result.error || 'Invalid response', tokens: [] };
  }
  return { tokens: result.data.pairs.slice(0, limit) };
}

/**
 * Get trending/new pairs from DexScreener for a specific chain.
 * DexScreener doesn't have a "trending" endpoint directly, so we
 * use latest token profiles filtered by chain.
 */
async function getTrendingPairs(chain, limit = 30) {
  const slug = CHAIN_SLUG[chain];
  if (!slug) return { tokens: [] };

  const { tokens, error } = await getLatestTokenProfiles(100);

  if (error || !tokens.length) {
    // Fallback: search common terms to get fresh pairs
    const searchResult = await searchTokens(chain === 'solana' ? 'SOL' : 
      chain === 'ethereum' ? 'ETH' : 
      chain === 'base' ? 'BASE' : 'BNB', limit * 2);
    if (searchResult.error) return { tokens: [] };
    return { tokens: searchResult.tokens.slice(0, limit) };
  }

  // Filter by chain if profile has chain info
  // DexScreener latest profiles may not have chain info directly,
  // so we just return the latest ones
  return { tokens: tokens.slice(0, limit) };
}

/**
 * Transform DexScreener pair/token format to our internal format
 * matching what trending.js expects.
 *
 * DexScreener Pair fields:
 *   { chainId, dexId, url, pairAddress, labels,
 *     baseToken: { address, name, symbol },
 *     quoteToken: { address, name, symbol },
 *     priceNative, priceUsd,
 *     txns: { m5, h1, h6, h24 },
 *     volume: { m5, h1, h6, h24 },
 *     priceChange: { m5, h1, h6, h24 },
 *     liquidity: { usd, base, quote },
 *     fdv, marketCap, pairCreatedAt }
 */
function transformDexScreenerPairs(pairs, chain) {
  if (!Array.isArray(pairs)) return [];
  return pairs.map((p, idx) => ({
    rank: idx + 1,
    address: p.baseToken?.address || p.pairAddress || '',
    symbol: p.baseToken?.symbol || 'Unknown',
    name: p.baseToken?.name || '',
    chain: chain,
    icon: `https://dd.dexscreener.com/ds-data/tokens/${CHAIN_SLUG[chain] || chain}/${(p.baseToken?.address || p.pairAddress || '')}.png`,
    priceUsd: parseFloat(p.priceUsd) || 0,
    priceChange1h: parseFloat(p.priceChange?.h1) || 0,
    priceChange24h: parseFloat(p.priceChange?.h24) || 0,
    volume1h: parseFloat(p.volume?.h1) || 0,
    volume24h: parseFloat(p.volume?.h24) || 0,
    liquidity: parseFloat(p.liquidity?.usd) || 0,
    fdv: parseFloat(p.fdv) || 0,
    marketCap: parseFloat(p.marketCap) || 0,
    holders: p.holders || 0,
    makerCount: 0,
    txns1h: {
      buys: parseInt(p.txns?.h1?.buys) || 0,
      sells: parseInt(p.txns?.h1?.sells) || 0,
      total: (parseInt(p.txns?.h1?.buys) || 0) + (parseInt(p.txns?.h1?.sells) || 0),
    },
    txns24h: {
      buys: parseInt(p.txns?.h24?.buys) || 0,
      sells: parseInt(p.txns?.h24?.sells) || 0,
      total: (parseInt(p.txns?.h24?.buys) || 0) + (parseInt(p.txns?.h24?.sells) || 0),
    },
    source: 'dexscreener',
    url: p.url || `https://dexscreener.com/${CHAIN_SLUG[chain] || chain}/${p.baseToken?.address || ''}`,
    firstTradePrice: 0,
    smartBalance: 0,
    smartCount: 0,
    smartRatio: 0,
    top10Holders: 0,
    age: '',
    isBan: false,
    isRug: false,
    isHoneypot: false,
    dexId: p.dexId || '',
    pairAddress: p.pairAddress || '',
    pairCreatedAt: p.pairCreatedAt || 0,
  }));
}

export {
  DEXSCREENER_BASE,
  CHAIN_SLUG,
  getLatestTokenProfiles,
  searchTokens,
  getTrendingPairs,
  transformDexScreenerPairs,
};
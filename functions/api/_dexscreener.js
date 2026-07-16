/**
 * DexScreener client for Cloudflare Pages Functions.
 *
 * Uses the public DexScreener API (no auth needed) as a fallback/alternative
 * to GMGN OpenAPI for memecoin data.
 *
 * Endpoints:
 *   - GET /token-profiles/latest/v1  — Latest token profiles (new pairs)
 *   - GET /latest/dex/search?q=                 — Search tokens by symbol/address
 *   - GET /token/{chain}/{address}       — Token pairs by chain + address
 *
 * DexScreener chain slugs:
 *   solana    → solana
 *   ethereum  → ethereum
 *   base      → base
 *   bsc       → bsc
 *   robinhood → robinhood  (Robinhood Chain L2)
 */

const DEXSCREENER_BASE = 'https://api.dexscreener.com';

/** Fetch with timeout */
async function safeFetch(url, timeoutMs = 5000) {
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
  robinhood: 'robinhood',
};

/**
 * Get latest token profiles from DexScreener.
 * Returns the most recently created pairs with some metadata.
 */
async function getLatestTokenProfiles(limit = 50) {
  const result = await safeFetch(`${DEXSCREENER_BASE}/token-profiles/latest/v1`, 12000);
  if (result.error || !Array.isArray(result.data)) {
    return { error: result.error || 'Invalid response', tokens: [] };
  }
  return { tokens: result.data.slice(0, limit) };
}

/**
 * Resolve token profile addresses into full DexScreener pairs.
 * DexScreener's latest profile endpoint returns lightweight token profiles,
 * not pair rows, so we must hydrate them before transformDexScreenerPairs().
 */
async function getPairsByTokenAddresses(chain, addresses, limit = 30) {
  const slug = CHAIN_SLUG[chain];
  const unique = [...new Set((addresses || []).filter(Boolean))].slice(0, Math.min(limit, 30));
  if (!slug || unique.length === 0) return { tokens: [] };

  const result = await safeFetch(`${DEXSCREENER_BASE}/tokens/v1/${slug}/${unique.join(',')}`, 12000);
  if (result.error || !Array.isArray(result.data)) {
    return { error: result.error || 'Invalid response', tokens: [] };
  }
  return { tokens: result.data.slice(0, limit) };
}

/**
 * Search tokens by symbol on DexScreener.
 */
async function searchTokens(query, limit = 30) {
  const result = await safeFetch(`${DEXSCREENER_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`, 12000);
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

  const deduped = new Map();
  const pushPairs = (pairs) => {
    for (const pair of pairs || []) {
      if ((pair.chainId || '').toLowerCase() !== slug) continue;
      const key = pair.pairAddress || `${pair.baseToken?.address}:${pair.dexId}`;
      if (key) deduped.set(key, pair);
    }
  };

  // 1) Latest profiles → hydrate by token address (batched)
  const { tokens, error } = await getLatestTokenProfiles(100);
  if (!error && tokens.length) {
    const addresses = tokens
      .filter((t) => (t.chainId || '').toLowerCase() === slug)
      .map((t) => t.tokenAddress)
      .filter(Boolean);
    // DexScreener tokens endpoint is happier with small batches
    for (let i = 0; i < addresses.length; i += 10) {
      const batch = addresses.slice(i, i + 10);
      const hydrated = await getPairsByTokenAddresses(chain, batch, batch.length * 3);
      if (hydrated.tokens?.length) pushPairs(hydrated.tokens);
    }
  }

  // 2) Always also search (critical for newer chains like Robinhood)
  const terms = chain === 'solana' ? ['pump', 'solana meme', 'SOL']
    : chain === 'ethereum' ? ['ethereum meme', 'ETH']
    : chain === 'base' ? ['base meme', 'BASE']
    : chain === 'robinhood' ? ['robinhood', 'ROBINHOOD', 'hood']
    : ['bsc meme', 'BNB'];
  const searchResults = await Promise.allSettled(terms.map((term) => searchTokens(term, Math.max(limit * 3, 30))));
  for (const result of searchResults) {
    if (result.status !== 'fulfilled') continue;
    const searchResult = result.value;
    if (!searchResult.error && Array.isArray(searchResult.tokens)) pushPairs(searchResult.tokens);
  }

  return {
    tokens: [...deduped.values()]
      .sort((a, b) => (parseFloat(b.volume?.h24) || 0) - (parseFloat(a.volume?.h24) || 0))
      .slice(0, limit),
  };
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
  getPairsByTokenAddresses,
  searchTokens,
  getTrendingPairs,
  transformDexScreenerPairs,
};
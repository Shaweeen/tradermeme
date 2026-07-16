/**
 * DexScreener multi-source discovery with global time budget.
 * Search-first (works for base/bsc/robinhood); boosts/profiles optional top-up.
 */

const DEXSCREENER_BASE = 'https://api.dexscreener.com';

const CHAIN_SLUG = {
  solana: 'solana',
  ethereum: 'ethereum',
  base: 'base',
  bsc: 'bsc',
  robinhood: 'robinhood',
};

const SEARCH_TERMS = {
  solana: ['SOL', 'pump', 'solana meme'],
  ethereum: ['ETH', 'ethereum meme'],
  base: ['base', 'base meme', 'BASE', 'brett'],
  bsc: ['bnb meme', 'bsc', 'BNB', 'four.meme'],
  robinhood: ['robinhood', 'ROBINHOOD', 'hood'],
};

async function safeFetch(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { data: await res.json(), error: null };
  } catch (e) {
    clearTimeout(timeout);
    return { error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

function chainSlug(chain) {
  return CHAIN_SLUG[chain] || null;
}

async function searchTokens(query, limit = 30) {
  const result = await safeFetch(
    `${DEXSCREENER_BASE}/latest/dex/search?q=${encodeURIComponent(query)}`,
    10000
  );
  if (result.error || !result.data?.pairs) {
    return { error: result.error || 'Invalid response', tokens: [] };
  }
  return { tokens: result.data.pairs.slice(0, limit) };
}

async function getLatestTokenProfiles(limit = 50) {
  const result = await safeFetch(`${DEXSCREENER_BASE}/token-profiles/latest/v1`, 10000);
  if (result.error || !Array.isArray(result.data)) {
    return { error: result.error || 'Invalid response', tokens: [] };
  }
  return { tokens: result.data.slice(0, limit) };
}

async function getTokenBoosts(kind = 'latest') {
  const path = kind === 'top' ? 'token-boosts/top/v1' : 'token-boosts/latest/v1';
  const result = await safeFetch(`${DEXSCREENER_BASE}/${path}`, 10000);
  if (result.error || !Array.isArray(result.data)) {
    return { error: result.error || 'Invalid response', tokens: [] };
  }
  return { tokens: result.data };
}

async function getPairsByTokenAddresses(chain, addresses, limit = 30) {
  const slug = chainSlug(chain);
  const unique = [...new Set((addresses || []).filter(Boolean))].slice(0, Math.min(limit, 15));
  if (!slug || unique.length === 0) return { tokens: [] };
  const result = await safeFetch(
    `${DEXSCREENER_BASE}/tokens/v1/${slug}/${unique.join(',')}`,
    10000
  );
  if (result.error || !Array.isArray(result.data)) {
    return { error: result.error || 'Invalid response', tokens: [] };
  }
  return { tokens: result.data.slice(0, limit) };
}

/**
 * Collect pairs with ~20s budget. Search first (2 concurrent), then optional top-up.
 */
async function getTrendingPairs(chain, limit = 30) {
  const slug = chainSlug(chain);
  if (!slug) return { tokens: [], sourcesUsed: [], errors: ['unknown chain'] };

  const started = Date.now();
  const BUDGET_MS = 18000;
  const left = () => Math.max(500, BUDGET_MS - (Date.now() - started));

  const sourcesUsed = [];
  const errors = [];
  const deduped = new Map();

  const pushPairs = (pairs, sourceTag) => {
    let added = 0;
    for (const pair of pairs || []) {
      if ((pair.chainId || '').toLowerCase() !== slug) continue;
      const key = pair.pairAddress || `${pair.baseToken?.address}:${pair.dexId}`;
      if (!key || deduped.has(key)) continue;
      deduped.set(key, { ...pair, _source: sourceTag || 'dexscreener' });
      added += 1;
    }
    if (added > 0 && sourceTag && !sourcesUsed.includes(sourceTag)) sourcesUsed.push(sourceTag);
    return added;
  };

  // 1) Search terms — 2 at a time
  const terms = SEARCH_TERMS[chain] || [chain];
  for (let i = 0; i < terms.length && left() > 800 && deduped.size < limit; i += 2) {
    const batch = terms.slice(i, i + 2);
    const results = await Promise.all(
      batch.map(async (term) => {
        const r = await searchTokens(term, 40);
        return { term, ...r };
      })
    );
    for (const r of results) {
      if (r.error) errors.push(`search:${r.term}:${r.error}`);
      else pushPairs(r.tokens, 'dex-search');
    }
  }

  // 2) Top-up via boosts/profiles if still sparse and budget remains
  if (deduped.size < Math.min(limit, 10) && left() > 2000) {
    const [boosts, profiles] = await Promise.all([
      getTokenBoosts('latest'),
      getLatestTokenProfiles(60),
    ]);
    const addrs = [];
    for (const pack of [boosts, profiles]) {
      if (pack.error) {
        errors.push(pack.error);
        continue;
      }
      for (const t of pack.tokens || []) {
        if ((t.chainId || '').toLowerCase() === slug && t.tokenAddress) addrs.push(t.tokenAddress);
      }
    }
    if (addrs.length && left() > 1500) {
      const hyd = await getPairsByTokenAddresses(chain, addrs.slice(0, 15), 30);
      if (hyd.error) errors.push(`hydrate:${hyd.error}`);
      else pushPairs(hyd.tokens, 'dex-hydrate');
    }
  }

  const tokens = [...deduped.values()]
    .sort((a, b) => (parseFloat(b.volume?.h24) || 0) - (parseFloat(a.volume?.h24) || 0))
    .slice(0, limit);

  return { tokens, sourcesUsed, errors: errors.slice(0, 8) };
}

function transformDexScreenerPairs(pairs, chain) {
  if (!Array.isArray(pairs)) return [];
  return pairs.map((p, idx) => ({
    rank: idx + 1,
    address: p.baseToken?.address || p.pairAddress || '',
    symbol: p.baseToken?.symbol || 'Unknown',
    name: p.baseToken?.name || '',
    chain,
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
    source: p._source || 'dexscreener',
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
    hasSmartMoneyData: false,
    securityChecked: false,
    dataQuality: 'dex-fallback',
    discoverySources: [p._source || 'dexscreener'],
  }));
}

export {
  DEXSCREENER_BASE,
  CHAIN_SLUG,
  SEARCH_TERMS,
  getLatestTokenProfiles,
  getTokenBoosts,
  getPairsByTokenAddresses,
  searchTokens,
  getTrendingPairs,
  transformDexScreenerPairs,
};

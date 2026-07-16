/**
 * GeckoTerminal public API — backup trending pools by network.
 * Docs: https://www.geckoterminal.com/dex-api
 *
 * Networks we map:
 *   solana → solana, base → base, bsc → bsc, ethereum → eth
 * Robinhood is often missing here; rely on DexScreener for RH.
 */

const GT_BASE = 'https://api.geckoterminal.com/api/v2';

const NETWORK_MAP = {
  solana: 'solana',
  base: 'base',
  bsc: 'bsc',
  ethereum: 'eth',
  // robinhood: not reliably listed on GT
};

async function safeFetch(url, timeoutMs = 18000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        // GT asks for a UA; some edges rate-limit empty UA harder
        'User-Agent': 'tradermeme/1.0 (geckoterminal-backup)',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return { error: `HTTP ${res.status}`, data: null };
    return { error: null, data: await res.json() };
  } catch (e) {
    clearTimeout(timeout);
    return { error: e.name === 'AbortError' ? 'timeout' : e.message, data: null };
  }
}

/**
 * Fetch trending pools for a chain and normalize to Dex-like pair shape
 * so transformDexScreenerPairs can be reused (or our own transform).
 */
async function getTrendingPools(chain, limit = 30) {
  const network = NETWORK_MAP[chain];
  if (!network) return { tokens: [], error: `unsupported network: ${chain}` };

  // Prefer trending, then new pools as second page of discovery
  const urls = [
    `${GT_BASE}/networks/${network}/trending_pools?page=1`,
    `${GT_BASE}/networks/${network}/new_pools?page=1`,
  ];

  const pools = [];
  const errors = [];
  for (const url of urls) {
    const { error, data } = await safeFetch(url, 12000);
    if (error) {
      errors.push(error);
      continue;
    }
    const list = Array.isArray(data?.data) ? data.data : [];
    pools.push(...list);
    if (pools.length >= limit) break;
  }

  if (!pools.length) {
    return { tokens: [], error: errors.join('; ') || 'empty' };
  }

  const seen = new Set();
  const tokens = [];
  for (const item of pools) {
    const a = item.attributes || {};
    const rel = item.relationships || {};
    // base token address often in name like "TOKEN / WETH" — prefer reserve addresses
    const baseId = rel.base_token?.data?.id || ''; // e.g. base_0xabc...
    const address = (baseId.includes('_') ? baseId.split('_').slice(1).join('_') : a.address || a.base_token_address || '').trim();
    const pairAddress = a.address || '';
    const key = (address || pairAddress).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const nameParts = String(a.name || '').split('/');
    const symbol = (nameParts[0] || a.name || 'UNKNOWN').trim().slice(0, 24);
    const priceUsd = parseFloat(a.base_token_price_usd) || 0;
    const vol = a.volume_usd || {};
    const change = a.price_change_percentage || {};
    const txns = a.transactions || {};
    const h1 = txns.h1 || txns.m5 || {};
    const h24 = txns.h24 || {};

    tokens.push({
      chainId: chain === 'bsc' ? 'bsc' : chain,
      dexId: a.dex_id || a.dex || 'geckoterminal',
      url: a.url || `https://www.geckoterminal.com/${network}/pools/${pairAddress}`,
      pairAddress,
      baseToken: {
        address: address || pairAddress,
        name: symbol,
        symbol,
      },
      quoteToken: { address: '', name: '', symbol: '' },
      priceUsd: String(priceUsd),
      txns: {
        h1: { buys: parseInt(h1.buys) || 0, sells: parseInt(h1.sells) || 0 },
        h24: { buys: parseInt(h24.buys) || 0, sells: parseInt(h24.sells) || 0 },
      },
      volume: {
        h1: parseFloat(vol.h1) || 0,
        h24: parseFloat(vol.h24) || 0,
      },
      priceChange: {
        h1: parseFloat(change.h1) || 0,
        h24: parseFloat(change.h24) || 0,
      },
      liquidity: { usd: parseFloat(a.reserve_in_usd) || 0 },
      fdv: parseFloat(a.fdv_usd) || 0,
      marketCap: parseFloat(a.market_cap_usd) || 0,
      pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : 0,
      _source: 'geckoterminal',
    });
    if (tokens.length >= limit) break;
  }

  return { tokens, error: null, source: 'geckoterminal' };
}

export { GT_BASE, NETWORK_MAP, getTrendingPools };

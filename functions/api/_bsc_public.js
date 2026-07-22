/**
 * Public BSC / Binance-ecosystem DEX sources (no API key).
 *
 * Primary (on-chain Binance DEX ecosystem):
 *   1) GeckoTerminal — PancakeSwap V2/V3 pools (Binance Chain public DEX)
 *   2) GeckoTerminal — BSC network trending + new pools
 * Optional mix-in:
 *   3) Binance Spot 24h high-movers (CEX pulse; filtered out of on-chain board by address prefix)
 *
 * Output shape matches DexScreener pairs so transformDexScreenerPairs can reuse.
 */

const GT = 'https://api.geckoterminal.com/api/v2';
const BINANCE = 'https://api.binance.com';

async function safeFetch(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'tradermeme/1.0 (bsc-public)',
      },
    });
    clearTimeout(t);
    if (!res.ok) return { error: `HTTP ${res.status}`, data: null };
    return { error: null, data: await res.json() };
  } catch (e) {
    clearTimeout(t);
    return { error: e.name === 'AbortError' ? 'timeout' : e.message, data: null };
  }
}

function poolToPair(item, sourceTag) {
  const a = item.attributes || {};
  const rel = item.relationships || {};
  const baseId = rel.base_token?.data?.id || '';
  const address = (baseId.includes('_') ? baseId.split('_').slice(1).join('_') : a.address || '').trim();
  const pairAddress = a.address || '';
  const nameParts = String(a.name || '').split('/');
  const symbol = (nameParts[0] || 'UNKNOWN').trim().slice(0, 24);
  const vol = a.volume_usd || {};
  const change = a.price_change_percentage || {};
  const txns = a.transactions || {};
  const h1 = txns.h1 || {};
  const h24 = txns.h24 || {};
  return {
    chainId: 'bsc',
    dexId: a.dex_id || sourceTag || 'pancakeswap',
    url: a.url || `https://www.geckoterminal.com/bsc/pools/${pairAddress}`,
    pairAddress,
    baseToken: { address: address || pairAddress, name: symbol, symbol },
    quoteToken: { address: '', name: '', symbol: '' },
    priceUsd: String(parseFloat(a.base_token_price_usd) || 0),
    txns: {
      h1: { buys: parseInt(h1.buys) || 0, sells: parseInt(h1.sells) || 0 },
      h24: { buys: parseInt(h24.buys) || 0, sells: parseInt(h24.sells) || 0 },
    },
    volume: { h1: parseFloat(vol.h1) || 0, h24: parseFloat(vol.h24) || 0 },
    priceChange: { h1: parseFloat(change.h1) || 0, h24: parseFloat(change.h24) || 0 },
    liquidity: { usd: parseFloat(a.reserve_in_usd) || 0 },
    fdv: parseFloat(a.fdv_usd) || 0,
    marketCap: parseFloat(a.market_cap_usd) || 0,
    pairCreatedAt: a.pool_created_at ? Date.parse(a.pool_created_at) : 0,
    _source: sourceTag || 'pancake-gt',
  };
}

/**
 * PancakeSwap (Binance ecosystem DEX) + BSC network trending/new pools via GeckoTerminal.
 * Prefer pancake pools first so BSC memecoin board is DEX-native, not CEX stubs.
 */
async function getPancakeAndBscPools(limit = 40) {
  // Pancake first (Binance DEX), then broader BSC discovery
  const urls = [
    // Binance ecosystem DEX (Pancake) — primary
    `${GT}/networks/bsc/dexes/pancakeswap_v2/pools?page=1`,
    `${GT}/networks/bsc/dexes/pancakeswap_v3/pools?page=1`,
    `${GT}/networks/bsc/dexes/pancakeswap-v3/pools?page=1`,
    // GMGN-style heat: trending + new launches
    `${GT}/networks/bsc/trending_pools?page=1`,
    `${GT}/networks/bsc/new_pools?page=1`,
    `${GT}/networks/bsc/trending_pools?page=2`,
    `${GT}/networks/bsc/new_pools?page=2`,
    `${GT}/networks/bsc/dexes/pancakeswap_v2/pools?page=2`,
    // other BSC DEXes sometimes carry early memes
    `${GT}/networks/bsc/dexes/uniswap_v3/pools?page=1`,
  ];

  const pairs = [];
  const errors = [];
  const sourcesUsed = [];
  const seen = new Set();

  for (const url of urls) {
    const { error, data } = await safeFetch(url, 15000);
    if (error) {
      errors.push(`${url.split('/').slice(-2).join('/')}:${error}`);
      continue;
    }
    const list = Array.isArray(data?.data) ? data.data : [];
    if (!list.length) continue;
    const tag = url.includes('pancakeswap')
      ? 'pancake-gt'
      : url.includes('new_pools')
        ? 'bsc-new-gt'
        : 'bsc-trend-gt';
    if (!sourcesUsed.includes(tag)) sourcesUsed.push(tag);
    for (const item of list) {
      const pair = poolToPair(item, tag);
      const key = (pair.baseToken.address || pair.pairAddress).toLowerCase();
      if (!key || seen.has(key)) continue;
      // skip pure stable / bluechip quote rows
      const sym = (pair.baseToken.symbol || '').toUpperCase();
      if (['USDT', 'USDC', 'BUSD', 'WBNB', 'BNB', 'ETH', 'BTCB', 'FDUSD', 'DAI'].includes(sym)) continue;
      // skip dust pools
      const vol = parseFloat(pair.volume?.h24) || 0;
      const liq = parseFloat(pair.liquidity?.usd) || 0;
      if (vol < 1000 && liq < 2000) continue;
      seen.add(key);
      pairs.push(pair);
      if (pairs.length >= limit) break;
    }
    if (pairs.length >= limit) break;
  }

  // Prefer high 24h volume; slight boost for pancake-tagged rows
  pairs.sort((a, b) => {
    const score = (p) => {
      const vol = parseFloat(p.volume?.h24) || 0;
      const pancakeBoost = String(p._source || '').includes('pancake') ? 1.15 : 1;
      return vol * pancakeBoost;
    };
    return score(b) - score(a);
  });
  return { pairs: pairs.slice(0, limit), sourcesUsed, errors };
}

/**
 * Binance public Spot 24h — high momentum USDT pairs as CEX pulse for BSC terminal.
 * Not on-chain, but public Binance market data user asked for.
 */
async function getBinanceSpotMovers(limit = 20) {
  const { error, data } = await safeFetch(`${BINANCE}/api/v3/ticker/24hr`, 15000);
  if (error || !Array.isArray(data)) return { pairs: [], error: error || 'empty', sourcesUsed: [] };

  const movers = data
    .filter((t) => String(t.symbol || '').endsWith('USDT'))
    .map((t) => {
      const symbol = String(t.symbol).replace(/USDT$/, '');
      const price = parseFloat(t.lastPrice) || 0;
      const change = parseFloat(t.priceChangePercent) || 0;
      const vol = parseFloat(t.quoteVolume) || 0;
      return { symbol, price, change, vol, high: parseFloat(t.highPrice) || 0, low: parseFloat(t.lowPrice) || 0 };
    })
    // meme / high-beta: big 24h move + decent quote volume
    .filter((t) => Math.abs(t.change) >= 5 && t.vol >= 500_000)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.vol - a.vol)
    .slice(0, limit);

  const pairs = movers.map((t) => ({
    chainId: 'bsc',
    dexId: 'binance-spot',
    url: `https://www.binance.com/en/trade/${t.symbol}_USDT`,
    pairAddress: `binance:${t.symbol}USDT`,
    baseToken: { address: `binance-${t.symbol}`, name: t.symbol, symbol: t.symbol },
    quoteToken: { address: '', name: 'USDT', symbol: 'USDT' },
    priceUsd: String(t.price),
    txns: { h1: { buys: 0, sells: 0 }, h24: { buys: 0, sells: 0 } },
    volume: { h1: 0, h24: t.vol },
    priceChange: { h1: 0, h24: t.change },
    liquidity: { usd: t.vol },
    fdv: 0,
    marketCap: 0,
    pairCreatedAt: 0,
    _source: 'binance-spot',
  }));

  return { pairs, sourcesUsed: pairs.length ? ['binance-spot'] : [], error: null };
}

/**
 * Full public BSC board for memecoin terminal:
 *   1) Pancake / BSC DEX pools (primary — Binance ecosystem on-chain)
 *   2) Binance spot movers only as thin-board fill (synthetic addr; client filters them)
 */
async function getBscPublicBoard(limit = 40) {
  const pancake = await getPancakeAndBscPools(limit);
  const pairs = [];
  const seen = new Set();
  for (const p of pancake.pairs || []) {
    const key = (p.baseToken?.address || p.pairAddress || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    pairs.push(p);
    if (pairs.length >= limit) break;
  }

  // Only pull CEX movers if on-chain DEX board is thin (e.g. GT rate-limit)
  let spot = { pairs: [], sourcesUsed: [], error: null };
  if (pairs.length < Math.min(12, limit)) {
    spot = await getBinanceSpotMovers(Math.min(15, limit - pairs.length));
    for (const p of spot.pairs || []) {
      const key = (p.baseToken?.address || p.pairAddress || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      pairs.push(p);
      if (pairs.length >= limit) break;
    }
  }

  return {
    pairs,
    sourcesUsed: [...(pancake.sourcesUsed || []), ...(spot.sourcesUsed || [])],
    errors: [...(pancake.errors || []), ...(spot.error ? [spot.error] : [])],
  };
}

export { getPancakeAndBscPools, getBinanceSpotMovers, getBscPublicBoard };

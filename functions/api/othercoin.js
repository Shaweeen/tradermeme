/**
 * Altcoin API (legacy path: /api/othercoin) — Cloudflare Pages Function
 *
 * Independent from Memecoin. 报警收集（零付费主路径）:
 *   主源 Binance + Bybit + OKX 公开永续（无需 key）
 *   硬门：周成交量环比连涨 2 周 · 排除 BTC · Top 20 · 多所合并
 *   叠加：OI · 资金费率异常
 *   补充：DefiLlama 免费 DEX 全市场热度（非合约硬门）
 *   可选：COINGLASS_API_KEY / CLAWBY_API_KEY（有则用，无则忽略）
 *
 * Memecoin SignalEngine / Monitor heat is NOT used here.
 */

import {
  ALTCOIN_SIGNAL_RULES,
  buildPrimaryEnvFromBybit,
  fetchClawbyDerivsSnapshot,
  fuseContractEnvironment,
  rankSignalsWithEnv,
  enrichTopSignalsWithClawbyDepth,
  buildEnvListGuidance,
  deriveActionAdvice,
  collectWeeklyVolumeAlerts,
} from './_altcoin.js';
import { collectBinanceWeeklyAlerts, mergeVenueAlertRows } from './_altcoin_binance.js';
import { collectOkxWeeklyAlerts } from './_altcoin_okx.js';
import { fetchDefiLlamaDexHeat, attachDefiLlamaHints } from './_altcoin_defillama.js';
import { collectCoinglassWeeklyAlerts } from './_altcoin_coinglass.js';

const BYBIT_BASE = 'https://api.bybit.com';
const BINANCE_BASE = 'https://api.binance.com';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// ===== Scan config (rules live in _altcoin.js ALTCOIN_SIGNAL_RULES) =====
const SIGNAL_CONFIG = {
  maxResults: ALTCOIN_SIGNAL_RULES.maxResults,
  scanDepth: 150,
};

// Known stablecoins and LPs to filter out
const FILTER_OUT = new Set([
  'usdt', 'usdc', 'dai', 'busd', 'tusd', 'usdp', 'fdusd',
  'usdd', 'gusd', 'lusd', 'lusd', 'husd', 'susd', 'ousd',
  'mkusd', 'crvusd', 'frax', 'lusd', 'alUSD', 'mim',
  'ust', 'ustc', 'eurs', 'eurt', 'ceur', 'eurc', 'eurs',
  'pyusd', 'usdce', 'steth', 'weth', 'wbtc', 'wsteth',
  'reth', 'sfrxeth', 'wbeth', 'cbeth', 'ankreth',
]);

/** Fetch with timeout */
async function safeFetch(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() =>controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return res.json();
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Fetch all USDT perpetual tickers from Bybit
 * Returns funding rate, OI, mark price, 24h change for each pair
 */
async function getBybitTickers() {
  const data = await safeFetch(`${BYBIT_BASE}/v5/market/tickers?category=linear`);
  if (!data?.result?.list) return [];

  return data.result.list
    .filter((t) =>t.symbol?.endsWith('USDT') && !t.symbol.includes('USDC'))
    .map((t) => ({
      symbol: t.symbol.replace('USDT', ''),
      rawSymbol: t.symbol,
      price: parseFloat(t.lastPrice) || 0,
      price24hPcnt: parseFloat(t.price24hPcnt) || 0,
      volume24h: parseFloat(t.volume24h) || 0,
      turnover24h: parseFloat(t.turnover24h) || 0,
      fundingRate: parseFloat(t.fundingRate) || 0,
      nextFundingTime: t.nextFundingTime ? parseInt(t.nextFundingTime) : null,
      openInterest: parseFloat(t.openInterest) || 0,
      markPrice: parseFloat(t.markPrice) || 0,
      indexPrice: parseFloat(t.indexPrice) || 0,
      high24h: parseFloat(t.highPrice24h) || 0,
      low24h: parseFloat(t.lowPrice24h) || 0,
      source: 'bybit',
    }));
}

/**
 * Fetch Binance 24hr tickers for volume/price verification
 */
async function getBinanceTickers() {
  const data = await safeFetch(`${BINANCE_BASE}/api/v3/ticker/24hr`);
  if (!Array.isArray(data)) return [];

  const map = {};
  for (const t of data) {
    const symbol = t.symbol?.replace('USDT', '');
    if (t.symbol?.endsWith('USDT') && symbol !== t.symbol) {
      map[symbol] = {
        symbol,
        price: parseFloat(t.lastPrice) || 0,
        priceChange: parseFloat(t.priceChangePercent) || 0,
        volume: parseFloat(t.volume) || 0,
        quoteVolume: parseFloat(t.quoteVolume) || 0,
        high: parseFloat(t.highPrice) || 0,
        low: parseFloat(t.lowPrice) || 0,
        source: 'binance',
      };
    }
  }
  return map;
}

/**
 * Fetch top coins from CoinGecko for metadata
 */
async function getCoinGeckoTop(limit = 150) {
  const data = await safeFetch(
    `${COINGECKO_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false`
  );
  if (!Array.isArray(data)) return {};
  const map = {};
  for (const c of data) {
    const symbol = (c.symbol || '').toLowerCase();
    map[symbol] = {
      id: c.id,
      symbol: (c.symbol || '').toUpperCase(),
      name: c.name || '',
      image: c.image || '',
      marketCap: c.market_cap || 0,
      marketCapRank: c.market_cap_rank || 999,
      totalVolume: c.total_volume || 0,
      priceUsd: c.current_price || 0,
      source: 'coingecko',
    };
  }
  return map;
}

function formatCompact(num) {
  if (!num || isNaN(num)) return '$0';
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

/**
 * Score Robinhood Chain (DexScreener) pairs for Othercoin monitoring.
 * Uses volume + 24h price move + liquidity — no CEX funding on this L2 yet.
 */
function scoreRobinhoodPair(pair, index = 0) {
  const symbol = (pair.baseToken?.symbol || '').toUpperCase();
  const name = pair.baseToken?.name || symbol;
  const address = pair.baseToken?.address || pair.pairAddress || '';
  if (!symbol || !address) return null;
  if (FILTER_OUT.has(symbol.toLowerCase())) return null;

  const price = parseFloat(pair.priceUsd) || 0;
  const priceChange24h = parseFloat(pair.priceChange?.h24) || 0;
  const volume24h = parseFloat(pair.volume?.h24) || 0;
  const liquidity = parseFloat(pair.liquidity?.usd) || 0;
  const fdv = parseFloat(pair.fdv) || 0;
  const buys = parseInt(pair.txns?.h24?.buys) || 0;
  const sells = parseInt(pair.txns?.h24?.sells) || 0;

  if (volume24h < 5000 && liquidity < 3000) return null;

  const signals = [];
  let score = 0;

  const absPct = Math.abs(priceChange24h);
  if (absPct >= 5) {
    const sev = Math.min(absPct / 20, 5);
    score += sev * 14;
    signals.push({
      type: 'price',
      label: '价格异动',
      detail: `${priceChange24h >0 ? '+' : ''}${priceChange24h.toFixed(2)}% · Robinhood 链`,
      severity: Math.min(sev, 5),
    });
  }
  if (volume24h >= 20000) {
    const sev = Math.min(volume24h / 500000, 5);
    score += sev * 12;
    signals.push({
      type: 'volume',
      label: '链上成交',
      detail: formatCompact(volume24h),
      severity: Math.min(sev, 5),
    });
  }
  if (liquidity >= 10000) {
    const sev = Math.min(liquidity / 200000, 4);
    score += sev * 8;
    signals.push({
      type: 'oi',
      label: '流动性',
      detail: formatCompact(liquidity),
      severity: Math.min(sev, 4),
    });
  }
  if (buys + sells >= 50) {
    score += Math.min((buys + sells) / 100, 3) * 6;
    signals.push({
      type: 'funding',
      label: '交易活跃',
      detail: `${buys + sells} tx / 24h`,
      severity: 2,
    });
  }

  if (signals.length === 0) {
    // Still surface nascent RH tokens with any liquidity
    score = 5 + Math.min(volume24h / 10000, 10);
    signals.push({
      type: 'volume',
      label: 'Robinhood 新池',
      detail: formatCompact(volume24h || liquidity),
      severity: 1,
    });
  }

  if (signals.length >= 3) score *= 1.15;

  return {
    rank: index + 1,
    address,
    symbol,
    name,
    icon: `https://dd.dexscreener.com/ds-data/tokens/robinhood/${address}.png`,
    chain: 'robinhood',
    priceUsd: price,
    priceChange24h,
    volume24h,
    liquidity,
    fdv,
    marketCap: fdv,
    marketCapRank: 999,
    signalScore: Math.round(score * 10) / 10,
    signalCount: signals.length,
    signals,
    strongestSignal: signals[0]?.type || 'volume',
    strongestLabel: signals[0]?.label || 'Robinhood',
    strongestDetail: signals[0]?.detail || '',
    fundingRate: 0,
    openInterest: 0,
    source: 'dexscreener-robinhood',
    txns1h: {
      buys: parseInt(pair.txns?.h1?.buys) || 0,
      sells: parseInt(pair.txns?.h1?.sells) || 0,
      total: (parseInt(pair.txns?.h1?.buys) || 0) + (parseInt(pair.txns?.h1?.sells) || 0),
    },
    txns24h: { buys, sells, total: buys + sells },
    url: pair.url || `https://dexscreener.com/robinhood/${address}`,
    pairAddress: pair.pairAddress || '',
    dexId: pair.dexId || '',
  };
}

async function scanRobinhoodChainSignals(limit = SIGNAL_CONFIG.maxResults) {
  try {
    const dex = await import('./_dexscreener.js');
    const { tokens } = await dex.getTrendingPairs('robinhood', Math.max(limit * 2, 30));
    if (!Array.isArray(tokens) || tokens.length === 0) return [];

    const scored = [];
    for (const pair of tokens) {
      const row = scoreRobinhoodPair(pair);
      if (row) scored.push(row);
    }
    return scored
      .sort((a, b) => (b.signalScore || 0) - (a.signalScore || 0))
      .slice(0, limit)
      .map((row, i) => ({ ...row, rank: i + 1 }));
  } catch (e) {
    console.error('Robinhood chain scan error:', e.message || e);
    return [];
  }
}

// Prefer major L1/L2 + liquid DEXes for user-facing chart pages
const DEX_CHAIN_PREF = {
  ethereum: 100,
  base: 95,
  bsc: 90,
  solana: 88,
  arbitrum: 70,
  optimism: 65,
  polygon: 55,
  avalanche: 50,
  robinhood: 80,
};
const DEX_ID_PREF = {
  uniswap: 30,
  'uniswap v3': 32,
  'uniswap v2': 28,
  pancakeswap: 28,
  'pancakeswap v3': 30,
  'pancakeswap v2': 26,
  raydium: 28,
  orca: 22,
  aerodrome: 24,
  sushiswap: 18,
  camelot: 16,
};

function isQuoteLikeSymbol(sym) {
  const s = String(sym || '').toUpperCase();
  // Pure stables / gas wrappers as quote — but allow as base when user searches majors
  return [
    'USDT', 'USDC', 'USD', 'DAI', 'BUSD', 'FDUSD', 'STETH', 'WSTETH',
  ].includes(s);
}

/**
 * Pick best DexScreener pair for a ticker — page like:
 *   https://dexscreener.com/base/0x7af45d...
 * Shows icon, token info, mcap, Uniswap pair, live trades.
 */
function pickBestDexPair(pairs, symbol) {
  const want = String(symbol || '').toUpperCase().replace(/USDT$/i, '');
  if (!Array.isArray(pairs) || !want) return null;

  const candidates = pairs.filter((p) => {
    const baseSym = String(p.baseToken?.symbol || '').toUpperCase();
    const quoteSym = String(p.quoteToken?.symbol || '').toUpperCase();
    if (isQuoteLikeSymbol(baseSym)) return false;
    // exact or close symbol match on base
    if (baseSym !== want && baseSym !== `${want}X` && !baseSym.startsWith(want)) return false;
    if (baseSym.length >want.length + 4) return false;
    // prefer stable/native quotes
    const okQuote = isQuoteLikeSymbol(quoteSym) || ['ETH', 'WETH', 'BNB', 'SOL', 'USDC', 'USDT'].includes(quoteSym);
    return okQuote || (parseFloat(p.liquidity?.usd) || 0) >50_000;
  });

  const pool = candidates.length ? candidates : pairs.filter((p) => {
    const baseSym = String(p.baseToken?.symbol || '').toUpperCase();
    return baseSym === want && !isQuoteLikeSymbol(baseSym);
  });

  if (!pool.length) return null;

  pool.sort((a, b) => {
    const score = (p) => {
      const liq = parseFloat(p.liquidity?.usd) || 0;
      const vol = parseFloat(p.volume?.h24) || 0;
      const chainBoost = DEX_CHAIN_PREF[String(p.chainId || '').toLowerCase()] || 10;
      const dexKey = String(p.dexId || '').toLowerCase();
      let dexBoost = 0;
      for (const [k, v] of Object.entries(DEX_ID_PREF)) {
        if (dexKey.includes(k)) { dexBoost = Math.max(dexBoost, v); }
      }
      // Strongly prefer ethereum/base/bsc/solana so Uniswap-style pages surface first
      return liq + vol * 0.5 + chainBoost * 5e6 + dexBoost * 2e5;
    };
    return score(b) - score(a);
  });

  return pool[0];
}

/** Major CEX tickers → search term that lands a real Uniswap/DEX pair page */
const MAJOR_DEX_QUERY = {
  BTC: 'WBTC USDC',
  ETH: 'WETH USDC',
  SOL: 'SOL USDC',
  XRP: 'XRP USDC',
  BNB: 'WBNB USDT',
  DOGE: 'DOGE USDC',
  ADA: 'ADA USDC',
  AVAX: 'AVAX USDC',
  LINK: 'LINK USDC',
  DOT: 'DOT USDC',
  MATIC: 'POL USDC',
  POL: 'POL USDC',
  ARB: 'ARB USDC',
  OP: 'OP USDC',
  PEPE: 'PEPE USDC',
  WIF: 'WIF USDC',
  BONK: 'BONK USDC',
};

/**
 * Resolve symbol → DexScreener token/pair chart URL + on-chain fields.
 * Target UX: https://dexscreener.com/{chain}/{pairOrToken}
 * Example: https://dexscreener.com/base/0x7af45dfaf2fdea139b2295f37ffea2e16e6fd8ba
 */
async function resolveDexScreenerChart(symbol) {
  const q = String(symbol || '').replace(/USDT$/i, '').trim();
  if (!q) return null;
  const pickSym = {
    BTC: 'WBTC', ETH: 'WETH', BNB: 'WBNB', SOL: 'SOL',
  }[q.toUpperCase()] || q;

  // At most 2 searches per symbol (latency budget for 10 parallel rows)
  const queries = [
    MAJOR_DEX_QUERY[q.toUpperCase()] || q,
    MAJOR_DEX_QUERY[q.toUpperCase()] ? null : `${q} USDC`,
  ].filter(Boolean);

  let best = null;
  for (const searchQ of queries) {
    const data = await safeFetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(searchQ)}`,
      10000
    );
    const pairs = data?.pairs || [];
    best = pickBestDexPair(pairs, pickSym) || pickBestDexPair(pairs, q);
    if (best) break;
  }
  if (!best) return null;

  const chainId = String(best.chainId || '').toLowerCase();
  const pairAddress = best.pairAddress || '';
  const tokenAddress = best.baseToken?.address || '';
  // Prefer pair page (Uniswap pool + live trades). Fallback: token page.
  const pathAddr = pairAddress || tokenAddress;
  if (!chainId || !pathAddr) return null;

  const chartUrl = best.url || `https://dexscreener.com/${chainId}/${pathAddr}`;
  const buys = parseInt(best.txns?.h24?.buys) || 0;
  const sells = parseInt(best.txns?.h24?.sells) || 0;
  const h1Buys = parseInt(best.txns?.h1?.buys) || 0;
  const h1Sells = parseInt(best.txns?.h1?.sells) || 0;

  return {
    chartUrl,
    chainId,
    pairAddress,
    tokenAddress,
    dexId: best.dexId || '',
    pairLabel: `${best.baseToken?.symbol || q}/${best.quoteToken?.symbol || ''}`.replace(/\/$/, ''),
    icon: best.info?.imageUrl || best.baseToken?.icon || '',
    name: best.baseToken?.name || '',
    priceUsd: parseFloat(best.priceUsd) || 0,
    priceChange24h: parseFloat(best.priceChange?.h24) || 0,
    volume24h: parseFloat(best.volume?.h24) || 0,
    liquidity: parseFloat(best.liquidity?.usd) || 0,
    fdv: parseFloat(best.fdv) || 0,
    marketCap: parseFloat(best.marketCap) || parseFloat(best.fdv) || 0,
    txns24h: { buys, sells, total: buys + sells },
    txns1h: { buys: h1Buys, sells: h1Sells, total: h1Buys + h1Sells },
  };
}

/**
 * Attach DexScreener chart pages to every captured row so「查看」opens
 * token icon / mcap / Uniswap pair / live trades — not search or CoinGecko.
 */
async function enrichRowsWithDexCharts(rows) {
  if (!Array.isArray(rows) || !rows.length) return rows;

  const enriched = await Promise.all(
    rows.map(async (row) => {
      // Already a proper chain chart URL (e.g. Robinhood pair)
      const existing = String(row.url || '');
      const hasChartPath =
        /dexscreener\.com\/[a-z0-9-]+\/0x[a-fA-F0-9]{40}/i.test(existing) ||
        /dexscreener\.com\/[a-z0-9-]+\/[1-9A-HJ-NP-Za-km-z]{32,}/.test(existing);
      if (hasChartPath && row.pairAddress) return row;

      // On-chain rows with pair/token address → normalize URL
      const chain = String(row.chain || '').toLowerCase();
      const pairOrToken = row.pairAddress || row.address || '';
      const looksOnChain =
        /^0x[a-fA-F0-9]{40}$/i.test(pairOrToken) ||
        (pairOrToken.length >= 32 && !/^[A-Z0-9]{2,20}$/.test(pairOrToken));
      if (looksOnChain && chain && chain !== 'multi') {
        return {
          ...row,
          address: row.address && row.address.startsWith('0x') ? row.address : pairOrToken,
          pairAddress: row.pairAddress || pairOrToken,
          url: existing.includes('dexscreener.com')
            ? existing
            : `https://dexscreener.com/${chain}/${row.pairAddress || pairOrToken}`,
          chartReady: true,
        };
      }

      // CEX symbol → resolve best Uniswap/DEX pair chart
      try {
        const dex = await resolveDexScreenerChart(row.symbol);
        if (!dex) {
          return {
            ...row,
            url: `https://dexscreener.com/search?q=${encodeURIComponent(row.symbol || '')}`,
            chartReady: false,
          };
        }
        return {
          ...row,
          // Keep CEX signal price if present; fill gaps from DEX
          address: dex.tokenAddress || row.address,
          pairAddress: dex.pairAddress,
          chain: dex.chainId || row.chain,
          name: row.name && row.name !== row.symbol ? row.name : (dex.name || row.name),
          icon: row.icon || dex.icon,
          url: dex.chartUrl,
          dexId: dex.dexId,
          pairLabel: dex.pairLabel,
          liquidity: dex.liquidity || row.liquidity,
          fdv: dex.fdv || row.fdv,
          marketCap: dex.marketCap || row.marketCap,
          // Prefer live DEX volume/txns for chart context when strong
          volume24h: Math.max(row.volume24h || 0, dex.volume24h || 0),
          txns24h: dex.txns24h?.total ? dex.txns24h : row.txns24h,
          txns1h: dex.txns1h?.total ? dex.txns1h : row.txns1h,
          chartReady: true,
          source: row.source ? `${row.source}+dex-chart` : 'dex-chart',
        };
      } catch (e) {
        console.warn('Dex chart resolve fail', row.symbol, e.message || e);
        return {
          ...row,
          url: `https://dexscreener.com/search?q=${encodeURIComponent(row.symbol || '')}`,
          chartReady: false,
        };
      }
    })
  );

  return enriched;
}

/**
 * Main scanner: 合约环境 + redesigned signals (+ optional Clawby).
 * @param {string} chainFilter - multi | robinhood | all
 * @param {{ clawbyKey?: string }} options
 * @returns {{ rows: Array, environment: object|null, meta: object }}
 */
async function scanSignals(chainFilter = 'all', options = {}) {
  const wantCex = chainFilter === 'all' || chainFilter === 'multi' || !chainFilter;
  const wantRh = chainFilter === 'all' || chainFilter === 'robinhood' || !chainFilter;
  const clawbyKey = options.clawbyKey || '';

  let environment = null;
  let bybitTickers = [];
  let binanceMap = {};
  let geckoMeta = {};
  let clawbySnap = { available: false, reason: 'skipped', coins: {} };

  if (wantCex) {
    const [bybit, binance, gecko, clawby] = await Promise.all([
      getBybitTickers(),
      getBinanceTickers(),
      getCoinGeckoTop(SIGNAL_CONFIG.scanDepth),
      clawbyKey
        ? fetchClawbyDerivsSnapshot(clawbyKey, { coins: ['BTC', 'ETH'] })
        : Promise.resolve({ available: false, reason: 'no-clawby-key', coins: {} }),
    ]);
    bybitTickers = bybit;
    binanceMap = binance;
    geckoMeta = gecko;
    clawbySnap = clawby;

    const primary = buildPrimaryEnvFromBybit(bybitTickers);
    environment = fuseContractEnvironment(primary, clawbySnap);
  }

  // ── CEX 硬门: 周量连涨2周 · 除BTC · Top20 ──
  // 默认：Binance（公开）+ Bybit 合并；可选 CoinGlass；DefiLlama 仅热度补充
  let cexRows = [];
  let weeklyMeta = {};
  let defillamaHeat = null;
  const coinglassKey = options.coinglassKey || '';
  if (wantCex) {
    const [bnPack, bybitPack, okxPack, llamaPack, cgPack] = await Promise.all([
      collectBinanceWeeklyAlerts({
        env: environment,
        geckoMeta,
        binanceMap,
      }),
      collectWeeklyVolumeAlerts({
        bybitTickers,
        binanceMap,
        geckoMeta,
        env: environment,
        fetcher: safeFetch,
      }),
      collectOkxWeeklyAlerts({
        env: environment,
        geckoMeta,
        binanceMap,
      }),
      fetchDefiLlamaDexHeat().catch(() => ({ ok: false })),
      coinglassKey
        ? collectCoinglassWeeklyAlerts({
            apiKey: coinglassKey,
            env: environment,
            geckoMeta,
            binanceMap,
            fetcher: safeFetch,
          })
        : Promise.resolve(null),
    ]);

    defillamaHeat = llamaPack?.ok ? llamaPack : { ok: false };

    const venueLists = [];
    if (bnPack?.rows?.length) venueLists.push(bnPack.rows);
    if (bybitPack?.rows?.length) venueLists.push(bybitPack.rows);
    if (okxPack?.rows?.length) venueLists.push(okxPack.rows);
    // CoinGlass optional only — never required
    if (cgPack?.meta?.ok && cgPack.rows?.length) venueLists.push(cgPack.rows);

    let mergedRows = mergeVenueAlertRows(venueLists, environment);
    if (defillamaHeat?.ok) {
      mergedRows = attachDefiLlamaHints(mergedRows, defillamaHeat);
    }

    const primary =
      bnPack?.meta?.ok
        ? 'binance'
        : bybitPack?.rows?.length
          ? 'bybit'
          : okxPack?.meta?.ok
            ? 'okx'
            : 'none';

    weeklyMeta = {
      ok: mergedRows.length > 0,
      primary,
      venues: {
        binance: {
          ok: !!bnPack?.meta?.ok,
          collected: bnPack?.rows?.length || 0,
          passed: bnPack?.meta?.passedWeeklyGate,
        },
        bybit: {
          ok: (bybitPack?.rows || []).length > 0,
          collected: bybitPack?.rows?.length || 0,
          passed: bybitPack?.meta?.passedWeeklyGate,
        },
        okx: {
          ok: !!okxPack?.meta?.ok,
          collected: okxPack?.rows?.length || 0,
          passed: okxPack?.meta?.passedWeeklyGate,
        },
        coinglass: coinglassKey
          ? {
              ok: !!cgPack?.meta?.ok,
              collected: cgPack?.rows?.length || 0,
              optional: true,
            }
          : { ok: false, reason: 'not-configured', optional: true },
      },
      defillama: defillamaHeat?.ok
        ? {
            ok: true,
            change_7d: defillamaHeat.change_7d,
            change_1d: defillamaHeat.change_1d,
            total24h: defillamaHeat.total24h,
            tone: defillamaHeat.tone,
            note: defillamaHeat.note,
          }
        : { ok: false },
      gate: 'two-week-volume-up-ex-btc',
      rulesVersion: 'altcoin-free-multi-venue-v3',
      needsKey: false,
      note: '主路径无需付费 key：Binance + Bybit + OKX；DefiLlama 为链上热度补充',
    };

    cexRows = mergedRows.map((coin, i) => ({
      rank: i + 1,
      address: `${coin.symbol}`,
      symbol: coin.symbol,
      name: coin.name,
      icon: coin.icon,
      chain: 'multi',
      priceUsd: coin.price,
      priceChange24h: coin.priceChange24h,
      volume24h: coin.volume24h,
      liquidity: coin.marketCap || coin.volume24h,
      fdv: coin.marketCap || 0,
      marketCap: coin.marketCap,
      marketCapRank: coin.marketCapRank,
      signalScore: coin.score,
      signalCount: coin.signalCount,
      signals: coin.signals,
      strongestSignal: coin.strongestSignal,
      strongestLabel: coin.strongestLabel,
      strongestDetail: coin.strongestDetail,
      setupBias: coin.setupBias || '',
      confirms: coin.confirms,
      envRegime: coin.envRegime || environment?.regime || null,
      envScore: coin.envScore ?? environment?.envScore ?? null,
      action: coin.action || 'watch',
      actionLabel: coin.actionLabel || '观察',
      actionPriority: coin.actionPriority ?? 40,
      actionReason: coin.actionReason || '',
      rulesVersion: coin.rulesVersion || weeklyMeta.rulesVersion,
      fundingRate: coin.fundingRate,
      openInterest: coin.openInterest,
      weeklyVolume: coin.weeklyVolume || null,
      volumeGrowthRankKey: coin.volumeGrowthRankKey,
      weeklySource: coin.weeklySource,
      venues: coin.venues || null,
      multiVenue: !!coin.multiVenue,
      binanceAgreement: coin.binanceAgreement || null,
      coinglass: coin.coinglass || null,
      defillama: coin.defillama || null,
      source: coin.source || 'multi-venue-weekly-v3',
      txns1h: { buys: 0, sells: 0, total: 0 },
      txns24h: { buys: 0, sells: 0, total: 0 },
      url: '',
      geckoId: coin.geckoId || null,
    }));
  }

  // Robinhood optional (not part of weekly-vol gate; appended only for chain=all)
  let rhRows = [];
  if (wantRh) {
    rhRows = await scanRobinhoodChainSignals(Math.min(8, SIGNAL_CONFIG.maxResults));
  }

  // Top CEX rows → optional Clawby per-symbol depth
  let cexEnriched = cexRows;
  let depthCount = 0;
  if (wantCex && clawbyKey && cexRows.length) {
    const bybitFundingBySymbol = {};
    for (const t of bybitTickers) {
      bybitFundingBySymbol[String(t.symbol).toUpperCase()] = Number(t.fundingRate) || 0;
    }
    const deepened = await enrichTopSignalsWithClawbyDepth(clawbyKey, cexRows, {
      topN: ALTCOIN_SIGNAL_RULES.clawbyDepthTopN,
      bybitFundingBySymbol,
    });
    cexEnriched = deepened.rows;
    depthCount = deepened.depthCount;
  }

  const merged = [...cexEnriched, ...rhRows].map((row) => {
    if (row.action) return row;
    const advice = deriveActionAdvice(
      {
        setupBias: row.setupBias,
        score: row.signalScore ?? row.score,
        envRegime: environment?.regime,
      },
      environment
    );
    return { ...row, ...advice };
  });

  // CEX already top-20 by volume growth; keep growth rank primary for multi-only
  const sorted = (wantCex && !wantRh
    ? merged.sort((a, b) => {
        const cg = Number(b.volumeGrowthRankKey || 0) - Number(a.volumeGrowthRankKey || 0);
        if (Math.abs(cg) > 0.01) return cg;
        const ap = (b.actionPriority || 0) - (a.actionPriority || 0);
        if (ap !== 0) return ap;
        return (b.signalScore ?? b.score ?? 0) - (a.signalScore ?? a.score ?? 0);
      })
    : rankSignalsWithEnv(merged, environment)
  )
    .slice(0, SIGNAL_CONFIG.maxResults)
    .map((row, i) => ({ ...row, rank: i + 1, signalScore: row.score ?? row.signalScore }));

  const rows = await enrichRowsWithDexCharts(sorted);
  const guidance = buildEnvListGuidance(environment);
  // Override guidance to state collection rule clearly
  const bnN = weeklyMeta.venues?.binance?.collected ?? 0;
  const bbN = weeklyMeta.venues?.bybit?.collected ?? 0;
  const okxN = weeklyMeta.venues?.okx?.collected ?? 0;
  const llamaNote = weeklyMeta.defillama?.ok ? ` · ${weeklyMeta.defillama.note}` : '';
  const gateGuide = {
    tone: guidance?.tone || weeklyMeta.defillama?.tone || 'neutral',
    text: `收集：Binance+Bybit+OKX 公开合约 · 除 BTC · 周量连涨2周 · Top ${ALTCOIN_SIGNAL_RULES.maxResults}（BN ${bnN}/BB ${bbN}/OKX ${okxN}）${llamaNote}${guidance?.text ? ' · ' + guidance.text : ''}`,
  };

  if (environment) {
    environment.listGuidance = gateGuide;
    if (defillamaHeat?.ok) {
      environment.defillama = {
        total24h: defillamaHeat.total24h,
        change_1d: defillamaHeat.change_1d,
        change_7d: defillamaHeat.change_7d,
        tone: defillamaHeat.tone,
        note: defillamaHeat.note,
      };
    }
  }

  return {
    rows,
    environment,
    meta: {
      rulesVersion: weeklyMeta.rulesVersion || 'altcoin-free-multi-venue-v3',
      gate: weeklyMeta.gate || 'two-week-volume-up-ex-btc',
      weekly: weeklyMeta,
      coinglass: weeklyMeta.venues?.coinglass || { ok: false, optional: true },
      defillama: weeklyMeta.defillama || { ok: false },
      clawby: clawbySnap.available
        ? { ok: true, depthCount, depthTopN: ALTCOIN_SIGNAL_RULES.clawbyDepthTopN }
        : { ok: false, reason: clawbySnap.reason || 'unavailable', depthCount: 0 },
      primarySource: 'binance+bybit+okx',
      secondarySource: clawbySnap.available ? 'clawby' : null,
      validateSource: 'multi-venue-merge',
      needsKey: false,
      listGuidance: gateGuide,
      actionCounts: {
        prefer: rows.filter((r) => r.action === 'prefer').length,
        watch: rows.filter((r) => r.action === 'watch').length,
        fade: rows.filter((r) => r.action === 'fade').length,
      },
    },
  };
}

/**
 * Handle API requests
 */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (url.pathname === '/api/othercoin' && request.method === 'GET') {
    try {
      const rawChain = (url.searchParams.get('chain') || 'multi').toLowerCase();
      // Default multi for Altcoin page; RH only when explicit
      let chainFilter = 'multi';
      if (rawChain === 'robinhood') chainFilter = 'robinhood';
      else if (rawChain === 'multi' || rawChain === 'futures' || rawChain === 'cex') chainFilter = 'multi';
      else if (rawChain === 'all') chainFilter = 'all';
      else if (['solana', 'ethereum', 'base', 'bsc'].includes(rawChain)) chainFilter = 'multi';

      const clawbyKey =
        env?.CLAWBY_API_KEY ||
        env?.CLAWBY_KEY ||
        (typeof process !== 'undefined' ? process.env?.CLAWBY_API_KEY : '') ||
        '';
      const coinglassKey =
        env?.COINGLASS_API_KEY ||
        env?.COINGLASS_KEY ||
        (typeof process !== 'undefined' ? process.env?.COINGLASS_API_KEY : '') ||
        '';

      const { rows, environment, meta } = await scanSignals(chainFilter, {
        clawbyKey,
        coinglassKey,
      });
      const sources = [...new Set(rows.map((r) => r.source).filter(Boolean))];
      return new Response(
        JSON.stringify({
          success: true,
          source: sources.join('+') || ALTCOIN_SIGNAL_RULES.rulesVersion,
          chain: chainFilter,
          count: rows.length,
          timestamp: Date.now(),
          // 合约环境面板（BTC/ETH 杠杆面 + 可选 Clawby 第二源）
          environment,
          meta,
          data: rows,
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, s-maxage=30',
            ...corsHeaders,
          },
        }
      );
    } catch (e) {
      console.error('Othercoin scan error:', e);
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

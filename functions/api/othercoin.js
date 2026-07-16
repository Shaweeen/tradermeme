/**
 * Othercoin API - Cloudflare Pages Function
 *
 * Signal-based coin scanner. Dynamically discovers coins with strong signals
 * from funding rate, price action, volume, and open interest data.
 * No hardcoded coin list — detects signals across all available pairs.
 *
 * Data Sources:
 *   - Bybit API: Funding rates, OI, mark prices for all USDT perpetuals
 *   - Binance API: 24hr ticker data for volume/price verification
 *   - CoinGecko API: Metadata (name, logo, market cap) for discovered coins
 *   - DexScreener: Robinhood Chain (and optional other L2) on-chain pairs
 *
 * Endpoints:
 *   GET /api/othercoin                - CEX futures signals + Robinhood chain
 *   GET /api/othercoin?chain=multi    - CEX futures only
 *   GET /api/othercoin?chain=robinhood - Robinhood Chain only
 *   GET /api/othercoin?chain=all      - same as default (multi + robinhood)
 */

const BYBIT_BASE = 'https://api.bybit.com';
const BINANCE_BASE = 'https://api.binance.com';
const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// ===== Signal Thresholds =====
const SIGNAL_CONFIG = {
  fundingRateMin: 0.0001,    // 0.01% — anomalous funding rate
  fundingRateMax: 0.001,     // 0.1% — extreme funding rate
  priceSurgeMin: 8,          // 8% — minimum 24h price move to flag
  priceSurgeMax: 100,        // 100% — max reasonable move
  oiMin: 500000,             // $500K — minimum OI to consider
  volumeMin: 100000,         // $100K — minimum 24h volume
  maxResults: 10,
  scanDepth: 150,            // scan top N coins from CoinGecko
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
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    .filter((t) => t.symbol?.endsWith('USDT') && !t.symbol.includes('USDC'))
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

/**
 * Calculate composite signal score for a coin
 * Returns the score and list of triggered signal reasons
 */
function calculateSignalScore(bybitTicker, binanceData, geckoMeta) {
  const signals = [];
  let score = 0;

  const symbol = bybitTicker.symbol;
  const meta = geckoMeta[symbol.toLowerCase()];
  const binance = binanceData[symbol];

  // Skip stablecoins, staked tokens
  if (FILTER_OUT.has(symbol.toLowerCase())) return null;

  // --- Signal 1: Funding Rate Anomaly ---
  const fr = Math.abs(bybitTicker.fundingRate);
  if (fr > SIGNAL_CONFIG.fundingRateMin) {
    const frSeverity = Math.min(fr / SIGNAL_CONFIG.fundingRateMax, 3);
    score += frSeverity * 15;
    const direction = bybitTicker.fundingRate > 0 ? '多头偏高 🔥' : '空头偏高 ❄️';
    signals.push({
      type: 'funding',
      label: '资金费率',
      detail: `${(bybitTicker.fundingRate * 100).toFixed(4)}% · ${direction}`,
      severity: Math.min(frSeverity, 3),
    });
  }

  // --- Signal 2: Price Surge ---
  const pct24h = (bybitTicker.price24hPcnt * 100);
  const absPct = Math.abs(pct24h);
  if (absPct > SIGNAL_CONFIG.priceSurgeMin && absPct < SIGNAL_CONFIG.priceSurgeMax) {
    const surgeSeverity = absPct / 20;
    score += surgeSeverity * 12;
    const direction = pct24h > 0 ? '上涨 📈' : '下跌 📉';
    signals.push({
      type: 'price',
      label: '价格异动',
      detail: `${pct24h > 0 ? '+' : ''}${pct24h.toFixed(2)}% · ${direction}`,
      severity: Math.min(surgeSeverity, 5),
    });
  }

  // --- Signal 3: Volume Spike ---
  const turnover = bybitTicker.turnover24h || 0;
  const binanceVol = binance?.quoteVolume || 0;
  const maxVolume = Math.max(turnover, binanceVol);
  if (maxVolume > SIGNAL_CONFIG.volumeMin) {
    const volSeverity = Math.min(maxVolume / 10000000, 5);
    score += volSeverity * 8;
    signals.push({
      type: 'volume',
      label: '交易量激增',
      detail: formatCompact(maxVolume),
      severity: Math.min(volSeverity, 5),
    });
  }

  // --- Signal 4: OI Buildup ---
  const oi = bybitTicker.openInterest * bybitTicker.markPrice || 0;
  if (oi > SIGNAL_CONFIG.oiMin) {
    const oiSeverity = Math.min(oi / 50000000, 5);
    score += oiSeverity * 10;
    signals.push({
      type: 'oi',
      label: '持仓量 (OI)',
      detail: formatCompact(oi),
      severity: Math.min(oiSeverity, 5),
    });
  }

  // --- Bonus: Multiple signals active ---
  if (signals.length >= 3) score *= 1.2;
  if (signals.length >= 4) score *= 1.3;

  // Must have at least one signal to be included
  if (signals.length === 0) return null;

  return {
    symbol: bybitTicker.symbol,
    name: meta?.name || bybitTicker.symbol,
    icon: meta?.image || '',
    geckoId: meta?.id || null,
    marketCap: meta?.marketCap || 0,
    marketCapRank: meta?.marketCapRank || 999,
    price: bybitTicker.markPrice || bybitTicker.price || 0,
    priceChange24h: pct24h,
    volume24h: maxVolume,
    fundingRate: bybitTicker.fundingRate,
    openInterest: oi,
    score: Math.round(score * 10) / 10,
    signals,
    signalCount: signals.length,
    strongestSignal: signals[0]?.type || 'unknown',
    strongestLabel: signals[0]?.label || '',
    strongestDetail: signals[0]?.detail || '',
    timestamp: Date.now(),
    source: 'bybit+coingecko',
  };
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
      detail: `${priceChange24h > 0 ? '+' : ''}${priceChange24h.toFixed(2)}% · Robinhood 链`,
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

/**
 * Main scanner: discover coins with strongest signals
 * @param {string} chainFilter - multi | robinhood | all
 */
async function scanSignals(chainFilter = 'all') {
  const wantCex = chainFilter === 'all' || chainFilter === 'multi' || !chainFilter;
  const wantRh = chainFilter === 'all' || chainFilter === 'robinhood' || !chainFilter;

  const tasks = [];
  if (wantCex) {
    tasks.push(
      (async () => {
        const [bybitTickers, binanceMap, geckoMeta] = await Promise.all([
          getBybitTickers(),
          getBinanceTickers(),
          getCoinGeckoTop(SIGNAL_CONFIG.scanDepth),
        ]);
        const scored = [];
        for (const ticker of bybitTickers) {
          const result = calculateSignalScore(ticker, binanceMap, geckoMeta);
          if (result) scored.push(result);
        }
        return scored
          .sort((a, b) => b.score - a.score)
          .slice(0, SIGNAL_CONFIG.maxResults)
          .map((coin, i) => ({
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
            fundingRate: coin.fundingRate,
            openInterest: coin.openInterest,
            source: 'signal-scan',
            txns1h: { buys: 0, sells: 0, total: 0 },
            txns24h: { buys: 0, sells: 0, total: 0 },
            // View button → DexScreener price chart (not CoinGecko; CG pages often inactive)
            url: `https://dexscreener.com/search?q=${encodeURIComponent(coin.symbol)}`,
            geckoId: coin.geckoId || null,
          }));
      })()
    );
  } else {
    tasks.push(Promise.resolve([]));
  }

  if (wantRh) {
    tasks.push(scanRobinhoodChainSignals(SIGNAL_CONFIG.maxResults));
  } else {
    tasks.push(Promise.resolve([]));
  }

  const [cexRows, rhRows] = await Promise.all(tasks);
  const merged = [...cexRows, ...rhRows]
    .sort((a, b) => (b.signalScore ?? 0) - (a.signalScore ?? 0))
    .slice(0, chainFilter === 'all' ? SIGNAL_CONFIG.maxResults + 8 : SIGNAL_CONFIG.maxResults)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return merged;
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

  if (url.pathname === '/api/othercoin' && request.method === 'GET') {
    try {
      const rawChain = (url.searchParams.get('chain') || 'all').toLowerCase();
      // Map memecoin-style chain tabs: non-RH chains → CEX multi; RH → robinhood; all → both
      let chainFilter = 'all';
      if (rawChain === 'robinhood') chainFilter = 'robinhood';
      else if (rawChain === 'multi' || rawChain === 'futures' || rawChain === 'cex') chainFilter = 'multi';
      else if (rawChain === 'all') chainFilter = 'all';
      else if (['solana', 'ethereum', 'base', 'bsc'].includes(rawChain)) chainFilter = 'multi';

      const results = await scanSignals(chainFilter);
      const sources = [...new Set(results.map((r) => r.source).filter(Boolean))];
      return new Response(
        JSON.stringify({
          success: true,
          source: sources.join('+') || 'signal-scan',
          chain: chainFilter,
          count: results.length,
          timestamp: Date.now(),
          data: results,
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

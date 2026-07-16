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
import { applyMonitorSignalEnrichment } from './_monitor_enrichment.js';

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
  // Robinhood Chain (mainnet 4663). DexScreener: robinhood; GMGN may lag — Dex fallback always on.
  robinhood: { gmgn: 'robinhood', dexscreener: 'robinhood', label: 'Robinhood', icon: '🟢' },
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
    priceChange1h: parseFloat(t.price_1h ?? t.price_change_percent1h ?? t.price_change_percent_1h ?? t.price_change_1h) || 0,
    priceChange24h: parseFloat(t.price_24h ?? t.price_change_percent24h ?? t.price_change_percent ?? t.price_change_24h) || 0,
    volume1h: parseFloat(t.volume_1h ?? t.volume) || 0,
    volume24h: parseFloat(t.volume_24h ?? t.volume) || 0,
    liquidity: parseFloat(t.liquidity) || 0,
    fdv: parseFloat(t.fdv) || 0,
    marketCap: parseFloat(t.market_cap) || 0,
    holders: t.holder_count || 0,
    makerCount: (parseInt(t.buy_count_1h ?? t.buys) || 0) + (parseInt(t.sell_count_1h ?? t.sells) || 0),
    txns1h: {
      buys: parseInt(t.buy_count_1h ?? t.buys) || 0,
      sells: parseInt(t.sell_count_1h ?? t.sells) || 0,
      total: (parseInt(t.buy_count_1h ?? t.buys) || 0) + (parseInt(t.sell_count_1h ?? t.sells) || 0),
    },
    txns24h: {
      buys: parseInt(t.buy_count_24h ?? t.buys) || 0,
      sells: parseInt(t.sell_count_24h ?? t.sells) || 0,
      total: (parseInt(t.buy_count_24h ?? t.buys) || 0) + (parseInt(t.sell_count_24h ?? t.sells) || 0),
    },
    source: 'gmgn-openapi',
    url: `https://gmgn.ai/${gmgnSlug}/token/${t.address}`,
    firstTradeTimestamp: t.first_trade_timestamp,
    firstTradePrice: parseFloat(t.first_trade_price) || 0,
    smartBalance: parseFloat(t.smart_balance) || 0,
    smartCount: t.smart_count || t.smart_degen_count || 0,
    smartRatio: parseFloat(t.smart_ratio) || 0,
    smartNetInflow5m: parseFloat(t.smart_net_inflow_5m ?? t.smart_netflow_5m ?? t.net_inflow_5m ?? t.smart_money_net_inflow_5m) || 0,
    smartNetInflow15m: parseFloat(t.smart_net_inflow_15m ?? t.smart_netflow_15m ?? t.net_inflow_15m ?? t.smart_money_net_inflow_15m) || 0,
    volume5m: parseFloat(t.volume_5m ?? t.volume5m ?? t.volume_m5) || 0,
    volume15m: parseFloat(t.volume_15m ?? t.volume15m ?? t.volume_m15) || 0,
    newWallets5m: parseInt(t.new_wallets_5m ?? t.new_wallet_count_5m ?? t.new_wallet_5m) || 0,
    newWallets15m: parseInt(t.new_wallets_15m ?? t.new_wallet_count_15m ?? t.new_wallet_15m) || 0,
    smartWallets5m: parseInt(t.smart_wallets_5m ?? t.smart_count_5m ?? t.smart_degen_count_5m) || 0,
    smartWallets15m: parseInt(t.smart_wallets_15m ?? t.smart_count_15m ?? t.smart_degen_count_15m) || 0,
    kolWallets5m: parseInt(t.kol_wallets_5m ?? t.kol_count_5m ?? t.kol_5m) || 0,
    kolWallets15m: parseInt(t.kol_wallets_15m ?? t.kol_count_15m ?? t.kol_15m) || 0,
    top10Holders: parseFloat(t.top10 ?? t.top_10_holder_rate) || 0,
    age: t.age || '',
    isBan: t.is_ban || false,
    isRug: t.is_rug || false,
    isHoneypot: t.is_honeypot || false,
    securityChecked: false,
    hasSmartMoneyData: false,
    dataQuality: 'rank-only',
    discoverySources: ['rank'],
  }));
}

function withTimeout(promise, label, ms = 3500) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms)),
  ]);
}

/** Normalize GMGN security payload into token risk flags. */
function applySecurityPayload(token, payload) {
  if (!payload || typeof payload !== 'object') return token;
  const sec = payload.data?.data || payload.data || payload.security || payload;
  const isHoneypot = !!(sec.is_honeypot ?? sec.isHoneypot ?? sec.honeypot ?? token.isHoneypot);
  const isRug = !!(sec.is_rug ?? sec.isRug ?? sec.rug ?? token.isRug);
  const isBan = !!(sec.is_ban ?? sec.isBan ?? token.isBan);
  const top10 = parseFloat(sec.top_10_holder_rate ?? sec.top10 ?? sec.top_10 ?? token.top10Holders) || 0;
  const renounced = sec.renounced ?? sec.is_renounced;
  const canSell = sec.can_sell ?? sec.sellable;
  return {
    ...token,
    isHoneypot,
    isRug,
    isBan,
    top10Holders: top10 || token.top10Holders || 0,
    securityChecked: true,
    security: {
      renounced: renounced == null ? null : !!renounced,
      canSell: canSell == null ? null : !!canSell,
      rawFlags: {
        isHoneypot,
        isRug,
        isBan,
      },
    },
  };
}

/**
 * Enrich rank tokens with multi-group token_signal + smartmoney + kol.
 * Phase A: signal groups 12 (smart money) + 14/16 (large buys / related).
 */
async function enrichTokensWithMonitorSignals(gmgnMod, apiKey, gmgnSlug, tokens) {
  const meta = {
    signalOk: false,
    smartOk: false,
    kolOk: false,
    securityChecked: 0,
    hasSmartMoneyData: false,
  };
  if (!apiKey || !gmgnSlug || !Array.isArray(tokens) || tokens.length === 0) {
    return { tokens, meta };
  }

  // Official multi-group pattern: smart money OR large-buy style signals
  const signalGroups = [
    { signal_type: [12] },
    { signal_type: [14, 16] },
  ];

  try {
    const [signalResult, smartResult, kolResult] = await Promise.allSettled([
      withTimeout(gmgnMod.getTokenSignalV2(apiKey, gmgnSlug, signalGroups), 'token_signal', 4000),
      withTimeout(gmgnMod.getSmartMoney(apiKey, gmgnSlug, 120), 'smartmoney', 4000),
      withTimeout(gmgnMod.getKol(apiKey, gmgnSlug, 120), 'kol', 4000),
    ]);

    meta.signalOk = signalResult.status === 'fulfilled';
    meta.smartOk = smartResult.status === 'fulfilled';
    meta.kolOk = kolResult.status === 'fulfilled';
    if (!meta.signalOk) console.warn(`GMGN token_signal failed: ${signalResult.reason?.message || signalResult.reason}`);
    if (!meta.smartOk) console.warn(`GMGN smartmoney failed: ${smartResult.reason?.message || smartResult.reason}`);
    if (!meta.kolOk) console.warn(`GMGN kol failed: ${kolResult.reason?.message || kolResult.reason}`);

    let enriched = applyMonitorSignalEnrichment(tokens, {
      tokenSignals: meta.signalOk ? signalResult.value : [],
      smartTrades: meta.smartOk ? smartResult.value : [],
      kolTrades: meta.kolOk ? kolResult.value : [],
    });

    meta.hasSmartMoneyData = meta.signalOk || meta.smartOk || meta.kolOk;
    enriched = enriched.map((t) => ({
      ...t,
      hasSmartMoneyData: meta.hasSmartMoneyData,
      dataQuality: meta.hasSmartMoneyData ? 'gmgn-enriched' : 'rank-only',
    }));

    // Security for top N only (latency budget)
    const securityN = Math.min(12, enriched.length);
    const secResults = await Promise.allSettled(
      enriched.slice(0, securityN).map((t) =>
        withTimeout(gmgnMod.getTokenSecurity(apiKey, gmgnSlug, t.address), `security:${t.symbol}`, 2800)
      )
    );
    enriched = enriched.map((t, i) => {
      if (i >= securityN) return t;
      if (secResults[i].status !== 'fulfilled') return t;
      meta.securityChecked += 1;
      return applySecurityPayload(t, secResults[i].value);
    });

    return { tokens: enriched, meta };
  } catch (e) {
    console.warn(`GMGN monitor enrichment skipped: ${e.message}`);
    return {
      tokens: tokens.map((t) => ({ ...t, hasSmartMoneyData: false, dataQuality: 'rank-only' })),
      meta,
    };
  }
}

/** Merge trenches + hot_searches discovery addresses into rank list tags / append. */
async function mergeDiscoveryChannels(gmgnMod, apiKey, gmgnSlug, chain, tokens, limit) {
  const discoveryMeta = { trenches: 0, hotSearches: 0 };
  if (!apiKey || !gmgnSlug) return { tokens, discoveryMeta };

  const [trenchRes, hotRes] = await Promise.allSettled([
    withTimeout(gmgnMod.getTrenches(apiKey, gmgnSlug, { limit: 20 }), 'trenches', 4000),
    withTimeout(gmgnMod.getHotSearches(apiKey, { chain: gmgnSlug, interval: '1h', limit: 20 }), 'hot_searches', 4000),
  ]);

  const byAddr = new Map(tokens.map((t) => [String(t.address || '').toLowerCase(), t]));

  function pickList(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    const d = payload.data?.data || payload.data || payload;
    if (Array.isArray(d)) return d;
    if (Array.isArray(d?.list)) return d.list;
    if (Array.isArray(d?.rank)) return d.rank;
    if (Array.isArray(d?.tokens)) return d.tokens;
    return [];
  }

  if (trenchRes.status === 'fulfilled') {
    const list = pickList(trenchRes.value);
    discoveryMeta.trenches = list.length;
    for (const raw of list) {
      const addr = String(raw.address || raw.token_address || raw.base_address || '').toLowerCase();
      if (!addr) continue;
      const existing = byAddr.get(addr);
      if (existing) {
        existing.discoverySources = [...new Set([...(existing.discoverySources || []), 'trenches'])];
        existing.fromTrenches = true;
      } else if (byAddr.size < limit + 15) {
        const row = transformGmgnRank([raw], chain, gmgnSlug)[0];
        if (row) {
          row.discoverySources = ['trenches'];
          row.fromTrenches = true;
          row.dataQuality = 'discovery';
          byAddr.set(addr, row);
        }
      }
    }
  } else {
    console.warn(`GMGN trenches failed: ${trenchRes.reason?.message || trenchRes.reason}`);
  }

  if (hotRes.status === 'fulfilled') {
    const list = pickList(hotRes.value);
    discoveryMeta.hotSearches = list.length;
    for (const raw of list) {
      const addr = String(raw.address || raw.token_address || raw.base_address || '').toLowerCase();
      if (!addr) continue;
      const existing = byAddr.get(addr);
      if (existing) {
        existing.discoverySources = [...new Set([...(existing.discoverySources || []), 'hot_search'])];
        existing.fromHotSearch = true;
      } else if (byAddr.size < limit + 20) {
        const row = transformGmgnRank([raw], chain, gmgnSlug)[0];
        if (row) {
          row.discoverySources = ['hot_search'];
          row.fromHotSearch = true;
          row.dataQuality = 'discovery';
          byAddr.set(addr, row);
        }
      }
    }
  } else {
    console.warn(`GMGN hot_searches failed: ${hotRes.reason?.message || hotRes.reason}`);
  }

  return { tokens: Array.from(byAddr.values()), discoveryMeta };
}

/**
 * Try GMGN first, fall back to DexScreener.
 * Returns { tokens, quality } for frontend signal gating.
 */
async function getTrendingMemecoins(context, chain, limit = 30) {
  const chainsToFetch = chain === 'all' ? Object.keys(CHAIN_MAP) : [chain];
  const apiKey = context?.env?.GMGN_API_KEY || '';
  const gmgnMod = await initGmgn();
  const dexMod = await initDex();
  const quality = {
    primarySource: 'none',
    hasApiKey: !!apiKey,
    hasSmartMoneyData: false,
    securityChecked: 0,
    discovery: {},
    warnings: [],
  };

  if (!apiKey) quality.warnings.push('GMGN_API_KEY missing — using public fallback only');

  const allResults = await Promise.allSettled(
    chainsToFetch.map(async (c) => {
      const gmgnSlug = CHAIN_MAP[c]?.gmgn;
      const dexSlug = CHAIN_MAP[c]?.dexscreener;

      try {
        let tokens = [];
        let chainSmart = false;
        let chainSec = 0;

        if (gmgnSlug && apiKey) {
          try {
            const rankData = await gmgnMod.getTrendingSwaps(apiKey, gmgnSlug, '5m', { limit });
            if (Array.isArray(rankData) && rankData.length > 0) {
              tokens = transformGmgnRank(rankData, c, gmgnSlug);
              const enriched = await enrichTokensWithMonitorSignals(gmgnMod, apiKey, gmgnSlug, tokens);
              tokens = enriched.tokens;
              chainSmart = enriched.meta.hasSmartMoneyData;
              chainSec = enriched.meta.securityChecked || 0;

              const disc = await mergeDiscoveryChannels(gmgnMod, apiKey, gmgnSlug, c, tokens, limit);
              tokens = disc.tokens;
              quality.discovery[c] = disc.discoveryMeta;
              quality.primarySource = 'gmgn-openapi';
              console.log(`GMGN returned ${tokens.length} tokens for ${c} (smart=${chainSmart}, sec=${chainSec})`);
            }
          } catch (gmgnErr) {
            console.error(`GMGN error for ${c}:`, gmgnErr.message);
            quality.warnings.push(`GMGN ${c}: ${gmgnErr.message}`);
          }
        }

        if (tokens.length === 0 && dexSlug) {
          try {
            const dexData = await dexMod.getTrendingPairs(c, limit);
            if (dexData && Array.isArray(dexData.tokens) && dexData.tokens.length > 0) {
              tokens = dexMod.transformDexScreenerPairs(dexData.tokens, c).map((t) => ({
                ...t,
                hasSmartMoneyData: false,
                securityChecked: false,
                dataQuality: 'dex-fallback',
                discoverySources: ['dexscreener'],
              }));
              if (quality.primarySource === 'none') quality.primarySource = 'dexscreener';
              else if (quality.primarySource === 'gmgn-openapi') quality.primarySource = 'gmgn+dex';
              quality.warnings.push(`${c}: DexScreener fallback (no smart-money enrichment)`);
              console.log(`DexScreener returned ${tokens.length} tokens for ${c}`);
            }
          } catch (dexErr) {
            console.error(`DexScreener error for ${c}:`, dexErr.message);
            quality.warnings.push(`Dex ${c}: ${dexErr.message}`);
          }
        }

        return { chain: c, tokens, chainSmart, chainSec };
      } catch (e) {
        console.error(`Fetch error for ${c}:`, e.message);
        return { chain: c, tokens: [], chainSmart: false, chainSec: 0 };
      }
    })
  );

  const mergedMap = new Map();
  for (const result of allResults) {
    if (result.status !== 'fulfilled') continue;
    if (result.value.chainSmart) quality.hasSmartMoneyData = true;
    quality.securityChecked += result.value.chainSec || 0;
    for (const token of result.value.tokens) {
      const key = String(token.address || '').toLowerCase() + ':' + token.chain;
      if (!key.startsWith(':')) mergedMap.set(key, token);
    }
  }

  const merged = Array.from(mergedMap.values())
    .sort((a, b) => {
      const bScore = (b.holders || 0) * 100 +
                     (b.liquidity || 0) +
                     ((b.txns24h?.total || 0) * 10) +
                     (b.smartCount || 0) * 1000 +
                     ((b.fromTrenches || b.fromHotSearch) ? 5000 : 0);
      const aScore = (a.holders || 0) * 100 +
                     (a.liquidity || 0) +
                     ((a.txns24h?.total || 0) * 10) +
                     (a.smartCount || 0) * 1000 +
                     ((a.fromTrenches || a.fromHotSearch) ? 5000 : 0);
      return bScore - aScore;
    })
    .slice(0, limit);

  if (!quality.hasSmartMoneyData) {
    quality.warnings.push('No smart-money enrichment available — signal engine will require stronger confirmation or skip weak fires');
  }

  return { tokens: merged, quality };
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
      const { tokens, quality } = await getTrendingMemecoins(context, chain, limit);
      const source = quality?.primarySource || (tokens.some((t) => t.source === 'dexscreener') ? 'dexscreener' : 'gmgn-openapi');
      return jsonResponse({
        success: true,
        chain,
        count: tokens.length,
        timestamp: Date.now(),
        source,
        quality: quality || {},
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
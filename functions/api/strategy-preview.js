/**
 * GET /api/strategy-preview
 *
 * Strategy order PREVIEW only — builds limit/TP/SL ladder quote.
 * NEVER places trades. No private keys. No swap/order endpoints.
 *
 * Query:
 *   chain, address, symbol
 *   price (optional market), signalPrice (optional buy marker)
 *   entryGrade (A|B|C|D), entryAction
 *   sizeUsd (optional override)
 */

import { buildStrategyQuote } from './_strategy_quote.js';

const CHAIN_TO_GMGN = {
  solana: 'sol',
  sol: 'sol',
  ethereum: 'eth',
  eth: 'eth',
  base: 'base',
  bsc: 'bsc',
  robinhood: 'robinhood',
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...extra,
    },
  });
}

async function resolveMarketPrice(context, chain, address, clientPrice) {
  const client = Number(clientPrice);
  if (client > 0) {
    return { price: client, source: 'client' };
  }
  if (!address) return { price: 0, source: 'none' };

  const apiKey = context?.env?.GMGN_API_KEY || '';
  const gmgnSlug = CHAIN_TO_GMGN[String(chain || '').toLowerCase()] || '';
  if (apiKey && gmgnSlug) {
    try {
      const gmgn = await import('./_gmgn.js');
      if (!(typeof gmgn.isCircuitOpen === 'function' && gmgn.isCircuitOpen())) {
        const info = await gmgn.getTokenInfo(apiKey, gmgnSlug, address);
        const p = Number(info?.price ?? info?.price_usd ?? info?.usd_price);
        if (p > 0) return { price: p, source: 'gmgn-token-info' };
      }
    } catch (e) {
      console.warn('strategy-preview gmgn price skip:', e?.message || e);
    }
  }

  // DexScreener public fallback (no auth)
  try {
    const dex = await import('./_dexscreener.js');
    if (typeof dex.getPairsByTokenAddresses === 'function') {
      const pairs = await dex.getPairsByTokenAddresses(chain, [address], 5);
      const list = Array.isArray(pairs) ? pairs : [];
      const best = list
        .slice()
        .sort((a, b) => Number(b.liquidity?.usd || b.liquidity || 0) - Number(a.liquidity?.usd || a.liquidity || 0))[0];
      const p = Number(best?.priceUsd ?? best?.price_usd);
      if (p > 0) return { price: p, source: 'dexscreener' };
    }
  } catch (e) {
    console.warn('strategy-preview dex price skip:', e?.message || e);
  }

  return { price: 0, source: 'unavailable' };
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }
  if (request.method !== 'GET') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  const url = new URL(request.url);
  const chain = (url.searchParams.get('chain') || 'solana').toLowerCase();
  const address = String(url.searchParams.get('address') || '').trim();
  const symbol = String(url.searchParams.get('symbol') || 'TOKEN').trim();
  const entryGrade = url.searchParams.get('entryGrade') || 'C';
  const entryAction = url.searchParams.get('entryAction') || '继续观察';
  const sizeUsd = url.searchParams.get('sizeUsd');
  const clientPrice = url.searchParams.get('price');
  const signalPrice = url.searchParams.get('signalPrice');

  try {
    const resolved = await resolveMarketPrice(context, chain, address, clientPrice);
    const quote = buildStrategyQuote({
      symbol,
      chain,
      address,
      marketPrice: resolved.price || Number(clientPrice) || 0,
      signalPrice: Number(signalPrice) || 0,
      entryGrade,
      entryAction,
      sizeUsd: sizeUsd != null && sizeUsd !== '' ? Number(sizeUsd) : undefined,
      priceSource: resolved.source,
    });

    return json(
      {
        success: true,
        executionEnabled: false,
        previewOnly: true,
        timestamp: Date.now(),
        data: quote,
      },
      200,
      { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60' }
    );
  } catch (e) {
    return json({
      success: false,
      executionEnabled: false,
      previewOnly: true,
      error: e?.message || String(e),
      data: null,
    }, 500);
  }
}

/**
 * GET /api/wallet-profile?chain=solana&wallet=...&period=7d
 *
 * Lazy-loaded GMGN portfolio stats for AI 钱包画像 drawer.
 * Exist auth only (GMGN_API_KEY). Heavy cache to protect rate limits.
 */

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

function shortWallet(addr = '') {
  const a = String(addr);
  if (a.length <= 12) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
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
  const chainRaw = (url.searchParams.get('chain') || 'solana').toLowerCase();
  const wallet = String(url.searchParams.get('wallet') || url.searchParams.get('address') || '').trim();
  const period = url.searchParams.get('period') === '30d' ? '30d' : '7d';
  const role = url.searchParams.get('role') || '';
  const twitter = url.searchParams.get('twitter') || '';
  const name = url.searchParams.get('name') || '';

  if (!wallet || wallet.length < 8) {
    return json({ success: false, error: 'Missing or invalid wallet' }, 400);
  }

  const gmgnChain = CHAIN_TO_GMGN[chainRaw] || chainRaw;
  const apiKey = context?.env?.GMGN_API_KEY || '';
  if (!apiKey) {
    return json({
      success: false,
      error: 'GMGN_API_KEY not configured',
      data: null,
    }, 503);
  }

  try {
    const gmgn = await import('./_gmgn.js');
    if (typeof gmgn.isCircuitOpen === 'function' && gmgn.isCircuitOpen()) {
      return json({
        success: false,
        error: 'GMGN rate-limit circuit open — try again shortly',
        rateLimited: true,
        gmgnRateLimit: gmgn.getRateLimitState?.() || null,
        data: null,
      }, 429);
    }

    const raw = await gmgn.getWalletStats(apiKey, gmgnChain, wallet, period);
    if (!raw) {
      return json({
        success: false,
        error: 'Empty wallet stats from GMGN',
        data: {
          wallet,
          chain: chainRaw,
          period,
          short: shortWallet(wallet),
          style: { grade: '未知', label: '无数据', score: 0 },
        },
      }, 200);
    }

    const profile = gmgn.normalizeWalletStats(raw, {
      wallet,
      chain: chainRaw,
      period,
      role,
      twitter,
      name,
    });
    profile.short = shortWallet(profile.wallet || wallet);
    profile.gmgnUrl =
      gmgnChain === 'sol'
        ? `https://gmgn.ai/sol/address/${wallet}`
        : `https://gmgn.ai/${gmgnChain}/address/${wallet}`;

    return json(
      {
        success: true,
        chain: chainRaw,
        period,
        timestamp: Date.now(),
        source: 'gmgn-wallet-stats',
        data: profile,
        gmgnRateLimit: gmgn.getRateLimitState?.() || null,
      },
      200,
      { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' }
    );
  } catch (e) {
    const rateLimited = !!(e?.rateLimited || e?.circuitOpen || e?.status === 429);
    return json(
      {
        success: false,
        error: e?.message || String(e),
        rateLimited,
        data: null,
      },
      rateLimited ? 429 : 500
    );
  }
}

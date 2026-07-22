// Cloudflare Pages Function: /api/chains
// Keep this endpoint separate from trending.js because Pages routes by file path.

const CHAINS = [
  { id: 'solana', gmgn: 'sol', dexscreener: 'solana', label: 'Solana', icon: '' },
  { id: 'ethereum', gmgn: 'eth', dexscreener: 'ethereum', label: 'Ethereum', icon: '' },
  { id: 'base', gmgn: 'base', dexscreener: 'base', label: 'Base', icon: '' },
  { id: 'bsc', gmgn: 'bsc', dexscreener: 'bsc', label: 'BNB Chain', icon: '' },
  { id: 'robinhood', gmgn: 'robinhood', dexscreener: 'robinhood', label: 'Robinhood', icon: '' },
];

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'public, s-maxage=3600',
    },
  });
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method === 'OPTIONS') return jsonResponse({}, 200);
  if (request.method !== 'GET') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  return jsonResponse({
    success: true,
    count: CHAINS.length,
    data: CHAINS,
  });
}

// Backward-compatible alias for old checks/bookmarks: /api/btc -> /api/bitcoin

export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = '/api/bitcoin';
  return Response.redirect(url.toString(), 308);
}

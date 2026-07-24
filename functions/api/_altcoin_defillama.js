/**
 * DefiLlama free open API — supplementary market heat only.
 * Free endpoints: no key. Derivatives overview is often paid — we use DEX overview.
 *
 * Not a substitute for CEX weekly futures volume gate.
 */

const LLAMA = 'https://api.llama.fi';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function llamaGet(path, timeoutMs = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${LLAMA}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return { ok: true, data: await resp.json() };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: e.name === 'AbortException' || e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

/**
 * Global DEX volume heat (free).
 * @returns {{ ok, total24h, change_1d, change_7d, topProtocols, note }}
 */
export async function fetchDefiLlamaDexHeat() {
  const res = await llamaGet('/overview/dexs', 12000);
  if (!res.ok) return { ok: false, error: res.error, source: 'defillama' };

  const d = res.data || {};
  // totalDataChartBreakdown / total24h / change_1d fields vary by version
  const total24h = num(d.total24h ?? d.totalVolume24h);
  const change1d = num(d.change_1d ?? d.change1d);
  const change7d = num(d.change_7d ?? d.change7d);

  const protocols = Array.isArray(d.protocols) ? d.protocols : [];
  const topProtocols = protocols
    .map((p) => ({
      name: p.name || p.displayName || '',
      total24h: num(p.total24h),
      change_1d: num(p.change_1d),
      change_7d: num(p.change_7d),
    }))
    .filter((p) => p.total24h > 0)
    .sort((a, b) => b.total24h - a.total24h)
    .slice(0, 8);

  let tone = 'neutral';
  if (change7d >= 8 || change1d >= 12) tone = 'hot';
  else if (change7d <= -8 || change1d <= -12) tone = 'cold';

  return {
    ok: true,
    source: 'defillama',
    total24h,
    change_1d: change1d,
    change_7d: change7d,
    topProtocols,
    tone,
    note:
      tone === 'hot'
        ? `链上 DEX 量能偏热（7d ${change7d >= 0 ? '+' : ''}${change7d.toFixed(1)}%）`
        : tone === 'cold'
          ? `链上 DEX 量能偏冷（7d ${change7d.toFixed(1)}%）`
          : `链上 DEX 量能中性（7d ${change7d >= 0 ? '+' : ''}${change7d.toFixed(1)}%）`,
  };
}

/**
 * Soft tag: if a coin name appears in top DEX protocol list, attach dex heat.
 * Protocol names rarely = ticker; best-effort match.
 */
export function attachDefiLlamaHints(rows = [], llama = null) {
  if (!llama?.ok || !Array.isArray(rows)) return rows;
  const names = (llama.topProtocols || []).map((p) => String(p.name || '').toLowerCase());
  return rows.map((r) => {
    const sym = String(r.symbol || '').toLowerCase();
    const name = String(r.name || '').toLowerCase();
    const hit = names.find((n) => n.includes(sym) || (name && n.includes(name.slice(0, 6))));
    if (!hit) return { ...r, defillama: { marketTone: llama.tone, marketNote: llama.note } };
    return {
      ...r,
      defillama: {
        marketTone: llama.tone,
        marketNote: llama.note,
        protocolHit: hit,
      },
    };
  });
}

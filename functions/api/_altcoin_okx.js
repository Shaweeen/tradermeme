/**
 * Altcoin free third venue: OKX USDT perpetual SWAP (no API key).
 * Same hard gate: exclude BTC + weekly quote volume 环比连涨 2 周.
 */

import {
  ALTCOIN_SIGNAL_RULES,
  evaluateTwoWeekVolumeGrowth,
  isExcludedAltcoinSymbol,
  scoreWeeklyVolumeAlert,
  rankSignalsWithEnv,
  mapPool,
} from './_altcoin.js';

const OKX = 'https://www.okx.com';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function okxGet(path, timeoutMs = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${OKX}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const body = await resp.json();
    if (String(body.code) !== '0') {
      return { ok: false, error: body.msg || `code ${body.code}` };
    }
    return { ok: true, data: body.data };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : (e.message || 'fail') };
  }
}

/** Parse instId ETH-USDT-SWAP → ETH */
export function okxInstToSymbol(instId) {
  const s = String(instId || '');
  const m = s.match(/^([A-Z0-9]+)-USDT-SWAP$/i);
  return m ? m[1].toUpperCase() : '';
}

/**
 * OKX candles: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
 * Newest first from API.
 */
export function parseOkxWeeklyBars(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const bars = [];
  for (const row of list) {
    if (!row) continue;
    const ts = num(Array.isArray(row) ? row[0] : row.ts);
    // Prefer quote volume (USDT)
    const quote = num(Array.isArray(row) ? row[7] : row.volCcyQuote);
    const alt = num(Array.isArray(row) ? row[6] : row.volCcy);
    const turnover = quote > 0 ? quote : alt;
    if (turnover > 0) bars.push({ start: ts, turnover });
  }
  bars.sort((a, b) => b.start - a.start);
  return bars;
}

/** All USDT SWAP tickers */
export async function fetchOkxSwapTickers() {
  const res = await okxGet('/api/v5/market/tickers?instType=SWAP', 12000);
  if (!res.ok || !Array.isArray(res.data)) return { ok: false, error: res.error, list: [] };

  const list = [];
  for (const t of res.data) {
    const instId = String(t.instId || '');
    if (!instId.endsWith('-USDT-SWAP')) continue;
    const symbol = okxInstToSymbol(instId);
    if (!symbol || isExcludedAltcoinSymbol(symbol)) continue;

    const last = num(t.last);
    const open24h = num(t.open24h);
    const price24hPcnt = open24h > 0 ? (last - open24h) / open24h : 0;
    // volCcy24h for SWAP is often base or quote depending on contract — prefer if large as quote
    const volCcy24h = num(t.volCcy24h);
    const vol24h = num(t.vol24h);
    // Heuristic: if volCcy >> last, treat as quote USDT turnover
    let turnover24h = volCcy24h;
    if (last > 0 && volCcy24h > 0 && volCcy24h < vol24h * last * 0.01) {
      turnover24h = vol24h * last;
    }

    list.push({
      symbol,
      instId,
      price: last,
      markPrice: last,
      price24hPcnt,
      turnover24h,
      volume24h: vol24h,
      source: 'okx-swap',
    });
  }
  return { ok: true, list };
}

export async function fetchOkxFunding(instId) {
  const res = await okxGet(
    `/api/v5/public/funding-rate?instId=${encodeURIComponent(instId)}`,
    5000
  );
  if (!res.ok || !res.data?.[0]) return { ok: false, fundingRate: 0 };
  return { ok: true, fundingRate: num(res.data[0].fundingRate) };
}

export async function fetchOkxOpenInterest(instId) {
  const res = await okxGet(
    `/api/v5/public/open-interest?instType=SWAP&instId=${encodeURIComponent(instId)}`,
    5000
  );
  if (!res.ok || !res.data?.[0]) return { ok: false, oiUsd: 0, oi: 0 };
  const row = res.data[0];
  return {
    ok: true,
    oiUsd: num(row.oiUsd),
    oi: num(row.oiCcy || row.oi),
  };
}

export async function fetchOkxWeeklyBars(instId) {
  const res = await okxGet(
    `/api/v5/market/candles?instId=${encodeURIComponent(instId)}&bar=1W&limit=4`,
    8000
  );
  if (!res.ok) return { ok: false, bars: [], source: 'okx' };
  const bars = parseOkxWeeklyBars(res.data);
  return { ok: bars.length >= 3, bars, source: 'okx' };
}

/**
 * Free third-venue collector: OKX USDT SWAP.
 */
export async function collectOkxWeeklyAlerts(opts = {}) {
  const R = ALTCOIN_SIGNAL_RULES;
  const tickersRes = await fetchOkxSwapTickers();
  if (!tickersRes.ok) {
    return {
      rows: [],
      meta: { ok: false, primary: 'okx', error: tickersRes.error || 'ticker-fail' },
    };
  }

  const pool = tickersRes.list
    .sort((a, b) => num(b.turnover24h) - num(a.turnover24h))
    .slice(0, R.scanPoolSize);

  const weeklyHits = await mapPool(pool, R.klineConcurrency, async (t) => {
    const wk = await fetchOkxWeeklyBars(t.instId);
    const eval_ = evaluateTwoWeekVolumeGrowth(wk.bars || []);
    return { ticker: t, weekly: wk, eval: eval_ };
  });

  const passed = weeklyHits.filter((h) => h?.eval?.pass);
  const forEnrich = passed.slice(0, Math.min(passed.length, R.maxResults * 2));

  // Funding + OI for passed only
  const enrich = await mapPool(forEnrich, 4, async (h) => {
    const [fr, oi] = await Promise.all([
      fetchOkxFunding(h.ticker.instId),
      fetchOkxOpenInterest(h.ticker.instId),
    ]);
    return {
      symbol: h.ticker.symbol,
      fundingRate: fr.ok ? fr.fundingRate : 0,
      oiUsd: oi.ok ? oi.oiUsd : 0,
      oi: oi.ok ? oi.oi : 0,
    };
  });
  const enrichMap = {};
  for (const e of enrich) {
    if (e?.symbol) enrichMap[e.symbol] = e;
  }

  const scored = [];
  for (const item of passed) {
    const t = item.ticker;
    const ex = enrichMap[t.symbol] || {};
    const price = t.markPrice || t.price || 0;
    const oiQty = ex.oiUsd > 0 && price > 0 ? ex.oiUsd / price : num(ex.oi);
    const ticker = {
      ...t,
      fundingRate: ex.fundingRate ?? 0,
      openInterest: oiQty,
      markPrice: price,
      price,
    };
    const row = scoreWeeklyVolumeAlert(
      ticker,
      item.eval,
      opts.binanceMap || {},
      opts.geckoMeta || {},
      opts.env || null
    );
    if (!row) continue;
    row.weeklySource = 'okx';
    row.source = 'okx-weekly-v3';
    scored.push(row);
  }

  scored.sort((a, b) => {
    const cg = num(b.volumeGrowthRankKey) - num(a.volumeGrowthRankKey);
    if (Math.abs(cg) > 0.01) return cg;
    return num(b.score) - num(a.score);
  });

  const top = scored.slice(0, R.maxResults);
  const ranked = rankSignalsWithEnv(top, opts.env).map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    rows: ranked,
    meta: {
      ok: ranked.length > 0,
      primary: 'okx',
      rulesVersion: 'altcoin-okx-weekly-v3',
      gate: 'two-week-volume-up-ex-btc',
      candidates: pool.length,
      passedWeeklyGate: passed.length,
      collected: ranked.length,
      maxResults: R.maxResults,
      exclude: R.excludeSymbols,
      note: 'OKX USDT-SWAP 公开接口 · 无需 API key',
      needsKey: false,
    },
  };
}

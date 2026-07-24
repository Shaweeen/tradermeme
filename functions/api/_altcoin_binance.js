/**
 * Altcoin free primary source: Binance USDT-M futures (no API key).
 * Hard gate: exclude BTC + weekly quote volume 环比连涨 2 周 → Top 20.
 *
 * Complements Bybit weekly collector; does NOT use CoinGlass.
 */

import {
  ALTCOIN_SIGNAL_RULES,
  evaluateTwoWeekVolumeGrowth,
  isExcludedAltcoinSymbol,
  scoreWeeklyVolumeAlert,
  rankSignalsWithEnv,
  mapPool,
  parseWeeklyTurnovers,
} from './_altcoin.js';

const BINANCE_FAPI = 'https://fapi.binance.com';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function bnGet(path, timeoutMs = 10000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${BINANCE_FAPI}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { ok: true, data };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : (e.message || 'fail') };
  }
}

/** All USDT perpetual 24h tickers */
export async function fetchBinanceFuturesTickers() {
  const res = await bnGet('/fapi/v1/ticker/24hr', 12000);
  if (!res.ok || !Array.isArray(res.data)) return { ok: false, error: res.error, list: [] };
  const list = res.data
    .filter((t) => String(t.symbol || '').endsWith('USDT') && !String(t.symbol).includes('_'))
    .map((t) => {
      const raw = String(t.symbol);
      const symbol = raw.replace(/USDT$/i, '');
      return {
        symbol,
        rawSymbol: raw,
        price: num(t.lastPrice),
        markPrice: num(t.lastPrice),
        price24hPcnt: num(t.priceChangePercent) / 100,
        turnover24h: num(t.quoteVolume),
        volume24h: num(t.volume),
        high24h: num(t.highPrice),
        low24h: num(t.lowPrice),
        source: 'binance-fapi',
      };
    })
    .filter((t) => t.symbol && !isExcludedAltcoinSymbol(t.symbol));
  return { ok: true, list };
}

/** premiumIndex: funding for all symbols */
export async function fetchBinancePremiumIndex() {
  const res = await bnGet('/fapi/v1/premiumIndex', 10000);
  if (!res.ok) return { ok: false, map: {} };
  const arr = Array.isArray(res.data) ? res.data : [res.data];
  const map = {};
  for (const row of arr) {
    const sym = String(row.symbol || '').replace(/USDT$/i, '');
    if (!sym) continue;
    map[sym] = {
      fundingRate: num(row.lastFundingRate),
      markPrice: num(row.markPrice),
      indexPrice: num(row.indexPrice),
      nextFundingTime: num(row.nextFundingTime),
    };
  }
  return { ok: true, map };
}

/** Open interest one symbol */
export async function fetchBinanceOpenInterest(symbol) {
  const pair = `${String(symbol).toUpperCase().replace(/USDT$/i, '')}USDT`;
  const res = await bnGet(`/fapi/v1/openInterest?symbol=${encodeURIComponent(pair)}`, 5000);
  if (!res.ok || !res.data) return { ok: false, oi: 0 };
  return { ok: true, oi: num(res.data.openInterest) };
}

/** Weekly klines → turnover bars newest-first */
export async function fetchBinanceWeeklyBars(symbol) {
  const pair = `${String(symbol).toUpperCase().replace(/USDT$/i, '')}USDT`;
  const res = await bnGet(
    `/fapi/v1/klines?symbol=${encodeURIComponent(pair)}&interval=1w&limit=4`,
    8000
  );
  if (!res.ok || !Array.isArray(res.data)) return { ok: false, bars: [], source: 'binance' };
  const bars = parseWeeklyTurnovers(res.data, 'binance');
  return { ok: bars.length >= 3, bars, source: 'binance', symbol: pair };
}

/**
 * Free primary collector: Binance USDT-M.
 */
export async function collectBinanceWeeklyAlerts(opts = {}) {
  const R = ALTCOIN_SIGNAL_RULES;
  const [tickersRes, premiumRes] = await Promise.all([
    fetchBinanceFuturesTickers(),
    fetchBinancePremiumIndex(),
  ]);
  if (!tickersRes.ok) {
    return {
      rows: [],
      meta: { ok: false, primary: 'binance', error: tickersRes.error || 'ticker-fail' },
    };
  }

  const fundingMap = premiumRes.map || {};
  const pool = tickersRes.list
    .map((t) => {
      const fr = fundingMap[t.symbol];
      return {
        ...t,
        fundingRate: fr?.fundingRate ?? 0,
        markPrice: fr?.markPrice || t.markPrice || t.price,
        price: fr?.markPrice || t.price,
      };
    })
    .sort((a, b) => num(b.turnover24h) - num(a.turnover24h))
    .slice(0, R.scanPoolSize);

  // Weekly volume gate + light OI for top candidates that pass (concurrency limited)
  const weeklyHits = await mapPool(pool, R.klineConcurrency, async (t) => {
    const wk = await fetchBinanceWeeklyBars(t.symbol);
    const eval_ = evaluateTwoWeekVolumeGrowth(wk.bars || []);
    return { ticker: t, weekly: wk, eval: eval_ };
  });

  const passed = weeklyHits.filter((h) => h?.eval?.pass);
  // Fetch OI only for passed gate (max 20*1.5 buffer) to save rate limit
  const forOi = passed.slice(0, Math.min(passed.length, R.maxResults * 2));
  const oiList = await mapPool(forOi, 5, async (h) => {
    const oi = await fetchBinanceOpenInterest(h.ticker.symbol);
    return { symbol: h.ticker.symbol, oi: oi.ok ? oi.oi : 0 };
  });
  const oiMap = {};
  for (const r of oiList) {
    if (r?.symbol) oiMap[r.symbol] = num(r.oi);
  }

  const scored = [];
  for (const item of passed) {
    const t = item.ticker;
    const oiQty = oiMap[t.symbol] || 0;
    const ticker = {
      ...t,
      openInterest: oiQty,
      // keep mark for OI notional = oi * price inside scorer
    };
    const row = scoreWeeklyVolumeAlert(
      ticker,
      item.eval,
      opts.binanceMap || {},
      opts.geckoMeta || {},
      opts.env || null
    );
    if (!row) continue;
    row.weeklySource = 'binance';
    row.source = 'binance-weekly-v3';
    row.binanceAgreement = 'primary';
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
      primary: 'binance',
      rulesVersion: 'altcoin-binance-weekly-v3',
      gate: 'two-week-volume-up-ex-btc',
      candidates: pool.length,
      passedWeeklyGate: passed.length,
      collected: ranked.length,
      maxResults: R.maxResults,
      exclude: R.excludeSymbols,
      note: 'Binance USDT-M 公开接口 · 无需 API key',
      needsKey: false,
    },
  };
}

/**
 * Merge Binance + Bybit rows by symbol: keep higher compound growth / score.
 */
export function mergeVenueAlertRows(lists = [], env = null) {
  const map = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      const sym = String(row.symbol || '').toUpperCase();
      if (!sym || isExcludedAltcoinSymbol(sym)) continue;
      const prev = map.get(sym);
      if (!prev) {
        map.set(sym, { ...row, venues: [row.weeklySource || row.source || 'unknown'] });
        continue;
      }
      const better =
        num(row.volumeGrowthRankKey) > num(prev.volumeGrowthRankKey) + 0.01 ||
        (Math.abs(num(row.volumeGrowthRankKey) - num(prev.volumeGrowthRankKey)) <= 0.01 &&
          num(row.score) > num(prev.score));
      if (better) {
        map.set(sym, {
          ...row,
          venues: [...new Set([...(prev.venues || []), row.weeklySource || row.source || 'unknown'])],
          multiVenue: true,
        });
      } else {
        prev.venues = [...new Set([...(prev.venues || []), row.weeklySource || row.source || 'unknown'])];
        prev.multiVenue = (prev.venues || []).length > 1;
        map.set(sym, prev);
      }
    }
  }
  const merged = [...map.values()];
  merged.sort((a, b) => {
    // multi-venue confirmation boost sort
    const am = a.multiVenue ? 1 : 0;
    const bm = b.multiVenue ? 1 : 0;
    if (bm !== am) return bm - am;
    const cg = num(b.volumeGrowthRankKey) - num(a.volumeGrowthRankKey);
    if (Math.abs(cg) > 0.01) return cg;
    return num(b.score) - num(a.score);
  });
  const top = merged.slice(0, ALTCOIN_SIGNAL_RULES.maxResults);
  return rankSignalsWithEnv(top, env).map((r, i) => ({
    ...r,
    rank: i + 1,
    signalScore: r.score ?? r.signalScore,
  }));
}

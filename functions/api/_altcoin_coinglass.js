/**
 * Altcoin CoinGlass primary source (full-market futures).
 * Does NOT touch Memecoin.
 *
 * Hard gate remains: exclude BTC + weekly volume 环比连涨 2 周 → Top 20.
 * CoinGlass provides market-wide OI / volume / funding; Binance weekly klines
 * optionally cross-check agreement.
 *
 * Auth: CG-API-KEY header · https://open-api-v4.coinglass.com
 */

import {
  ALTCOIN_SIGNAL_RULES,
  evaluateTwoWeekVolumeGrowth,
  isExcludedAltcoinSymbol,
  scoreWeeklyVolumeAlert,
  rankSignalsWithEnv,
  mapPool,
  fetchWeeklyTurnovers,
  formatCompact,
} from './_altcoin.js';

const CG_BASE = 'https://open-api-v4.coinglass.com';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {string} apiKey
 * @param {string} path e.g. /api/futures/coins-markets
 * @param {Record<string,string|number>} [params]
 */
export async function coinglassGet(apiKey, path, params = {}, timeoutMs = 10000) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const url = `${CG_BASE}${path}${qs.toString() ? `?${qs}` : ''}`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: {
        accept: 'application/json',
        'CG-API-KEY': apiKey,
      },
      signal: controller.signal,
    });
    clearTimeout(t);
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}`, status: resp.status, body };
    }
    // v4: { code: "0", data: ... }
    const code = body.code != null ? String(body.code) : '0';
    if (code !== '0' && code !== '200' && body.success === false) {
      return { ok: false, error: body.msg || body.message || `code ${code}`, body };
    }
    return { ok: true, data: body.data !== undefined ? body.data : body };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : (e.message || 'fetch-fail') };
  }
}

/** Full-market coin snapshot */
export async function fetchCoinglassCoinsMarkets(apiKey) {
  const res = await coinglassGet(apiKey, '/api/futures/coins-markets', {}, 12000);
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : [];
  return { ok: true, data: list, count: list.length };
}

/**
 * Weekly aggregated taker volume (buy+sell) as proxy for market-wide futures volume.
 * interval=1w · newest last or first depending on API — we normalize.
 */
export async function fetchCoinglassWeeklyVolume(apiKey, symbol) {
  const sym = String(symbol || '').toUpperCase().replace(/USDT$/i, '');
  const res = await coinglassGet(
    apiKey,
    '/api/futures/aggregated-taker-buy-sell-volume/history',
    {
      symbol: sym,
      interval: '1w',
      // some plans want exchange_list; omit for aggregated all when supported
    },
    8000
  );
  if (!res.ok) return { ok: false, symbol: sym, error: res.error, bars: [] };
  const bars = parseCoinglassWeeklyTakerBars(res.data);
  return { ok: bars.length >= 3, symbol: sym, source: 'coinglass', bars, error: bars.length < 3 ? 'need-3-weeks' : '' };
}

/**
 * Parse CG taker history → [{start, turnover}] newest-first
 */
export function parseCoinglassWeeklyTakerBars(raw) {
  const list = Array.isArray(raw) ? raw : raw?.data || raw?.list || [];
  const bars = [];
  for (const row of list) {
    if (!row) continue;
    const buy = num(
      row.aggregated_buy_volume_usd ??
        row.buy_volume_usd ??
        row.taker_buy_volume_usd ??
        row.buyVolUsd
    );
    const sell = num(
      row.aggregated_sell_volume_usd ??
        row.sell_volume_usd ??
        row.taker_sell_volume_usd ??
        row.sellVolUsd
    );
    const total = buy + sell || num(row.volume_usd ?? row.volumeUsd ?? row.vol_usd);
    const ts = num(
      row.t ??
        row.time ??
        row.timestamp ??
        row.createTime ??
        row.t_ms ??
        (Array.isArray(row) ? row[0] : 0)
    );
    if (total > 0) bars.push({ start: ts || bars.length, turnover: total });
  }
  // newest first
  bars.sort((a, b) => b.start - a.start);
  // if timestamps missing/equal, keep API order reversed if chronological ascending
  if (bars.length >= 2 && bars.every((b) => !b.start || b.start < 1e11)) {
    // already sorted by start; if all start are indices, reverse if ascending volume timeline unknown
  }
  return bars;
}

/** Estimate 24h volume USD from coins-markets row */
export function estimateVolumeUsd(row = {}) {
  const direct = num(
    row.volume_usd ??
      row.volumeUsd ??
      row.vol_usd ??
      row.volume_24h ??
      row.volume24h
  );
  if (direct > 0) return direct;
  const oi = num(row.open_interest_usd);
  const ratio = num(row.open_interest_volume_ratio);
  if (oi > 0 && ratio > 0) return oi / ratio;
  // change usd fields are deltas not totals
  return Math.max(0, num(row.volume_change_usd_24h));
}

/**
 * CoinGlass funding may already be in percent units (0.01 = 0.01%).
 * Normalize to decimal rate (0.0001 = 0.01%) for shared thresholds.
 */
export function normalizeCgFundingToDecimal(raw) {
  const v = num(raw);
  if (!v) return 0;
  // If |v| looks like percent (e.g. 0.01 ~ 0.05 typical display), convert
  // CG examples: 0.002647 → treat as percent → decimal / 100
  if (Math.abs(v) < 0.05) return v / 100;
  // Already large → assume percent * 100 mis-scale
  if (Math.abs(v) >= 0.05 && Math.abs(v) < 5) return v / 100;
  return v;
}

/**
 * Map coins-markets row → pseudo Bybit ticker for scoreWeeklyVolumeAlert
 */
export function cgMarketToTicker(row = {}) {
  const symbol = String(row.symbol || '').toUpperCase();
  const price = num(row.current_price);
  const oiUsd = num(row.open_interest_usd);
  const vol = estimateVolumeUsd(row);
  const funding = normalizeCgFundingToDecimal(
    row.avg_funding_rate_by_vol ?? row.avg_funding_rate_by_oi ?? row.funding_rate
  );
  // OI quantity for openInterest field; score uses openInterest * markPrice
  const oiQty = price > 0 ? oiUsd / price : num(row.open_interest_quantity);
  return {
    symbol,
    markPrice: price,
    price,
    fundingRate: funding,
    price24hPcnt: num(row.price_change_percent_24h) / 100,
    turnover24h: vol,
    volume24h: vol,
    openInterest: oiQty,
    openInterestUsd: oiUsd,
    oiChange24h: num(row.open_interest_change_percent_24h),
    volumeChange24h: num(row.volume_change_percent_24h),
    source: 'coinglass',
    raw: row,
  };
}

/**
 * Primary collection: CoinGlass full-market → weekly gate → Top 20.
 * Binance weekly klines used for cross-check when fetcher provided.
 *
 * @param {{
 *   apiKey: string,
 *   env?: object|null,
 *   geckoMeta?: object,
 *   fetcher?: Function,  // for Binance/Bybit kline validate
 *   binanceMap?: object,
 * }} opts
 */
export async function collectCoinglassWeeklyAlerts(opts = {}) {
  const R = ALTCOIN_SIGNAL_RULES;
  const apiKey = opts.apiKey || '';
  if (!apiKey) {
    return {
      rows: [],
      meta: { error: 'no-coinglass-key', primary: 'coinglass', ok: false },
    };
  }

  const marketsRes = await fetchCoinglassCoinsMarkets(apiKey);
  if (!marketsRes.ok) {
    return {
      rows: [],
      meta: {
        error: marketsRes.error || 'coins-markets-fail',
        primary: 'coinglass',
        ok: false,
      },
    };
  }

  // Pre-pool: exclude BTC/stables, prefer high volume / volume expansion
  const pool = (marketsRes.data || [])
    .map((row) => {
      const t = cgMarketToTicker(row);
      return { ...t, _vol: estimateVolumeUsd(row), _oiChg: num(row.open_interest_change_percent_24h) };
    })
    .filter((t) => t.symbol && !isExcludedAltcoinSymbol(t.symbol))
    .filter((t) => t._vol >= R.weekVolumePriorMinUsd || t.openInterestUsd >= R.oiFloor)
    .sort((a, b) => {
      // Prefer rising volume + size
      const scoreA = a._vol * (1 + Math.max(0, num(a.volumeChange24h)) / 100);
      const scoreB = b._vol * (1 + Math.max(0, num(b.volumeChange24h)) / 100);
      return scoreB - scoreA;
    })
    .slice(0, R.scanPoolSize);

  // Weekly volume history from CoinGlass (1w taker agg)
  const weeklyHits = await mapPool(pool, Math.min(6, R.klineConcurrency), async (t) => {
    const wk = await fetchCoinglassWeeklyVolume(apiKey, t.symbol);
    let eval_ = evaluateTwoWeekVolumeGrowth(wk.bars || []);
    let weeklySource = 'coinglass';

    // Fallback weekly bars from Binance public klines if CG history thin
    if (!eval_.pass && typeof opts.fetcher === 'function') {
      const bn = await fetchWeeklyTurnovers(t.symbol, opts.fetcher);
      if (bn.ok && bn.bars?.length >= 3) {
        const e2 = evaluateTwoWeekVolumeGrowth(bn.bars);
        if (e2.pass) {
          eval_ = e2;
          weeklySource = 'binance-fallback';
          wk.bars = bn.bars;
          wk.ok = true;
        }
      }
    }

    // Optional Binance cross-check when CG already passed
    let binanceAgreement = 'n/a';
    if (eval_.pass && typeof opts.fetcher === 'function') {
      const bn = await fetchWeeklyTurnovers(t.symbol, opts.fetcher);
      if (bn.ok && bn.bars?.length >= 3) {
        const eBn = evaluateTwoWeekVolumeGrowth(bn.bars);
        if (eBn.pass) {
          const sameDir =
            Math.sign(eBn.growth1) === Math.sign(eval_.growth1) &&
            Math.sign(eBn.growth2) === Math.sign(eval_.growth2);
          binanceAgreement = sameDir ? 'agree' : 'soft';
        } else {
          binanceAgreement = 'conflict';
        }
      }
    }

    return { ticker: t, weekly: wk, eval: eval_, weeklySource, binanceAgreement };
  });

  const scored = [];
  let passedGate = 0;
  for (const item of weeklyHits) {
    if (!item || item.error || !item.eval?.pass) continue;
    passedGate += 1;
    const gecko = opts.geckoMeta || {};
    const row = scoreWeeklyVolumeAlert(
      item.ticker,
      item.eval,
      opts.binanceMap || {},
      gecko,
      opts.env || null
    );
    if (!row) continue;

    // Boost / penalize from CG OI surge + Binance agreement
    let score = num(row.score);
    const oiChg = num(item.ticker.oiChange24h);
    if (oiChg >= 8) {
      score = Math.min(100, score + 8);
      row.signals = [
        {
          type: 'oi',
          label: '全市场 OI 激增',
          detail: `24h OI ${oiChg > 0 ? '+' : ''}${oiChg.toFixed(1)}% · CoinGlass`,
          severity: 3,
          bias: 'oi-surge',
        },
        ...(row.signals || []),
      ];
    } else if (oiChg >= 3) {
      score = Math.min(100, score + 4);
    }

    if (item.binanceAgreement === 'agree') score = Math.min(100, score + 4);
    else if (item.binanceAgreement === 'conflict') score = Math.max(0, score - 8);

    // Funding already in scoreWeeklyVolumeAlert; tag market-wide
    row.score = Math.round(score * 10) / 10;
    row.signalScore = row.score;
    row.weeklySource = item.weeklySource;
    row.binanceAgreement = item.binanceAgreement;
    row.source = 'coinglass-weekly-v3';
    row.coinglass = {
      openInterestUsd: item.ticker.openInterestUsd,
      oiChange24h: oiChg,
      volumeChange24h: item.ticker.volumeChange24h,
      volumeUsd: item.ticker._vol,
      fundingVolWeight: item.ticker.fundingRate,
    };
    if (item.binanceAgreement === 'conflict') {
      row.action = 'fade';
      row.actionLabel = '校验冲突';
      row.actionPriority = 12;
      row.actionReason = 'CoinGlass 周量过门但 Binance 周量未连涨，降权';
    }
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
      ok: true,
      primary: 'coinglass',
      rulesVersion: 'altcoin-coinglass-weekly-v3',
      gate: 'two-week-volume-up-ex-btc',
      candidates: pool.length,
      marketsTotal: marketsRes.count,
      passedWeeklyGate: passedGate,
      collected: ranked.length,
      maxResults: R.maxResults,
      exclude: R.excludeSymbols,
      binanceValidate: typeof opts.fetcher === 'function',
      note: `全市场 CoinGlass · 周量连涨2周 · 除BTC · Top${R.maxResults}`,
    },
  };
}

export { CG_BASE, formatCompact };

/**
 * Altcoin-only module (does NOT touch Memecoin).
 *
 * Alert collection gate (v3):
 *   1) Exclude BTC (and stables / wrapped majors noise)
 *   2) Weekly quote volume 环比上涨 连续 2 周 (w0>w1 且 w1>w2)
 *   3) Rank by volume growth + 合约量/OI 激增 + 资金费率异常 → Top 20
 *
 * Also: BTC/ETH 合约环境面板 + optional Clawby second source.
 */

const CLAWBY_BASE = process.env.CLAWBY_BASE || 'https://api.openclawby.com';
const BYBIT_BASE = 'https://api.bybit.com';
const BINANCE_FUTURES = 'https://fapi.binance.com';

// ─── Signal rules (Altcoin CEX perps) ───────────────────────────────────────
/**
 * v3 alert collection — weekly volume expansion is the HARD gate.
 * Only tokens that pass 2 consecutive weekly volume up-prints enter the board.
 */
export const ALTCOIN_SIGNAL_RULES = {
  rulesVersion: 'altcoin-weekly-vol-v3',
  // Always exclude from collection
  excludeSymbols: ['BTC'],
  // Weekly volume growth (环比)
  weekOverWeekMinGrowth: 0.05, // each week must be ≥ +5% vs prior
  // Absolute floors so dust never ranks
  weekVolumeMinUsd: 5_000_000, // latest week turnover ≥ $5M
  weekVolumePriorMinUsd: 2_000_000,
  // Candidate pre-filter before kline fan-out (latency)
  scanPoolSize: 80, // top N by 24h turnover (ex-BTC) to check weekly
  klineConcurrency: 8,
  maxResults: 20, // 报警收集上限：前 20
  // Secondary alert dimensions (within the weekly-volume set)
  fundingMild: 0.00015,
  fundingHot: 0.0004,
  fundingExtreme: 0.001,
  oiFloor: 5_000_000,
  oiStrong: 50_000_000,
  // 24h turnover vs soft context
  volume24hStrong: 30_000_000,
  // Legacy fields kept for env soft-adjust / depth
  minScore: 20,
  envRiskOffPenalty: 8,
  envRiskOnBoost: 4,
  riskOffMinScoreExtra: 0,
  clawbyDepthTopN: 8,
  // Old multi-factor thresholds (kept for optional helpers)
  priceMoveMin: 6,
  priceMoveStrong: 15,
  priceMoveCap: 120,
  volumeFloor: 2_000_000,
  volumeStrong: 25_000_000,
};

const FILTER_OUT = new Set([
  'usdt', 'usdc', 'dai', 'busd', 'tusd', 'usdp', 'fdusd', 'usdd', 'gusd',
  'lusd', 'husd', 'susd', 'ousd', 'pyusd', 'usdce', 'steth', 'weth', 'wbtc',
  'wsteth', 'reth', 'sfrxeth', 'wbeth', 'cbeth',
  // majors we never treat as "alt volume leaders" board noise
  'btc',
]);

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatCompact(n) {
  const x = num(n);
  if (!x) return '$0';
  if (x >= 1e12) return `$${(x / 1e12).toFixed(2)}T`;
  if (x >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6) return `$${(x / 1e6).toFixed(2)}M`;
  if (x >= 1e3) return `$${(x / 1e3).toFixed(1)}K`;
  return `$${x.toFixed(0)}`;
}

// ─── Clawby second source ───────────────────────────────────────────────────

/**
 * @param {string|undefined} apiKey
 * @param {string} name relay interface name
 * @param {object} params
 */
export async function clawbyRelay(apiKey, name, params = {}, timeoutMs = 7000) {
  if (!apiKey) return { ok: false, error: 'no-key' };
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${CLAWBY_BASE}/api/relay`, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ name, params }),
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}`, status: resp.status };
    }
    const body = await resp.json();
    if (body.error) return { ok: false, error: String(body.error) };
    return { ok: true, data: body.data !== undefined ? body.data : body };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : (e.message || 'fetch-fail') };
  }
}

function rowsOf(d) {
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.data)) return d.data;
  if (d && Array.isArray(d.list)) return d.list;
  return [];
}

/**
 * Pull BTC (and optional ETH) derivatives snapshot via Clawby.
 * Degrades gracefully — each sub-call is independent.
 */
export async function fetchClawbyDerivsSnapshot(apiKey, { coins = ['BTC', 'ETH'] } = {}) {
  if (!apiKey) {
    return { ok: false, available: false, reason: 'no-clawby-key', coins: {} };
  }

  const out = {
    ok: true,
    available: true,
    reason: '',
    fetchedAt: Date.now(),
    coins: {},
    global: {},
  };

  const [fundingRes, liqRes] = await Promise.all([
    clawbyRelay(apiKey, 'futures_funding_rate_exchange_list', {}),
    clawbyRelay(apiKey, 'futures_liquidation_exchange_list', { range: '24h' }),
  ]);

  if (fundingRes.ok) {
    const list = rowsOf(fundingRes.data);
    for (const coin of coins) {
      const entry = list.find((r) => String(r.symbol || '').toUpperCase() === coin);
      if (!entry) continue;
      const venues = (entry.stablecoin_margin_list || [])
        .map((e) => ({
          exchange: e.exchange,
          rate: num(e.funding_rate),
          rate_pct: num(e.funding_rate) * 100,
        }))
        .filter((e) => Number.isFinite(e.rate));
      const avg = venues.length
        ? venues.reduce((s, e) => s + e.rate, 0) / venues.length
        : null;
      out.coins[coin] = {
        ...(out.coins[coin] || {}),
        funding_avg: avg,
        funding_avg_pct: avg == null ? null : avg * 100,
        funding_venues: venues.slice(0, 8),
      };
    }
  }

  if (liqRes.ok) {
    const list = rowsOf(liqRes.data);
    const all = list.find((r) => String(r.exchange || '').toLowerCase() === 'all') || list[0];
    if (all) {
      out.global.liquidations = {
        total_usd_24h: num(all.liquidation_usd ?? all.total_liquidation_usd),
        long_usd_24h: num(all.longLiquidation_usd ?? all.long_liquidation_usd),
        short_usd_24h: num(all.shortLiquidation_usd ?? all.short_liquidation_usd),
      };
    }
  }

  // Per-coin OI + long/short (parallel, limited)
  await Promise.all(
    coins.map(async (coin) => {
      const [oiRes, lsRes, takerRes] = await Promise.all([
        clawbyRelay(apiKey, 'futures_open_interest_exchange_list', { symbol: coin }),
        clawbyRelay(apiKey, 'futures_global_long_short_account_ratio_history', {
          exchange: 'Binance',
          symbol: `${coin}USDT`,
          interval: '1h',
        }),
        clawbyRelay(apiKey, 'futures_taker_buy_sell_volume_exchange_list', {
          symbol: coin,
          range: '4h',
        }),
      ]);
      const slot = out.coins[coin] || (out.coins[coin] = {});
      if (oiRes.ok) {
        const list = rowsOf(oiRes.data);
        const all = list.find((r) => String(r.exchange || '').toLowerCase() === 'all') || list[0];
        if (all) {
          slot.oi_usd = num(all.open_interest_usd);
          slot.oi_change_pct_24h = num(
            all.open_interest_change_percent_24h ?? all.oi_change_percent_24h
          );
        }
      }
      if (lsRes.ok) {
        const hist = rowsOf(lsRes.data);
        const last = hist[hist.length - 1];
        if (last) {
          slot.long_pct = num(last.global_account_long_percent);
          slot.short_pct = num(last.global_account_short_percent);
          slot.ls_ratio = num(last.global_account_long_short_ratio);
        }
      }
      if (takerRes.ok) {
        const body = takerRes.data?.data || takerRes.data;
        if (body && body.buy_ratio != null) {
          slot.taker_buy_ratio = num(body.buy_ratio);
          slot.taker_sell_ratio = num(body.sell_ratio);
        }
      }
    })
  );

  const anyCoin = Object.keys(out.coins).length > 0 || out.global.liquidations;
  if (!anyCoin) {
    out.ok = false;
    out.available = false;
    out.reason = fundingRes.error || liqRes.error || 'empty-clawby';
  }
  return out;
}

// ─── Primary venue env (Bybit BTC/ETH) ──────────────────────────────────────

/**
 * Build env metrics from Bybit linear tickers list (already fetched).
 * @param {Array} bybitTickers - from getBybitTickers style [{ symbol, fundingRate, openInterest, markPrice, price24hPcnt, ...}]
 */
export function buildPrimaryEnvFromBybit(bybitTickers = []) {
  const pick = (sym) => bybitTickers.find((t) => String(t.symbol).toUpperCase() === sym);
  const btc = pick('BTC');
  const eth = pick('ETH');

  const pack = (t) => {
    if (!t) return null;
    const oiUsd = num(t.openInterest) * num(t.markPrice || t.price);
    return {
      symbol: t.symbol,
      price: num(t.markPrice || t.price),
      priceChange24h: num(t.price24hPcnt) * 100,
      fundingRate: num(t.fundingRate),
      fundingRatePct: num(t.fundingRate) * 100,
      openInterestUsd: oiUsd,
      volume24h: num(t.turnover24h),
      source: 'bybit',
    };
  };

  return {
    btc: pack(btc),
    eth: pack(eth),
    source: 'bybit',
    available: !!(btc || eth),
  };
}

/**
 * Fuse primary (Bybit) + secondary (Clawby) into a single 合约环境 panel model.
 */
export function fuseContractEnvironment(primary = {}, clawby = {}, opts = {}) {
  const now = opts.now || Date.now();
  const btcP = primary.btc || null;
  const ethP = primary.eth || null;
  const btcC = clawby.coins?.BTC || null;
  const ethC = clawby.coins?.ETH || null;
  const liq = clawby.global?.liquidations || null;

  // Prefer primary funding; cross-check with Clawby average
  const fundingBtc = btcP?.fundingRate ?? btcC?.funding_avg ?? null;
  const fundingEth = ethP?.fundingRate ?? ethC?.funding_avg ?? null;
  const fundingAvg =
    fundingBtc != null && fundingEth != null
      ? (fundingBtc + fundingEth) / 2
      : fundingBtc ?? fundingEth;

  let fundingAgreement = 'n/a';
  if (btcP?.fundingRate != null && btcC?.funding_avg != null) {
    const a = btcP.fundingRate;
    const b = btcC.funding_avg;
    const sameSign = a === 0 || b === 0 || a * b > 0;
    const rel = Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-8);
    fundingAgreement = sameSign && rel < 0.85 ? 'agree' : sameSign ? 'soft' : 'conflict';
  }

  const oiBtc = btcP?.openInterestUsd || btcC?.oi_usd || 0;
  const oiEth = ethP?.openInterestUsd || ethC?.oi_usd || 0;
  const priceBtc = btcP?.priceChange24h ?? 0;
  const priceEth = ethP?.priceChange24h ?? 0;

  const liqLong = liq?.long_usd_24h || 0;
  const liqShort = liq?.short_usd_24h || 0;
  const liqTotal = liq?.total_usd_24h || liqLong + liqShort;
  const liqLongShare = liqTotal > 0 ? liqLong / liqTotal : null;

  // Long account % (Clawby) — high = crowded retail long
  const longPct = btcC?.long_pct ?? ethC?.long_pct ?? null;
  const takerBuy = btcC?.taker_buy_ratio ?? null;

  // Environment score 0–100 (higher = more risk-on for alt long bias)
  // risk-off when: extreme positive funding + red market, or heavy long liquidations
  let envScore = 50;
  const notes = [];

  if (fundingAvg != null) {
    if (fundingAvg >= ALTCOIN_SIGNAL_RULES.fundingHot) {
      envScore -= 18;
      notes.push('费率偏高：多头拥挤');
    } else if (fundingAvg <= -ALTCOIN_SIGNAL_RULES.fundingHot) {
      envScore += 12;
      notes.push('负费率：空头付费 / 偏挤空');
    } else if (Math.abs(fundingAvg) < ALTCOIN_SIGNAL_RULES.fundingMild) {
      envScore += 4;
      notes.push('费率中性');
    }
  }

  if (priceBtc <= -3 && priceEth <= -3) {
    envScore -= 14;
    notes.push('BTC/ETH 同步走弱');
  } else if (priceBtc >= 2 && priceEth >= 1.5) {
    envScore += 10;
    notes.push('BTC/ETH 偏强');
  }

  if (liqLongShare != null) {
    if (liqLongShare >= 0.62) {
      envScore -= 12;
      notes.push('24h 多头爆仓主导');
    } else if (liqLongShare <= 0.38) {
      envScore += 8;
      notes.push('24h 空头爆仓主导');
    }
  }

  if (longPct != null && longPct >= 58) {
    envScore -= 8;
    notes.push(`账户多头 ${longPct.toFixed(1)}%`);
  } else if (longPct != null && longPct <= 42) {
    envScore += 6;
    notes.push(`账户空头偏多 short%≈${(100 - longPct).toFixed(0)}`);
  }

  if (takerBuy != null) {
    if (takerBuy >= 0.55) {
      envScore += 5;
      notes.push(`主动买 ${((takerBuy) * 100).toFixed(0)}%`);
    } else if (takerBuy <= 0.45) {
      envScore -= 5;
      notes.push(`主动卖 ${((1 - takerBuy) * 100).toFixed(0)}%`);
    }
  }

  if (fundingAgreement === 'conflict') {
    envScore -= 6;
    notes.push('Bybit vs Clawby 费率方向冲突');
  }

  envScore = Math.max(0, Math.min(100, Math.round(envScore)));

  let regime = 'neutral';
  if (envScore >= 62) regime = 'risk-on';
  else if (envScore <= 38) regime = 'risk-off';

  const regimeLabel =
    regime === 'risk-on' ? '偏多环境' : regime === 'risk-off' ? '避险 / 拥挤' : '中性';

  return {
    regime,
    regimeLabel,
    envScore,
    notes: notes.slice(0, 6),
    primary: primary,
    clawby: {
      available: !!clawby.available,
      reason: clawby.reason || '',
      coins: clawby.coins || {},
      liquidations: liq,
    },
    metrics: {
      fundingBtc: fundingBtc,
      fundingEth: fundingEth,
      fundingAvg,
      fundingBtcPct: fundingBtc == null ? null : fundingBtc * 100,
      fundingEthPct: fundingEth == null ? null : fundingEth * 100,
      fundingAgreement,
      oiBtcUsd: oiBtc,
      oiEthUsd: oiEth,
      priceChangeBtc: priceBtc,
      priceChangeEth: priceEth,
      liqTotal24h: liqTotal || null,
      liqLong24h: liqLong || null,
      liqShort24h: liqShort || null,
      liqLongShare,
      longAccountPct: longPct,
      takerBuyRatio: takerBuy,
    },
    sources: {
      primary: primary.available ? 'bybit' : 'none',
      secondary: clawby.available ? 'clawby' : 'none',
    },
    updatedAt: now,
  };
}

// ─── Weekly volume gate (hard) — 连续 2 周成交量环比放大 ───────────────────

/**
 * Parse weekly turnovers newest-first → [w0, w1, w2, ...]
 * Bybit list item: [start, open, high, low, close, volume, turnover]
 * Binance kline: [openTime, o, h, l, c, volume, closeTime, quoteVolume, ...]
 */
export function parseWeeklyTurnovers(rawList, source = 'bybit') {
  if (!Array.isArray(rawList) || rawList.length === 0) return [];
  const out = [];
  for (const row of rawList) {
    if (!row) continue;
    if (source === 'binance') {
      // quote asset volume index 7
      const qv = num(row[7] ?? row.quoteVolume);
      const ts = num(row[0]);
      if (qv > 0) out.push({ start: ts, turnover: qv });
    } else {
      // bybit array or object
      const turnover = num(Array.isArray(row) ? row[6] : row.turnover);
      const ts = num(Array.isArray(row) ? row[0] : row.startTime);
      if (turnover > 0) out.push({ start: ts, turnover });
    }
  }
  // newest first
  out.sort((a, b) => b.start - a.start);
  return out;
}

/**
 * Hard gate: volume 环比上涨连续 2 周.
 * Needs ≥3 weekly bars: w0 (latest) > w1 > w2 with min growth each step.
 *
 * @returns {{ pass, w0, w1, w2, growth1, growth2, compoundGrowth, reason }}
 */
export function evaluateTwoWeekVolumeGrowth(weeklyBars = [], opts = {}) {
  const R = { ...ALTCOIN_SIGNAL_RULES, ...opts };
  const minG = num(R.weekOverWeekMinGrowth) || 0.05;
  const bars = Array.isArray(weeklyBars) ? weeklyBars : [];
  if (bars.length < 3) {
    return {
      pass: false,
      reason: 'need-3-weeks',
      w0: 0,
      w1: 0,
      w2: 0,
      growth1: 0,
      growth2: 0,
      compoundGrowth: 0,
    };
  }
  const w0 = num(bars[0].turnover);
  const w1 = num(bars[1].turnover);
  const w2 = num(bars[2].turnover);
  if (w0 < R.weekVolumeMinUsd) {
    return { pass: false, reason: 'latest-week-too-small', w0, w1, w2, growth1: 0, growth2: 0, compoundGrowth: 0 };
  }
  if (w1 < R.weekVolumePriorMinUsd || w2 < R.weekVolumePriorMinUsd * 0.5) {
    return { pass: false, reason: 'prior-week-too-small', w0, w1, w2, growth1: 0, growth2: 0, compoundGrowth: 0 };
  }
  const growth1 = w1 > 0 ? w0 / w1 - 1 : 0;
  const growth2 = w2 > 0 ? w1 / w2 - 1 : 0;
  const up1 = w0 >= w1 * (1 + minG);
  const up2 = w1 >= w2 * (1 + minG);
  const pass = up1 && up2;
  const compoundGrowth = w2 > 0 ? w0 / w2 - 1 : 0;
  return {
    pass,
    reason: pass ? 'two-week-volume-up' : !up1 ? 'week0-not-up' : 'week1-not-up',
    w0,
    w1,
    w2,
    growth1,
    growth2,
    compoundGrowth,
    minGrowthRequired: minG,
  };
}

export function isExcludedAltcoinSymbol(symbol) {
  const s = String(symbol || '').toUpperCase().replace(/USDT$/i, '');
  if (!s) return true;
  if (ALTCOIN_SIGNAL_RULES.excludeSymbols.includes(s)) return true;
  if (FILTER_OUT.has(s.toLowerCase())) return true;
  return false;
}

/** Run async mapper with concurrency limit */
export async function mapPool(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  const limit = Math.max(1, Number(concurrency) || 6);
  const results = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      try {
        results[i] = await mapper(list[i], i);
      } catch (e) {
        results[i] = { error: e.message || String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return results;
}

/**
 * Fetch weekly turnovers for a USDT perp (Bybit primary, Binance futures fallback).
 * @param {string} symbol e.g. ETH (not ETHUSDT)
 * @param {(url:string, ms?:number)=>Promise<any>} fetcher
 */
export async function fetchWeeklyTurnovers(symbol, fetcher, opts = {}) {
  const sym = String(symbol || '').toUpperCase().replace(/USDT$/i, '');
  const pair = `${sym}USDT`;
  const timeout = opts.timeoutMs || 6000;

  // Bybit linear weekly
  try {
    const bybitUrl = `${BYBIT_BASE}/v5/market/kline?category=linear&symbol=${encodeURIComponent(pair)}&interval=W&limit=4`;
    const data = await fetcher(bybitUrl, timeout);
    const list = data?.result?.list || data?.list || [];
    const bars = parseWeeklyTurnovers(list, 'bybit');
    if (bars.length >= 3) return { ok: true, source: 'bybit', symbol: sym, bars };
  } catch (_) {
    /* fall through */
  }

  // Binance USDT-M futures weekly
  try {
    const bnUrl = `${BINANCE_FUTURES}/fapi/v1/klines?symbol=${encodeURIComponent(pair)}&interval=1w&limit=4`;
    const data = await fetcher(bnUrl, timeout);
    const bars = parseWeeklyTurnovers(Array.isArray(data) ? data : [], 'binance');
    if (bars.length >= 3) return { ok: true, source: 'binance', symbol: sym, bars };
  } catch (_) {
    /* fall through */
  }

  return { ok: false, source: 'none', symbol: sym, bars: [] };
}

/**
 * Score a token that ALREADY passed the 2-week volume gate.
 * Ranking dims: 成交量涨幅 + 合约 OI 激增 + 资金费率异常.
 */
export function scoreWeeklyVolumeAlert(bybitTicker, weeklyEval, binanceData = {}, geckoMeta = {}, env = null) {
  const R = ALTCOIN_SIGNAL_RULES;
  const symbol = String(bybitTicker.symbol || '').toUpperCase().replace(/USDT$/i, '');
  if (isExcludedAltcoinSymbol(symbol)) return null;
  if (!weeklyEval?.pass) return null;

  const meta = geckoMeta[symbol.toLowerCase()] || {};
  const binance = binanceData[symbol] || {};
  const funding = num(bybitTicker.fundingRate);
  const absFr = Math.abs(funding);
  const pct24h = num(bybitTicker.price24hPcnt) * 100;
  const turnover24h = Math.max(num(bybitTicker.turnover24h), num(binance.quoteVolume));
  const oiUsd = num(bybitTicker.openInterest) * num(bybitTicker.markPrice || bybitTicker.price);

  const signals = [];
  let raw = 0;

  // 1) Primary: two-week volume expansion magnitude
  const g1 = Math.max(0, num(weeklyEval.growth1));
  const g2 = Math.max(0, num(weeklyEval.growth2));
  const compound = Math.max(0, num(weeklyEval.compoundGrowth));
  const volGrowthScore = Math.min(55, g1 * 80 + g2 * 50 + compound * 20);
  raw += volGrowthScore;
  signals.push({
    type: 'volume',
    label: '连续2周量能放大',
    detail: `环比 +${(g1 * 100).toFixed(0)}% / +${(g2 * 100).toFixed(0)}% · 两周复合 +${(compound * 100).toFixed(0)}%`,
    severity: Math.min(5, 2 + g1 * 3 + g2 * 2),
    bias: 'volume-2w-up',
  });
  signals.push({
    type: 'volume_week',
    label: '周成交额',
    detail: `${formatCompact(weeklyEval.w0)} → 前周 ${formatCompact(weeklyEval.w1)}`,
    severity: 2,
  });

  // 2) 合约量 / OI 激增（名义持仓规模）
  if (oiUsd >= R.oiFloor) {
    const sev = Math.min(oiUsd / R.oiStrong, 3.5);
    raw += sev * 12;
    signals.push({
      type: 'oi',
      label: '合约持仓量大',
      detail: formatCompact(oiUsd),
      severity: Math.min(sev, 3.5),
      bias: 'oi-surge',
    });
  }
  // 24h 合约成交额放大（相对周均）
  const weekDailyAvg = weeklyEval.w0 / 7;
  if (weekDailyAvg > 0 && turnover24h >= weekDailyAvg * 1.4 && turnover24h >= R.volume24hStrong * 0.4) {
    raw += 10;
    signals.push({
      type: 'volume',
      label: '24h 合约成交激增',
      detail: `${formatCompact(turnover24h)} · 高于周均`,
      severity: 2.5,
      bias: 'turnover-spike',
    });
  }

  // 3) 资金费率异常
  if (absFr >= R.fundingMild) {
    const sev = absFr >= R.fundingExtreme ? 3 : absFr >= R.fundingHot ? 2.2 : 1.2;
    raw += sev * 14;
    const crowdedLong = funding > 0;
    signals.push({
      type: 'funding',
      label: crowdedLong ? '资金费率偏高·多' : '资金费率偏高·空',
      detail: `${(funding * 100).toFixed(4)}%`,
      severity: Math.min(sev, 3),
      bias: crowdedLong ? 'long-crowded' : 'short-crowded',
    });
  }

  // Structure tags (secondary, still useful for action advice)
  if (absFr >= R.fundingMild && Math.abs(pct24h) >= 5) {
    if (funding > 0 && pct24h < -5) {
      raw += 12;
      signals.push({
        type: 'structure',
        label: '多头踩踏风险',
        detail: '正费率 + 下跌',
        severity: 3,
        bias: 'long-flush',
      });
    } else if (funding < 0 && pct24h > 5) {
      raw += 12;
      signals.push({
        type: 'structure',
        label: '空头轧空结构',
        detail: '负费率 + 上涨',
        severity: 3,
        bias: 'short-squeeze',
      });
    } else if (funding > 0 && pct24h > 10) {
      raw += 6;
      signals.push({
        type: 'structure',
        label: '多头趋势+费率',
        detail: '顺势但拥挤',
        severity: 2,
        bias: 'trend-crowded',
      });
    }
  }

  let score = Math.min(100, raw);
  const regime = env?.regime || 'neutral';
  if (regime === 'risk-off') score = Math.max(0, score - R.envRiskOffPenalty);
  else if (regime === 'risk-on') score = Math.min(100, score + R.envRiskOnBoost);

  if (score < R.minScore) return null;

  const sorted = [...signals].sort((a, b) => (b.severity || 0) - (a.severity || 0));
  const setupBias =
    sorted.find((s) => s.type === 'structure')?.bias ||
    sorted.find((s) => s.bias === 'volume-2w-up')?.bias ||
    sorted[0]?.bias ||
    'volume-2w-up';

  const base = {
    symbol,
    name: meta.name || symbol,
    icon: meta.image || '',
    geckoId: meta.id || null,
    marketCap: meta.marketCap || 0,
    marketCapRank: meta.marketCapRank || 999,
    price: num(bybitTicker.markPrice || bybitTicker.price),
    priceChange24h: pct24h,
    volume24h: turnover24h,
    fundingRate: funding,
    openInterest: oiUsd,
    score: Math.round(score * 10) / 10,
    signals: sorted,
    signalCount: sorted.length,
    strongestSignal: sorted[0]?.type || 'volume',
    strongestLabel: sorted[0]?.label || '连续2周量能放大',
    strongestDetail: sorted[0]?.detail || '',
    setupBias,
    confirms: sorted.length,
    envRegime: regime,
    envScore: env?.envScore ?? null,
    rulesVersion: R.rulesVersion,
    // weekly volume stats for UI
    weeklyVolume: {
      w0: weeklyEval.w0,
      w1: weeklyEval.w1,
      w2: weeklyEval.w2,
      growth1: weeklyEval.growth1,
      growth2: weeklyEval.growth2,
      compoundGrowth: weeklyEval.compoundGrowth,
      pass: true,
    },
    volumeGrowthRankKey: compound, // sort key: 两周复合涨幅
    timestamp: Date.now(),
    source: 'weekly-vol-v3',
  };

  const advice = deriveActionAdvice(base, env);
  return { ...base, ...advice };
}

/**
 * Build Top-20 alert list from Bybit tickers + weekly volume checks.
 * @param {object} opts
 * @param {Array} opts.bybitTickers
 * @param {object} opts.binanceMap
 * @param {object} opts.geckoMeta
 * @param {object|null} opts.env
 * @param {(url:string, ms?:number)=>Promise<any>} opts.fetcher
 */
export async function collectWeeklyVolumeAlerts(opts = {}) {
  const R = ALTCOIN_SIGNAL_RULES;
  const bybitTickers = Array.isArray(opts.bybitTickers) ? opts.bybitTickers : [];
  const fetcher = opts.fetcher;
  if (typeof fetcher !== 'function') {
    return { rows: [], meta: { error: 'no-fetcher', candidates: 0, passed: 0 } };
  }

  // Pre-pool: exclude BTC/stables, sort by 24h turnover, take top scanPoolSize
  const pool = bybitTickers
    .filter((t) => t && !isExcludedAltcoinSymbol(t.symbol))
    .map((t) => ({
      ...t,
      symbol: String(t.symbol || '').toUpperCase().replace(/USDT$/i, ''),
      _turnover: Math.max(num(t.turnover24h), 0),
    }))
    .sort((a, b) => b._turnover - a._turnover)
    .slice(0, R.scanPoolSize);

  const weeklyResults = await mapPool(pool, R.klineConcurrency, async (t) => {
    const wk = await fetchWeeklyTurnovers(t.symbol, fetcher);
    const eval_ = evaluateTwoWeekVolumeGrowth(wk.bars || []);
    return { ticker: t, weekly: wk, eval: eval_ };
  });

  const scored = [];
  let passedGate = 0;
  for (const item of weeklyResults) {
    if (!item || item.error || !item.eval) continue;
    if (!item.eval.pass) continue;
    passedGate += 1;
    const row = scoreWeeklyVolumeAlert(
      item.ticker,
      item.eval,
      opts.binanceMap || {},
      opts.geckoMeta || {},
      opts.env || null
    );
    if (row) {
      row.weeklySource = item.weekly?.source || 'unknown';
      scored.push(row);
    }
  }

  // Rank: primarily by two-week compound volume growth, then score
  scored.sort((a, b) => {
    const cg = num(b.volumeGrowthRankKey) - num(a.volumeGrowthRankKey);
    if (Math.abs(cg) > 0.01) return cg;
    return num(b.score) - num(a.score);
  });

  const top = scored.slice(0, R.maxResults);
  // Re-apply action ranking for display order within top20 (optional soft)
  const ranked = rankSignalsWithEnv(top, opts.env).map((r, i) => ({
    ...r,
    rank: i + 1,
  }));

  return {
    rows: ranked,
    meta: {
      rulesVersion: R.rulesVersion,
      candidates: pool.length,
      passedWeeklyGate: passedGate,
      collected: ranked.length,
      maxResults: R.maxResults,
      exclude: R.excludeSymbols,
      gate: 'two-week-volume-up-ex-btc',
    },
  };
}

// ─── Legacy multi-factor scorer (kept for tests / RH path compatibility) ─────

/**
 * Score one Bybit linear ticker with redesigned multi-factor rules.
 * Optional env soft-adjusts final score (risk-off penalty / risk-on boost).
 *
 * @returns null if below threshold
 */
export function scoreAltcoinPerpSignal(bybitTicker, binanceData = {}, geckoMeta = {}, env = null) {
  const R = ALTCOIN_SIGNAL_RULES;
  const symbol = String(bybitTicker.symbol || '').toUpperCase();
  if (!symbol || FILTER_OUT.has(symbol.toLowerCase())) return null;

  const meta = geckoMeta[symbol.toLowerCase()] || {};
  const binance = binanceData[symbol] || binanceData[`${symbol}`] || {};

  const funding = num(bybitTicker.fundingRate);
  const absFr = Math.abs(funding);
  const pct24h = num(bybitTicker.price24hPcnt) * 100;
  const absPct = Math.abs(pct24h);
  if (absPct > R.priceMoveCap) return null;

  const turnover = Math.max(num(bybitTicker.turnover24h), num(binance.quoteVolume));
  const oiUsd = num(bybitTicker.openInterest) * num(bybitTicker.markPrice || bybitTicker.price);

  const signals = [];
  let raw = 0;
  let confirms = 0; // independent factors

  // 1) Funding posture
  if (absFr >= R.fundingMild) {
    confirms += 1;
    const sev =
      absFr >= R.fundingExtreme ? 3 : absFr >= R.fundingHot ? 2.2 : 1.2;
    raw += sev * 14;
    const crowdedLong = funding > 0;
    signals.push({
      type: 'funding',
      label: crowdedLong ? '多头费率拥挤' : '空头费率拥挤',
      detail: `${(funding * 100).toFixed(4)}%`,
      severity: Math.min(sev, 3),
      bias: crowdedLong ? 'long-crowded' : 'short-crowded',
    });
  }

  // 2) Price move (needs volume or funding companion later)
  if (absPct >= R.priceMoveMin) {
    confirms += 1;
    const sev = absPct >= R.priceMoveStrong ? Math.min(absPct / 12, 4) : absPct / 18;
    raw += sev * 11;
    signals.push({
      type: 'price',
      label: pct24h >= 0 ? '价格拉升' : '价格下挫',
      detail: `${pct24h >= 0 ? '+' : ''}${pct24h.toFixed(2)}%`,
      severity: Math.min(sev, 4),
      bias: pct24h >= 0 ? 'up' : 'down',
    });
  }

  // 3) Volume
  if (turnover >= R.volumeFloor) {
    confirms += 1;
    const sev = Math.min(turnover / R.volumeStrong, 3.5);
    raw += sev * 9;
    signals.push({
      type: 'volume',
      label: '成交额放大',
      detail: formatCompact(turnover),
      severity: Math.min(sev, 3.5),
    });
  }

  // 4) OI notional
  if (oiUsd >= R.oiFloor) {
    confirms += 1;
    const sev = Math.min(oiUsd / R.oiStrong, 3.5);
    raw += sev * 10;
    signals.push({
      type: 'oi',
      label: 'OI 规模',
      detail: formatCompact(oiUsd),
      severity: Math.min(sev, 3.5),
    });
  }

  // 5) Structure bonuses (true alt "setup" tags)
  // Funding vs price divergence → squeeze / flush risk
  if (absFr >= R.fundingMild && absPct >= R.priceMoveMin) {
    if (funding > 0 && pct24h < -R.priceMoveMin) {
      raw += 16;
      confirms += 1;
      signals.push({
        type: 'structure',
        label: '多头踩踏风险',
        detail: '正费率 + 下跌',
        severity: 3,
        bias: 'long-flush',
      });
    } else if (funding < 0 && pct24h > R.priceMoveMin) {
      raw += 16;
      confirms += 1;
      signals.push({
        type: 'structure',
        label: '空头轧空结构',
        detail: '负费率 + 上涨',
        severity: 3,
        bias: 'short-squeeze',
      });
    } else if (funding > 0 && pct24h > R.priceMoveStrong) {
      raw += 8;
      signals.push({
        type: 'structure',
        label: '多头趋势+费率',
        detail: '顺势但拥挤',
        severity: 2,
        bias: 'trend-crowded',
      });
    }
  }

  // Volume + price coincidence
  if (turnover >= R.volumeFloor && absPct >= R.priceMoveMin) {
    raw += 10;
  }

  // Multi-factor gate: pure single-factor noise out
  if (confirms < 2 && raw < R.minScore + 10) return null;
  if (signals.length === 0) return null;

  // Soft multi-signal boost
  if (signals.length >= 3) raw *= 1.12;
  if (signals.length >= 4) raw *= 1.08;

  let score = Math.min(100, raw);

  // Environment soft adjust (does not kill list; risk-off makes listing harder)
  const regime = env?.regime || 'neutral';
  if (regime === 'risk-off') {
    score = Math.max(0, score - R.envRiskOffPenalty);
  } else if (regime === 'risk-on') {
    score = Math.min(100, score + R.envRiskOnBoost);
  }

  // risk-off: structure setups keep lower floor; pure trend noise needs higher score
  const setupBiasEarly =
    signals.find((s) => s.type === 'structure')?.bias ||
    signals.find((s) => s.bias)?.bias ||
    '';
  let minNeed = R.minScore;
  if (regime === 'risk-off') {
    const structureOk = ['long-flush', 'short-squeeze', 'short-crowded'].includes(setupBiasEarly);
    if (!structureOk) minNeed = R.minScore + R.riskOffMinScoreExtra;
  }
  if (score < minNeed) return null;

  // Sort signals by severity for strongest*
  const sorted = [...signals].sort((a, b) => (b.severity || 0) - (a.severity || 0));
  const setupBias =
    sorted.find((s) => s.type === 'structure')?.bias || sorted[0]?.bias || '';

  const base = {
    symbol,
    name: meta.name || symbol,
    icon: meta.image || '',
    geckoId: meta.id || null,
    marketCap: meta.marketCap || 0,
    marketCapRank: meta.marketCapRank || 999,
    price: num(bybitTicker.markPrice || bybitTicker.price),
    priceChange24h: pct24h,
    volume24h: turnover,
    fundingRate: funding,
    openInterest: oiUsd,
    score: Math.round(score * 10) / 10,
    signals: sorted,
    signalCount: sorted.length,
    strongestSignal: sorted[0]?.type || 'unknown',
    strongestLabel: sorted[0]?.label || '',
    strongestDetail: sorted[0]?.detail || '',
    setupBias,
    confirms,
    envRegime: regime,
    envScore: env?.envScore ?? null,
    rulesVersion: 'altcoin-perp-v2',
    timestamp: Date.now(),
    source: 'bybit+binance+rules-v2',
  };

  const advice = deriveActionAdvice(base, env);
  return { ...base, ...advice };
}

/**
 * Map setup + 合约环境 → 操作建议（Altcoin only; not execution）.
 * priority: higher sorts first within same score band.
 */
export function deriveActionAdvice(signal = {}, env = null) {
  const regime = env?.regime || signal.envRegime || 'neutral';
  const bias = signal.setupBias || '';
  const score = num(signal.score);

  // Default
  let action = 'watch';
  let actionLabel = '观察';
  let priority = 40;
  let actionReason = '周量能已连涨2周，等待结构/费率二次确认';

  // 已通过硬门：连续2周量能放大 — 默认进入观察池，高分优先
  if (bias === 'volume-2w-up' || bias === 'turnover-spike') {
    if (score >= 55) {
      action = 'prefer';
      actionLabel = '量能优先';
      priority = 70 + Math.min(20, Math.round(score / 5));
      actionReason = '连续2周成交量环比放大 · 全市场量能异动 Top';
    } else {
      action = 'watch';
      actionLabel = '量能观察';
      priority = 52;
      actionReason = '周量能连涨达标，关注 OI/费率是否共振';
    }
  } else if (bias === 'short-squeeze') {
    if (regime === 'risk-on' || regime === 'neutral') {
      action = 'prefer';
      actionLabel = '优先关注';
      priority = 90;
      actionReason = '负费率+上涨 · 轧空结构，环境未避险';
    } else {
      action = 'watch';
      actionLabel = '谨慎观察';
      priority = 55;
      actionReason = '轧空结构但大盘避险，仓位与节奏宜保守';
    }
  } else if (bias === 'long-flush') {
    if (regime === 'risk-off') {
      action = 'prefer';
      actionLabel = '优先关注';
      priority = 88;
      actionReason = '避险环境 + 多头踩踏，顺势结构优先';
    } else if (regime === 'neutral') {
      action = 'watch';
      actionLabel = '观察';
      priority = 60;
      actionReason = '多头踩踏结构，中性环境等二次确认';
    } else {
      action = 'fade';
      actionLabel = '仅观察';
      priority = 25;
      actionReason = '偏多环境里的踩踏可能是洗盘，勿追空';
    }
  } else if (bias === 'trend-crowded' || bias === 'long-crowded') {
    if (regime === 'risk-off') {
      action = 'fade';
      actionLabel = '仅观察';
      priority = 15;
      actionReason = '避险 + 多头拥挤/顺势费率，假突破风险高';
    } else if (regime === 'risk-on' && score >= 55) {
      action = 'watch';
      actionLabel = '趋势观察';
      priority = 50;
      actionReason = '偏多环境可跟踪，但费率拥挤勿追高';
    } else {
      action = 'fade';
      actionLabel = '仅观察';
      priority = 20;
      actionReason = '顺势但拥挤，默认不作为优先标的';
    }
  } else if (bias === 'short-crowded') {
    if (regime === 'risk-on') {
      action = 'prefer';
      actionLabel = '优先关注';
      priority = 75;
      actionReason = '偏多 + 空头费率拥挤，反转/轧空观察池';
    } else {
      action = 'watch';
      actionLabel = '观察';
      priority = 45;
      actionReason = '空头拥挤，等价格配合';
    }
  } else if (regime === 'risk-off') {
    action = 'fade';
    actionLabel = '仅观察';
    priority = 18;
    actionReason = '避险环境默认降权，除非出现踩踏/轧空结构';
  } else if (score >= 65) {
    action = 'watch';
    actionLabel = '观察';
    priority = 48;
    actionReason = '高分多因子，待结构标签';
  }

  return {
    action, // prefer | watch | fade
    actionLabel,
    actionPriority: priority,
    actionReason,
  };
}

/**
 * Re-rank: action priority first, then score. Attach advice if missing.
 */
export function rankSignalsWithEnv(scoredList = [], env = null) {
  return (Array.isArray(scoredList) ? scoredList : [])
    .map((c) => {
      const advice = c.action ? c : { ...c, ...deriveActionAdvice(c, env) };
      return {
        ...advice,
        envRegime: env?.regime || advice.envRegime || null,
        envScore: env?.envScore ?? advice.envScore ?? null,
      };
    })
    .sort((a, b) => {
      const ap = num(b.actionPriority) - num(a.actionPriority);
      if (ap !== 0) return ap;
      return num(b.score ?? b.signalScore) - num(a.score ?? a.signalScore);
    });
}

export function applyEnvToScoreList(scoredList, env) {
  if (!Array.isArray(scoredList)) return [];
  let list = scoredList;
  if (env) {
    list = scoredList
      .map((c) => {
        let score = c.score;
        if (env.regime === 'risk-off') score = Math.max(0, score - ALTCOIN_SIGNAL_RULES.envRiskOffPenalty);
        else if (env.regime === 'risk-on') score = Math.min(100, score + ALTCOIN_SIGNAL_RULES.envRiskOnBoost);
        const next = {
          ...c,
          score: Math.round(score * 10) / 10,
          envRegime: env.regime,
          envScore: env.envScore,
        };
        return { ...next, ...deriveActionAdvice(next, env) };
      })
      .filter((c) => c.score >= ALTCOIN_SIGNAL_RULES.minScore);
  }
  return rankSignalsWithEnv(list, env);
}

/**
 * Per-symbol Clawby depth (OI / L-S / taker / cross funding from exchange list).
 * Used for top-N alt signals only — latency budget.
 */
export async function fetchClawbySymbolDepth(apiKey, symbol) {
  const coin = String(symbol || '')
    .toUpperCase()
    .replace(/USDT$/i, '')
    .trim();
  if (!apiKey || !coin) return { ok: false, symbol: coin, error: 'bad-args' };

  const pair = `${coin}USDT`;
  const [oiRes, lsRes, takerRes, fundingRes] = await Promise.all([
    clawbyRelay(apiKey, 'futures_open_interest_exchange_list', { symbol: coin }),
    clawbyRelay(apiKey, 'futures_global_long_short_account_ratio_history', {
      exchange: 'Binance',
      symbol: pair,
      interval: '1h',
    }),
    clawbyRelay(apiKey, 'futures_taker_buy_sell_volume_exchange_list', {
      symbol: coin,
      range: '4h',
    }),
    clawbyRelay(apiKey, 'futures_funding_rate_exchange_list', {}),
  ]);

  const depth = {
    ok: true,
    symbol: coin,
    pair,
    source: 'clawby',
    oi_usd: null,
    oi_change_pct_24h: null,
    long_pct: null,
    short_pct: null,
    ls_ratio: null,
    taker_buy_ratio: null,
    taker_sell_ratio: null,
    funding_avg: null,
    funding_avg_pct: null,
    funding_venues: [],
    summary: '',
  };

  if (oiRes.ok) {
    const list = rowsOf(oiRes.data);
    const all = list.find((r) => String(r.exchange || '').toLowerCase() === 'all') || list[0];
    if (all) {
      depth.oi_usd = num(all.open_interest_usd);
      depth.oi_change_pct_24h = num(
        all.open_interest_change_percent_24h ?? all.oi_change_percent_24h
      );
    }
  }
  if (lsRes.ok) {
    const hist = rowsOf(lsRes.data);
    const last = hist[hist.length - 1];
    if (last) {
      depth.long_pct = num(last.global_account_long_percent);
      depth.short_pct = num(last.global_account_short_percent);
      depth.ls_ratio = num(last.global_account_long_short_ratio);
    }
  }
  if (takerRes.ok) {
    const body = takerRes.data?.data || takerRes.data;
    if (body && body.buy_ratio != null) {
      depth.taker_buy_ratio = num(body.buy_ratio);
      depth.taker_sell_ratio = num(body.sell_ratio);
    }
  }
  if (fundingRes.ok) {
    const list = rowsOf(fundingRes.data);
    const entry = list.find((r) => String(r.symbol || '').toUpperCase() === coin);
    if (entry) {
      const venues = (entry.stablecoin_margin_list || [])
        .map((e) => ({
          exchange: e.exchange,
          rate: num(e.funding_rate),
          rate_pct: num(e.funding_rate) * 100,
        }))
        .filter((e) => Number.isFinite(e.rate));
      const avg = venues.length
        ? venues.reduce((s, e) => s + e.rate, 0) / venues.length
        : null;
      depth.funding_avg = avg;
      depth.funding_avg_pct = avg == null ? null : avg * 100;
      depth.funding_venues = venues.slice(0, 5);
    }
  }

  const bits = [];
  if (depth.funding_avg_pct != null) bits.push(`费率均 ${depth.funding_avg_pct.toFixed(4)}%`);
  if (depth.oi_usd) bits.push(`OI ${formatCompact(depth.oi_usd)}`);
  if (depth.oi_change_pct_24h) bits.push(`OI24h ${depth.oi_change_pct_24h > 0 ? '+' : ''}${depth.oi_change_pct_24h.toFixed(1)}%`);
  if (depth.long_pct != null) bits.push(`多账户 ${depth.long_pct.toFixed(1)}%`);
  if (depth.taker_buy_ratio != null) bits.push(`主动买 ${(depth.taker_buy_ratio * 100).toFixed(0)}%`);
  depth.summary = bits.join(' · ') || 'Clawby 无有效字段';
  depth.ok = bits.length > 0;
  if (!depth.ok) depth.error = 'empty-depth';
  return depth;
}

/**
 * Enrich top rows with Clawby symbol depth; optional score nudge from agreement.
 * @param {string} apiKey
 * @param {Array} rows scored signal rows
 * @param {{ topN?: number, bybitFundingBySymbol?: Record<string, number> }} opts
 */
export async function enrichTopSignalsWithClawbyDepth(apiKey, rows = [], opts = {}) {
  if (!apiKey || !Array.isArray(rows) || rows.length === 0) {
    return { rows, depthCount: 0 };
  }
  const topN = Math.min(
    Number(opts.topN || ALTCOIN_SIGNAL_RULES.clawbyDepthTopN),
    rows.length
  );
  const targets = rows.slice(0, topN);
  const depths = await Promise.all(
    targets.map((r) => fetchClawbySymbolDepth(apiKey, r.symbol))
  );

  const bybitMap = opts.bybitFundingBySymbol || {};
  const out = rows.map((row, i) => {
    if (i >= topN) return row;
    const depth = depths[i];
    if (!depth?.ok) {
      return {
        ...row,
        clawbyDepth: depth || { ok: false },
        clawbyDepthOk: false,
      };
    }

    // Funding agreement primary vs Clawby
    const primaryFr = row.fundingRate != null ? num(row.fundingRate) : bybitMap[row.symbol];
    let fundingAgreement = 'n/a';
    if (primaryFr != null && depth.funding_avg != null) {
      const sameSign = primaryFr === 0 || depth.funding_avg === 0 || primaryFr * depth.funding_avg > 0;
      const rel =
        Math.abs(primaryFr - depth.funding_avg) /
        Math.max(Math.abs(primaryFr), Math.abs(depth.funding_avg), 1e-8);
      fundingAgreement = sameSign && rel < 0.85 ? 'agree' : sameSign ? 'soft' : 'conflict';
    }

    let score = num(row.score ?? row.signalScore);
    if (fundingAgreement === 'agree') score = Math.min(100, score + 3);
    else if (fundingAgreement === 'conflict') score = Math.max(0, score - 6);

    // Taker confirms structure
    if (depth.taker_buy_ratio != null) {
      if (row.setupBias === 'short-squeeze' && depth.taker_buy_ratio >= 0.52) score = Math.min(100, score + 4);
      if (row.setupBias === 'long-flush' && depth.taker_buy_ratio <= 0.48) score = Math.min(100, score + 4);
      if (row.setupBias === 'trend-crowded' && depth.taker_buy_ratio < 0.48) score = Math.max(0, score - 4);
    }

    const next = {
      ...row,
      score: Math.round(score * 10) / 10,
      signalScore: Math.round(score * 10) / 10,
      clawbyDepth: {
        ...depth,
        fundingAgreement,
      },
      clawbyDepthOk: true,
      source: row.source?.includes('clawby') ? row.source : `${row.source || 'v2'}+clawby-depth`,
    };
    return { ...next, ...deriveActionAdvice(next, { regime: row.envRegime, envScore: row.envScore }) };
  });

  return {
    rows: rankSignalsWithEnv(out, {
      regime: rows[0]?.envRegime,
      envScore: rows[0]?.envScore,
    }),
    depthCount: depths.filter((d) => d?.ok).length,
  };
}

/** Banner copy for UI from environment */
export function buildEnvListGuidance(env = null) {
  if (!env) return { tone: 'neutral', text: '环境未就绪' };
  if (env.regime === 'risk-off') {
    return {
      tone: 'off',
      text: '避险环境：优先「多头踩踏」结构；顺势拥挤/无结构信号降为仅观察，列表已按操作优先级排序',
    };
  }
  if (env.regime === 'risk-on') {
    return {
      tone: 'on',
      text: '偏多环境：轧空/空头拥挤可优先；多头费率拥挤勿追高，仅作趋势观察',
    };
  }
  return {
    tone: 'neutral',
    text: '中性环境：以结构标签（轧空/踩踏）为主，多因子高分其次',
  };
}

export { FILTER_OUT, formatCompact };

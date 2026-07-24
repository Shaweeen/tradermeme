/**
 * Altcoin-only module (does NOT touch Memecoin).
 *
 * - Contract market environment (BTC/ETH leverage posture)
 * - Redesigned CEX perpetual signal rules
 * - Optional Clawby relay as second source (funding / OI / liq / L-S / taker)
 *
 * Clawby: https://api.openclawby.com/api/relay  (same family as tradingview-mcp crypto tools)
 */

const CLAWBY_BASE = process.env.CLAWBY_BASE || 'https://api.openclawby.com';

// ─── Signal rules (Altcoin CEX perps) ───────────────────────────────────────
/** Redesigned thresholds — multi-factor, less noise than pure volume flags */
export const ALTCOIN_SIGNAL_RULES = {
  // Funding: |rate| as decimal (0.0001 = 0.01%)
  fundingMild: 0.00015, // 0.015%
  fundingHot: 0.0004, // 0.04%
  fundingExtreme: 0.001, // 0.1%
  // Price 24h %
  priceMoveMin: 6,
  priceMoveStrong: 15,
  priceMoveCap: 120, // ignore absurd prints
  // Volume USD (turnover)
  volumeFloor: 2_000_000,
  volumeStrong: 25_000_000,
  // OI notional USD
  oiFloor: 3_000_000,
  oiStrong: 40_000_000,
  // Dual confirmation: need score ≥ this after multi-factor
  minScore: 28,
  maxResults: 12,
  // Environment soft gate for listing quality (not a hard block on env alone)
  envRiskOffPenalty: 12,
  envRiskOnBoost: 6,
};

const FILTER_OUT = new Set([
  'usdt', 'usdc', 'dai', 'busd', 'tusd', 'usdp', 'fdusd', 'usdd', 'gusd',
  'lusd', 'husd', 'susd', 'ousd', 'pyusd', 'usdce', 'steth', 'weth', 'wbtc',
  'wsteth', 'reth', 'sfrxeth', 'wbeth', 'cbeth',
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

// ─── Redesigned per-symbol signal rules ─────────────────────────────────────

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

  if (score < R.minScore) return null;

  // Sort signals by severity for strongest*
  const sorted = [...signals].sort((a, b) => (b.severity || 0) - (a.severity || 0));

  return {
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
    setupBias: sorted.find((s) => s.type === 'structure')?.bias || sorted[0]?.bias || '',
    confirms,
    envRegime: regime,
    envScore: env?.envScore ?? null,
    rulesVersion: 'altcoin-perp-v2',
    timestamp: Date.now(),
    source: 'bybit+binance+rules-v2',
  };
}

export function applyEnvToScoreList(scoredList, env) {
  if (!env || !Array.isArray(scoredList)) return scoredList;
  return scoredList
    .map((c) => {
      let score = c.score;
      if (env.regime === 'risk-off') score = Math.max(0, score - ALTCOIN_SIGNAL_RULES.envRiskOffPenalty);
      else if (env.regime === 'risk-on') score = Math.min(100, score + ALTCOIN_SIGNAL_RULES.envRiskOnBoost);
      return {
        ...c,
        score: Math.round(score * 10) / 10,
        envRegime: env.regime,
        envScore: env.envScore,
      };
    })
    .filter((c) => c.score >= ALTCOIN_SIGNAL_RULES.minScore)
    .sort((a, b) => b.score - a.score);
}

export { FILTER_OUT, formatCompact };

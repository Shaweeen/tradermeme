(function attachSignalEngine(global) {
  'use strict';

  const V2 = {
    version: 'gmgn-monitor-heat-v4',
    weights: {
      priceMomentum: 0.12,
      volumeQuality: 0.15,
      buyPressure: 0.15,
      smartMoneyQuality: 0.33,
      riskAdjusted: 0.25,
    },
    /**
     * Signal collection = ONLY hot memecoins in 5m / 15m / 1h on-chain windows.
     * Heat standard ≈ GMGN Monitor · Smart Net Inflow board rules (proxy via
     * smart net USD + smart/KOL wallet counts + short-window volume / tx activity).
     */
    thresholds: {
      aiScore: 62,
      maxAiRisk: 72,
      monitorInflow: 62,
      monitorMaxRisk: 68,
      priceSurge1h: 15,
      volume1hMin: 80_000,
      buyPressure: 75,
      // --- Monitor Smart Net Inflow heat floors ---
      // 5m burst
      net5mMin: 2_500,
      net5mStrong: 8_000,
      smartWallets5mMin: 2,
      volume5mMin: 12_000,
      // 15m build
      net15mMin: 6_000,
      net15mStrong: 20_000,
      smartWallets15mMin: 3,
      volume15mMin: 40_000,
      // 1h sustained heat (txid / volume + smart participation)
      volume1hHot: 80_000,
      net1hMin: 10_000,
      smartWallets1hMin: 3,
      smartCount1hMin: 2,
      // composite monitor score (same formula as getMonitorInflowScore)
      monitorHeatScore: 58,
    },
  };

  function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

  /** Prefer first finite number (including 0). */
  function numFinite(...values) {
    for (const v of values) {
      if (v == null || v === '') continue;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  /** Prefer first non-zero finite; fall back to 0. (legacy monitor metrics) */
  function num(...values) {
    for (const v of values) {
      const n = Number(v);
      if (Number.isFinite(n) && n !== 0) return n;
    }
    return 0;
  }

  function calculateBuyPercent(token) {
    const buys = Number(token?.txns24h?.buys ?? token?.txns1h?.buys ?? 0);
    const sells = Number(token?.txns24h?.sells ?? token?.txns1h?.sells ?? 0);
    const total = buys + sells;
    if (!total) return null; // unknown — do not invent 50% buy pressure
    return (buys / total) * 100;
  }

  function labelRisk(score) {
    if (score >= 85) return '极高';
    if (score >= 65) return '高';
    if (score >= 38) return '中';
    return '低';
  }

  function labelSignal(score) {
    if (score >= 90) return '重点报警';
    if (score >= 75) return '强报警';
    if (score >= 62) return '普通报警';
    if (score >= 40) return '观察';
    return '忽略';
  }

  function getMonitorMetrics(token = {}) {
    const volume1h = numFinite(
      token.volume1h,
      token.volume_1h,
      token.volume?.h1,
      token.buys_volume_1h
    );
    return {
      smartNetInflow5m: num(token.smartNetInflow5m, token.smart_net_inflow_5m, token.smart_netflow_5m, token.net_inflow_5m),
      smartNetInflow15m: num(token.smartNetInflow15m, token.smart_net_inflow_15m, token.smart_netflow_15m, token.net_inflow_15m),
      smartNetInflow1h: num(token.smartNetInflow1h, token.smart_net_inflow_1h, token.smart_netflow_1h, token.net_inflow_1h),
      volume5m: num(token.volume5m, token.volume_5m, token.volume?.m5),
      volume15m: num(token.volume15m, token.volume_15m, token.volume?.m15),
      volume1h,
      // txid heat proxies (swap count in short windows)
      txns5m: numFinite(token.txns5m, token.swaps_5m, token.txns?.m5?.total),
      txns15m: numFinite(token.txns15m, token.swaps_15m, token.txns?.m15?.total),
      txns1h: numFinite(
        token.txns1h?.total,
        token.swaps_1h,
        (Number(token.txns1h?.buys) || 0) + (Number(token.txns1h?.sells) || 0)
      ),
      newWallets5m: num(token.newWallets5m, token.new_wallets_5m, token.new_wallet_count_5m),
      newWallets15m: num(token.newWallets15m, token.new_wallets_15m, token.new_wallet_count_15m),
      smartWallets5m: num(token.smartWallets5m, token.smart_wallets_5m, token.smart_count_5m, token.smartCount5m),
      smartWallets15m: num(token.smartWallets15m, token.smart_wallets_15m, token.smart_count_15m, token.smartCount15m),
      smartWallets1h: num(token.smartWallets1h, token.smart_wallets_1h, token.smart_count_1h),
      kolWallets5m: num(token.kolWallets5m, token.kol_wallets_5m, token.kol_count_5m, token.kolCount5m),
      kolWallets15m: num(token.kolWallets15m, token.kol_wallets_15m, token.kol_count_15m, token.kolCount15m),
      kolWallets1h: num(token.kolWallets1h, token.kol_wallets_1h),
      // KOL Net Inflow (gmgn.ai/monitor KOL tab) — separate from smart net
      kolNetInflow5m: num(token.kolNetInflow5m, token.kol_net_inflow_5m),
      kolNetInflow15m: num(token.kolNetInflow15m, token.kol_net_inflow_15m),
      kolNetInflow1h: num(token.kolNetInflow1h, token.kol_net_inflow_1h),
      smartCount: num(token.smartCount, token.smart_degen_count, token.smart_count),
    };
  }

  function getMonitorInflowScore(token = {}) {
    const m = getMonitorMetrics(token);
    // Smart Net Inflow (primary) + KOL Net Inflow (secondary, GMGN Monitor split)
    const smartNet =
      Math.max(0, m.smartNetInflow5m) * 1.35 +
      Math.max(0, m.smartNetInflow15m) * 0.85 +
      Math.max(0, m.smartNetInflow1h) * 0.35;
    const kolNet =
      Math.max(0, m.kolNetInflow5m) * 1.2 +
      Math.max(0, m.kolNetInflow15m) * 0.75 +
      Math.max(0, m.kolNetInflow1h) * 0.3;
    const volume =
      Math.max(0, m.volume5m) * 1.0 +
      Math.max(0, m.volume15m) * 0.55 +
      Math.max(0, m.volume1h) * 0.2;
    const netScore = clampScore(smartNet <= 0 ? 0 : Math.log10(smartNet + 1) * 22 - 45);
    const kolNetScore = clampScore(kolNet <= 0 ? 0 : Math.log10(kolNet + 1) * 20 - 40);
    const monitorVolumeScore = clampScore(volume <= 0 ? 0 : Math.log10(volume + 1) * 18 - 45);
    const newWalletScore = clampScore(m.newWallets5m * 1.5 + m.newWallets15m * 0.65);
    const smartWalletScore = clampScore(
      m.smartWallets5m * 18 + m.smartWallets15m * 9 + m.smartWallets1h * 4 + m.smartCount * 3
    );
    const kolWalletScore = clampScore(m.kolWallets5m * 22 + m.kolWallets15m * 12 + m.kolWallets1h * 5);
    const score = clampScore(
      netScore * 0.34 +
      kolNetScore * 0.12 +
      monitorVolumeScore * 0.16 +
      newWalletScore * 0.12 +
      smartWalletScore * 0.16 +
      kolWalletScore * 0.10
    );
    return {
      ...m,
      score,
      netScore,
      kolNetScore,
      monitorVolumeScore,
      newWalletScore,
      smartWalletScore,
      kolWalletScore,
    };
  }

  /**
   * GMGN Monitor–style heat gate for 5m / 15m / 1h.
   * Only tokens that pass at least one window are signal-eligible.
   */
  function evaluateMonitorHeat(token = {}) {
    const T = V2.thresholds;
    const mon = getMonitorInflowScore(token);
    const m = mon;
    const windows = [];
    const notes = [];

    // --- 5m: Smart Net Inflow and/or KOL Net Inflow burst ---
    const hot5mNet =
      m.smartNetInflow5m >= T.net5mStrong ||
      (m.smartNetInflow5m >= T.net5mMin && m.smartWallets5m >= T.smartWallets5mMin) ||
      (m.smartWallets5m >= 3 && m.volume5m >= T.volume5mMin) ||
      m.kolNetInflow5m >= T.net5mMin ||
      (m.kolNetInflow5m >= T.net5mMin * 0.6 && m.kolWallets5m >= 2);
    const hot5mActivity =
      m.volume5m >= T.volume5mMin ||
      m.txns5m >= 25 ||
      m.smartNetInflow5m >= T.net5mMin ||
      m.kolNetInflow5m >= T.net5mMin * 0.5;
    if (hot5mNet && hot5mActivity) {
      windows.push('5m');
      notes.push(
        `5m SM net $${Math.round(m.smartNetInflow5m)} · KOL net $${Math.round(m.kolNetInflow5m)} · SM ${m.smartWallets5m}/KOL ${m.kolWallets5m}`
      );
    }

    // --- 15m ---
    const hot15mNet =
      m.smartNetInflow15m >= T.net15mStrong ||
      (m.smartNetInflow15m >= T.net15mMin && m.smartWallets15m >= T.smartWallets15mMin) ||
      (m.smartWallets15m >= 4 && m.volume15m >= T.volume15mMin) ||
      m.kolNetInflow15m >= T.net15mMin ||
      (m.kolNetInflow15m >= T.net15mMin * 0.5 && m.kolWallets15m >= 2);
    const hot15mActivity =
      m.volume15m >= T.volume15mMin ||
      m.volume1h >= T.volume1hHot * 0.5 ||
      m.txns15m >= 40 ||
      m.smartNetInflow15m >= T.net15mMin ||
      m.kolNetInflow15m >= T.net15mMin * 0.4;
    if (hot15mNet && hot15mActivity) {
      windows.push('15m');
      notes.push(
        `15m SM net $${Math.round(m.smartNetInflow15m)} · KOL net $${Math.round(m.kolNetInflow15m)}`
      );
    }

    // --- 1h ---
    const net1h = Math.max(m.smartNetInflow1h, m.smartNetInflow15m, m.smartNetInflow5m);
    const kol1h = Math.max(m.kolNetInflow1h, m.kolNetInflow15m, m.kolNetInflow5m);
    const smart1h = Math.max(m.smartWallets1h, m.smartWallets15m, m.smartCount);
    const hot1hVolume = m.volume1h >= T.volume1hHot || m.txns1h >= 80;
    const hot1hSmart =
      net1h >= T.net1hMin ||
      kol1h >= T.net1hMin * 0.5 ||
      smart1h >= T.smartWallets1hMin ||
      m.smartCount >= T.smartCount1hMin ||
      m.kolWallets15m >= 1;
    if (hot1hVolume && hot1hSmart) {
      windows.push('1h');
      notes.push(`1h vol $${Math.round(m.volume1h)} · SM net $${Math.round(net1h)} · KOL net $${Math.round(kol1h)}`);
    }

    // Composite board score as secondary admit
    if (
      windows.length === 0 &&
      mon.score >= T.monitorHeatScore &&
      (m.smartNetInflow5m > 0 || m.smartNetInflow15m > 0 || m.kolNetInflow5m > 0 || m.kolNetInflow15m > 0) &&
      (m.volume5m > 0 || m.volume15m > 0 || m.volume1h >= T.volume1hHot * 0.4)
    ) {
      windows.push(m.smartNetInflow5m + m.kolNetInflow5m >= m.smartNetInflow15m + m.kolNetInflow15m ? '5m' : '15m');
      notes.push(`Monitor分 ${mon.score}/100`);
    }

    // Prefer shortest hot window for labeling
    const primaryWindow = windows.includes('5m') ? '5m' : windows.includes('15m') ? '15m' : windows.includes('1h') ? '1h' : null;

    return {
      hot: windows.length > 0,
      windows,
      primaryWindow,
      monitor: mon,
      notes,
      detail: notes.slice(0, 2).join(' · '),
    };
  }

  function applyRiskCaps(score, metrics) {
    let capped = score;
    if (metrics.hardVeto) return 0;
    if (metrics.riskScore >= 85) capped = Math.min(capped, 39);
    else if (metrics.riskScore >= 70) capped = Math.min(capped, 59);
    if (metrics.priceChange1h >= 180) capped = Math.min(capped, 49);
    else if (metrics.priceChange1h >= 130) capped = Math.min(capped, 59);
    if (metrics.liquidity > 0 && metrics.liquidity < 10_000) capped = Math.min(capped, 55);
    if (metrics.buyPercent != null && metrics.buyPercent < 45) capped = Math.min(capped, 55);
    if (metrics.dataQuality === 'dex-fallback' || metrics.hasSmartMoneyData === false) {
      capped = Math.min(capped, 58); // no smart-money: never "强报警"
    }
    return clampScore(capped);
  }

  function evaluateHardVeto(token = {}, riskScore = 0, riskFlags = []) {
    const reasons = [];
    if (token.isHoneypot) reasons.push('Honeypot');
    if (token.isRug) reasons.push('Rug');
    if (token.isBan) reasons.push('Ban');
    if (token.security?.canSell === false) reasons.push('不可卖出');
    if (riskScore >= 85) reasons.push('风险分≥85');
    const top10 = Number(token.top10Holders ?? token.top10 ?? 0);
    if (top10 >= 0.85 || top10 >= 85) reasons.push('Top10≥85%');
    return {
      hardVeto: reasons.length > 0,
      hardVetoReasons: reasons,
      riskFlags: riskFlags.concat(reasons.filter((r) => !riskFlags.includes(r))),
    };
  }

  function scoreTokenSignal(token = {}) {
    const priceChange1h = Number(token.priceChange1h ?? 0);
    const priceChange24h = Number(token.priceChange24h ?? 0);
    const volume1h = Number(token.volume1h ?? 0);
    const volume24h = Number(token.volume24h ?? 0);
    const volume = volume1h > 0 ? volume1h : volume24h;
    const liquidity = Number(token.liquidity ?? 0);
    const smartCount = Number(token.smartCount ?? token.smart_degen_count ?? 0);
    const top10 = Number(token.top10Holders ?? token.top10 ?? 0);
    const buyPercent = calculateBuyPercent(token);
    const txnsTotal = Number(token.txns1h?.total ?? token.txns24h?.total ?? 0);
    const monitor = getMonitorInflowScore(token);
    const hasSmartMoneyData = token.hasSmartMoneyData !== false && token.dataQuality !== 'dex-fallback';
    const dataQuality = token.dataQuality || (hasSmartMoneyData ? 'gmgn-enriched' : 'unknown');

    const riskFlags = [];
    let riskScore = 18;
    if (token.isHoneypot) { riskScore += 45; riskFlags.push('GMGN 标记 Honeypot'); }
    if (token.isRug) { riskScore += 45; riskFlags.push('GMGN 标记 Rug'); }
    if (token.isBan) { riskScore += 30; riskFlags.push('GMGN 标记 Ban'); }
    if (token.security?.canSell === false) { riskScore += 40; riskFlags.push('合约不可卖'); }
    if (liquidity > 0 && liquidity < 10_000) { riskScore += 25; riskFlags.push('流动性过低'); }
    else if (liquidity > 0 && liquidity < 40_000) { riskScore += 12; riskFlags.push('流动性一般'); }
    if (!volume || volume < 80_000) { riskScore += 14; riskFlags.push('成交量不足'); }
    if (buyPercent != null && buyPercent < 45) { riskScore += 14; riskFlags.push('买入占比不足'); }
    if (txnsTotal > 0 && txnsTotal < 30 && buyPercent != null && buyPercent >= 70) { riskScore += 8; riskFlags.push('交易笔数不足但买压偏高'); }
    if (top10 >= 0.7 || top10 >= 70) { riskScore += 26; riskFlags.push('Top10 持仓高度集中'); }
    else if (top10 >= 0.55 || top10 >= 55) { riskScore += 18; riskFlags.push('Top10 持仓集中'); }
    else if (top10 >= 0.35 || top10 >= 35) { riskScore += 8; riskFlags.push('Top10 持仓偏集中'); }
    if (priceChange1h >= 180) { riskScore += 24; riskFlags.push('短线涨幅极高'); }
    else if (priceChange1h >= 90) { riskScore += 12; riskFlags.push('短线涨幅过高'); }
    if (!hasSmartMoneyData) { riskScore += 8; riskFlags.push('缺少聪明钱富化'); }
    riskScore = clampScore(riskScore);
    const veto = evaluateHardVeto(token, riskScore, riskFlags);
    const riskLevel = labelRisk(riskScore);

    const priceMomentumScore = clampScore(Math.max(0, Math.min(priceChange1h, 95)) * 1.05 + Math.max(0, Math.min(priceChange24h, 180)) * 0.08);
    const volumeQualityScore = clampScore(volume <= 0 ? 0 : Math.log10(volume) * 18 - 45);
    // Unknown buy pressure → neutral 40 (does not invent fake 50% strength)
    const buyPressureScore = buyPercent == null
      ? 40
      : clampScore((buyPercent - 50) * 2.2 + 55 + (txnsTotal >= 100 ? 8 : 0));
    const smartMoneyQualityScore = clampScore(smartCount * 12 + (smartCount > 0 ? 20 : 0) + monitor.score * 0.65);
    const riskAdjustedScore = clampScore(100 - riskScore);

    const rawSignalScore = clampScore(
      priceMomentumScore * V2.weights.priceMomentum +
      volumeQualityScore * V2.weights.volumeQuality +
      buyPressureScore * V2.weights.buyPressure +
      smartMoneyQualityScore * V2.weights.smartMoneyQuality +
      riskAdjustedScore * V2.weights.riskAdjusted
    );
    const signalScore = applyRiskCaps(rawSignalScore, {
      riskScore,
      priceChange1h,
      liquidity,
      buyPercent,
      hardVeto: veto.hardVeto,
      dataQuality,
      hasSmartMoneyData,
    });
    const signalLevel = veto.hardVeto ? '忽略' : labelSignal(signalScore);

    const reasons = [];
    if (priceChange1h >= 15) reasons.push(`1h 动量 ${priceChange1h.toFixed(1)}%`);
    if (volume1h >= 80_000) reasons.push(`1h 量 ${Math.round(volume1h).toLocaleString('en-US')}`);
    else if (volume24h >= 500_000) reasons.push(`24h 量 ${Math.round(volume24h).toLocaleString('en-US')}`);
    if (buyPercent != null && buyPercent >= 60) reasons.push(`买入占比 ${buyPercent.toFixed(0)}%`);
    if (smartCount > 0) reasons.push(`Smart Money ${smartCount}`);
    const heat = evaluateMonitorHeat(token);
    if (heat.hot) {
      reasons.push(`Monitor热度 ${heat.primaryWindow || heat.windows.join('/')} · 分${heat.monitor.score}/100`);
      if (heat.detail) reasons.push(heat.detail);
    }
    if (monitor.score >= 55) {
      reasons.push(
        `Smart Net Inflow ${monitor.score}/100 · 5m $${Math.round(monitor.smartNetInflow5m).toLocaleString('en-US')} · 15m $${Math.round(monitor.smartNetInflow15m).toLocaleString('en-US')}`
      );
    }
    if (monitor.newWallets5m || monitor.newWallets15m) reasons.push(`新钱包 ${monitor.newWallets5m}/${monitor.newWallets15m}`);
    if (monitor.kolWallets5m || monitor.kolWallets15m) reasons.push(`KOL 钱包 ${monitor.kolWallets5m}/${monitor.kolWallets15m}`);
    if (token.fromTrenches) reasons.push('发现: Trenches 新盘');
    if (token.fromHotSearch) reasons.push('发现: Hot Search');
    if (!hasSmartMoneyData) reasons.push('数据: 无聪明钱富化');
    if (veto.hardVetoReasons.length) reasons.push(`否决: ${veto.hardVetoReasons.slice(0, 2).join(' / ')}`);
    else if (veto.riskFlags.length) reasons.push(`风险: ${veto.riskFlags.slice(0, 2).join(' / ')}`);

    let entryGrade = 'C';
    let suggestedAction = '继续观察';
    if (veto.hardVeto || riskScore >= 85 || token.isHoneypot || token.isRug) {
      entryGrade = 'D';
      suggestedAction = '禁止交易';
    } else if (priceChange1h >= 130) {
      entryGrade = 'D';
      suggestedAction = '禁止追高';
    } else if (priceChange1h >= 90) {
      entryGrade = 'C';
      suggestedAction = '等待回踩';
    } else if (signalScore >= 86 && riskScore < 45 && priceChange1h < 70 && buyPercent != null && buyPercent >= 60 && (smartCount >= 2 || monitor.score >= 75)) {
      entryGrade = 'A';
      suggestedAction = '重点观察';
    } else if (signalScore >= 76 && riskScore < 58 && priceChange1h < 90 && (buyPercent == null || buyPercent >= 55)) {
      entryGrade = 'B';
      suggestedAction = '小仓试探';
    }

    return {
      version: V2.version,
      signalScore,
      rawSignalScore,
      signalLevel,
      confidence: veto.hardVeto ? '否决' : signalScore >= 80 ? '中高' : signalScore >= 62 ? '中' : '偏低',
      riskScore,
      riskLevel,
      riskFlags: veto.riskFlags,
      hardVeto: veto.hardVeto,
      hardVetoReasons: veto.hardVetoReasons,
      smartMoneyScore: smartMoneyQualityScore,
      smartMoneyQualityScore,
      monitorInflowScore: monitor.score,
      monitor,
      buyPercent,
      volumeScore: volumeQualityScore,
      volumeQualityScore,
      priceMomentumScore,
      riskAdjustedScore,
      entryGrade,
      suggestedAction,
      reasons,
      hasSmartMoneyData,
      dataQuality,
      heat: evaluateMonitorHeat(token),
    };
  }

  /**
   * Signal policy v4 — ONLY hot on-chain memecoins (5m / 15m / 1h):
   * - Hard veto blocks all alerts
   * - Must pass GMGN Monitor Smart Net Inflow–style heat gate
   * - Risk must not be extreme
   * - Pure volume / pure price / pure buy-pressure alone NEVER fires
   */
  function shouldEmitAlert(token = {}, scoreSnapshot = null) {
    const score = scoreSnapshot || scoreTokenSignal(token);
    const T = V2.thresholds;
    const heat = score.heat || evaluateMonitorHeat(token);

    if (score.hardVeto) {
      return { fire: false, reason: 'hard-veto', text: `风险否决: ${(score.hardVetoReasons || []).join(', ')}`, score, heat };
    }
    if (score.riskScore > T.maxAiRisk) {
      return { fire: false, reason: 'risk-high', text: `风险过高 ${score.riskScore}`, score, heat };
    }

    // Primary: only Monitor heat windows (5m / 15m / 1h)
    if (!heat.hot) {
      return {
        fire: false,
        reason: 'not-monitor-hot',
        text: '未达 5m/15m/1h Monitor Smart Net Inflow 火热标准',
        score,
        heat,
      };
    }

    // Soft quality: prefer enriched SM; allow rank-only if window net is strong
    const m = heat.monitor || getMonitorMetrics(token);
    const strongNet =
      m.smartNetInflow5m >= T.net5mStrong ||
      m.smartNetInflow15m >= T.net15mStrong ||
      m.smartNetInflow1h >= T.net1hMin * 1.5;
    if (!score.hasSmartMoneyData && !strongNet) {
      return {
        fire: false,
        reason: 'no-smart-enrichment',
        text: '无聪明钱/Monitor 富化且净流入不足',
        score,
        heat,
      };
    }

    // Cap extreme chase still applies via entry grade; allow fire if heat ok
    const win = heat.primaryWindow || heat.windows[0] || '15m';
    const reason =
      win === '5m' ? 'monitor-hot-5m' : win === '1h' ? 'monitor-hot-1h' : 'monitor-hot-15m';
    return {
      fire: true,
      reason,
      text: `Monitor ${win} 火热 · 分${heat.monitor?.score ?? score.monitorInflowScore}/100 · ${heat.detail || 'Smart Net Inflow'}`,
      score: { ...score, heat },
      heat,
    };
  }

  function getTrackedPerformance(tracked = {}) {
    const base = Number(tracked.priceAtSignal || 0);
    const current = Number(tracked.currentPrice || 0);
    const points = (tracked.priceHistory || []).filter((p) => p && Number(p.price) > 0);
    const prices = points.map((p) => Number(p.price));
    if (base > 0) prices.push(base);
    if (current > 0) prices.push(current);
    const maxPrice = prices.length ? Math.max(...prices) : current;
    const minPrice = prices.length ? Math.min(...prices) : current;
    const currentChange = base > 0 ? ((current - base) / base) * 100 : 0;
    const maxPnl24h = base > 0 ? ((maxPrice - base) / base) * 100 : 0;
    const minPnl24h = base > 0 ? ((minPrice - base) / base) * 100 : 0;
    return { base, current, currentChange, maxPnl24h, minPnl24h, maxGain: maxPnl24h, maxDrawdown: minPnl24h };
  }

  function analyzeTrackedSignal(tracked = {}) {
    const perf = getTrackedPerformance(tracked);
    const snapshot = tracked.signalScoreSnapshot || tracked.signalMeta?.signalScoreSnapshot || {};
    let entryGrade = snapshot.entryGrade || 'C';
    let entryAction = snapshot.suggestedAction || '继续观察';
    if (perf.currentChange >= 160) { entryGrade = 'D'; entryAction = '禁止追高'; }
    else if (perf.currentChange >= 80 && entryAction !== '禁止交易') { entryGrade = 'C'; entryAction = '等待回踩'; }
    else if (perf.currentChange <= -25) { entryGrade = 'D'; entryAction = '信号失效'; }

    const dropFromPeak = perf.maxPnl24h - perf.currentChange;
    const resultLabel = perf.maxPnl24h >= 500 && (dropFromPeak >= 250 || perf.currentChange <= perf.maxPnl24h * 0.45)
      ? '高收益回撤'
      : perf.currentChange <= -25
        ? '失败/跌破'
        : perf.maxPnl24h >= 500
          ? '超级收益'
          : perf.maxPnl24h >= 100
            ? '高收益验证'
            : perf.maxPnl24h >= 35
              ? '有效信号'
              : '观察中';

    return { ...perf, entryGrade, entryAction, resultLabel, dropFromPeak };
  }

  global.SignalEngine = {
    version: V2.version,
    thresholds: V2.thresholds,
    clampScore,
    calculateBuyPercent,
    getMonitorMetrics,
    getMonitorInflowScore,
    evaluateMonitorHeat,
    scoreTokenSignal,
    shouldEmitAlert,
    evaluateHardVeto,
    analyzeTrackedSignal,
    getTrackedPerformance,
  };
})(typeof window !== 'undefined' ? window : globalThis);

(function attachSignalEngine(global) {
  'use strict';

  const V2 = {
    version: 'gmgn-ai-v2-conservative',
    weights: {
      priceMomentum: 0.15,
      volumeQuality: 0.17,
      buyPressure: 0.18,
      smartMoneyQuality: 0.25,
      riskAdjusted: 0.25,
    },
  };

  function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  }

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
    if (!total) return 50;
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
    return {
      smartNetInflow5m: num(token.smartNetInflow5m, token.smart_net_inflow_5m, token.smart_netflow_5m, token.net_inflow_5m),
      smartNetInflow15m: num(token.smartNetInflow15m, token.smart_net_inflow_15m, token.smart_netflow_15m, token.net_inflow_15m),
      volume5m: num(token.volume5m, token.volume_5m, token.volume?.m5),
      volume15m: num(token.volume15m, token.volume_15m, token.volume?.m15),
      newWallets5m: num(token.newWallets5m, token.new_wallets_5m, token.new_wallet_count_5m),
      newWallets15m: num(token.newWallets15m, token.new_wallets_15m, token.new_wallet_count_15m),
      smartWallets5m: num(token.smartWallets5m, token.smart_wallets_5m, token.smart_count_5m, token.smartCount5m),
      smartWallets15m: num(token.smartWallets15m, token.smart_wallets_15m, token.smart_count_15m, token.smartCount15m),
      kolWallets5m: num(token.kolWallets5m, token.kol_wallets_5m, token.kol_count_5m, token.kolCount5m),
      kolWallets15m: num(token.kolWallets15m, token.kol_wallets_15m, token.kol_count_15m, token.kolCount15m),
    };
  }

  function getMonitorInflowScore(token = {}) {
    const m = getMonitorMetrics(token);
    const net = Math.max(0, m.smartNetInflow5m) * 1.25 + Math.max(0, m.smartNetInflow15m) * 0.75;
    const volume = Math.max(0, m.volume5m) * 0.9 + Math.max(0, m.volume15m) * 0.45;
    const netScore = clampScore(net <= 0 ? 0 : Math.log10(net + 1) * 22 - 45);
    const monitorVolumeScore = clampScore(volume <= 0 ? 0 : Math.log10(volume + 1) * 18 - 45);
    const newWalletScore = clampScore(m.newWallets5m * 1.5 + m.newWallets15m * 0.65);
    const smartWalletScore = clampScore(m.smartWallets5m * 18 + m.smartWallets15m * 8);
    const kolWalletScore = clampScore(m.kolWallets5m * 28 + m.kolWallets15m * 14);
    const score = clampScore(
      netScore * 0.38 +
      monitorVolumeScore * 0.18 +
      newWalletScore * 0.16 +
      smartWalletScore * 0.18 +
      kolWalletScore * 0.10
    );
    return { ...m, score, netScore, monitorVolumeScore, newWalletScore, smartWalletScore, kolWalletScore };
  }

  function applyRiskCaps(score, metrics) {
    let capped = score;
    if (metrics.riskScore >= 85) capped = Math.min(capped, 39);
    else if (metrics.riskScore >= 70) capped = Math.min(capped, 59);
    if (metrics.priceChange1h >= 180) capped = Math.min(capped, 49);
    else if (metrics.priceChange1h >= 130) capped = Math.min(capped, 59);
    if (metrics.liquidity > 0 && metrics.liquidity < 10_000) capped = Math.min(capped, 55);
    if (metrics.buyPercent < 45) capped = Math.min(capped, 55);
    return clampScore(capped);
  }

  function scoreTokenSignal(token = {}) {
    const priceChange1h = Number(token.priceChange1h ?? 0);
    const priceChange24h = Number(token.priceChange24h ?? 0);
    const volume = Number(token.volume24h ?? token.volume1h ?? 0);
    const liquidity = Number(token.liquidity ?? 0);
    const smartCount = Number(token.smartCount ?? token.smart_degen_count ?? 0);
    const top10 = Number(token.top10Holders ?? token.top10 ?? 0);
    const buyPercent = calculateBuyPercent(token);
    const txnsTotal = Number(token.txns24h?.total ?? token.txns1h?.total ?? 0);
    const monitor = getMonitorInflowScore(token);

    const riskFlags = [];
    let riskScore = 18;
    if (token.isHoneypot) { riskScore += 45; riskFlags.push('GMGN 标记 Honeypot'); }
    if (token.isRug) { riskScore += 45; riskFlags.push('GMGN 标记 Rug'); }
    if (token.isBan) { riskScore += 30; riskFlags.push('GMGN 标记 Ban'); }
    if (liquidity > 0 && liquidity < 10_000) { riskScore += 25; riskFlags.push('流动性过低'); }
    else if (liquidity > 0 && liquidity < 40_000) { riskScore += 12; riskFlags.push('流动性一般'); }
    if (!volume || volume < 80_000) { riskScore += 14; riskFlags.push('成交量不足'); }
    if (buyPercent < 45) { riskScore += 14; riskFlags.push('买入占比不足'); }
    if (txnsTotal > 0 && txnsTotal < 30 && buyPercent >= 70) { riskScore += 8; riskFlags.push('交易笔数不足但买压偏高'); }
    if (top10 >= 0.7 || top10 >= 70) { riskScore += 26; riskFlags.push('Top10 持仓高度集中'); }
    else if (top10 >= 0.55 || top10 >= 55) { riskScore += 18; riskFlags.push('Top10 持仓集中'); }
    else if (top10 >= 0.35 || top10 >= 35) { riskScore += 8; riskFlags.push('Top10 持仓偏集中'); }
    if (priceChange1h >= 180) { riskScore += 24; riskFlags.push('短线涨幅极高'); }
    else if (priceChange1h >= 90) { riskScore += 12; riskFlags.push('短线涨幅过高'); }
    riskScore = clampScore(riskScore);
    const riskLevel = labelRisk(riskScore);

    const priceMomentumScore = clampScore(Math.max(0, Math.min(priceChange1h, 95)) * 1.05 + Math.max(0, Math.min(priceChange24h, 180)) * 0.08);
    const volumeQualityScore = clampScore(volume <= 0 ? 0 : Math.log10(volume) * 18 - 45);
    const buyPressureScore = clampScore((buyPercent - 50) * 2.2 + 55 + (txnsTotal >= 100 ? 8 : 0));
    const smartMoneyQualityScore = clampScore(smartCount * 12 + (smartCount > 0 ? 20 : 0) + monitor.score * 0.65);
    const riskAdjustedScore = clampScore(100 - riskScore);

    const rawSignalScore = clampScore(
      priceMomentumScore * V2.weights.priceMomentum +
      volumeQualityScore * V2.weights.volumeQuality +
      buyPressureScore * V2.weights.buyPressure +
      smartMoneyQualityScore * V2.weights.smartMoneyQuality +
      riskAdjustedScore * V2.weights.riskAdjusted
    );
    const signalScore = applyRiskCaps(rawSignalScore, { riskScore, priceChange1h, liquidity, buyPercent });
    const signalLevel = labelSignal(signalScore);

    const reasons = [];
    if (priceChange1h >= 15) reasons.push(`1h 动量 ${priceChange1h.toFixed(1)}%`);
    if (volume >= 500_000) reasons.push(`成交量放大 ${Math.round(volume).toLocaleString('en-US')}`);
    if (buyPercent >= 60) reasons.push(`买入占比 ${buyPercent.toFixed(0)}%`);
    if (smartCount > 0) reasons.push(`Smart Money ${smartCount}`);
    if (monitor.score >= 55) reasons.push(`Smart Net Inflow ${monitor.score}/100 · 5m $${Math.round(monitor.smartNetInflow5m).toLocaleString('en-US')} · 15m $${Math.round(monitor.smartNetInflow15m).toLocaleString('en-US')}`);
    if (monitor.newWallets5m || monitor.newWallets15m) reasons.push(`新钱包 ${monitor.newWallets5m}/${monitor.newWallets15m}`);
    if (monitor.kolWallets5m || monitor.kolWallets15m) reasons.push(`KOL 钱包 ${monitor.kolWallets5m}/${monitor.kolWallets15m}`);
    if (riskFlags.length) reasons.push(`风险: ${riskFlags.slice(0, 2).join(' / ')}`);

    let entryGrade = 'C';
    let suggestedAction = '继续观察';
    if (riskScore >= 85 || token.isHoneypot || token.isRug) {
      entryGrade = 'D';
      suggestedAction = '禁止交易';
    } else if (priceChange1h >= 130) {
      entryGrade = 'D';
      suggestedAction = '禁止追高';
    } else if (priceChange1h >= 90) {
      entryGrade = 'C';
      suggestedAction = '等待回踩';
    } else if (signalScore >= 86 && riskScore < 45 && priceChange1h < 70 && buyPercent >= 60 && (smartCount >= 2 || monitor.score >= 75)) {
      entryGrade = 'A';
      suggestedAction = '重点观察';
    } else if (signalScore >= 76 && riskScore < 58 && priceChange1h < 90 && buyPercent >= 55) {
      entryGrade = 'B';
      suggestedAction = '小仓试探';
    }

    return {
      version: V2.version,
      signalScore,
      rawSignalScore,
      signalLevel,
      confidence: signalScore >= 80 ? '中高' : signalScore >= 62 ? '中' : '偏低',
      riskScore,
      riskLevel,
      riskFlags,
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
    clampScore,
    calculateBuyPercent,
    getMonitorMetrics,
    getMonitorInflowScore,
    scoreTokenSignal,
    analyzeTrackedSignal,
    getTrackedPerformance,
  };
})(typeof window !== 'undefined' ? window : globalThis);

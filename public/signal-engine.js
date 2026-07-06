(function attachSignalEngine(global) {
  'use strict';

  function clampScore(value) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
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
    if (score >= 60) return '普通报警';
    if (score >= 40) return '观察';
    return '忽略';
  }

  function scoreTokenSignal(token = {}) {
    const priceChange1h = Number(token.priceChange1h ?? 0);
    const priceChange24h = Number(token.priceChange24h ?? 0);
    const volume = Number(token.volume24h ?? token.volume1h ?? 0);
    const liquidity = Number(token.liquidity ?? 0);
    const smartCount = Number(token.smartCount ?? token.smart_degen_count ?? 0);
    const top10 = Number(token.top10Holders ?? token.top10 ?? 0);
    const buyPercent = calculateBuyPercent(token);

    const riskFlags = [];
    let riskScore = 18;
    if (token.isHoneypot) { riskScore += 45; riskFlags.push('GMGN 标记 Honeypot'); }
    if (token.isRug) { riskScore += 45; riskFlags.push('GMGN 标记 Rug'); }
    if (token.isBan) { riskScore += 30; riskFlags.push('GMGN 标记 Ban'); }
    if (liquidity > 0 && liquidity < 10_000) { riskScore += 25; riskFlags.push('流动性过低'); }
    else if (liquidity > 0 && liquidity < 40_000) { riskScore += 12; riskFlags.push('流动性一般'); }
    if (!volume || volume < 80_000) { riskScore += 14; riskFlags.push('成交量不足'); }
    if (buyPercent < 45) { riskScore += 14; riskFlags.push('买入占比不足'); }
    if (top10 >= 0.55 || top10 >= 55) { riskScore += 18; riskFlags.push('Top10 持仓集中'); }
    if (priceChange1h >= 180) { riskScore += 18; riskFlags.push('短线涨幅极高'); }
    else if (priceChange1h >= 90) { riskScore += 10; riskFlags.push('短线涨幅过高'); }
    riskScore = clampScore(riskScore);
    const riskLevel = labelRisk(riskScore);

    const priceMomentumScore = clampScore(Math.max(0, priceChange1h) * 1.25 + Math.max(0, priceChange24h) * 0.12);
    const volumeScore = clampScore(volume <= 0 ? 0 : Math.log10(volume) * 15 - 45);
    const buyPressureScore = clampScore((buyPercent - 50) * 2.5 + 45);
    const smartMoneyScore = clampScore(smartCount * 12 + (smartCount > 0 ? 20 : 0));
    const riskAdjustedScore = clampScore(100 - riskScore);

    const signalScore = clampScore(
      priceMomentumScore * 0.25 +
      volumeScore * 0.20 +
      buyPressureScore * 0.20 +
      smartMoneyScore * 0.20 +
      riskAdjustedScore * 0.15
    );
    const signalLevel = labelSignal(signalScore);

    const reasons = [];
    if (priceChange1h >= 15) reasons.push(`1h 动量 ${priceChange1h.toFixed(1)}%`);
    if (volume >= 500_000) reasons.push(`成交量放大 ${Math.round(volume).toLocaleString('en-US')}`);
    if (buyPercent >= 65) reasons.push(`买入占比 ${buyPercent.toFixed(0)}%`);
    if (smartCount > 0) reasons.push(`Smart Money ${smartCount}`);
    if (riskFlags.length) reasons.push(`风险: ${riskFlags.slice(0, 2).join(' / ')}`);

    let entryGrade = 'C';
    let suggestedAction = '继续观察';
    if (riskScore >= 85 || token.isHoneypot || token.isRug) {
      entryGrade = 'D';
      suggestedAction = '禁止交易';
    } else if (priceChange1h >= 120) {
      entryGrade = 'D';
      suggestedAction = '禁止追高';
    } else if (priceChange1h >= 70) {
      entryGrade = 'C';
      suggestedAction = '等待回踩';
    } else if (signalScore >= 80 && riskScore < 45) {
      entryGrade = 'A';
      suggestedAction = '重点观察';
    } else if (signalScore >= 65 && riskScore < 60) {
      entryGrade = 'B';
      suggestedAction = '小仓试探';
    }

    return {
      version: 'gmgn-ai-mvp-v1',
      signalScore,
      signalLevel,
      confidence: signalScore >= 80 ? '中高' : signalScore >= 60 ? '中' : '偏低',
      riskScore,
      riskLevel,
      riskFlags,
      smartMoneyScore,
      buyPercent,
      volumeScore,
      priceMomentumScore,
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
    scoreTokenSignal,
    analyzeTrackedSignal,
    getTrackedPerformance,
  };
})(typeof window !== 'undefined' ? window : globalThis);

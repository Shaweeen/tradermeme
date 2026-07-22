/**
 * Strategy order PREVIEW only — never places real trades.
 *
 * Standard ladder template:
 *   - Limit buy below market
 *   - TP1 +100% sell 50%
 *   - TP2 +300% sell remaining
 *   - SL -50%
 */

const TEMPLATE_ID = 'standard-ladder-v1';

const SIZE_BY_GRADE = {
  A: { suggestedUsd: 100, maxUsd: 300, label: '重点观察仓' },
  B: { suggestedUsd: 50, maxUsd: 150, label: '小仓试探' },
  C: { suggestedUsd: 25, maxUsd: 75, label: '观察仓' },
  D: { suggestedUsd: 0, maxUsd: 0, label: '禁止' },
};

const BLOCKED_ACTIONS = new Set(['禁止交易', '禁止追高', '信号失效']);

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function roundPrice(p) {
  const n = Number(p);
  if (!(n > 0)) return 0;
  if (n >= 1) return Math.round(n * 1e6) / 1e6;
  if (n >= 0.0001) return Math.round(n * 1e8) / 1e8;
  return Number(n.toPrecision(6));
}

function roundUsd(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Compute limit entry relative to market / signal buy marker.
 */
function computeEntryPrice({ marketPrice, signalPrice, entryAction, entryGrade }) {
  const market = num(marketPrice);
  const signal = num(signalPrice);
  const ref = market > 0 ? market : signal;
  if (!(ref > 0)) return 0;

  let mult = 0.9;
  if (entryAction === '等待回踩' || entryAction === '禁止追高') mult = 0.85;
  else if (entryAction === '重点观察' || entryGrade === 'A') mult = 0.95;
  else if (entryGrade === 'B') mult = 0.92;
  else if (entryGrade === 'C') mult = 0.88;

  let entry = ref * mult;
  // Prefer not chasing above signal buy marker when we have one
  if (signal > 0 && market > signal * 1.15) {
    entry = Math.min(entry, signal * 1.02);
  }
  return roundPrice(entry);
}

/**
 * Build a full strategy quote preview. Pure — no network, no side effects.
 *
 * @param {object} input
 * @param {string} input.symbol
 * @param {string} input.chain
 * @param {string} input.address
 * @param {number} input.marketPrice
 * @param {number} [input.signalPrice]
 * @param {string} [input.entryGrade] A|B|C|D
 * @param {string} [input.entryAction]
 * @param {number} [input.sizeUsd] override suggested size
 * @param {string} [input.priceSource]
 * @param {object} [input.signalMeta]
 */
function buildStrategyQuote(input = {}) {
  const symbol = String(input.symbol || 'TOKEN');
  const chain = String(input.chain || 'solana');
  const address = String(input.address || '');
  const marketPrice = num(input.marketPrice);
  const signalPrice = num(input.signalPrice);
  const entryGrade = String(input.entryGrade || 'C').toUpperCase().slice(0, 1);
  const entryAction = String(input.entryAction || '继续观察');
  const priceSource = input.priceSource || 'client';

  const sizeCfg = SIZE_BY_GRADE[entryGrade] || SIZE_BY_GRADE.C;
  const blocked =
    BLOCKED_ACTIONS.has(entryAction) ||
    entryGrade === 'D' ||
    !(marketPrice > 0 || signalPrice > 0);

  let blockReason = '';
  if (entryGrade === 'D' || entryAction === '禁止交易') blockReason = '买点评级 D / 禁止交易';
  else if (entryAction === '禁止追高') blockReason = '短线涨幅过高，禁止追高';
  else if (entryAction === '信号失效') blockReason = '信号已失效';
  else if (!(marketPrice > 0 || signalPrice > 0)) blockReason = '缺少有效价格';

  const entryPrice = computeEntryPrice({
    marketPrice,
    signalPrice,
    entryAction,
    entryGrade,
  });

  let sizeUsd = num(input.sizeUsd, sizeCfg.suggestedUsd);
  if (!(sizeUsd > 0)) sizeUsd = sizeCfg.suggestedUsd;
  sizeUsd = clamp(sizeUsd, 0, sizeCfg.maxUsd || sizeUsd);
  sizeUsd = roundUsd(sizeUsd);

  const sizeTokens = entryPrice > 0 ? sizeUsd / entryPrice : 0;
  const tp1Price = roundPrice(entryPrice * 2); // +100%
  const tp2Price = roundPrice(entryPrice * 4); // +300%
  const slPrice = roundPrice(entryPrice * 0.5); // -50%

  const tp1Usd = roundUsd(sizeUsd * 0.5 * 2); // half position at 2x = 1x notional back on that half + profit
  // Simpler risk math for UI:
  const maxLossUsd = roundUsd(sizeUsd * 0.5); // -50% stop on full size
  const tp1ProceedsUsd = roundUsd((sizeUsd * 0.5) * 2); // sell 50% at +100% → get back that half * 2
  const tp2ProceedsUsd = roundUsd((sizeUsd * 0.5) * 4); // remaining 50% at +300%
  const fullSuccessUsd = roundUsd(tp1ProceedsUsd + tp2ProceedsUsd); // total cash if both TPs hit
  const fullSuccessPnl = roundUsd(fullSuccessUsd - sizeUsd);
  const riskReward =
    maxLossUsd > 0 ? Math.round((fullSuccessPnl / maxLossUsd) * 10) / 10 : null;

  const legs = blocked
    ? []
    : [
        {
          id: 'entry',
          side: 'buy',
          type: 'limit',
          label: '限价买入',
          price: entryPrice,
          sizeUsd,
          sizeTokens: sizeTokens > 0 ? Number(sizeTokens.toPrecision(8)) : 0,
          pctOfPosition: 100,
          note: `相对市价 ${marketPrice > 0 ? (((entryPrice / marketPrice) - 1) * 100).toFixed(1) : '—'}%`,
        },
        {
          id: 'tp1',
          side: 'sell',
          type: 'limit',
          label: '止盈1 · +100%',
          price: tp1Price,
          sizeUsd: roundUsd(sizeUsd * 0.5),
          sizeTokens: sizeTokens > 0 ? Number((sizeTokens * 0.5).toPrecision(8)) : 0,
          pctOfPosition: 50,
          gainPct: 100,
          note: '卖出 50% 仓位',
        },
        {
          id: 'tp2',
          side: 'sell',
          type: 'limit',
          label: '止盈2 · +300%',
          price: tp2Price,
          sizeUsd: roundUsd(sizeUsd * 0.5),
          sizeTokens: sizeTokens > 0 ? Number((sizeTokens * 0.5).toPrecision(8)) : 0,
          pctOfPosition: 50,
          gainPct: 300,
          note: '卖出剩余 50%',
        },
        {
          id: 'sl',
          side: 'sell',
          type: 'stop',
          label: '止损 · -50%',
          price: slPrice,
          sizeUsd,
          sizeTokens: sizeTokens > 0 ? Number(sizeTokens.toPrecision(8)) : 0,
          pctOfPosition: 100,
          lossPct: -50,
          note: '跌破止损清仓',
        },
      ];

  return {
    templateId: TEMPLATE_ID,
    templateName: '标准阶梯 · 限价买入 + 双止盈 + 止损',
    executionEnabled: false,
    requiresExplicitConfirm: true,
    previewOnly: true,
    blocked,
    blockReason,
    symbol,
    chain,
    address,
    entryGrade,
    entryAction,
    sizing: {
      grade: entryGrade,
      label: sizeCfg.label,
      suggestedUsd: sizeCfg.suggestedUsd,
      maxUsd: sizeCfg.maxUsd,
      sizeUsd: blocked ? 0 : sizeUsd,
    },
    market: {
      price: marketPrice > 0 ? roundPrice(marketPrice) : 0,
      signalPrice: signalPrice > 0 ? roundPrice(signalPrice) : 0,
      source: priceSource,
    },
    legs,
    risk: {
      maxLossUsd: blocked ? 0 : maxLossUsd,
      fullSuccessUsd: blocked ? 0 : fullSuccessUsd,
      fullSuccessPnl: blocked ? 0 : fullSuccessPnl,
      riskReward,
      stopLossPct: -50,
      takeProfit1Pct: 100,
      takeProfit2Pct: 300,
    },
    disclaimer:
      '此为策略订单预览，不创建链上/交易所订单，不连接钱包私钥。真实下单必须单独二次确认（当前版本未开放执行）。',
    generatedAt: Date.now(),
  };
}

export {
  TEMPLATE_ID,
  SIZE_BY_GRADE,
  BLOCKED_ACTIONS,
  buildStrategyQuote,
  computeEntryPrice,
  roundPrice,
  roundUsd,
};

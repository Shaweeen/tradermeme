/**
 * Altcoin-only: env fuse + signal rules v2 (no Memecoin imports)
 */
import assert from 'node:assert/strict';
import {
  scoreAltcoinPerpSignal,
  buildPrimaryEnvFromBybit,
  fuseContractEnvironment,
  deriveActionAdvice,
  rankSignalsWithEnv,
  buildEnvListGuidance,
  ALTCOIN_SIGNAL_RULES,
} from '../functions/api/_altcoin.js';

// ── Primary env from Bybit-shaped tickers ──
const primary = buildPrimaryEnvFromBybit([
  {
    symbol: 'BTC',
    markPrice: 100000,
    price: 100000,
    fundingRate: 0.0005,
    openInterest: 1000,
    price24hPcnt: 0.02,
    turnover24h: 1e9,
  },
  {
    symbol: 'ETH',
    markPrice: 3500,
    fundingRate: 0.0003,
    openInterest: 50000,
    price24hPcnt: 0.015,
    turnover24h: 5e8,
  },
]);
assert.ok(primary.available);
assert.ok(primary.btc.openInterestUsd > 0);

// risk-on-ish when prices up + mild funding without clawby liq
const envOn = fuseContractEnvironment(primary, { available: false, coins: {} });
assert.ok(envOn.envScore >= 40);
assert.ok(['risk-on', 'neutral', 'risk-off'].includes(envOn.regime));

// risk-off: extreme positive funding + red market + long liq dominance
const envOff = fuseContractEnvironment(
  {
    available: true,
    btc: {
      symbol: 'BTC',
      priceChange24h: -4,
      fundingRate: 0.0012,
      openInterestUsd: 1e10,
    },
    eth: {
      symbol: 'ETH',
      priceChange24h: -3.5,
      fundingRate: 0.0009,
      openInterestUsd: 4e9,
    },
  },
  {
    available: true,
    coins: {
      BTC: { funding_avg: 0.001, long_pct: 62, taker_buy_ratio: 0.42 },
    },
    global: {
      liquidations: {
        total_usd_24h: 5e8,
        long_usd_24h: 3.5e8,
        short_usd_24h: 1.5e8,
      },
    },
  }
);
assert.ok(envOff.envScore < envOn.envScore, `off ${envOff.envScore} should be < on ${envOn.envScore}`);
assert.ok(['agree', 'soft'].includes(envOff.metrics.fundingAgreement));

// funding conflict
const conflict = fuseContractEnvironment(
  { available: true, btc: { fundingRate: 0.0005, priceChange24h: 1, openInterestUsd: 1 }, eth: null },
  { available: true, coins: { BTC: { funding_avg: -0.0005 } }, global: {} }
);
assert.equal(conflict.metrics.fundingAgreement, 'conflict');

// ── Signal rules: need multi-factor ──
const weak = scoreAltcoinPerpSignal(
  {
    symbol: 'AAA',
    fundingRate: 0,
    price24hPcnt: 0.03, // 3% only
    turnover24h: 1000,
    openInterest: 1,
    markPrice: 1,
  },
  {},
  {}
);
assert.equal(weak, null, 'single weak factor should not pass');

const squeeze = scoreAltcoinPerpSignal(
  {
    symbol: 'SQUZ',
    fundingRate: -0.0005,
    price24hPcnt: 0.12, // +12%
    turnover24h: 30_000_000,
    openInterest: 20_000,
    markPrice: 2,
  },
  { SQUZ: { quoteVolume: 30_000_000 } },
  { squz: { name: 'Squeeze Coin', image: '', marketCap: 1e8, marketCapRank: 50 } },
  envOn
);
assert.ok(squeeze, 'short-squeeze structure should score');
assert.ok(squeeze.score >= ALTCOIN_SIGNAL_RULES.minScore);
assert.ok(squeeze.signals.some((s) => s.type === 'structure'));
assert.equal(squeeze.rulesVersion, 'altcoin-perp-v2');

const flush = scoreAltcoinPerpSignal(
  {
    symbol: 'FLUSH',
    fundingRate: 0.0006,
    price24hPcnt: -0.1,
    turnover24h: 40_000_000,
    openInterest: 50_000,
    markPrice: 1,
  },
  {},
  {},
  envOff
);
assert.ok(flush);
assert.ok(flush.signals.some((s) => s.bias === 'long-flush' || s.label.includes('踩踏')));

// Stable filtered
assert.equal(
  scoreAltcoinPerpSignal({ symbol: 'USDT', fundingRate: 0.01, price24hPcnt: 0.2, turnover24h: 1e9, openInterest: 1e6, markPrice: 1 }, {}, {}),
  null
);

// Action advice: risk-off elevates long-flush, demotes trend-crowded
const flushAdvice = deriveActionAdvice({ setupBias: 'long-flush', score: 50 }, { regime: 'risk-off' });
assert.equal(flushAdvice.action, 'prefer');
const crowdedOff = deriveActionAdvice({ setupBias: 'trend-crowded', score: 60 }, { regime: 'risk-off' });
assert.equal(crowdedOff.action, 'fade');
const squeezeOn = deriveActionAdvice({ setupBias: 'short-squeeze', score: 55 }, { regime: 'risk-on' });
assert.equal(squeezeOn.action, 'prefer');

const ranked = rankSignalsWithEnv(
  [
    { symbol: 'A', score: 90, setupBias: 'trend-crowded', action: 'fade', actionPriority: 15 },
    { symbol: 'B', score: 40, setupBias: 'long-flush', action: 'prefer', actionPriority: 88 },
  ],
  { regime: 'risk-off', envScore: 30 }
);
assert.equal(ranked[0].symbol, 'B', 'prefer should sort above fade even with lower score');

const guide = buildEnvListGuidance({ regime: 'risk-off' });
assert.equal(guide.tone, 'off');
assert.ok(guide.text.includes('踩踏'));

console.log('altcoin-module tests passed');

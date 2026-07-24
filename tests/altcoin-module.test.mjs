/**
 * Altcoin-only: weekly volume gate v3 + env / action helpers
 */
import assert from 'node:assert/strict';
import {
  scoreAltcoinPerpSignal,
  scoreWeeklyVolumeAlert,
  buildPrimaryEnvFromBybit,
  fuseContractEnvironment,
  deriveActionAdvice,
  rankSignalsWithEnv,
  buildEnvListGuidance,
  evaluateTwoWeekVolumeGrowth,
  parseWeeklyTurnovers,
  isExcludedAltcoinSymbol,
  ALTCOIN_SIGNAL_RULES,
} from '../functions/api/_altcoin.js';

// ── Exclude BTC always ──
assert.equal(isExcludedAltcoinSymbol('BTC'), true);
assert.equal(isExcludedAltcoinSymbol('btc'), true);
assert.equal(isExcludedAltcoinSymbol('BTCUSDT'), true);
assert.equal(isExcludedAltcoinSymbol('ETH'), false);
assert.equal(isExcludedAltcoinSymbol('USDT'), true);

// ── Parse Bybit-style weekly bars (newest first) ──
const bybitList = [
  ['3', '1', '1', '1', '1', '100', '30000000'], // w0
  ['2', '1', '1', '1', '1', '100', '20000000'], // w1
  ['1', '1', '1', '1', '1', '100', '10000000'], // w2
];
const bars = parseWeeklyTurnovers(bybitList, 'bybit');
assert.equal(bars.length, 3);
assert.equal(bars[0].turnover, 30_000_000);

// ── Two consecutive week volume growth gate ──
const pass = evaluateTwoWeekVolumeGrowth(bars);
assert.equal(pass.pass, true, `expected pass, got ${pass.reason}`);
assert.ok(pass.growth1 > 0 && pass.growth2 > 0);

const flat = evaluateTwoWeekVolumeGrowth([
  { start: 3, turnover: 10_000_000 },
  { start: 2, turnover: 10_000_000 },
  { start: 1, turnover: 10_000_000 },
]);
assert.equal(flat.pass, false);

const oneWeekOnly = evaluateTwoWeekVolumeGrowth([
  { start: 3, turnover: 50_000_000 },
  { start: 2, turnover: 10_000_000 },
  { start: 1, turnover: 20_000_000 }, // w1 not > w2
]);
assert.equal(oneWeekOnly.pass, false);

const btcBlocked = scoreWeeklyVolumeAlert(
  {
    symbol: 'BTC',
    fundingRate: 0.001,
    price24hPcnt: 0.1,
    turnover24h: 1e10,
    openInterest: 1e5,
    markPrice: 100000,
  },
  pass,
  {},
  {}
);
assert.equal(btcBlocked, null, 'BTC must never enter alt alert list');

// ── Score alert that passed weekly gate ──
const ethAlert = scoreWeeklyVolumeAlert(
  {
    symbol: 'ETH',
    fundingRate: 0.0005,
    price24hPcnt: 0.08,
    turnover24h: 80_000_000,
    openInterest: 50_000,
    markPrice: 3000,
  },
  pass,
  {},
  { eth: { name: 'Ethereum', marketCap: 1e11, marketCapRank: 2 } },
  { regime: 'neutral', envScore: 50 }
);
assert.ok(ethAlert, 'ETH with 2w volume up should score');
assert.ok(ethAlert.score >= ALTCOIN_SIGNAL_RULES.minScore);
assert.ok(ethAlert.signals.some((s) => s.label?.includes('2周') || s.bias === 'volume-2w-up'));
assert.equal(ethAlert.rulesVersion, 'altcoin-weekly-vol-v3');
assert.ok(ethAlert.weeklyVolume?.pass);
assert.notEqual(ethAlert.symbol, 'BTC');

// ── maxResults is 20 ──
assert.equal(ALTCOIN_SIGNAL_RULES.maxResults, 20);
assert.ok(ALTCOIN_SIGNAL_RULES.excludeSymbols.includes('BTC'));

// ── Env fuse still works ──
const primary = buildPrimaryEnvFromBybit([
  {
    symbol: 'BTC',
    markPrice: 100000,
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
const env = fuseContractEnvironment(primary, { available: false, coins: {} });
assert.ok(['risk-on', 'neutral', 'risk-off'].includes(env.regime));

// ── Action advice ──
const flushAdvice = deriveActionAdvice({ setupBias: 'long-flush', score: 50 }, { regime: 'risk-off' });
assert.equal(flushAdvice.action, 'prefer');
const ranked = rankSignalsWithEnv(
  [
    { symbol: 'A', score: 90, setupBias: 'trend-crowded', action: 'fade', actionPriority: 15 },
    { symbol: 'B', score: 40, setupBias: 'long-flush', action: 'prefer', actionPriority: 88 },
  ],
  { regime: 'risk-off', envScore: 30 }
);
assert.equal(ranked[0].symbol, 'B');

const guide = buildEnvListGuidance({ regime: 'risk-off' });
assert.equal(guide.tone, 'off');

// legacy scorer still loads (RH / tests)
const weak = scoreAltcoinPerpSignal(
  {
    symbol: 'AAA',
    fundingRate: 0,
    price24hPcnt: 0.03,
    turnover24h: 1000,
    openInterest: 1,
    markPrice: 1,
  },
  {},
  {}
);
assert.equal(weak, null);

console.log('altcoin-module tests passed');

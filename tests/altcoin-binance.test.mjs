/**
 * Binance free primary + venue merge helpers
 */
import assert from 'node:assert/strict';
import { mergeVenueAlertRows } from '../functions/api/_altcoin_binance.js';
import { parseOkxWeeklyBars, okxInstToSymbol } from '../functions/api/_altcoin_okx.js';
import { evaluateTwoWeekVolumeGrowth, parseWeeklyTurnovers, isExcludedAltcoinSymbol } from '../functions/api/_altcoin.js';

assert.equal(isExcludedAltcoinSymbol('BTC'), true);

// Binance kline shape: quote volume index 7
const klines = [
  [1, '1', '1', '1', '1', '10', 2, '10000000'],
  [2, '1', '1', '1', '1', '10', 3, '20000000'],
  [3, '1', '1', '1', '1', '10', 4, '35000000'],
];
const bars = parseWeeklyTurnovers(klines, 'binance');
// parse sorts newest first by start time
assert.ok(bars.length === 3);
const newestFirst = [...bars].sort((a, b) => b.start - a.start);
const gate = evaluateTwoWeekVolumeGrowth(newestFirst);
assert.equal(gate.pass, true, gate.reason);

const merged = mergeVenueAlertRows([
  [
    {
      symbol: 'ETH',
      score: 40,
      volumeGrowthRankKey: 0.5,
      weeklySource: 'binance',
      action: 'watch',
      actionPriority: 50,
    },
  ],
  [
    {
      symbol: 'ETH',
      score: 55,
      volumeGrowthRankKey: 0.8,
      weeklySource: 'bybit',
      action: 'prefer',
      actionPriority: 70,
    },
    {
      symbol: 'SOL',
      score: 45,
      volumeGrowthRankKey: 0.4,
      weeklySource: 'bybit',
      action: 'watch',
      actionPriority: 50,
    },
  ],
], { regime: 'neutral' });

assert.ok(merged.some((r) => r.symbol === 'ETH'));
const eth = merged.find((r) => r.symbol === 'ETH');
assert.ok(eth.multiVenue || (eth.venues && eth.venues.length >= 2));
assert.ok(eth.volumeGrowthRankKey >= 0.8);
assert.ok(!merged.some((r) => r.symbol === 'BTC'));

// OKX helpers
assert.equal(okxInstToSymbol('ETH-USDT-SWAP'), 'ETH');
assert.equal(okxInstToSymbol('BTC-USDT-SWAP'), 'BTC');
const okxBars = parseOkxWeeklyBars([
  ['3', '1', '1', '1', '1', '1', '1', '30000000', '0'],
  ['2', '1', '1', '1', '1', '1', '1', '20000000', '1'],
  ['1', '1', '1', '1', '1', '1', '1', '10000000', '1'],
]);
assert.equal(okxBars.length, 3);
assert.equal(evaluateTwoWeekVolumeGrowth(okxBars).pass, true);

const threeVenue = mergeVenueAlertRows([
  [{ symbol: 'SOL', score: 40, volumeGrowthRankKey: 0.3, weeklySource: 'binance', actionPriority: 40 }],
  [{ symbol: 'SOL', score: 42, volumeGrowthRankKey: 0.35, weeklySource: 'bybit', actionPriority: 42 }],
  [{ symbol: 'SOL', score: 50, volumeGrowthRankKey: 0.9, weeklySource: 'okx', actionPriority: 60 }],
], { regime: 'neutral' });
const sol = threeVenue.find((r) => r.symbol === 'SOL');
assert.ok(sol);
assert.ok(sol.venues?.length >= 2 || sol.multiVenue);
assert.ok(sol.volumeGrowthRankKey >= 0.9);

console.log('altcoin-binance tests passed');

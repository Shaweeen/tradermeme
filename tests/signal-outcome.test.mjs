/**
 * 24H AI signal outcomes: buy-point win/loss + selection advice
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const engineSrc = fs.readFileSync(new URL('../public/signal-engine.js', import.meta.url), 'utf8');
const storageSrc = fs.readFileSync(new URL('../public/tracking-storage.js', import.meta.url), 'utf8');
const context = { window: {}, console, globalThis: {} };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(engineSrc, context, { filename: 'signal-engine.js' });
vm.runInContext(storageSrc, context, { filename: 'tracking-storage.js' });

const engine = context.window.SignalEngine || context.globalThis.SignalEngine;
const storage = context.window.TrackingStorage || context.globalThis.TrackingStorage;
assert.ok(engine, 'SignalEngine loaded');
assert.ok(storage, 'TrackingStorage loaded');
assert.equal(typeof engine.evaluateSignalOutcome, 'function');
assert.equal(typeof engine.computeOutcomeStats, 'function');
assert.equal(typeof engine.getSelectionAdvice, 'function');
assert.equal(typeof engine.applySelectionAdvice, 'function');

const now = 1_800_000_000_000;
const base = {
  symbol: 'WIN',
  address: 'AddrWin',
  chain: 'solana',
  signalAt: now - 60 * 60 * 1000,
  priceAtSignal: 1,
  currentPrice: 1,
  signalReason: 'monitor-hot-5m',
  signalMeta: { heatWindow: '5m' },
  signalScoreSnapshot: { entryGrade: 'A' },
  priceHistory: [{ time: now - 60 * 60 * 1000, price: 1, marker: 'buy' }],
};

// Win: peak +40% from buy point
const winTracked = {
  ...base,
  currentPrice: 1.2,
  priceHistory: [
    { time: now - 3600000, price: 1, marker: 'buy' },
    { time: now - 1800000, price: 1.4 },
    { time: now, price: 1.2 },
  ],
};
const winOut = engine.evaluateSignalOutcome(winTracked, { now });
assert.equal(winOut.status, 'win', `expected win, got ${winOut.status}`);
assert.ok(winOut.isWin);
assert.ok(winOut.maxGain >= 35);
assert.ok(winOut.patternKey.includes('monitor-hot-5m'));
assert.ok(winOut.patternKey.includes('a'));

// Loss: never recovered, -20% from buy
const lossTracked = {
  ...base,
  symbol: 'LOSE',
  signalReason: 'monitor-hot-1h',
  signalScoreSnapshot: { entryGrade: 'C' },
  signalMeta: { heatWindow: '1h' },
  currentPrice: 0.78,
  priceHistory: [
    { time: now - 3600000, price: 1, marker: 'buy' },
    { time: now - 1800000, price: 0.95 },
    { time: now, price: 0.78 },
  ],
};
const lossOut = engine.evaluateSignalOutcome(lossTracked, { now, forceSettle: true });
assert.equal(lossOut.status, 'loss', `expected loss, got ${lossOut.status}`);
assert.ok(lossOut.isLoss);

// Invalid
const inv = engine.evaluateSignalOutcome(base, { now, invalidReason: '价格归零', forceSettle: true });
assert.equal(inv.status, 'invalid');
assert.ok(inv.isLoss);

// Stats
const outcomes = [
  { ...winOut, isSettled: true, patternKey: winOut.patternKey, entryGrade: 'A' },
  { ...lossOut, isSettled: true, patternKey: lossOut.patternKey, entryGrade: 'C' },
  { ...winOut, isSettled: true, patternKey: winOut.patternKey, entryGrade: 'A', maxGain: 50 },
  { ...winOut, isSettled: true, patternKey: winOut.patternKey, entryGrade: 'A', maxGain: 80 },
  { ...lossOut, isSettled: true, patternKey: lossOut.patternKey, entryGrade: 'C', maxGain: 5 },
  { ...lossOut, isSettled: true, patternKey: lossOut.patternKey, entryGrade: 'C', maxGain: 2 },
];
// Make loss outcomes properly marked
for (const o of outcomes) {
  if (o.entryGrade === 'C' && o.maxGain < 15) {
    o.isWin = false;
    o.isLoss = true;
    o.status = 'loss';
  }
}
const stats = engine.computeOutcomeStats(outcomes);
assert.ok(stats.total >= 5);
assert.ok(stats.wins >= 2);
assert.ok(stats.winRate > 0);

// Selection: block low-win pattern with enough samples
const badPatternKey = lossOut.patternKey;
// Pad bad pattern to minSamples
const badPad = Array.from({ length: 6 }, () => ({
  isSettled: true,
  isWin: false,
  isLoss: true,
  status: 'loss',
  maxGain: 0,
  currentChange: -20,
  patternKey: badPatternKey,
  entryGrade: 'C',
}));
const paddedStats = engine.computeOutcomeStats([...outcomes, ...badPad]);
const badDecision = {
  fire: true,
  reason: 'monitor-hot-1h',
  score: { entryGrade: 'C', signalScore: 70 },
  heat: { primaryWindow: '1h' },
};
const advice = engine.getSelectionAdvice(badDecision, paddedStats, { minSamples: 5 });
assert.equal(advice.allow, false, `expected block low WR pattern, got ${JSON.stringify(advice)}`);
const blocked = engine.applySelectionAdvice(badDecision, advice);
assert.equal(blocked.fire, false);

// High win pattern boost
const goodDecision = {
  fire: true,
  reason: 'monitor-hot-5m',
  score: { entryGrade: 'A', signalScore: 72 },
  heat: { primaryWindow: '5m' },
};
const goodPad = Array.from({ length: 6 }, () => ({
  isSettled: true,
  isWin: true,
  isLoss: false,
  status: 'win',
  maxGain: 60,
  currentChange: 40,
  patternKey: winOut.patternKey,
  entryGrade: 'A',
}));
const goodStats = engine.computeOutcomeStats(goodPad);
const goodAdvice = engine.getSelectionAdvice(goodDecision, goodStats, { minSamples: 5 });
assert.ok(goodAdvice.allow);
assert.ok(goodAdvice.scoreDelta >= 5, `expected boost, got ${goodAdvice.scoreDelta}`);

// Storage compact outcomes
const prepared = storage.prepareOutcomesForStorage([
  {
    key: 'solana:x',
    symbol: 'X',
    signalAt: now - 1000,
    settledAt: now,
    status: 'win',
    isSettled: true,
    isWin: true,
    maxGain: 40,
    patternKey: 'monitor-hot-5m|a|5m',
  },
  {
    key: 'solana:old',
    symbol: 'OLD',
    signalAt: now - 40 * 86400000,
    settledAt: now - 40 * 86400000,
    status: 'loss',
    isSettled: true,
    isWin: false,
    isLoss: true,
  },
], { now, outcomeRetentionMs: 30 * 86400000 });
assert.ok(prepared.some((o) => o.symbol === 'X'));
assert.ok(!prepared.some((o) => o.symbol === 'OLD'), 'expired outcomes pruned');

const full = storage.prepareTrackingStateForStorage({
  savedAt: now,
  signalIdCounter: 1,
  signals: [],
  trackedTokens: {},
  signalOutcomes: prepared,
}, { now, maxBytes: 100_000 });
assert.ok(Array.isArray(full.signalOutcomes));

console.log('signal-outcome tests passed');

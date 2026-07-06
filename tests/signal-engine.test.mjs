import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/signal-engine.js', import.meta.url), 'utf8');
const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'signal-engine.js' });
const engine = context.window.SignalEngine;

assert.ok(engine, 'SignalEngine should be exposed on window');
assert.equal(typeof engine.scoreTokenSignal, 'function');
assert.equal(typeof engine.analyzeTrackedSignal, 'function');
assert.equal(typeof engine.getMonitorInflowScore, 'function');

const strong = engine.scoreTokenSignal({
  symbol: 'ALPHA',
  priceChange1h: 42,
  priceChange24h: 120,
  volume24h: 1_800_000,
  liquidity: 85_000,
  smartCount: 8,
  txns24h: { buys: 820, sells: 180, total: 1000 },
  top10Holders: 0.22,
  isRug: false,
  isHoneypot: false,
});
assert.ok(strong.signalScore >= 75, `expected strong score >=75, got ${strong.signalScore}`);
assert.equal(strong.signalLevel, '强报警');
assert.equal(strong.riskLevel, '低');
assert.ok(strong.reasons.some((r) => r.includes('Smart Money')));
assert.ok(['A', 'B'].includes(strong.entryGrade));

const risky = engine.scoreTokenSignal({
  symbol: 'RUGGY',
  priceChange1h: 240,
  volume24h: 40_000,
  liquidity: 3_000,
  smartCount: 0,
  txns24h: { buys: 20, sells: 80, total: 100 },
  top10Holders: 0.72,
  isRug: true,
  isHoneypot: true,
});
assert.ok(risky.riskScore >= 85, `expected extreme risk >=85, got ${risky.riskScore}`);
assert.equal(risky.riskLevel, '极高');
assert.equal(risky.suggestedAction, '禁止交易');
assert.ok(risky.riskFlags.includes('GMGN 标记 Honeypot'));

const tracked = engine.analyzeTrackedSignal({
  symbol: 'CHASE',
  priceAtSignal: 0.001,
  currentPrice: 0.0031,
  signalAt: Date.now() - 15 * 60 * 1000,
  signalScoreSnapshot: strong,
  priceHistory: [
    { time: Date.now() - 15 * 60 * 1000, price: 0.001, marker: 'buy' },
    { time: Date.now() - 5 * 60 * 1000, price: 0.0034 },
    { time: Date.now(), price: 0.0031 },
  ],
});
assert.equal(tracked.entryAction, '禁止追高');
assert.equal(tracked.entryGrade, 'D');
assert.ok(tracked.maxPnl24h > 200);
assert.ok(tracked.resultLabel.includes('高收益'));

const moonshot = engine.analyzeTrackedSignal({
  symbol: 'MOON',
  priceAtSignal: 0.001,
  currentPrice: 0.0105,
  signalScoreSnapshot: strong,
  priceHistory: [
    { time: Date.now() - 60 * 60 * 1000, price: 0.001, marker: 'buy' },
    { time: Date.now() - 30 * 60 * 1000, price: 0.012 },
    { time: Date.now(), price: 0.008 },
  ],
});
assert.equal(moonshot.resultLabel, '超级收益');
assert.ok(moonshot.maxPnl24h >= 1000);

const moonshotSelloff = engine.analyzeTrackedSignal({
  symbol: 'DROP',
  priceAtSignal: 0.001,
  currentPrice: 0.003,
  signalScoreSnapshot: strong,
  priceHistory: [
    { time: Date.now() - 60 * 60 * 1000, price: 0.001, marker: 'buy' },
    { time: Date.now() - 30 * 60 * 1000, price: 0.012 },
    { time: Date.now(), price: 0.003 },
  ],
});
assert.equal(moonshotSelloff.resultLabel, '高收益回撤');
assert.ok(moonshotSelloff.dropFromPeak >= 800);

const monitorInflow = engine.scoreTokenSignal({
  symbol: 'FLOW',
  priceChange1h: 28,
  priceChange24h: 45,
  volume24h: 900_000,
  liquidity: 120_000,
  smartCount: 3,
  smartNetInflow5m: 42_000,
  smartNetInflow15m: 120_000,
  volume5m: 180_000,
  volume15m: 520_000,
  newWallets5m: 38,
  newWallets15m: 96,
  smartWallets5m: 3,
  smartWallets15m: 8,
  kolWallets5m: 1,
  kolWallets15m: 2,
  txns24h: { buys: 640, sells: 360, total: 1000 },
  top10Holders: 0.24,
});
assert.equal(monitorInflow.version, 'gmgn-ai-v2-conservative');
assert.ok(monitorInflow.monitorInflowScore >= 75, `expected monitor inflow >=75, got ${monitorInflow.monitorInflowScore}`);
assert.ok(monitorInflow.signalScore >= 76, `expected strong signal from monitor inflow, got ${monitorInflow.signalScore}`);
assert.ok(monitorInflow.reasons.some((r) => r.includes('Smart Net Inflow')));
assert.ok(['A', 'B'].includes(monitorInflow.entryGrade));

const chaseTrap = engine.scoreTokenSignal({
  symbol: 'CHASETRAP',
  priceChange1h: 190,
  priceChange24h: 260,
  volume24h: 5_000_000,
  liquidity: 200_000,
  smartCount: 8,
  smartNetInflow5m: 80_000,
  smartNetInflow15m: 200_000,
  txns24h: { buys: 850, sells: 150, total: 1000 },
  top10Holders: 0.25,
});
assert.ok(chaseTrap.signalScore <= 49, `extreme chase should be capped <=49, got ${chaseTrap.signalScore}`);
assert.equal(chaseTrap.entryGrade, 'D');
assert.equal(chaseTrap.suggestedAction, '禁止追高');

const lowLiqTrap = engine.scoreTokenSignal({
  symbol: 'LOWLIQ',
  priceChange1h: 35,
  volume24h: 800_000,
  liquidity: 5_000,
  smartCount: 5,
  txns24h: { buys: 700, sells: 300, total: 1000 },
});
assert.ok(lowLiqTrap.signalScore <= 55, `low liquidity should cap score <=55, got ${lowLiqTrap.signalScore}`);
assert.notEqual(lowLiqTrap.signalLevel, '强报警');

console.log('signal-engine tests passed');

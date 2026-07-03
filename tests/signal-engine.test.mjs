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

console.log('signal-engine tests passed');

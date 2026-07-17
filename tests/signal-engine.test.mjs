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
assert.equal(typeof engine.shouldEmitAlert, 'function');
assert.ok(
  String(engine.version || '').includes('monitor-heat') ||
    String(engine.version || '').includes('phase-a') ||
    String(engine.version || '').includes('v3') ||
    String(engine.version || '').includes('v4')
);
assert.equal(typeof engine.evaluateMonitorHeat, 'function');

const strong = engine.scoreTokenSignal({
  symbol: 'ALPHA',
  priceChange1h: 42,
  priceChange24h: 120,
  volume1h: 400_000,
  volume24h: 1_800_000,
  liquidity: 85_000,
  smartCount: 8,
  hasSmartMoneyData: true,
  dataQuality: 'gmgn-enriched',
  txns1h: { buys: 820, sells: 180, total: 1000 },
  txns24h: { buys: 820, sells: 180, total: 1000 },
  top10Holders: 0.22,
  isRug: false,
  isHoneypot: false,
  smartNetInflow5m: 50_000,
  smartNetInflow15m: 120_000,
  volume5m: 200_000,
  volume15m: 500_000,
  newWallets5m: 40,
  smartWallets5m: 5,
});
assert.ok(strong.signalScore >= 62, `expected strong score >=62, got ${strong.signalScore}`);
assert.ok(['强报警', '重点报警', '普通报警'].includes(strong.signalLevel));
assert.equal(strong.riskLevel, '低');
assert.ok(strong.reasons.some((r) => r.includes('Smart Money') || r.includes('Inflow')));
assert.ok(['A', 'B', 'C'].includes(strong.entryGrade));

const strongFire = engine.shouldEmitAlert(strong.token || {
  symbol: 'ALPHA',
  priceChange1h: 42,
  volume1h: 400_000,
  liquidity: 85_000,
  smartCount: 8,
  hasSmartMoneyData: true,
  dataQuality: 'gmgn-enriched',
  txns1h: { buys: 820, sells: 180, total: 1000 },
  smartNetInflow5m: 50_000,
  smartNetInflow15m: 120_000,
  volume5m: 200_000,
  volume15m: 500_000,
  newWallets5m: 40,
  smartWallets5m: 5,
  top10Holders: 0.22,
}, strong);
assert.equal(strongFire.fire, true, `strong should fire, got ${JSON.stringify(strongFire)}`);

const risky = engine.scoreTokenSignal({
  symbol: 'RUGGY',
  priceChange1h: 240,
  volume24h: 40_000,
  liquidity: 3_000,
  smartCount: 0,
  hasSmartMoneyData: true,
  txns24h: { buys: 20, sells: 80, total: 100 },
  top10Holders: 0.72,
  isRug: true,
  isHoneypot: true,
});
assert.ok(risky.riskScore >= 85, `expected extreme risk >=85, got ${risky.riskScore}`);
assert.equal(risky.riskLevel, '极高');
assert.equal(risky.suggestedAction, '禁止交易');
assert.equal(risky.hardVeto, true);
assert.ok(risky.riskFlags.includes('GMGN 标记 Honeypot'));

const riskyFire = engine.shouldEmitAlert({
  symbol: 'RUGGY',
  priceChange1h: 240,
  volume24h: 5_000_000,
  isRug: true,
  isHoneypot: true,
  hasSmartMoneyData: true,
}, risky);
assert.equal(riskyFire.fire, false, 'honeypot/rug must not fire');
assert.equal(riskyFire.reason, 'hard-veto');

// Pure volume dump — must NOT fire
const volumeOnly = engine.shouldEmitAlert({
  symbol: 'VOLONLY',
  priceChange1h: 2,
  volume24h: 5_000_000,
  volume1h: 50_000,
  liquidity: 100_000,
  smartCount: 0,
  hasSmartMoneyData: false,
  dataQuality: 'dex-fallback',
  txns24h: { buys: 50, sells: 50, total: 100 },
});
assert.equal(volumeOnly.fire, false, `volume-only must not fire, got ${JSON.stringify(volumeOnly)}`);

// Strong price but no Monitor heat — must NOT fire (v4)
const noHeat = engine.shouldEmitAlert({
  symbol: 'NOHEAT',
  priceChange1h: 40,
  volume1h: 200_000,
  liquidity: 80_000,
  smartCount: 0,
  hasSmartMoneyData: true,
  dataQuality: 'gmgn-enriched',
  txns1h: { buys: 200, sells: 50, total: 250 },
  smartNetInflow5m: 0,
  smartNetInflow15m: 0,
  volume5m: 0,
  volume15m: 0,
  smartWallets5m: 0,
  smartWallets15m: 0,
  top10Holders: 0.2,
});
assert.equal(noHeat.fire, false, `no monitor heat must not fire, got ${JSON.stringify(noHeat)}`);
assert.ok(['not-monitor-hot', 'no-smart-enrichment'].includes(noHeat.reason), noHeat.reason);

// 5m Smart Net Inflow heat — must fire
const hot5m = engine.shouldEmitAlert({
  symbol: 'HOT5',
  priceChange1h: 12,
  volume1h: 100_000,
  liquidity: 50_000,
  smartCount: 4,
  hasSmartMoneyData: true,
  dataQuality: 'gmgn-enriched',
  txns1h: { buys: 100, sells: 40, total: 140 },
  smartNetInflow5m: 12_000,
  smartNetInflow15m: 25_000,
  volume5m: 40_000,
  volume15m: 90_000,
  smartWallets5m: 3,
  smartWallets15m: 5,
  newWallets5m: 10,
  top10Holders: 0.25,
});
assert.equal(hot5m.fire, true, `5m monitor heat should fire, got ${JSON.stringify(hot5m)}`);
assert.ok(String(hot5m.reason).includes('monitor-hot'), hot5m.reason);

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
  volume1h: 200_000,
  volume24h: 900_000,
  liquidity: 120_000,
  smartCount: 3,
  hasSmartMoneyData: true,
  dataQuality: 'gmgn-enriched',
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
  txns1h: { buys: 640, sells: 360, total: 1000 },
  txns24h: { buys: 640, sells: 360, total: 1000 },
  top10Holders: 0.24,
});
assert.ok(
  monitorInflow.version.includes('monitor-heat') ||
    monitorInflow.version.includes('phase-a') ||
    monitorInflow.version.includes('v3') ||
    monitorInflow.version.includes('v4')
);
assert.ok(monitorInflow.monitorInflowScore >= 70, `expected monitor inflow >=70, got ${monitorInflow.monitorInflowScore}`);
assert.ok(monitorInflow.heat?.hot === true, 'monitor heat should be hot');
assert.ok(monitorInflow.signalScore >= 62, `expected solid signal from monitor inflow, got ${monitorInflow.signalScore}`);

const monitorFire = engine.shouldEmitAlert({
  symbol: 'FLOW',
  priceChange1h: 28,
  volume1h: 200_000,
  liquidity: 120_000,
  smartCount: 3,
  hasSmartMoneyData: true,
  dataQuality: 'gmgn-enriched',
  smartNetInflow5m: 42_000,
  smartNetInflow15m: 120_000,
  volume5m: 180_000,
  volume15m: 520_000,
  newWallets5m: 38,
  smartWallets5m: 3,
  kolWallets5m: 1,
  top10Holders: 0.24,
  txns1h: { buys: 640, sells: 360, total: 1000 },
}, monitorInflow);
assert.equal(monitorFire.fire, true);

const chaseTrap = engine.scoreTokenSignal({
  symbol: 'CHASETRAP',
  priceChange1h: 190,
  priceChange24h: 260,
  volume24h: 5_000_000,
  liquidity: 200_000,
  smartCount: 8,
  hasSmartMoneyData: true,
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
  hasSmartMoneyData: true,
  txns24h: { buys: 700, sells: 300, total: 1000 },
});
assert.ok(lowLiqTrap.signalScore <= 55, `low liquidity should cap score <=55, got ${lowLiqTrap.signalScore}`);
assert.notEqual(lowLiqTrap.signalLevel, '强报警');

// Unknown buy ratio should not invent 50%
assert.equal(engine.calculateBuyPercent({}), null);

console.log('signal-engine tests passed');

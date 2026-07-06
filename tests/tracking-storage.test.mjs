import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/tracking-storage.js', import.meta.url), 'utf8');
const context = { window: {}, console };
vm.createContext(context);
vm.runInContext(source, context, { filename: 'tracking-storage.js' });
const storage = context.window.TrackingStorage;

assert.ok(storage, 'TrackingStorage should be exposed on window');
assert.equal(typeof storage.compressPriceHistory, 'function');
assert.equal(typeof storage.prepareTrackingStateForStorage, 'function');
assert.equal(typeof storage.shouldSkipAutoRefresh, 'function');

const now = 1_800_000_000_000;
const points = Array.from({ length: 12_000 }, (_, i) => ({
  time: now - (12_000 - i) * 30_000,
  price: 0.001 + i * 0.000001,
}));
const compressed = storage.compressPriceHistory(points, {
  now,
  recentMs: 60 * 60 * 1000,
  olderBucketMs: 15 * 60 * 1000,
  maxPoints: 900,
});
assert.ok(compressed.length <= 900, `expected <=900 points, got ${compressed.length}`);
assert.equal(compressed[0].time, points[0].time, 'first/buy point should be preserved');
assert.equal(compressed.at(-1).time, points.at(-1).time, 'latest point should be preserved');

const largeState = {
  savedAt: now,
  signalIdCounter: 2,
  signals: [{ id: 1, tokenAddress: 'A', tokenChain: 'solana', active: true }],
  trackedTokens: {
    'solana:moon': {
      address: 'MOON', symbol: 'MOON', chain: 'solana', signalAt: now - 2 * 86400000,
      priceAtSignal: 0.001, currentPrice: 0.01,
      moonshot: { active: true, maxGain: 900 },
      priceHistory: points,
    },
    'solana:old': {
      address: 'OLD', symbol: 'OLD', chain: 'solana', signalAt: now - 31 * 86400000,
      priceAtSignal: 1, currentPrice: 0.8,
      priceHistory: points.slice(0, 100),
    },
  },
};
const prepared = storage.prepareTrackingStateForStorage(largeState, {
  now,
  maxBytes: 220_000,
  normalRetentionMs: 86400000,
  moonshotRetentionMs: 30 * 86400000,
  moonshotMaxPoints: 900,
});
const json = JSON.stringify(prepared);
assert.ok(json.length <= 220_000, `prepared JSON too large: ${json.length}`);
assert.ok(prepared.trackedTokens['solana:moon'], 'moonshot should be retained');
assert.ok(!prepared.trackedTokens['solana:old'], 'expired non-moonshot should be pruned');
assert.ok(prepared.trackedTokens['solana:moon'].priceHistory.length <= 900);

assert.equal(storage.shouldSkipAutoRefresh({ hidden: true, autoRefreshEnabled: true }), true);
assert.equal(storage.shouldSkipAutoRefresh({ hidden: false, autoRefreshEnabled: true }), false);
assert.equal(storage.shouldSkipAutoRefresh({ hidden: false, autoRefreshEnabled: false }), true);

console.log('tracking-storage tests passed');

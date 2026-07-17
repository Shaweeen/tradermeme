import assert from 'node:assert/strict';
import {
  applyMonitorSignalEnrichment,
  unwrapList,
  dedupeKolSources,
} from '../functions/api/_monitor_enrichment.js';

const nowSec = 1_800_000_000;
const baseToken = {
  address: 'ABC123',
  symbol: 'FLOW',
  holderCount: 200,
  volume5m: 0,
  volume15m: 0,
  smartNetInflow5m: 0,
  smartNetInflow15m: 0,
  smartWallets5m: 0,
  smartWallets15m: 0,
  kolWallets5m: 0,
  kolWallets15m: 0,
  kolNetInflow5m: 0,
  kolNetInflow15m: 0,
};

assert.deepEqual(unwrapList({ data: { list: [1, 2] } }), [1, 2]);
assert.deepEqual(unwrapList({ data: { data: { rank: [3] } } }), [3]);

// Dedup: GMGN wins on shared handles
const deduped = dedupeKolSources(['VitalikButerin', 'Ansem'], ['ansem', 'fish081320792', 'elonmusk']);
assert.ok(deduped.gmgnHandles.includes('vitalikbuterin'));
assert.ok(deduped.gmgnHandles.includes('ansem'));
assert.deepEqual(deduped.sharedHandles.sort(), ['ansem']);
assert.ok(deduped.watchlistOnlyHandles.includes('fish081320792'));
assert.ok(deduped.watchlistOnlyHandles.includes('elonmusk'));
assert.ok(!deduped.watchlistOnlyHandles.includes('ansem'), 'shared must not stay on watchlist-only');

const enriched = applyMonitorSignalEnrichment([baseToken], {
  nowSec,
  watchlistHandles: ['Ansem', 'fish081320792'],
  tokenSignals: [{
    token_address: 'ABC123',
    trigger_at: nowSec - 120,
    data: {
      volume_1m: 11000,
      volume_1h: 120000,
      fresh_wallet_rate: 0.15,
      holder_count: 200,
      renowned_count: 2,
      smart_degen_wallets: [
        { address: 'S1', buy_timestamp: nowSec - 60, buy_amount: 5000 },
        { address: 'S2', buy_timestamp: nowSec - 700, buy_amount: 8000 },
      ],
    },
  }],
  smartTrades: [
    { base_address: 'ABC123', maker: 'S3', side: 'buy', timestamp: nowSec - 200, amount_usd: 3000 },
    { base_address: 'ABC123', maker: 'S4', side: 'sell', timestamp: nowSec - 100, amount_usd: 1200 },
  ],
  // GMGN Monitor KOL Net Inflow trades (separate from smart net)
  kolTrades: [
    {
      base_address: 'ABC123',
      maker: 'K1',
      side: 'buy',
      timestamp: nowSec - 240,
      amount_usd: 2200,
      maker_info: { twitter_username: 'Ansem', tags: ['kol'] },
    },
    {
      base_address: 'ABC123',
      maker: 'K2',
      side: 'buy',
      timestamp: nowSec - 100,
      amount_usd: 1500,
      maker_info: { twitter_username: 'SomeOtherKol', tags: ['kol'] },
    },
  ],
});

const token = enriched[0];
// Smart net: 5000 + 3000 - 1200 = 6800 (5m); 15m also +8000 from S2 = 14800
assert.equal(token.smartNetInflow5m, 6800);
assert.equal(token.smartNetInflow15m, 14800);
// KOL net separate
assert.equal(token.kolNetInflow5m, 3700); // 2200 + 1500
assert.equal(token.kolNetInflow15m, 3700);
assert.equal(token.smartWallets5m, 3); // S1,S3,S4
assert.equal(token.smartWallets15m, 4); // +S2
assert.ok(token.kolWallets5m >= 2);
assert.ok(token.kolHandlesGmgn.includes('ansem'));
assert.ok(token.kolHandlesGmgn.includes('someotherkol'));
// Ansem is on personal list but GMGN wins — only in shared, not watchlist-only
assert.ok(token.kolHandlesShared.includes('ansem'));
assert.ok(!token.kolHandlesWatchlistOnly.includes('ansem'));
assert.ok(token.kolHandlesWatchlistOnly.includes('fish081320792'));
assert.equal(token.kolSource, 'gmgn-kol-net-inflow');
assert.ok(token.newWallets5m >= 30);
assert.ok(token.volume5m >= 11000);

console.log('monitor-enrichment tests passed');

import assert from 'node:assert/strict';
import { applyMonitorSignalEnrichment, unwrapList } from '../functions/api/_monitor_enrichment.js';

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
};

assert.deepEqual(unwrapList({ data: { list: [1, 2] } }), [1, 2]);
assert.deepEqual(unwrapList({ data: { data: { rank: [3] } } }), [3]);

const enriched = applyMonitorSignalEnrichment([baseToken], {
  nowSec,
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
  kolTrades: [
    { base_address: 'ABC123', maker: 'K1', side: 'buy', timestamp: nowSec - 240, amount_usd: 2200 },
  ],
});

const token = enriched[0];
assert.equal(token.smartNetInflow5m, 9000); // 5000 + 3000 - 1200 + 2200
assert.equal(token.smartNetInflow15m, 17000); // 5000 + 8000 + 3000 - 1200 + 2200
assert.equal(token.smartWallets5m, 4);
assert.equal(token.smartWallets15m, 5);
assert.equal(token.kolWallets5m, 3);
assert.equal(token.kolWallets15m, 3);
assert.equal(token.newWallets5m, 30);
assert.equal(token.newWallets15m, 30);
assert.ok(token.volume5m >= 11000);
assert.ok(token.volume15m >= 120000);

console.log('monitor-enrichment tests passed');

/**
 * Memecoin value rank: multi-factor score + top-20 selection + dedupe merge
 */
import assert from 'node:assert/strict';
import {
  DISPLAY_LIMIT,
  computeValueScore,
  rankAndSelectTopMemecoins,
  scoreHeat,
  scoreSmart,
} from '../functions/api/_value_rank.js';

assert.equal(DISPLAY_LIMIT, 20);

const hotSm = computeValueScore({
  symbol: 'ALPHA',
  name: 'Alpha Pepe',
  chain: 'bsc',
  address: '0xaaa',
  priceUsd: 0.01,
  volume5m: 80_000,
  volume15m: 200_000,
  volume1h: 500_000,
  volume24h: 2_000_000,
  priceChange1h: 35,
  liquidity: 120_000,
  smartCount: 6,
  hasSmartMoneyData: true,
  dataQuality: 'gmgn-enriched',
  smartNetInflow5m: 25_000,
  smartNetInflow15m: 60_000,
  kolNetInflow5m: 8_000,
  smartWallets5m: 4,
  kolWallets5m: 2,
  newWallets5m: 30,
  top10Holders: 0.22,
  fromHotSearch: true,
  discoverySources: ['gmgn-openapi', 'pancake-gt', 'dex-boost-new'],
  kolHandlesGmgn: ['ansem', 'cryptoyoda'],
  kolSource: 'gmgn-kol-net-inflow',
  txns1h: { buys: 400, sells: 120, total: 520 },
  securityChecked: true,
});
assert.ok(hotSm.valueScore >= 55, `hot smart meme should score high, got ${hotSm.valueScore}`);
assert.ok(hotSm.valueBreakdown.heat >= 40);
assert.ok(hotSm.valueBreakdown.smart >= 40);
assert.ok(hotSm.valueBreakdown.social >= 40);

const thin = computeValueScore({
  symbol: 'DUST',
  address: '0xbbb',
  chain: 'bsc',
  priceUsd: 0.0001,
  volume24h: 500,
  liquidity: 800,
  hasSmartMoneyData: false,
  dataQuality: 'dex-fallback',
});
assert.ok(thin.valueScore < hotSm.valueScore, 'dust should rank below enriched heat');

const pol = computeValueScore({
  symbol: 'TRUMP',
  name: 'Official Trump Meme',
  address: '0xccc',
  chain: 'solana',
  priceUsd: 1,
  volume24h: 100_000,
  liquidity: 50_000,
  priceChange1h: 12,
});
assert.ok(pol.narrativeTags.includes('trump') || pol.valueBreakdown.narrative >= 20);

// Dedupe + top 20 hard cap
const pool = [];
for (let i = 0; i < 45; i++) {
  pool.push({
    symbol: `T${i}`,
    address: `0x${i.toString(16).padStart(40, '0')}`,
    chain: 'bsc',
    priceUsd: 1,
    volume24h: 10_000 + i * 1000,
    volume1h: 2_000 + i * 200,
    liquidity: 20_000 + i * 500,
    smartCount: i % 5,
    hasSmartMoneyData: i % 3 === 0,
    discoverySources: i % 2 === 0 ? ['pancake-gt'] : ['dex-search'],
  });
}
// duplicate address with second source — must merge not double-count
pool.push({
  symbol: 'T10',
  address: pool[10].address,
  chain: 'bsc',
  priceUsd: 1,
  volume24h: 50_000,
  liquidity: 40_000,
  smartCount: 8,
  hasSmartMoneyData: true,
  dataQuality: 'gmgn-enriched',
  discoverySources: ['gmgn-openapi'],
  smartNetInflow5m: 12_000,
});

const top = rankAndSelectTopMemecoins(pool, 20);
assert.equal(top.length, 20, `expected 20, got ${top.length}`);
assert.equal(top[0].rank, 1);
assert.ok(top.every((t, i) => t.rank === i + 1));
// merged T10 should appear once with multi sources
const t10 = top.filter((t) => t.address === pool[10].address);
assert.ok(t10.length <= 1);
const merged = rankAndSelectTopMemecoins([pool[10], pool[pool.length - 1]], 5);
assert.equal(merged.length, 1);
assert.ok(merged[0].sourceHitCount >= 2 || (merged[0].discoverySources || []).length >= 2);
assert.ok(merged[0].valueScore > 0);

assert.ok(scoreHeat({ volume5m: 100_000, volume1h: 200_000, priceChange1h: 20 }) > scoreHeat({ volume24h: 1000 }));
assert.ok(scoreSmart({ smartCount: 5, smartNetInflow5m: 20_000, hasSmartMoneyData: true }) > scoreSmart({}));

console.log('value-rank tests passed');

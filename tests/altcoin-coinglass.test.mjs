/**
 * Altcoin CoinGlass helpers (pure, no live key required)
 */
import assert from 'node:assert/strict';
import {
  parseCoinglassWeeklyTakerBars,
  estimateVolumeUsd,
  normalizeCgFundingToDecimal,
  cgMarketToTicker,
} from '../functions/api/_altcoin_coinglass.js';
import { evaluateTwoWeekVolumeGrowth, isExcludedAltcoinSymbol as excl } from '../functions/api/_altcoin.js';

assert.equal(excl('BTC'), true);

// Funding normalize: small CG values → decimal
const fr = normalizeCgFundingToDecimal(0.01); // 0.01% → 0.0001
assert.ok(Math.abs(fr - 0.0001) < 1e-9, `got ${fr}`);

// Volume estimate via OI / ratio
const vol = estimateVolumeUsd({
  open_interest_usd: 100_000_000,
  open_interest_volume_ratio: 0.5,
});
assert.equal(vol, 200_000_000);

// Ticker map
const t = cgMarketToTicker({
  symbol: 'ETH',
  current_price: 2000,
  open_interest_usd: 10_000_000,
  open_interest_volume_ratio: 0.5,
  avg_funding_rate_by_vol: 0.01,
  price_change_percent_24h: 5,
  open_interest_change_percent_24h: 12,
});
assert.equal(t.symbol, 'ETH');
assert.ok(t.turnover24h > 0);
assert.ok(t.fundingRate > 0);

// Weekly taker bars → growth gate
const raw = [
  { t: 3, aggregated_buy_volume_usd: 20e6, aggregated_sell_volume_usd: 20e6 },
  { t: 2, aggregated_buy_volume_usd: 12e6, aggregated_sell_volume_usd: 12e6 },
  { t: 1, aggregated_buy_volume_usd: 8e6, aggregated_sell_volume_usd: 8e6 },
];
const bars = parseCoinglassWeeklyTakerBars(raw);
assert.equal(bars.length, 3);
assert.ok(bars[0].turnover >= bars[1].turnover);
const gate = evaluateTwoWeekVolumeGrowth(bars);
assert.equal(gate.pass, true, gate.reason);

// BTC excluded via altcoin rules
assert.equal(excl('BTC'), true);

console.log('altcoin-coinglass tests passed');

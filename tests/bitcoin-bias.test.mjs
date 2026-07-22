/**
 * Smoke-level checks for Bitcoin bias helpers via isolated reimplementation
 * (bitcoin.js is CF Pages entry; logic mirrored for pure unit check).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(__dirname, '../functions/api/bitcoin.js'), 'utf8');

// Ensure market bias exists in backend
assert.match(src, /function computeMarketBias/);
assert.match(src, /marketBias/);
assert.match(src, /fundingVenues/);
assert.match(src, /normalizeFundingTs|nextFundingTime/);
assert.match(src, /PERIOD_DEFS/);
assert.match(src, /fetchPeriodVenueBoard/);
assert.match(src, /periodBoard/);
assert.match(src, /'1h'/);
assert.match(src, /'2h'/);
assert.match(src, /'4h'/);
assert.match(src, /fundingStatsInWindow/);
assert.match(src, /openInterestHist|open-interest/);
assert.match(src, /fetchOkxPeriodMetrics/);
assert.match(src, /fetchBitgetPeriodMetrics/);
assert.match(src, /OKX_BASE|okx\.com/);
assert.match(src, /BITGET_BASE|bitget\.com/);
assert.match(src, /buildFiveVenueAverage/);
assert.match(src, /stageAverages/);
assert.match(src, /volumeQuoteAvg/);
assert.match(src, /priceAvg/);
assert.match(src, /自信号源/);
assert.match(src, /EXPECTED_VENUE_SLOTS|missingVenues|degraded/);
assert.match(src, /fetchLighterPeriodMetrics|LIGHTER_BASE|lighter/);
assert.match(src, /PLATFORM_VENUE_KEYS|hyperLiquid/);
assert.match(src, /stability|offlineKeys|online/);
assert.match(src, /buildRobustFundingMean|toFunding8h|fundingOutliers/);
assert.match(src, /thresholdPct|deviationPct/);

// Frontend wiring
const app = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
assert.match(app, /renderBtcMarketBias/);
assert.match(app, /renderBtcFundingVenues/);
assert.match(app, /renderPeriodVenueBoard/);
assert.match(app, /renderStageAverages/);
assert.match(app, /setBtcPeriod/);
assert.match(app, /Soft refresh|soft refresh|hasCache/);
assert.match(app, /btcBiasStrip|btcSourceHealth/);
assert.match(app, /btcPeriod/);
assert.match(app, /volumeQuoteAvg|fiveVenueAvg|自信号源/);
assert.match(app, /btcContractNodes|btcContractStability|contractDataStatus/);
assert.match(app, /renderFundingOutlierAlert|btcFundOutlierAlert|fundingOutliers/);

const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
assert.match(html, /btcBiasStrip/);
assert.match(html, /btcFundingVenues/);
assert.match(html, /btcTfBar/);
assert.match(html, /data-period="1h"/);
assert.match(html, /data-period="2h"/);
assert.match(html, /data-period="4h"/);
assert.doesNotMatch(html, /data-period="1d"/);
assert.doesNotMatch(html, /data-period="3w"/);
assert.match(html, /btcVenueTable/);
assert.match(html, /btcAvgBanner|自信号源平均/);
assert.match(html, /btcStageGrid/);
assert.match(html, /aggPrice/);
assert.match(html, /btcSelfSourceBar|自信号源/);
assert.doesNotMatch(html, /永续补充/);
assert.doesNotMatch(html, /btcCardHL|hlPrice|hlFundingRate/);
assert.doesNotMatch(html, /预预测资金费率/);
assert.match(html, /合约数据/);
assert.doesNotMatch(html, /期货数据/);
assert.doesNotMatch(html, /数据来源:\s*<a href="https:\/\/gmgn\.ai/);
assert.doesNotMatch(html, /Coinglass/);
// 页面不应再突出单所切换入口
assert.match(html, /btcSourceSelector" hidden|btcSourceSelector" id="btcSourceSelector" hidden/);

// Keep in sync with bitcoin.js: funding > 0 → 看多；<= 0 → 看空；无中性
function computeMarketBias({ fundingRate = 0, defaultFundingRate = 0 }) {
  const rate = Number(fundingRate) || 0;
  const def = Number(defaultFundingRate) || 0;
  const delta = rate - def;
  const isBull = delta > 0;
  const intensity = Math.min(50, Math.abs(delta) * 500_000);
  const score = Math.max(
    0,
    Math.min(100, Math.round(isBull ? 50 + Math.max(8, intensity) : 50 - Math.max(8, intensity)))
  );
  return { score, label: isBull ? '看多' : '看空', tone: isBull ? 'bull' : 'bear' };
}

const posFund = computeMarketBias({ fundingRate: 0.0001 });
assert.equal(posFund.label, '看多');
assert.ok(posFund.score > 50, `positive funding → bull score>50, got ${posFund.score}`);

const negFund = computeMarketBias({ fundingRate: -0.0001 });
assert.equal(negFund.label, '看空');
assert.ok(negFund.score < 50, `negative funding → bear score<50, got ${negFund.score}`);

const zeroFund = computeMarketBias({ fundingRate: 0 });
assert.equal(zeroFund.label, '看空', 'zero funding is not 中性 - 看空');

assert.match(src, /label = isBull \? '看多' : '看空'/);
assert.doesNotMatch(src, /label = '中性'/);

console.log('bitcoin-bias tests passed');

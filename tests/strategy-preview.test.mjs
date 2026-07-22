/**
 * Strategy quote PREVIEW — pure math + safety flags (never executes).
 */
import assert from 'node:assert/strict';
import { buildStrategyQuote, computeEntryPrice, SIZE_BY_GRADE } from '../functions/api/_strategy_quote.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const q = buildStrategyQuote({
  symbol: 'PEPE',
  chain: 'solana',
  address: 'TokenAddr111',
  marketPrice: 1,
  signalPrice: 0.9,
  entryGrade: 'B',
  entryAction: '小仓试探',
});

assert.equal(q.executionEnabled, false);
assert.equal(q.previewOnly, true);
assert.equal(q.requiresExplicitConfirm, true);
assert.equal(q.blocked, false);
assert.equal(q.templateId, 'standard-ladder-v1');
assert.equal(q.sizing.sizeUsd, SIZE_BY_GRADE.B.suggestedUsd);
assert.equal(q.legs.length, 4);

const entry = q.legs.find((l) => l.id === 'entry');
const tp1 = q.legs.find((l) => l.id === 'tp1');
const tp2 = q.legs.find((l) => l.id === 'tp2');
const sl = q.legs.find((l) => l.id === 'sl');
assert.ok(entry && entry.side === 'buy' && entry.type === 'limit');
assert.ok(entry.price > 0 && entry.price < 1, `entry below market, got ${entry.price}`);
assert.ok(Math.abs(tp1.price / entry.price - 2) < 0.001, 'TP1 = +100%');
assert.ok(Math.abs(tp2.price / entry.price - 4) < 0.001, 'TP2 = +300%');
assert.ok(Math.abs(sl.price / entry.price - 0.5) < 0.001, 'SL = -50%');
assert.equal(tp1.pctOfPosition, 50);
assert.equal(tp2.pctOfPosition, 50);
assert.ok(q.risk.maxLossUsd > 0);
assert.ok(q.risk.fullSuccessPnl > q.risk.maxLossUsd);
assert.ok(String(q.disclaimer).includes('预览') || String(q.disclaimer).includes('不'));

// Grade A larger size
const a = buildStrategyQuote({
  symbol: 'A',
  marketPrice: 10,
  entryGrade: 'A',
  entryAction: '重点观察',
});
assert.equal(a.sizing.sizeUsd, 100);
assert.ok(a.legs[0].price >= 9 && a.legs[0].price <= 10);

// D / hard block
const d = buildStrategyQuote({
  symbol: 'RUG',
  marketPrice: 1,
  entryGrade: 'D',
  entryAction: '禁止交易',
});
assert.equal(d.blocked, true);
assert.equal(d.legs.length, 0);
assert.equal(d.sizing.sizeUsd, 0);
assert.equal(d.executionEnabled, false);

const chase = buildStrategyQuote({
  symbol: 'CHASE',
  marketPrice: 2,
  signalPrice: 1,
  entryGrade: 'C',
  entryAction: '禁止追高',
});
assert.equal(chase.blocked, true);

// Entry helper
const e1 = computeEntryPrice({ marketPrice: 100, signalPrice: 100, entryAction: '继续观察', entryGrade: 'C' });
assert.ok(e1 < 100 && e1 > 80);

// sizeUsd override capped by grade max
const capped = buildStrategyQuote({
  symbol: 'CAP',
  marketPrice: 1,
  entryGrade: 'C',
  entryAction: '继续观察',
  sizeUsd: 9999,
});
assert.equal(capped.sizing.sizeUsd, SIZE_BY_GRADE.C.maxUsd);

// Route module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const route = await import(pathToFileURL(path.resolve(__dirname, '../functions/api/strategy-preview.js')).href);
assert.equal(typeof route.onRequest, 'function');

// Frontend safety wiring
const app = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
assert.match(app, /\/api\/strategy-preview/);
assert.match(app, /executionEnabled:\s*false|executionEnabled === true/);
assert.match(app, /openStrategyModal/);
assert.match(app, /buildLocalStrategyQuote/);
const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
assert.match(html, /strategyModal/);
assert.match(html, /不执行真实交易/);

console.log('strategy-preview tests passed');

/**
 * Wallet profile normalize + style rating + API module surface
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const gmgn = await import(pathToFileURL(path.resolve(__dirname, '../functions/api/_gmgn.js')).href);

assert.equal(typeof gmgn.normalizeWalletStats, 'function');
assert.equal(typeof gmgn.rateTradingStyle, 'function');
assert.equal(typeof gmgn.getWalletStats, 'function');

const strong = gmgn.normalizeWalletStats(
  {
    winrate: 0.62,
    realized_profit: 45000,
    unrealized_profit: 8000,
    total_cost: 20000,
    pnl: 2.25,
    buy_count: 40,
    sell_count: 35,
    common: {
      name: 'AlphaWhale',
      twitter_username: 'alpha_whale',
      tags: ['smart_money', 'gmgn'],
      follow_count: 1200,
    },
  },
  { wallet: 'So11111111111111111111111111111111111111112', chain: 'solana', period: '7d', role: 'smart' }
);

assert.equal(strong.winratePct, 62);
assert.ok(strong.realizedProfit >= 45000);
assert.ok(strong.style.score >= 65);
assert.ok(['A', 'B'].includes(strong.style.grade), strong.style.grade);
assert.ok(strong.tags.includes('smart_money'));
assert.equal(strong.twitter, 'alpha_whale');
assert.equal(strong.source, 'gmgn-wallet-stats');

// winrate as percent (62) should normalize to 0.62
const pctForm = gmgn.normalizeWalletStats({ winrate: 55, buy_count: 10, sell_count: 8 }, { wallet: 'x' });
assert.ok(pctForm.winrate > 0.5 && pctForm.winrate <= 1, String(pctForm.winrate));

const weak = gmgn.rateTradingStyle({ winrate: 0.25, pnl: -0.4, buyCount: 3, sellCount: 2, realized: -500 });
assert.ok(['C', 'D'].includes(weak.grade), weak.grade);

const empty = gmgn.rateTradingStyle({ winrate: null, buyCount: 0, sellCount: 0 });
assert.equal(empty.grade, '未知');

// wallet-profile route module exports onRequest
const route = await import(pathToFileURL(path.resolve(__dirname, '../functions/api/wallet-profile.js')).href);
assert.equal(typeof route.onRequest, 'function');

// Static UI wiring
import fs from 'node:fs';
const app = fs.readFileSync(path.resolve(__dirname, '../public/app.js'), 'utf8');
assert.match(app, /renderWalletProfileCard/);
assert.match(app, /\/api\/wallet-profile/);
assert.match(app, /loadWalletProfileStats/);
assert.match(app, /topWallets/);

console.log('wallet-profile tests passed');

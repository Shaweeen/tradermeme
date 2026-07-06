import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

assert.match(app, /archive-address-copy/, 'archived history address/fingerprint should render as a copyable element');
assert.match(app, /data-copy-address=/, 'archived history copy element should carry the full token address');
assert.match(app, /querySelectorAll\('\.archive-address-copy'\)/, 'archived history copy elements should be wired after render');
assert.match(app, /copyAddress\(e\.currentTarget\.dataset\.copyAddress, e\)/, 'left-click should copy the archived token address');
assert.match(css, /\.archive-address-copy/, 'copyable archived address should have cursor/hover styling');
assert.match(app, /zeroNoInflowCleanupMs:\s*4 \* 60 \* 60 \* 1000/, 'zero-price no-inflow cleanup window should be 4 hours');
assert.match(app, /function hasRecentCapitalInflow/, 'tracking should detect fresh capital inflow');
assert.match(app, /lastCapitalInflowAt/, 'tracked tokens should persist the last capital inflow timestamp');
assert.match(app, /价格归零且4小时无资金流入/, 'zero-price tokens should only be deleted after 4h without inflow');

console.log('archive-copy static tests passed');

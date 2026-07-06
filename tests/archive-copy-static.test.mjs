import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

assert.match(app, /archive-address-copy/, 'archived history address/fingerprint should render as a copyable element');
assert.match(app, /data-copy-address=/, 'archived history copy element should carry the full token address');
assert.match(app, /querySelectorAll\('\.archive-address-copy'\)/, 'archived history copy elements should be wired after render');
assert.match(app, /copyAddress\(e\.currentTarget\.dataset\.copyAddress, e\)/, 'left-click should copy the archived token address');
assert.match(css, /\.archive-address-copy/, 'copyable archived address should have cursor/hover styling');

console.log('archive-copy static tests passed');

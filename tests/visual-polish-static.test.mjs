import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(root, 'public/style.css'), 'utf8');

function includesAll(source, snippets) {
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `missing expected CSS snippet: ${snippet}`);
  }
}

includesAll(css, [
  '--accent: #4b8bff;',
  '--border: #1e2a3d;',
  '--surface-glass:',
  '--gradient-panel:',
  'body::after',
  '.dashboard-section::before',
  '.stats-item::before',
  '.token-row:nth-child(even)',
  '.table-container {\n  overflow-x: auto;',
  '@media (prefers-reduced-motion: reduce)',
]);

assert.ok(/\.monitor-card:hover\s*\{[\s\S]*transform: translateY\(-2px\)/.test(css), 'monitor cards should get tactile hover lift');
assert.ok(/\.action-btn:active,[\s\S]*\.monitor-action-btn:active[\s\S]*scale\(0\.98\)/.test(css), 'buttons should have active tactile feedback');

console.log('visual-polish static tests passed');

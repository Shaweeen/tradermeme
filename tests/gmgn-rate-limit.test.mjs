/**
 * GMGN rate-limit shield: cache, circuit, stale serve, concurrency.
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = pathToFileURL(path.resolve(__dirname, '../functions/api/_gmgn.js')).href;

const gmgn = await import(modPath);
const {
  gmgnFetch,
  getRateLimitState,
  resetRateLimitStateForTests,
  isCircuitOpen,
  getTrendingSwapsMulti,
} = gmgn;

assert.equal(typeof gmgnFetch, 'function');
assert.equal(typeof getRateLimitState, 'function');
assert.equal(typeof resetRateLimitStateForTests, 'function');
assert.equal(typeof isCircuitOpen, 'function');

resetRateLimitStateForTests();

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
let force429 = false;
let forceOkPayload = { code: 0, data: { data: { rank: [{ address: 'A', symbol: 'AAA', volume_24h: 1000 }] } } };

globalThis.fetch = async (url) => {
  fetchCalls += 1;
  if (force429) {
    return {
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      json: async () => ({ code: 429, message: 'IP is temporarily banned due to repeated rate limit violations' }),
    };
  }
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => forceOkPayload,
  };
};

try {
  // Fresh miss → network
  fetchCalls = 0;
  const r1 = await gmgnFetch('test-key', 'GET', '/v1/market/rank', { chain: 'sol', interval: '1h', limit: 30 });
  assert.ok(r1 && r1.code === 0);
  assert.equal(fetchCalls, 1);

  // Fresh hit → no network
  fetchCalls = 0;
  const r2 = await gmgnFetch('test-key', 'GET', '/v1/market/rank', { chain: 'sol', interval: '1h', limit: 30 });
  assert.deepEqual(r2, r1);
  assert.equal(fetchCalls, 0, 'second call should hit cache');
  const st1 = getRateLimitState();
  assert.ok(st1.cacheHits >= 1);
  assert.equal(st1.circuitOpen, false);

  // 429 opens circuit; next call serves stale without network
  force429 = true;
  fetchCalls = 0;
  // skipCache to force network attempt that 429s — but same key has cache
  // Actually first 429: use different path so we open circuit, then same cached path serves stale
  await assert.rejects(
    () => gmgnFetch('test-key', 'GET', '/v1/user/smartmoney', { chain: 'sol', limit: 10 }, null, { skipCache: true }),
    (err) => err.rateLimited === true
  );
  assert.equal(isCircuitOpen(), true, 'circuit should open after 429');

  fetchCalls = 0;
  // Cached rank should be served as stale while circuit open
  const stale = await gmgnFetch('test-key', 'GET', '/v1/market/rank', { chain: 'sol', interval: '1h', limit: 30 });
  assert.deepEqual(stale, r1);
  assert.equal(fetchCalls, 0, 'stale serve must not hit network');
  assert.ok(getRateLimitState().staleServes >= 1);

  // Multi-rank stops hammering under circuit
  force429 = false;
  resetRateLimitStateForTests();
  force429 = true;
  fetchCalls = 0;
  const multi = await getTrendingSwapsMulti('test-key', 'sol', 20);
  assert.ok(Array.isArray(multi.list));
  assert.ok(multi.rateLimited === true || multi.errors.length > 0);
  // Should not fire dozens of orderby extras (old code could do 10+)
  assert.ok(fetchCalls <= 4, `expected few rank attempts under 429, got ${fetchCalls}`);

  // Success clears circuit
  force429 = false;
  resetRateLimitStateForTests();
  fetchCalls = 0;
  await gmgnFetch('test-key', 'GET', '/v1/market/rank', { chain: 'base', interval: '1h' });
  assert.equal(isCircuitOpen(), false);
  assert.equal(getRateLimitState().consecutive429, 0);

  console.log('gmgn-rate-limit tests passed');
} finally {
  globalThis.fetch = originalFetch;
  resetRateLimitStateForTests();
}

/**
 * Personal X alpha watchlist (user-curated).
 * Memecoin community signals only — max 500 handles.
 * Append more rows to HANDLES (rank, name, handle without @).
 */

const MAX_HANDLES = 500;

/** @type {{ rank: number, name: string, handle: string, note?: string }[]} */
const HANDLES = [
  { rank: 1, name: 'PokerFish', handle: 'fish081320792' },
  { rank: 2, name: '念云归', handle: 'slowisfast_' },
  { rank: 3, name: 'Mr.DQ', handle: '0xmrdq' },
  { rank: 4, name: 'Elon Musk', handle: 'elonmusk', note: 'high-noise global' },
  { rank: 5, name: 'Donald J. Trump', handle: 'realdonaldtrump', note: 'high-noise global' },
  { rank: 6, name: 'CZ', handle: 'Cz_binance' },
  { rank: 7, name: '一屹水火先', handle: 'Cryptoyiyi' },
  { rank: 8, name: 'Yi He', handle: 'Heyibinance' },
  { rank: 9, name: 'ye', handle: 'kanyewest', note: 'high-noise global' },
  { rank: 10, name: 'Mario Nawfal', handle: 'marionawfal' },
  { rank: 11, name: 'Cointelegraph', handle: 'cointelegraph', note: 'media' },
  { rank: 12, name: 'Insyder', handle: 'insydercrypto' },
  { rank: 13, name: 'pepe boost', handle: 'PepeBoost888' },
  { rank: 14, name: 'Binance', handle: 'binance', note: 'exchange official' },
  { rank: 15, name: 'Watcher.Guru', handle: 'WatcherGuru', note: 'media' },
  { rank: 16, name: 'Dave Portnoy', handle: 'stoolpresidente' },
  { rank: 17, name: 'XXYY', handle: 'useXXYYio' },
  // … paste up to rank 500
];

/** @returns {string[]} lowercase handles without @ */
function getWatchlistHandles() {
  const out = [];
  const seen = new Set();
  for (const row of HANDLES.slice(0, MAX_HANDLES)) {
    const h = String(row?.handle || '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase();
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}

/** @returns {Set<string>} */
function getWatchlistSet() {
  return new Set(getWatchlistHandles());
}

/**
 * Normalize raw handle / x.com URL → bare lowercase handle
 */
function normalizeHandle(raw) {
  return String(raw || '')
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, '')
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
}

/**
 * Match candidates against personal watchlist.
 * @param {string[]} candidates
 * @returns {{ hits: string[], count: number }}
 */
function matchWatchlist(candidates = []) {
  const set = getWatchlistSet();
  const hits = [];
  const seen = new Set();
  for (const raw of candidates) {
    const h = normalizeHandle(raw);
    if (!h || !set.has(h) || seen.has(h)) continue;
    seen.add(h);
    hits.push(h);
  }
  return { hits, count: hits.length };
}

function getWatchlistMeta() {
  return {
    version: 1,
    name: 'personal-x-alpha-watchlist',
    count: getWatchlistHandles().length,
    maxHandles: MAX_HANDLES,
    updatedAt: '2026-07-16',
  };
}

export {
  HANDLES,
  MAX_HANDLES,
  getWatchlistHandles,
  getWatchlistSet,
  matchWatchlist,
  normalizeHandle,
  getWatchlistMeta,
};

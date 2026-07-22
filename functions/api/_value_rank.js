/**
 * Memecoin value ranking — GMGN Monitor–style heat + multi-source social/smart blend.
 *
 * Goal: from a multi-platform pool, dedupe is assumed upstream; score & keep top N
 * (default 20) highest-value targets for the memecoin board.
 *
 * Factors (0–100 each, then weighted):
 *   heat      — short-window volume / tx / price momentum (GMGN Monitor heat proxy)
 *   smart     — smart money + KOL net inflow / wallet counts
 *   social    — hot search, trenches, boosts, KOL handles, X mentions
 *   community — new wallets, holder concentration risk inverted, multi-source hits
 *   narrative — headline / politics / culture keyword heat (proxy, not a news API)
 *   quality   — liquidity, price validity, security flags, data quality
 */

const DISPLAY_LIMIT = 20;
const RANK_POOL_LIMIT = 80; // score more than display, then cut

const WEIGHTS = {
  heat: 0.28,
  smart: 0.26,
  social: 0.16,
  community: 0.12,
  narrative: 0.08,
  quality: 0.10,
};

/** Culture / politics / meme-narrative keywords (lowercase). Soft boost only. */
const NARRATIVE_KEYWORDS = [
  // politics / public discourse (crypto-meme relevant, not full news feed)
  'trump', 'maga', 'biden', 'obama', 'harris', 'elon', 'musk', 'doge', 'pepe', 'wojak',
  'war', 'peace', 'tariff', 'fed', 'rate', 'election', 'vote', 'congress', 'sec', 'etf',
  'china', 'usa', 'america', 'bitcoin', 'btc', 'ai', 'gpt', 'openai', 'nvidia',
  // launchpad / platform culture
  'pump', 'bonk', 'wif', 'meme', 'cat', 'dog', 'frog', 'moon', 'rocket',
  'binance', 'cz', 'bnb', 'four', 'pancake', 'hood', 'robin',
];

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));
}

function num(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function logScore(value, mid = 10_000) {
  const v = Math.max(0, Number(value) || 0);
  if (v <= 0) return 0;
  // log10 curve: mid → ~50, 100*mid → ~100
  return clamp((Math.log10(v + 1) / Math.log10(mid * 100 + 1)) * 100);
}

function textBlob(token = {}) {
  return [
    token.symbol,
    token.name,
    token.signalReasonText,
    ...(Array.isArray(token.discoverySources) ? token.discoverySources : []),
    ...(Array.isArray(token.kolHandlesUnique) ? token.kolHandlesUnique : []),
    ...(Array.isArray(token.kolHandlesGmgn) ? token.kolHandlesGmgn : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function scoreHeat(token = {}) {
  const vol5 = num(token.volume5m, token.volume_5m);
  const vol15 = num(token.volume15m, token.volume_15m);
  const vol1h = num(token.volume1h, token.volume_1h);
  const vol24 = num(token.volume24h, token.volume_24h, token.volume);
  const shortVol = vol5 * 3 + vol15 * 1.5 + (vol1h || vol24 * 0.15);
  const ch1h = Math.abs(num(token.priceChange1h));
  const ch24 = Math.abs(num(token.priceChange24h));
  const txns = num(
    token.txns1h?.total,
    (num(token.txns1h?.buys) || 0) + (num(token.txns1h?.sells) || 0),
    token.txns24h?.total
  );
  let s = 0;
  s += logScore(shortVol, 50_000) * 0.45;
  s += logScore(vol24, 200_000) * 0.2;
  s += clamp(Math.min(ch1h, 120) * 0.55) * 0.2;
  s += clamp(Math.min(ch24, 200) * 0.2) * 0.05;
  s += logScore(txns, 200) * 0.1;
  // GMGN-style: pure price dump without volume is weak
  if (ch1h > 40 && shortVol < 5_000 && vol24 < 50_000) s *= 0.55;
  return clamp(s);
}

function scoreSmart(token = {}) {
  const smartCount = num(token.smartCount, token.smart_degen_count, token.smart_count);
  const sm5 = num(token.smartNetInflow5m);
  const sm15 = num(token.smartNetInflow15m);
  const sm1h = num(token.smartNetInflow1h);
  const kol5 = num(token.kolNetInflow5m);
  const kol15 = num(token.kolNetInflow15m);
  const smW = num(token.smartWallets5m) + num(token.smartWallets15m) * 0.5;
  const kolW = num(token.kolWallets5m) + num(token.kolWallets15m) * 0.5;
  const hasSm = token.hasSmartMoneyData === true || token.dataQuality === 'gmgn-enriched';

  let s = 0;
  s += clamp(smartCount * 14) * 0.25;
  s += logScore(Math.max(0, sm5) * 1.4 + Math.max(0, sm15) + Math.max(0, sm1h) * 0.4, 8_000) * 0.35;
  s += logScore(Math.max(0, kol5) * 1.2 + Math.max(0, kol15), 5_000) * 0.2;
  s += clamp(smW * 12 + kolW * 14) * 0.15;
  if (!hasSm && sm5 + sm15 + smartCount === 0) s *= 0.45;
  return clamp(s);
}

function scoreSocial(token = {}) {
  const sources = new Set(
    (Array.isArray(token.discoverySources) ? token.discoverySources : [])
      .map((s) => String(s).toLowerCase())
  );
  const kolHandles = [
    ...(token.kolHandlesUnique || []),
    ...(token.kolHandlesGmgn || []),
  ];
  let s = 18;
  if (token.fromHotSearch || sources.has('hot-search') || sources.has('hot_search')) s += 28;
  if (token.fromTrenches || sources.has('trenches')) s += 18;
  if ([...sources].some((x) => x.includes('boost') || x.includes('hydrate'))) s += 14;
  if ([...sources].some((x) => x.includes('pancake') || x.includes('binance-dex'))) s += 10;
  if ([...sources].some((x) => x.includes('four') || x.includes('xxyy') || x.includes('new'))) s += 12;
  s += clamp(kolHandles.length * 10, 0, 30);
  if (token.kolSource === 'gmgn-kol-net-inflow') s += 12;
  if (token.kolSource === 'x-watchlist') s += 8;
  // multi-platform hits
  const platformHits = num(token.sourceHitCount, sources.size);
  s += clamp(platformHits * 6, 0, 18);
  return clamp(s);
}

function scoreCommunity(token = {}) {
  const newW = num(token.newWallets5m) + num(token.newWallets15m) * 0.5;
  const holders = num(token.holders, token.holder_count);
  const top10 = num(token.top10Holders, token.top10);
  const top10Pct = top10 > 1 ? top10 : top10 * 100;
  let s = 20;
  s += logScore(newW, 40) * 0.4;
  s += logScore(holders, 5_000) * 0.25;
  // concentration penalty
  if (top10Pct >= 70) s -= 28;
  else if (top10Pct >= 50) s -= 14;
  else if (top10Pct > 0 && top10Pct < 35) s += 12;
  return clamp(s);
}

function scoreNarrative(token = {}) {
  const blob = textBlob(token);
  if (!blob) return 10;
  let hits = 0;
  const matched = [];
  for (const kw of NARRATIVE_KEYWORDS) {
    if (blob.includes(kw)) {
      hits += 1;
      matched.push(kw);
      if (hits >= 5) break;
    }
  }
  // politics-ish cluster
  const politics = ['trump', 'biden', 'election', 'maga', 'tariff', 'fed', 'war', 'sec', 'etf'];
  const polHits = politics.filter((k) => blob.includes(k)).length;
  let s = 12 + hits * 14 + polHits * 8;
  return { score: clamp(s), matched: matched.slice(0, 4), polHits };
}

function scoreQuality(token = {}) {
  const liq = num(token.liquidity, token.liquidityUsd);
  const price = num(token.priceUsd, token.price);
  let s = 40;
  if (!(price > 0)) return 0;
  s += logScore(liq, 40_000) * 0.45;
  if (token.isHoneypot || token.isRug) return 5;
  if (token.isBan) s -= 25;
  if (token.security?.canSell === false) s -= 30;
  if (token.securityChecked) s += 8;
  const dq = String(token.dataQuality || '');
  if (dq.includes('gmgn')) s += 12;
  else if (dq.includes('dex') || dq.includes('pancake') || dq.includes('binance-dex')) s += 6;
  else if (dq.includes('fallback') || dq === 'rank-only') s -= 4;
  if (String(token.address || '').startsWith('binance-')) s -= 40;
  return clamp(s);
}

/**
 * @returns {{ valueScore: number, valueBreakdown: object, valueReasons: string[], narrativeTags: string[] }}
 */
function computeValueScore(token = {}) {
  const heat = scoreHeat(token);
  const smart = scoreSmart(token);
  const social = scoreSocial(token);
  const community = scoreCommunity(token);
  const narrative = scoreNarrative(token);
  const quality = scoreQuality(token);

  const raw =
    heat * WEIGHTS.heat +
    smart * WEIGHTS.smart +
    social * WEIGHTS.social +
    community * WEIGHTS.community +
    narrative.score * WEIGHTS.narrative +
    quality * WEIGHTS.quality;

  const valueScore = clamp(raw);
  const reasons = [];
  if (heat >= 55) reasons.push(`热度${heat}`);
  if (smart >= 50) reasons.push(`聪明钱${smart}`);
  if (social >= 50) reasons.push(`社交${social}`);
  if (narrative.polHits > 0) reasons.push(`舆论${narrative.polHits}`);
  if (narrative.matched.length) reasons.push(...narrative.matched.slice(0, 2));
  if (quality < 35) reasons.push('质量偏低');

  return {
    valueScore,
    valueBreakdown: {
      heat,
      smart,
      social,
      community,
      narrative: narrative.score,
      quality,
    },
    valueReasons: reasons.slice(0, 5),
    narrativeTags: narrative.matched,
  };
}

/**
 * Dedupe by chain:address (keep richer row), score, sort, take top limit.
 */
function rankAndSelectTopMemecoins(tokens = [], limit = DISPLAY_LIMIT) {
  const byKey = new Map();
  for (const t of tokens || []) {
    const chain = String(t.chain || '').toLowerCase() || 'unknown';
    const addr = String(t.address || '').toLowerCase();
    if (!addr) continue;
    const key = `${chain}:${addr}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...t });
      continue;
    }
    // Merge: keep max metrics + union discovery
    const merged = { ...prev };
    for (const k of Object.keys(t)) {
      const a = prev[k];
      const b = t[k];
      if (b == null || b === '' || b === 0) continue;
      if (typeof b === 'number' && typeof a === 'number') {
        // prefer larger activity/smart fields
        if (
          /volume|liquidity|smart|kol|holder|inflow|wallet|count|change/i.test(k)
        ) {
          merged[k] = Math.abs(b) > Math.abs(a) ? b : a;
        }
      } else if (a == null || a === '' || a === 0) {
        merged[k] = b;
      }
    }
    const srcA = Array.isArray(prev.discoverySources) ? prev.discoverySources : [];
    const srcB = Array.isArray(t.discoverySources) ? t.discoverySources : [];
    const tagA = prev.source ? [prev.source] : [];
    const tagB = t.source ? [t.source] : [];
    merged.discoverySources = [...new Set([...srcA, ...srcB, ...tagA, ...tagB])];
    merged.sourceHitCount = merged.discoverySources.length;
    if (prev.hasSmartMoneyData || t.hasSmartMoneyData) merged.hasSmartMoneyData = true;
    if (t.dataQuality === 'gmgn-enriched' || prev.dataQuality === 'gmgn-enriched') {
      merged.dataQuality = 'gmgn-enriched';
    }
    byKey.set(key, merged);
  }

  const scored = [...byKey.values()].map((t) => {
    const v = computeValueScore(t);
    return {
      ...t,
      valueScore: v.valueScore,
      valueBreakdown: v.valueBreakdown,
      valueReasons: v.valueReasons,
      narrativeTags: v.narrativeTags,
      sourceHitCount: t.sourceHitCount || (t.discoverySources || []).length || 1,
    };
  });

  scored.sort((a, b) => {
    if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
    const vol = (x) => num(x.volume24h, x.volume1h);
    if (vol(b) !== vol(a)) return vol(b) - vol(a);
    return num(b.smartCount) - num(a.smartCount);
  });

  const topN = Math.max(1, Math.min(Number(limit) || DISPLAY_LIMIT, 50));
  return scored.slice(0, topN).map((t, i) => ({ ...t, rank: i + 1 }));
}

export {
  DISPLAY_LIMIT,
  RANK_POOL_LIMIT,
  WEIGHTS,
  NARRATIVE_KEYWORDS,
  computeValueScore,
  rankAndSelectTopMemecoins,
  scoreHeat,
  scoreSmart,
  scoreSocial,
};

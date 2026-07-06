(function initTrackingStorage(global) {
  function estimateJsonBytes(value) {
    try { return JSON.stringify(value).length; }
    catch { return Number.POSITIVE_INFINITY; }
  }

  function compressPriceHistory(points = [], opts = {}) {
    const list = (Array.isArray(points) ? points : [])
      .filter((p) => p && Number(p.time) > 0 && Number(p.price) > 0)
      .sort((a, b) => Number(a.time) - Number(b.time));
    if (list.length <= 2) return list;

    const now = Number(opts.now || Date.now());
    const recentMs = Number(opts.recentMs || 24 * 60 * 60 * 1000);
    const olderBucketMs = Number(opts.olderBucketMs || 15 * 60 * 1000);
    const maxPoints = Number(opts.maxPoints || 900);
    const recentCutoff = now - recentMs;
    const first = list[0];
    const latest = list[list.length - 1];
    const buckets = new Map();
    const output = [first];

    for (const p of list) {
      if (p === first || p === latest) continue;
      const time = Number(p.time);
      if (time >= recentCutoff) {
        output.push(p);
      } else {
        const bucket = Math.floor(time / olderBucketMs) * olderBucketMs;
        buckets.set(bucket, p); // keep the newest point in that bucket
      }
    }
    output.push(...Array.from(buckets.values()));
    output.push(latest);

    const deduped = [];
    const seen = new Set();
    for (const p of output.sort((a, b) => Number(a.time) - Number(b.time))) {
      const k = `${p.time}:${p.price}`;
      if (!seen.has(k)) { seen.add(k); deduped.push(p); }
    }
    if (deduped.length <= maxPoints) return deduped;

    const keep = [deduped[0]];
    const middle = deduped.slice(1, -1);
    const step = Math.max(1, Math.ceil(middle.length / Math.max(1, maxPoints - 2)));
    for (let i = 0; i < middle.length && keep.length < maxPoints - 1; i += step) keep.push(middle[i]);
    keep.push(deduped[deduped.length - 1]);
    return keep;
  }

  function retentionForTracked(tracked, opts) {
    const normalRetentionMs = Number(opts.normalRetentionMs || 24 * 60 * 60 * 1000);
    const moonshotRetentionMs = Number(opts.moonshotRetentionMs || 30 * 24 * 60 * 60 * 1000);
    return tracked?.moonshot?.active ? moonshotRetentionMs : normalRetentionMs;
  }

  function prepareTrackingStateForStorage(input = {}, opts = {}) {
    const now = Number(opts.now || Date.now());
    const maxBytes = Number(opts.maxBytes || 4_000_000);
    const moonshotMaxPoints = Number(opts.moonshotMaxPoints || 900);
    const normalMaxPoints = Number(opts.normalMaxPoints || 2880);
    const prepared = {
      savedAt: input.savedAt || now,
      signalIdCounter: input.signalIdCounter || 0,
      signals: Array.isArray(input.signals) ? input.signals.slice(0, 50) : [],
      trackedTokens: {},
    };

    for (const [key, tracked] of Object.entries(input.trackedTokens || {})) {
      if (!tracked) continue;
      const retentionMs = retentionForTracked(tracked, opts);
      if (now - Number(tracked.signalAt || 0) > retentionMs) continue;
      const copy = { ...tracked };
      const maxPoints = copy.moonshot?.active ? moonshotMaxPoints : normalMaxPoints;
      copy.priceHistory = compressPriceHistory(copy.priceHistory || [], {
        now,
        recentMs: copy.moonshot?.active ? 24 * 60 * 60 * 1000 : retentionMs,
        olderBucketMs: copy.moonshot?.active ? 15 * 60 * 1000 : 60 * 1000,
        maxPoints,
      });
      prepared.trackedTokens[key] = copy;
    }

    if (estimateJsonBytes(prepared) <= maxBytes) return prepared;

    const entries = Object.entries(prepared.trackedTokens)
      .sort(([, a], [, b]) => {
        const am = a?.moonshot?.active ? 1 : 0;
        const bm = b?.moonshot?.active ? 1 : 0;
        if (am !== bm) return bm - am;
        return Number(b.signalAt || 0) - Number(a.signalAt || 0);
      });
    const compacted = { ...prepared, trackedTokens: {} };
    for (const [key, tracked] of entries) {
      const copy = { ...tracked, priceHistory: compressPriceHistory(tracked.priceHistory || [], { now, recentMs: 60 * 60 * 1000, olderBucketMs: 60 * 60 * 1000, maxPoints: 240 }) };
      compacted.trackedTokens[key] = copy;
      if (estimateJsonBytes(compacted) > maxBytes) delete compacted.trackedTokens[key];
    }
    return compacted;
  }

  function shouldSkipAutoRefresh({ hidden = false, autoRefreshEnabled = true } = {}) {
    return !autoRefreshEnabled || !!hidden;
  }

  global.TrackingStorage = { estimateJsonBytes, compressPriceHistory, prepareTrackingStateForStorage, shouldSkipAutoRefresh };
})(typeof window !== 'undefined' ? window : globalThis);

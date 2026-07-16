/**
 * CoinWatch - Frontend Application
 * Multi-page dashboard: Memecoin (10-item), Othercoin (top coins), Bitcoin (BTC market)
 */

// ===== State =====
const state = {
  // Page state
  currentPage: 'memecoin',

  // Memecoin state
  currentChain: 'solana',
  tokens: [],
  signals: [],
  trackedTokens: {},
  aiExpanded: {},
  archiveExpanded: false,
  isLoading: false,
  memecoinLoadId: 0, // race-safe chain switches
  error: null,
  lastUpdated: null,
  autoRefreshInterval: null,
  autoRefreshDelay: 30000,
  retryCount: 0,
  maxRetries: 3,
  sortBy: 'volume',
  signalIdCounter: 0,
  signalExpiryMs: 300000, // 5 min active signal carousel
  trackingRetentionMs: 9 * 60 * 60 * 1000, // 9h normal historical tracking observation window
  moonshotRetentionMs: 30 * 24 * 60 * 60 * 1000, // >500% projects are kept for 1 month
  maxPriceHistory: 2880, // normal 24h at 30s refresh cadence
  maxMoonshotPriceHistory: 900, // compressed 1-month moonshot history for localStorage safety
  maxTrackingStorageBytes: 4_000_000, // keep below common 5MB localStorage quota
  zeroNoInflowCleanupMs: 4 * 60 * 60 * 1000, // remove zero-price archive rows after 4h without capital inflow
  memecoinLimit: 30,

  // Othercoin state
  otherTokens: [],
  otherLoading: false,
  otherError: null,
  otherSortBy: 'signalScore',

  // Bitcoin state
  btcData: null,
  btcLoading: false,
  btcError: null,
  btcPriceHistory: [],
  btcPreferredSource: 'auto',
  btcSourceRetryCount: 0,
  btcSourceMaxRetries: 2,
};

// ===== Signal Thresholds (prefer SignalEngine.thresholds when loaded) =====
const SIGNAL_THRESHOLDS = {
  priceSurge: 15,
  volumeSpike: 500000, // legacy UI only — alerts no longer fire on volume alone
  volume1hMin: 80000,
  buyPressure: 75,
  aiScore: 62,
  maxAiRisk: 74,
  monitorInflow: 70,
  monitorMaxRisk: 60,
};

const TRACKING_STORAGE_KEY = 'coinwatch_memecoin_signal_tracking_v1';

// ===== DOM =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  // Page Nav
  pageTabs: $$('.page-tab'),
  pageContents: {
    memecoin: $('#pageMemecoin'),
    othercoin: $('#pageOthercoin'),
    bitcoin: $('#pageBitcoin'),
  },
  logoSubtitle: $('#logoSubtitle'),

  // Shared
  statusDot: $('.status-dot'),
  statusText: $('#statusText'),
  refreshBtn: $('#refreshBtn'),
  autoRefreshToggle: $('#autoRefreshToggle'),
  chainTabs: $$('.chain-tab'),

  // Memecoin - Signals
  signalsList: $('#signalsList'),
  signalsEmpty: $('#signalsEmpty'),
  signalCount: $('#signalCount'),
  clearSignalsBtn: $('#clearSignalsBtn'),

  // Memecoin - Tokens
  tokenList: $('#tokenList'),
  loadingState: $('#loadingState'),
  errorState: $('#errorState'),
  errorMessage: $('#errorMessage'),
  retryBtn: $('#retryBtn'),
  hotCount: $('#hotCount'),
  sortBtns: $$('#sortSelect .filter-btn'),

  // Memecoin - Stats
  statCount: $('#statCountMeme .stat-value'),
  statVolume: $('#statVolumeMeme .stat-value'),
  statNewest: $('#statNewestMeme .stat-value'),
  statUpdated: $('#statUpdatedMeme .stat-value'),
  statsBar: $('#statsBarMeme'),

  // Memecoin - Monitoring
  monitorCards: $('#monitorCards'),
  monitorEmpty: $('#monitorEmpty'),
  trackedCount: $('#trackedCount'),

  // Othercoin
  otherTokenList: $('#otherTokenList'),
  otherLoadingState: $('#otherLoadingState'),
  otherErrorState: $('#otherErrorState'),
  otherErrorMessage: $('#otherErrorMessage'),
  otherRetryBtn: $('#otherRetryBtn'),
  otherCount: $('#otherCount'),
  otherSortBtns: $$('#otherSortSelect .filter-btn'),
  statCountOther: $('#statCountOther .stat-value'),
  statVolOther: $('#statVolOther .stat-value'),
  statCapOther: $('#statCapOther .stat-value'),
  statUpdatedOther: $('#statUpdatedOther .stat-value'),
  statsBarOther: $('#statsBarOther'),

  // Bitcoin
  btcHeroLoading: $('#btcHeroLoading'),
  btcHeroContent: $('#btcHeroContent'),
  btcPrice: $('#btcPrice'),
  btc24hChange: $('#btc24hChange'),
  btcHigh24h: $('#btcHigh24h'),
  btcLow24h: $('#btcLow24h'),
  btcVolume24h: $('#btcVolume24h'),
  btcUpdated: $('#btcUpdated'),
  btcSparkline: $('#btcSparkline'),
  btcFundingRate: $('#btcFundingRate'),
  btcAnnualFunding: $('#btcAnnualFunding'),
  btcOpenInterest: $('#btcOpenInterest'),
  btcMarkPrice: $('#btcMarkPrice'),
  btcNextFundingTime: $('#btcNextFundingTime'),
  btcDominance: $('#btcDominance'),
  btcTotalMarketCap: $('#btcTotalMarketCap'),
  btcTotalVolume: $('#btcTotalVolume'),
  btcMarketCapChange: $('#btcMarketCapChange'),
  btcSources: $('#btcSources'),
  // BTC Source Selector
  btcSourceBtns: $$('#btcSourceBtns .btc-source-btn'),
  sourceStatusDot: $('#sourceStatusDot'),
  sourceStatusText: $('#sourceStatusText'),

  // BTC - Long/Short Ratio
  lsGrid: $('#lsGrid'),
  lsStatus: $('#lsStatus'),
  lsSignal: $('#lsSignal'),

  // BTC - Liquidations
  liqTotalUsd: $('#liqTotalUsd'),
  liqCount: $('#liqCount'),
  liqSignal: $('#liqSignal'),
  liqLongBar: $('#liqLongBar'),
  liqShortBar: $('#liqShortBar'),
  liqLongPct: $('#liqLongPct'),
  liqShortPct: $('#liqShortPct'),
  liqSources: $('#liqSources'),
  liqStatus: $('#liqStatus'),

  // BTC - HyperLiquid
  hlPrice: $('#hlPrice'),
  hlFundingRate: $('#hlFundingRate'),
  hlAnnualFunding: $('#hlAnnualFunding'),
  hlPredictedFunding: $('#hlPredictedFunding'),
  hlOpenInterest: $('#hlOpenInterest'),
  hlStatus: $('#hlStatus'),

  // BTC - Funding History
  fundingHistoryStatus: $('#fundingHistoryStatus'),
  fundingHistoryBody: $('#fundingHistoryBody'),
  fundingSparkline: $('#fundingSparkline'),
  fhCurrent: $('#fhCurrent'),
  fhHigh: $('#fhHigh'),
  fhLow: $('#fhLow'),
  fhAvg: $('#fhAvg'),
  fhSource: $('#fhSource'),

  // Toast
  toastContainer: $('#toastContainer'),
};

// ===== Utilities =====

function formatPrice(price) {
  if (price == null || price === '' || isNaN(price)) return '$--';
  if (price === 0) return '$0.00';
  if (price < 0.000001) return `$${price.toExponential(2)}`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  if (price < 1) return `$${price.toFixed(4)}`;
  if (price < 100) return `$${price.toFixed(2)}`;
  return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCompact(num) {
  if (num == null || isNaN(num)) return '$--';
  if (num === 0) return '$0';
  if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function formatChange(value) {
  if (value == null || isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function getChangeClass(value) {
  if (value == null || isNaN(value)) return 'neutral';
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

function formatTime(timestamp) {
  if (timestamp == null) return '--';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function shortAddress(addr) {
  if (!addr || addr.length < 10) return addr ?? '';
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function uniqueTokenFingerprint(addr) {
  if (!addr) return '----';
  let hash = 0;
  for (let i = 0; i < addr.length; i++) hash = ((hash << 5) - hash + addr.charCodeAt(i)) | 0;
  const checksum = Math.abs(hash).toString(36).slice(0, 4).padStart(4, '0');
  if (addr.length <= 12) return `${addr}#${checksum}`;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}#${checksum}`;
}

function getTokenDisplayName(token) {
  return token?.symbol || token?.name || 'Unknown';
}

function getTokenIcon(token) {
  if (token.icon) {
    return `<img src="${token.icon}" alt="${token.symbol}" onerror="this.style.display='none'" />`;
  }
  return token.symbol?.charAt(0)?.toUpperCase() || '?';
}

function getExplorerUrl(chain, address) {
  const explorers = {
    solana: `https://solscan.io/token/${address}`,
    ethereum: `https://etherscan.io/token/${address}`,
    base: `https://basescan.org/token/${address}`,
    bsc: `https://bscscan.com/token/${address}`,
    robinhood: `https://robinhoodchain.blockscout.com/token/${address}`,
  };
  return explorers[chain] || `https://solscan.io/token/${address}`;
}

function getGmgnUrl(chain, address) {
  const slugs = { solana: 'sol', base: 'base', bsc: 'bsc', ethereum: 'eth', robinhood: 'robinhood' };
  if (chain === 'robinhood') {
    // Prefer DexScreener until GMGN fully indexes Robinhood Chain
    return `https://dexscreener.com/robinhood/${address}`;
  }
  return `https://gmgn.ai/${slugs[chain] || 'sol'}/token/${address}`;
}

/**
 * Othercoin「查看」→ 统一 DexScreener 价格曲线（不用 CoinGecko，避免 inactive/deactivated 页）
 * - 有链上地址 → 直接进对应链 token/pair 页（含 K 线）
 * - CEX 信号仅有 symbol → search，落地后选池看曲线
 */
function getOthercoinDexScreenerUrl(token) {
  const existing = String(token?.url || '');
  if (existing.includes('dexscreener.com')) return existing;

  const chain = String(token?.chain || '').toLowerCase();
  const addr = String(token?.address || token?.pairAddress || '').trim();
  const symbol = String(token?.symbol || '').replace(/USDT$/i, '').trim();
  const looksLikeAddress =
    /^0x[a-fA-F0-9]{40}$/i.test(addr) ||
    (addr.length >= 32 && !/^[A-Z0-9]{2,20}$/.test(addr));

  const dexChain = {
    solana: 'solana',
    ethereum: 'ethereum',
    base: 'base',
    bsc: 'bsc',
    robinhood: 'robinhood',
  }[chain];

  if (dexChain && looksLikeAddress) {
    // pairAddress preferred when present (better chart page)
    const pathAddr = String(token?.pairAddress || addr).trim();
    return `https://dexscreener.com/${dexChain}/${pathAddr}`;
  }

  const q = symbol || token?.name || addr || '';
  return `https://dexscreener.com/search?q=${encodeURIComponent(q)}`;
}

function getChainDotClass(chain) {
  return { solana: 'sol', ethereum: 'eth', base: 'base', bsc: 'bsc', robinhood: 'robinhood', multi: 'multi' }[chain] || 'sol';
}

function getApiUrl(path) {
  // Always same-origin so local (127.0.0.1:8788) hits local API with Robinhood support.
  // Old logic forced local UI → tradermeme.pages.dev (stale production without robinhood).
  // Optional override: window.MEMECOIN_API_ORIGIN = 'https://tradermeme.pages.dev'
  const origin = (typeof window !== 'undefined' && window.MEMECOIN_API_ORIGIN) || '';
  return `${origin}${path}`;
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// ===== Toast =====
function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-message">${message}</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }
  }, 4000);
}

// ===== Status (signal-detect lights only: green=ok, yellow=loading/warn) =====
// No descriptive copy in the header — user wants lights only, not "N 币 · 链=… · 无聪明钱…"
function setStatus(type, _text) {
  dom.statusDot.className = 'status-dot';
  // green = default/success; yellow = loading or soft warn; never show long 说明 text
  if (type === 'loading' || type === 'error') {
    dom.statusDot.classList.add('loading'); // yellow
  }
  // keep status text node empty/hidden (lights-only module)
  if (dom.statusText) {
    dom.statusText.textContent = '';
    dom.statusText.setAttribute('aria-hidden', 'true');
  }
}

// ====================================================================================
// PAGE SWITCHING
// ====================================================================================

function switchPage(page) {
  if (page === state.currentPage) return;
  state.currentPage = page;

  // Update tabs
  dom.pageTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.page === page));

  // Show/hide page content
  Object.entries(dom.pageContents).forEach(([key, el]) => {
    if (el) el.classList.toggle('active', key === page);
  });

  // Update header
  const labels = {
    memecoin: 'Meme 代币监控 · 含 Robinhood 链',
    othercoin: '信号扫描 · CEX + Robinhood 链',
    bitcoin: 'BTC 市场数据 · Coinglass',
  };
  dom.logoSubtitle.textContent = labels[page] || labels.memecoin;

  // Chain tabs = Memecoin only (Othercoin is CEX multi-market, not per-chain)
  const chainNav = document.getElementById('chainTabs');
  if (chainNav) chainNav.style.display = page === 'memecoin' ? '' : 'none';

  // Load data for the page
  if (page === 'memecoin') {
    // Always reload for the active chain so boards never stick on Solana data
    loadMemecoinData(state.currentChain);
  } else if (page === 'othercoin') {
    loadOthercoinData();
  } else if (page === 'bitcoin') {
    if (state.btcData) renderBitcoinData();
    else loadBitcoinData();
  }
}

// ====================================================================================
// MEMECOIN PAGE
// ====================================================================================

function getTrackingKey(address, chain = '') {
  return `${(chain || '').toLowerCase()}:${(address || '').toLowerCase()}`;
}

function getTrackedRetentionMs(tracked, now = Date.now()) {
  const perf = getTrackedPerformance(tracked);
  const moonshot = perf.maxGain >= 500 || perf.currentChange >= 500 || tracked?.moonshot?.active;
  if (moonshot) {
    tracked.moonshot = {
      ...(tracked.moonshot || {}),
      active: true,
      firstMarkedAt: tracked.moonshot?.firstMarkedAt || now,
      maxGain: Math.max(Number(tracked.moonshot?.maxGain || 0), perf.maxGain || 0),
    };
    return state.moonshotRetentionMs;
  }
  return state.trackingRetentionMs;
}

function getTrackedLastPrice(tracked = {}) {
  const points = Array.isArray(tracked.priceHistory) ? tracked.priceHistory : [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = Number(points[i]?.price);
    if (Number.isFinite(p)) return p;
  }
  const current = Number(tracked.currentPrice ?? tracked.priceUsd ?? tracked.price ?? 0);
  return Number.isFinite(current) ? current : 0;
}

function hasRecentCapitalInflow(token = {}) {
  const txns24h = token.txns24h || {};
  const txns1h = token.txns1h || {};
  const buys = Number(txns24h.buys ?? txns1h.buys ?? token.buys ?? 0);
  const sells = Number(txns24h.sells ?? txns1h.sells ?? token.sells ?? 0);
  const smartNetInflow = Number(token.smartNetInflow5m ?? 0) + Number(token.smartNetInflow15m ?? 0);
  const shortVolume = Number(token.volume5m ?? 0) + Number(token.volume15m ?? 0);
  const buyVolume = Number(token.buyVolume5m ?? token.buy_volume_5m ?? 0) + Number(token.buyVolume15m ?? token.buy_volume_15m ?? 0);
  return smartNetInflow > 0 || buyVolume > 0 || (shortVolume > 0 && buys > sells) || (buys > 0 && sells === 0);
}

function shouldCleanupZeroNoInflow(tracked = {}, now = Date.now()) {
  const lastPrice = getTrackedLastPrice(tracked);
  if (!(Number.isFinite(lastPrice) && lastPrice <= Number.EPSILON)) return false;
  const lastInflowAt = Number(tracked.lastCapitalInflowAt || tracked.signalAt || 0);
  return lastInflowAt > 0 && now - lastInflowAt >= state.zeroNoInflowCleanupMs;
}

function pruneSignalTracking(now = Date.now()) {
  state.signals = state.signals.filter((s) => s.active && (now - s.timestamp <= state.signalExpiryMs));
  for (const [key, tracked] of Object.entries(state.trackedTokens)) {
    if (!tracked) {
      delete state.trackedTokens[key];
      continue;
    }
    if (shouldCleanupZeroNoInflow(tracked, now)) {
      delete state.trackedTokens[key];
      delete state.aiExpanded[key];
      continue;
    }
    const retentionMs = getTrackedRetentionMs(tracked, now);
    if (now - tracked.signalAt > retentionMs) {
      delete state.trackedTokens[key];
      continue;
    }
    tracked.historyStatus = now - tracked.signalAt <= state.signalExpiryMs ? 'active' : 'history';
    const historyLimit = tracked.moonshot?.active ? state.maxMoonshotPriceHistory : state.maxPriceHistory;
    tracked.priceHistory = (tracked.priceHistory || [])
      .filter((p) => p && (p.time === tracked.signalAt || now - p.time <= retentionMs))
      .slice(-historyLimit);
    if (!tracked.priceHistory.some((p) => p.time === tracked.signalAt && p.price === tracked.priceAtSignal)) {
      tracked.priceHistory.unshift({ time: tracked.signalAt, price: tracked.priceAtSignal, marker: 'buy' });
    }
  }
}

function saveSignalTracking() {
  try {
    pruneSignalTracking();
    const payload = {
      savedAt: Date.now(),
      signalIdCounter: state.signalIdCounter,
      signals: state.signals,
      trackedTokens: state.trackedTokens,
    };
    const prepared = window.TrackingStorage?.prepareTrackingStateForStorage
      ? window.TrackingStorage.prepareTrackingStateForStorage(payload, {
          now: Date.now(),
          maxBytes: state.maxTrackingStorageBytes,
          normalRetentionMs: state.trackingRetentionMs,
          moonshotRetentionMs: state.moonshotRetentionMs,
          normalMaxPoints: state.maxPriceHistory,
          moonshotMaxPoints: state.maxMoonshotPriceHistory,
        })
      : payload;
    localStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(prepared));
    if (prepared.trackedTokens && prepared.trackedTokens !== state.trackedTokens) {
      state.trackedTokens = prepared.trackedTokens;
      state.signals = prepared.signals || state.signals;
    }
  } catch (e) {
    console.warn('Failed to save signal tracking state:', e);
    try {
      const fallback = window.TrackingStorage?.prepareTrackingStateForStorage?.({
        savedAt: Date.now(),
        signalIdCounter: state.signalIdCounter,
        signals: state.signals.slice(0, 20),
        trackedTokens: state.trackedTokens,
      }, { now: Date.now(), maxBytes: 2_000_000, normalRetentionMs: state.trackingRetentionMs, moonshotRetentionMs: state.moonshotRetentionMs, normalMaxPoints: 240, moonshotMaxPoints: 240 });
      if (fallback) localStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(fallback));
    } catch (fallbackError) {
      console.warn('Failed to save compact signal tracking state:', fallbackError);
    }
  }
}

function loadSignalTracking() {
  try {
    const raw = localStorage.getItem(TRACKING_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.signalIdCounter = Math.max(state.signalIdCounter, parsed.signalIdCounter || 0);
    state.signals = Array.isArray(parsed.signals) ? parsed.signals : [];
    state.trackedTokens = parsed.trackedTokens && typeof parsed.trackedTokens === 'object' ? parsed.trackedTokens : {};
    pruneSignalTracking();
  } catch (e) {
    console.warn('Failed to load signal tracking state:', e);
    state.signals = [];
    state.trackedTokens = {};
  }
}

// --- Signal System ---

function detectSignals(tokens) {
  const newSignals = [];
  pruneSignalTracking();
  const engine = window.SignalEngine;
  for (const token of tokens) {
    const existingSignal = state.signals.find((s) => s.tokenAddress === token.address && s.tokenChain === (token.chain || state.currentChain) && s.active);
    // Active 5-minute carousel: skip duplicates while still active
    if (existingSignal) continue;

    // Phase A: layered gates via SignalEngine.shouldEmitAlert (no volume-only / risk veto)
    let decision;
    if (engine?.shouldEmitAlert) {
      decision = engine.shouldEmitAlert(token);
    } else {
      // Fallback if engine script missing: score only, no pure volume
      const scoreSnapshot = engine?.scoreTokenSignal?.(token);
      const ok = scoreSnapshot
        && scoreSnapshot.signalScore >= SIGNAL_THRESHOLDS.aiScore
        && scoreSnapshot.riskScore <= SIGNAL_THRESHOLDS.maxAiRisk
        && !scoreSnapshot.hardVeto;
      decision = ok
        ? { fire: true, reason: 'rules-score', text: `规则分 ${scoreSnapshot.signalScore}`, score: scoreSnapshot }
        : { fire: false, reason: 'no-engine', text: '', score: scoreSnapshot };
    }

    if (!decision.fire) continue;
    newSignals.push(createSignal(token, decision.reason, decision.text, decision.score));
  }
  for (const signal of newSignals) {
    state.signalIdCounter++;
    signal.id = state.signalIdCounter;
    state.signals.push(signal);
    startTrackingToken(signal);
    showToast(`🔔 信号: ${signal.tokenSymbol} - ${signal.reasonText}`, 'info');
  }
  if (newSignals.length > 0) {
    saveSignalTracking();
    renderMemecoinSignals();
  }
}

function createSignal(token, reason, reasonText, scoreSnapshot = null) {
  // Use the token's actual chain from the data, NOT state.currentChain
  const actualChain = token.chain || state.currentChain;
  const buyPercent = calculateBuyPercent(token);
  const signalScoreSnapshot = scoreSnapshot || window.SignalEngine?.scoreTokenSignal(token) || null;
  return {
    id: 0,
    tokenAddress: token.address,
    tokenSymbol: token.symbol || 'Unknown',
    tokenName: token.name || '',
    tokenIcon: token.icon || '',
    tokenChain: actualChain,
    reason,
    reasonText,
    priceAtSignal: (token.priceUsd ?? token.price ?? 0),
    timestamp: Date.now(),
    active: true,
    meta: {
      priceChange1h: token.priceChange1h,
      priceChange24h: token.priceChange24h,
      volume24h: token.volume24h,
      volume1h: token.volume1h,
      liquidity: token.liquidity,
      fdv: token.fdv,
      txns24h: token.txns24h,
      smartNetInflow5m: token.smartNetInflow5m,
      smartNetInflow15m: token.smartNetInflow15m,
      volume5m: token.volume5m,
      volume15m: token.volume15m,
      newWallets5m: token.newWallets5m,
      newWallets15m: token.newWallets15m,
      smartWallets5m: token.smartWallets5m,
      smartWallets15m: token.smartWallets15m,
      kolWallets5m: token.kolWallets5m,
      kolWallets15m: token.kolWallets15m,
      buyPercent,
      dataQuality: token.dataQuality,
      hasSmartMoneyData: token.hasSmartMoneyData,
      securityChecked: token.securityChecked,
      discoverySources: token.discoverySources,
      signalScoreSnapshot,
    },
  };
}

function calculateBuyPercent(token) {
  if (window.SignalEngine?.calculateBuyPercent) {
    const v = window.SignalEngine.calculateBuyPercent(token);
    return v == null ? 0 : v; // UI display: treat unknown as 0, not fake 50%
  }
  const buys = (token.txns1h?.buys != null ? token.txns1h.buys : (token.txns24h?.buys ?? 0));
  const sells = (token.txns1h?.sells != null ? token.txns1h.sells : (token.txns24h?.sells ?? 0));
  const total = buys + sells;
  if (total === 0) return 0;
  return (buys / total) * 100;
}

function getSmartSellSnapshot(token = {}, previous = {}) {
  const txns = token.txns1h || token.txns24h || {};
  const buys = Number(token.smartBuys ?? token.smart_buy_count ?? token.smartBuys1h ?? txns.buys ?? 0);
  const sells = Number(token.smartSells ?? token.smart_sell_count ?? token.smartSells1h ?? txns.sells ?? 0);
  const total = buys + sells;
  const sellPercent = total > 0 ? (sells / total) * 100 : Number(previous.sellPercent || 0);
  const smartCount = Number(token.smartCount ?? token.smart_degen_count ?? previous.smartCount ?? 0);
  const previousSmartCount = Number(previous.smartCount ?? smartCount);
  const smartCountDrop = previousSmartCount > 0 ? ((previousSmartCount - smartCount) / previousSmartCount) * 100 : 0;
  const majoritySelling = (total >= 6 && sellPercent >= 60) || (smartCountDrop >= 35 && sellPercent >= 50);
  return { buys, sells, total, sellPercent, smartCount, previousSmartCount, smartCountDrop, majoritySelling, updatedAt: Date.now() };
}

function getTokenActivitySnapshot(token = {}) {
  const price = Number(token.priceUsd ?? token.price ?? 0);
  const liquidity = Number(token.liquidity ?? token.liquidityUsd ?? token.liquidUSD ?? 0);
  const volume = Number(token.volume24h ?? token.volume1h ?? token.volume ?? 0);
  const txns24h = token.txns24h || {};
  const txns1h = token.txns1h || {};
  const buys = Number(txns24h.buys ?? txns1h.buys ?? token.buys ?? 0);
  const sells = Number(txns24h.sells ?? txns1h.sells ?? token.sells ?? 0);
  const totalTxns = Number(txns24h.total ?? txns1h.total ?? (buys + sells));
  return { price, liquidity, volume, buys, sells, totalTxns };
}

function getAbandonReasonForTracked(found, tracked, now = Date.now()) {
  if (!found) return '';
  const a = getTokenActivitySnapshot(found);
  if (hasRecentCapitalInflow(found)) tracked.lastCapitalInflowAt = now;
  const zeroPrice = !Number.isFinite(a.price) || a.price <= Number.EPSILON;
  const lastInflowAt = Number(tracked.lastCapitalInflowAt || tracked.signalAt || 0);
  if (zeroPrice && lastInflowAt > 0 && now - lastInflowAt >= state.zeroNoInflowCleanupMs) return '价格归零且4小时无资金流入';
  if (!zeroPrice && a.liquidity <= 0 && a.volume <= 0) return '流动性和成交额均为 0';
  if (!zeroPrice && a.volume <= 0 && a.totalTxns <= 0) return '无成交量且无买卖交易';
  return '';
}

function abandonTrackedTarget(key, tracked, reason) {
  delete state.trackedTokens[key];
  state.signals = state.signals.filter((s) => getTrackingKey(s.tokenAddress, s.tokenChain) !== key);
  delete state.aiExpanded[key];
  if (tracked?.symbol) showToast(`🧹 已放弃 ${tracked.symbol}: ${reason}`, 'warning');
}

function maybeRaiseMoonshotSelloffAlert(key, tracked, token, now = Date.now()) {
  if (!tracked?.moonshot?.active || tracked.moonshot.selloffAlertedAt) return false;
  const analysis = analyzeTrackedToken(tracked, false, now);
  const maxGain = Math.max(Number(tracked.moonshot.maxGain || 0), analysis.maxGain || 0);
  const dropFromPeak = maxGain > 0 ? maxGain - analysis.currentChange : 0;
  const droppedHard = maxGain >= 500 && (dropFromPeak >= 250 || analysis.currentChange <= maxGain * 0.45);
  const smartSell = tracked.smartSellSnapshot?.majoritySelling;
  if (!droppedHard || !smartSell) return false;

  tracked.moonshot.selloffAlertedAt = now;
  tracked.moonshot.selloffReason = `500%+项目从最高点回撤 ${dropFromPeak.toFixed(0)}% · 聪明钱卖出占比 ${tracked.smartSellSnapshot.sellPercent.toFixed(0)}%`;
  state.signalIdCounter++;
  state.signals.unshift({
    id: state.signalIdCounter,
    tokenAddress: tracked.address,
    tokenSymbol: tracked.symbol || 'Unknown',
    tokenName: tracked.name || '',
    tokenIcon: tracked.icon || '',
    tokenChain: tracked.chain || state.currentChain,
    reason: 'moonshot-selloff',
    reasonText: `高收益回撤提醒：${tracked.moonshot.selloffReason}`,
    priceAtSignal: tracked.currentPrice || tracked.priceAtSignal || 0,
    timestamp: now,
    active: true,
    alertOnly: true,
    meta: {
      trackedKey: key,
      alertType: 'moonshot-selloff',
      currentChange: analysis.currentChange,
      maxGain,
      dropFromPeak,
      smartSellSnapshot: tracked.smartSellSnapshot,
    },
  });
  showToast(`⚠️ ${tracked.symbol} 高收益回撤：聪明钱多数卖出`, 'warning');
  return true;
}

function startTrackingToken(signal) {
  const key = getTrackingKey(signal.tokenAddress, signal.tokenChain);
  if (state.trackedTokens[key]) return;
  state.trackedTokens[key] = {
    address: signal.tokenAddress,
    symbol: signal.tokenSymbol,
    name: signal.tokenName,
    icon: signal.tokenIcon,
    chain: signal.tokenChain,
    signalAt: signal.timestamp,
    signalReason: signal.reason,
    signalReasonText: signal.reasonText,
    priceAtSignal: signal.priceAtSignal,
    buyMarker: { time: signal.timestamp, price: signal.priceAtSignal, label: '信号买入点' },
    priceHistory: [{ time: signal.timestamp, price: signal.priceAtSignal, marker: 'buy' }],
    currentPrice: signal.priceAtSignal,
    lastCapitalInflowAt: signal.timestamp,
    signalMeta: signal.meta || {},
    signalScoreSnapshot: signal.meta?.signalScoreSnapshot || null,
    aiNotes: null,
    historyStatus: 'active',
  };
}

function getChainBadgeHtml(chain) {
  const chainBadges = {
    solana: '<span class="chain-badge sol" title="Solana">Sol</span>',
    ethereum: '<span class="chain-badge eth" title="Ethereum">ETH</span>',
    base: '<span class="chain-badge base" title="Base">Base</span>',
    bsc: '<span class="chain-badge bsc" title="BSC">BSC</span>',
    robinhood: '<span class="chain-badge robinhood" title="Robinhood Chain">RH</span>',
    multi: '<span class="chain-badge multi" title="CEX / 多市场">CEX</span>',
  };
  return chainBadges[chain] || '';
}

function renderMemecoinSignals() {
  const now = Date.now();
  pruneSignalTracking(now);
  
  // Filter signals by current chain if not viewing "all"
  const isAllChain = state.currentChain === 'all';
  const visibleSignals = isAllChain 
    ? state.signals 
    : state.signals.filter((s) => s.tokenChain === state.currentChain);
  
  dom.signalCount.textContent = visibleSignals.length;
  if (visibleSignals.length === 0) { dom.signalsList.innerHTML = ''; dom.signalsEmpty.style.display = 'flex'; return; }
  dom.signalsEmpty.style.display = 'none';
  const fragment = document.createDocumentFragment();
  const typeLabels = { 'ai-score': '🤖 GMGN AI', 'monitor-inflow': '📡 Monitor 共振', 'price-surge': '📈 价格飙升', 'volume-spike': '💎 交易量激增', 'buy-pressure': '🟢 买入压力', 'moonshot-selloff': '⚠️ 高收益回撤' };
  for (const signal of visibleSignals) {
    const card = document.createElement('div');
    card.className = `signal-card signal-${signal.reason}`;
    card.dataset.signalId = signal.id;
    const chainBadge = getChainBadgeHtml(signal.tokenChain);
    card.innerHTML = `
      <button class="signal-dismiss-btn" data-signal-id="${signal.id}" title="关闭信号">✕</button>
      <div class="signal-header">
        <span class="signal-type">${typeLabels[signal.reason] || '信号'}</span>
        ${chainBadge}
        <span class="signal-time">${formatDuration(now - signal.timestamp)}</span>
      </div>
      <div class="signal-body">
        <div class="signal-token-icon">${signal.tokenIcon ? `<img src="${signal.tokenIcon}" alt="" onerror="this.style.display='none'" />` : (signal.tokenSymbol?.charAt(0) || '?')}</div>
        <div class="signal-token-info"><span class="signal-token-symbol">${signal.tokenSymbol}</span><span class="signal-token-name">${signal.tokenName || shortAddress(signal.tokenAddress)}</span></div>
      </div>
      <div class="signal-message">${signal.reasonText}</div>`;
    fragment.appendChild(card);
  }
  dom.signalsList.innerHTML = '';
  dom.signalsList.appendChild(fragment);
  dom.signalsList.querySelectorAll('.signal-dismiss-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.currentTarget.dataset.signalId);
      const signal = state.signals.find((s) => s.id === id);
      if (signal) signal.active = false;
      saveSignalTracking();
      renderMemecoinSignals();
      renderMemecoinMonitoring();
    });
  });
}

// --- Data Fetching ---

async function fetchMemecoinApi(chain) {
  const response = await fetch(getApiUrl(`/api/trending?chain=${encodeURIComponent(chain)}&limit=${state.memecoinLimit}`), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API错误: ${response.status}`);
  }
  return response.json();
}

/** Drop junk rows so each chain board stays useful */
function filterMemecoinTokens(tokens, chain) {
  if (!Array.isArray(tokens)) return [];
  const chainKey = (chain || '').toLowerCase();
  return tokens.filter((t) => {
    // Strict chain isolation (except "all")
    if (chainKey && chainKey !== 'all') {
      const tc = String(t.chain || '').toLowerCase();
      if (tc && tc !== chainKey) return false;
    }
    // Skip fake CEX-only stubs on on-chain boards
    const addr = String(t.address || '');
    if (addr.startsWith('binance-') || addr.startsWith('binance:')) return false;
    // Robinhood: drop ticker spam
    const sym = String(t.symbol || '').toUpperCase();
    if (chainKey === 'robinhood' && ['ROBINHOOD', 'HOOD', 'RH', 'RHC'].includes(sym)) return false;
    const price = Number(t.priceUsd ?? t.price ?? 0);
    const vol = Number(t.volume24h || t.volume1h || 0);
    const liq = Number(t.liquidity || 0);
    if (!(price > 0)) return false;
    // Minimum activity — chain-specific floors (BSC = Binance DEX; RH kept active)
    if (chainKey === 'bsc') {
      if (vol < 2_000 && liq < 5_000) return false;
    } else if (chainKey === 'robinhood') {
      if (vol < 300 && liq < 1_500) return false;
    } else if (chainKey !== 'all') {
      if (vol < 500 && liq < 3_000) return false;
    }
    return true;
  });
}

async function loadMemecoinData(chain = state.currentChain, isRetry = false) {
  // Race-safe: each click gets a loadId; stale responses are ignored
  const loadId = isRetry ? state.memecoinLoadId : (++state.memecoinLoadId);
  const requestChain = chain || state.currentChain;

  state.isLoading = true;
  if (!isRetry) {
    state.error = null;
    // Clear previous chain's rows immediately so BSC never shows Solana/RH leftovers
    state.tokens = [];
    dom.errorState.style.display = 'none';
    dom.loadingState.style.display = 'flex';
    dom.tokenList.innerHTML = '';
    setStatus('loading');
  } else {
    setStatus('loading');
  }

  try {
    const data = await fetchMemecoinApi(requestChain);
    // Stale response (user already switched chain)
    if (loadId !== state.memecoinLoadId) return;
    if (!data.success || !Array.isArray(data.data)) throw new Error('API返回数据格式异常');

    const filtered = filterMemecoinTokens(data.data, requestChain);
    // Prefer API-reported chain; force-stamp for safety
    const stamped = filtered.map((t) => ({ ...t, chain: t.chain || requestChain }));

    state.tokens = stamped;
    state.currentChain = requestChain;
    state.dataQuality = data.quality || {};
    state.lastUpdated = data.timestamp || Date.now();
    state.retryCount = 0;

    detectSignals(stamped);
    updateTrackedPrices(stamped);
    renderMemecoinSortedTokens(stamped);
    updateMemecoinStats(stamped, data.timestamp);
    renderMemecoinMonitoring();

    setStatus(''); // green light only — no quality 说明
    dom.loadingState.style.display = 'none';
    if (stamped.length === 0) {
      dom.tokenList.innerHTML = `<div class="empty-state"><div class="empty-icon">📭</div><p>${requestChain} 暂无合格代币（已过滤低质/错链）</p></div>`;
    }
  } catch (err) {
    if (loadId !== state.memecoinLoadId) return;
    console.error('Memecoin load error:', err);
    state.error = err.message;
    if (state.retryCount < state.maxRetries && !isRetry) {
      state.retryCount++;
      setStatus('loading');
      setTimeout(() => loadMemecoinData(requestChain, true), 1500);
      return;
    }
    showToast(`数据加载失败: ${err.message}`, 'error');
    dom.loadingState.style.display = 'none';
    dom.tokenList.innerHTML = '';
    dom.errorState.style.display = 'flex';
    dom.errorMessage.textContent = err.message;
    setStatus('error');
  } finally {
    if (loadId === state.memecoinLoadId) {
      state.isLoading = false;
      dom.refreshBtn.classList.remove('spinning');
    }
  }
}

// --- Tracked Prices ---

function updateTrackedPrices(tokens) {
  const keys = Object.keys(state.trackedTokens);
  if (keys.length === 0) return;
  const now = Date.now();
  pruneSignalTracking(now);
  let abandoned = 0;
  for (const key of Object.keys(state.trackedTokens)) {
    const tracked = state.trackedTokens[key];
    const found = tokens.find((t) => getTrackingKey(t.address, t.chain || state.currentChain) === key);
    const abandonReason = getAbandonReasonForTracked(found, tracked, now);
    if (abandonReason) {
      abandonTrackedTarget(key, tracked, abandonReason);
      abandoned++;
      continue;
    }

    if (!found) {
      const lastKnown = tracked.currentPrice || tracked.priceAtSignal || 0;
      if (lastKnown > 0) tracked.priceHistory.push({ time: now, price: lastKnown, carried: true });
      tracked.historyStatus = now - tracked.signalAt <= state.signalExpiryMs ? 'active' : 'history';
      const retentionMs = getTrackedRetentionMs(tracked, now);
      const historyLimit = tracked.moonshot?.active ? state.maxMoonshotPriceHistory : state.maxPriceHistory;
      tracked.priceHistory = tracked.priceHistory
        .filter((p) => p && (p.time === tracked.signalAt || now - p.time <= retentionMs))
        .slice(-historyLimit);
      continue;
    }

    const price = found.priceUsd ?? found.price ?? 0;
    tracked.currentPrice = price;
    tracked.priceHistory.push({ time: now, price });
    tracked.smartSellSnapshot = getSmartSellSnapshot(found, tracked.smartSellSnapshot);
    getTrackedRetentionMs(tracked, now);
    maybeRaiseMoonshotSelloffAlert(key, tracked, found, now);

    tracked.historyStatus = now - tracked.signalAt <= state.signalExpiryMs ? 'active' : 'history';
    const retentionMs = getTrackedRetentionMs(tracked, now);
    const historyLimit = tracked.moonshot?.active ? state.maxMoonshotPriceHistory : state.maxPriceHistory;
    tracked.priceHistory = tracked.priceHistory
      .filter((p) => p && (p.time === tracked.signalAt || now - p.time <= retentionMs))
      .slice(-historyLimit);
  }
  if (abandoned > 0) {
    renderMemecoinSignals();
  }
  saveSignalTracking();
}

// --- Token Rendering ---

function renderMemecoinSortedTokens(tokens) {
  const sorted = [...tokens].sort((a, b) => {
    switch (state.sortBy) {
      case 'volume': { return (b.volume24h || b.volume1h || 0) - (a.volume24h || a.volume1h || 0); }
      case 'priceChange': { return Math.abs(b.priceChange1h || 0) - Math.abs(a.priceChange1h || 0); }
      case 'buyRatio': { return calculateBuyPercent(b) - calculateBuyPercent(a); }
      default: return 0;
    }
  });
  dom.hotCount.textContent = tokens.length;
  renderMemecoinTokenRows(sorted);
}

function renderMemecoinTokenRows(tokens) {
  if (!tokens || tokens.length === 0) {
    dom.tokenList.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>暂无代币数据</p></div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  tokens.forEach((token, index) => {
    const row = document.createElement('div');
    row.className = 'token-row';
    row.style.animationDelay = `${index * 0.03}s`;
    const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1;
    const iconHtml = getTokenIcon(token);
    // Use token's actual chain for URLs, NOT state.currentChain
    const tokenChain = token.chain || state.currentChain;
    const explorerUrl = getExplorerUrl(tokenChain, token.address);
    const gmgnUrl = getGmgnUrl(tokenChain, token.address);
    const buyPercent = calculateBuyPercent(token);
    const chainBadge = getChainBadgeHtml(tokenChain);
    const qualityBits = [];
    if (token.isHoneypot || token.isRug) qualityBits.push('<span class="chain-badge multi" title="高风险">⚠风险</span>');
    else if (token.securityChecked) qualityBits.push('<span class="chain-badge base" title="已抽检 security">SEC</span>');
    if (token.hasSmartMoneyData) qualityBits.push('<span class="chain-badge sol" title="含聪明钱富化">SM</span>');
    else qualityBits.push('<span class="chain-badge multi" title="无聪明钱富化">无SM</span>');
    if (token.fromTrenches) qualityBits.push('<span class="chain-badge bsc" title="Trenches 新盘">新</span>');
    if (token.fromHotSearch) qualityBits.push('<span class="chain-badge robinhood" title="Hot Search">热搜</span>');
    const qualityHtml = qualityBits.join('');
    row.innerHTML = `
      <div class="td ${index < 3 ? 'rank-cell top-3' : 'rank-cell'}">${rankEmoji}</div>
      <div class="td token-cell">
        <div class="token-icon">${iconHtml}</div>
        <div class="token-info">
          <span class="token-symbol" title="${token.name || ''}">${token.symbol || 'Unknown'}</span>
          <span class="token-name">${token.name || shortAddress(token.address)} ${qualityHtml}</span>
          <div class="token-links"><a href="${gmgnUrl}" target="_blank" rel="noopener" class="token-link">GMGN</a><button class="token-copy-btn" onclick="copyAddress('${token.address}', event)" title="复制合约地址">📋</button></div>
        </div>
        ${chainBadge}
      </div>
      <div class="td price-cell">${formatPrice(token.priceUsd ?? token.price)}</div>
      <div class="td"><span class="change-cell ${getChangeClass(token.priceChange1h)}">${formatChange(token.priceChange1h)}</span></div>
      <div class="td"><span class="change-cell ${getChangeClass(token.priceChange24h)}">${formatChange(token.priceChange24h)}</span></div>
      <div class="td volume-cell">${formatCompact(token.volume24h != null ? token.volume24h : token.volume1h)}</div>
      <div class="td liquidity-cell">${formatCompact(token.liquidity)}</div>
      <div class="td fdv-cell">${formatCompact(token.fdv)}</div>
      <div class="td txns-cell">${token.txns24h?.total != null ? formatTxns(token.txns24h.total) : '--'}</div>
      <div class="td trades-cell"><div class="buy-sell-bar"><div class="buys" style="width:${buyPercent}%"></div></div><span class="buy-sell-ratio">${buyPercent.toFixed(0)}%</span></div>
      <div class="td actions-cell"><a href="${gmgnUrl}" target="_blank" rel="noopener" class="action-btn primary">交易</a><a href="${explorerUrl}" target="_blank" rel="noopener" class="action-btn">详情</a></div>`;
    fragment.appendChild(row);
  });
  dom.tokenList.innerHTML = '';
  dom.tokenList.appendChild(fragment);
}

// ===== Clipboard Copy =====
function copyAddress(address, event) {
  if (event) {
    event.stopPropagation();
    const btn = event.currentTarget;
    if (btn.classList.contains('archive-address-copy')) {
      btn.classList.add('copied');
      const hint = btn.querySelector('.archive-copy-hint');
      if (hint) hint.textContent = '已复制';
      setTimeout(() => {
        btn.classList.remove('copied');
        if (hint) hint.textContent = '复制';
      }, 1500);
    } else {
      btn.textContent = '✅';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '📋';
        btn.classList.remove('copied');
      }, 1500);
    }
  }
  navigator.clipboard.writeText(address).then(() => {
    showToast('地址已复制: ' + shortAddress(address), 'success');
  }).catch(() => {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = address;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('地址已复制', 'success');
  });
}

function formatTxns(num) {
  if (num == null || isNaN(num)) return '--';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// --- Stats ---

function updateMemecoinStats(tokens, timestamp) {
  if (!dom.statsBar || !dom.statCount) return;
  dom.statCount.textContent = tokens.length;
  const totalVolume = tokens.reduce((sum, t) => sum + (t.volume24h != null ? t.volume24h : (t.volume1h ?? 0)), 0);
  dom.statVolume.textContent = formatCompact(totalVolume);
  const newest = tokens.reduce((latest, t) => {
    if (!latest) return t;
    return (t.createdAt || 0) > (latest.createdAt || 0) ? t : latest;
  }, null);
  dom.statNewest.textContent = newest?.symbol || '--';
  dom.statUpdated.textContent = formatTime(timestamp || Date.now());
}

// --- AI Decision Helpers ---

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getTrackedPerformance(tracked) {
  const base = Number(tracked.priceAtSignal || 0);
  const current = Number(tracked.currentPrice || 0);
  const points = (tracked.priceHistory || []).filter((p) => p && p.price != null && Number(p.price) > 0);
  const prices = points.map((p) => Number(p.price));
  if (base > 0) prices.push(base);
  if (current > 0) prices.push(current);
  const maxPrice = prices.length ? Math.max(...prices) : current;
  const minPrice = prices.length ? Math.min(...prices) : current;
  const currentChange = base > 0 ? ((current - base) / base) * 100 : 0;
  const maxGain = base > 0 ? ((maxPrice - base) / base) * 100 : 0;
  const maxDrawdown = base > 0 ? ((minPrice - base) / base) * 100 : 0;
  return { base, current, currentChange, maxGain, maxDrawdown, maxPrice, minPrice };
}

function analyzeTrackedToken(tracked, isActive, now = Date.now()) {
  const perf = getTrackedPerformance(tracked);
  const meta = tracked.signalMeta || {};
  const buyPercent = Number(meta.buyPercent || 50);
  const volume = Number(meta.volume24h ?? meta.volume1h ?? 0);
  const liquidity = Number(meta.liquidity || 0);
  const priceChange1h = Number(meta.priceChange1h || 0);
  const elapsed = now - tracked.signalAt;

  let phase = '可观察';
  if (perf.currentChange >= 80) phase = '高位加速';
  else if (perf.currentChange >= 30) phase = '突破加速';
  else if (perf.currentChange >= 8) phase = '趋势延续';
  else if (perf.currentChange <= -15) phase = '跌破买入点';
  else if (!isActive && elapsed > state.signalExpiryMs) phase = '历史观察';

  const riskFlags = [];
  let riskScore = 25;
  if (liquidity && liquidity < 10000) { riskScore += 28; riskFlags.push('流动性偏低'); }
  else if (liquidity && liquidity < 50000) { riskScore += 14; riskFlags.push('流动性一般'); }
  if (perf.maxDrawdown <= -40) { riskScore += 22; riskFlags.push('信号后回撤过大'); }
  if (priceChange1h >= 80 || perf.currentChange >= 120) { riskScore += 18; riskFlags.push('短线涨幅过高'); }
  if (buyPercent < 50) { riskScore += 15; riskFlags.push('买入占比不足'); }
  if (!volume || volume < 100000) { riskScore += 10; riskFlags.push('成交量不足'); }
  riskScore = clampScore(riskScore);
  const riskLevel = riskScore >= 78 ? '极高' : riskScore >= 58 ? '高' : riskScore >= 38 ? '中' : '低';

  let resonanceScore = 0;
  if ((tracked.signalReasonText || '').includes('买入占比')) resonanceScore += 35;
  if ((tracked.signalReasonText || '').includes('交易量')) resonanceScore += 30;
  if (buyPercent >= 75) resonanceScore += 20;
  if (volume >= 1000000) resonanceScore += 15;
  const resonanceLevel = resonanceScore >= 75 ? '强' : resonanceScore >= 50 ? '中' : resonanceScore >= 25 ? '弱' : '无';

  let action = '继续观察';
  if (riskLevel === '极高') action = '禁止交易';
  else if (perf.currentChange <= -15) action = '信号失效';
  else if (perf.currentChange >= 80) action = '等待回踩';
  else if (resonanceLevel === '强' && riskLevel !== '高') action = '重点观察';

  const trackedModel = window.SignalEngine?.analyzeTrackedSignal({ ...tracked, signalScoreSnapshot: tracked.signalScoreSnapshot || meta.signalScoreSnapshot }) || {};
  const signalSnapshot = tracked.signalScoreSnapshot || meta.signalScoreSnapshot || null;
  const modelRiskScore = signalSnapshot?.riskScore ?? riskScore;
  const modelRiskLevel = signalSnapshot?.riskLevel ?? riskLevel;
  const modelRiskFlags = signalSnapshot?.riskFlags?.length ? signalSnapshot.riskFlags : riskFlags;
  const modelAction = trackedModel.entryAction || signalSnapshot?.suggestedAction || action;
  const entryGrade = trackedModel.entryGrade || signalSnapshot?.entryGrade || 'C';
  const signalLevel = signalSnapshot?.signalLevel || '观察';
  const aiScore = signalSnapshot?.signalScore ?? clampScore(50 + Math.min(perf.currentChange, 80) * 0.25 + resonanceScore * 0.22 - riskScore * 0.25);
  const confidence = signalSnapshot?.confidence || (aiScore >= 75 ? '中高' : aiScore >= 55 ? '中' : '偏低');
  const historyStatus = trackedModel.resultLabel || (perf.currentChange <= -15 ? '跌破买入点' : perf.maxGain >= 80 && perf.currentChange < perf.maxGain * 0.45 ? '疑似出货' : perf.currentChange >= 20 ? '趋势延续' : '高位观察');
  const summary = `${tracked.symbol} 触发 ${tracked.signalReasonText || '交易信号'}。GMGN AI ${signalLevel} ${aiScore}/100，买点评级 ${entryGrade}，当前相对买入标注点 ${formatChange(perf.currentChange)}，风险等级${modelRiskLevel}。`;
  const suggestion = modelAction === '禁止交易' ? '风险过高，仅保留观察，不建议进入策略订单。' : modelAction === '禁止追高' || modelAction === '等待回踩' ? '短线涨幅较高，不建议直接追高，等待回踩或二次放量确认。' : modelAction === '重点观察' ? '信号质量较好，可加入重点观察，策略订单仍需二次确认。' : '继续观察价格是否守住买入标注点。';
  return { ...perf, ...trackedModel, phase, riskScore: modelRiskScore, riskLevel: modelRiskLevel, riskFlags: modelRiskFlags, resonanceScore, resonanceLevel, action: modelAction, entryAction: modelAction, entryGrade, signalLevel, aiScore, confidence, historyStatus, summary, suggestion, modelReasons: signalSnapshot?.reasons || [] };
}

function getLevelClass(level) {
  if (['低', '强', '重点观察', '趋势延续', '中高', '重点报警', '强报警', 'A', 'B', '高收益验证', '超级收益', '有效信号'].includes(level)) return 'good';
  if (['中', '弱', '等待回踩', '高位观察', '历史观察', '普通报警', '观察', 'C', '小仓试探', '继续观察', '观察中'].includes(level)) return 'warn';
  if (['高', '极高', '禁止交易', '禁止追高', '跌破买入点', '信号失效', '疑似出货', '高收益回撤', 'D', '失败/跌破'].includes(level)) return 'danger';
  return 'neutral';
}

function renderAiDetailPanel(tracked, analysis, key, isOpen) {
  if (!isOpen) return '';
  const canTradePreview = !['禁止交易', '禁止追高', '信号失效'].includes(analysis.action) && analysis.entryGrade !== 'D';
  const riskFlags = analysis.riskFlags.length ? analysis.riskFlags.join(' / ') : '未发现明显硬风险（仍需接入 GMGN security 完整校验）';
  return `
    <div class="ai-detail-panel">
      <div class="ai-detail-grid">
        <div class="ai-mini-card ai-wide">
          <div class="ai-mini-title">AI 信号解释</div>
          <div class="ai-mini-main">${analysis.signalLevel} · 强度 ${analysis.aiScore}/100 · 置信度 ${analysis.confidence}</div>
          <p>${analysis.summary}</p>
          <p>${analysis.modelReasons.length ? analysis.modelReasons.join(' / ') : '等待更多 GMGN 数据进入评分模型。'}</p>
          <p class="ai-suggestion">${analysis.suggestion}</p>
        </div>
        <div class="ai-mini-card">
          <div class="ai-mini-title">Token 安全检查</div>
          <div class="ai-mini-main ${getLevelClass(analysis.riskLevel)}">风险 ${analysis.riskLevel} · ${100 - analysis.riskScore}/100</div>
          <p>${riskFlags}</p>
        </div>
        <div class="ai-mini-card">
          <div class="ai-mini-title">Smart Money 共振</div>
          <div class="ai-mini-main ${getLevelClass(analysis.resonanceLevel)}">${analysis.resonanceLevel}共振</div>
          <p>当前 MVP 用买压、放量、信号组合估算；下一步接入 GMGN smartmoney/KOL 实时钱包。</p>
        </div>
        <div class="ai-mini-card">
          <div class="ai-mini-title">买入点评估</div>
          <div class="ai-mini-main ${getLevelClass(analysis.entryGrade)}">${analysis.entryGrade} · ${analysis.entryAction}</div>
          <p>报警不等于买入。买点会结合风险、动量、回撤和 24h 追踪结果单独评估。</p>
        </div>
        <div class="ai-mini-card">
          <div class="ai-mini-title">钱包画像</div>
          <div class="ai-mini-main neutral">点击钱包后展开</div>
          <p>后续接入 wallet stats：胜率、PnL、平均持仓、交易风格评级。</p>
        </div>
        <div class="ai-mini-card ai-wide">
          <div class="ai-mini-title">AI 历史追踪总结</div>
          <div class="ai-mini-main ${getLevelClass(analysis.historyStatus)}">${analysis.historyStatus}</div>
          <p>信号后最高 ${formatChange(analysis.maxGain)}，最大回撤 ${formatChange(analysis.maxDrawdown)}，当前 ${formatChange(analysis.currentChange)}。${tracked.moonshot?.active ? '该项目已进入 500%+ 特色观察池，买入标注点和状态保留 1 个月。' : '买入标注点将持续保留 24 小时。'}</p>
          ${tracked.moonshot?.selloffReason ? `<p class="ai-suggestion danger">提醒原因：${tracked.moonshot.selloffReason}</p>` : ''}
        </div>
      </div>
      <div class="strategy-preview-box ${canTradePreview ? '' : 'blocked'}">
        <div>
          <strong>策略订单预览</strong>
          <span>${canTradePreview ? '限价买入 + 止盈/止损，仅生成预览，不自动下单' : '风险过高，交易入口已拦截'}</span>
        </div>
        <button class="monitor-action-btn primary strategy-preview-btn" data-tracked-key="${key}" ${canTradePreview ? '' : 'disabled'}>策略预览</button>
      </div>
    </div>`;
}

function showStrategyPreview(tracked, analysis) {
  if (['禁止交易', '禁止追高', '信号失效'].includes(analysis.action) || analysis.entryGrade === 'D') {
    showToast(`买点评级 ${analysis.entryGrade}：${analysis.action}，当前仅允许观察，不生成策略订单`, 'error');
    return;
  }
  const entry = analysis.current > 0 ? analysis.current * 0.9 : 0;
  const text = `策略预览：${tracked.symbol} · 限价买入 ${formatPrice(entry)} · 标准模板：+100%卖50%，+300%卖剩余，-50%止损。当前仅为预览，不执行真实交易。`;
  showToast(text, 'info');
}

// --- Monitoring ---

function renderMemecoinMonitoring() {
  pruneSignalTracking();
  const keys = Object.keys(state.trackedTokens);
  const activeAddresses = new Set(state.signals.filter((s) => s.active).map((s) => getTrackingKey(s.tokenAddress, s.tokenChain)));
  const now = Date.now();
  const remainingKeys = Object.keys(state.trackedTokens);
  dom.trackedCount.textContent = remainingKeys.length;
  if (remainingKeys.length === 0) { dom.monitorCards.innerHTML = ''; dom.monitorEmpty.style.display = 'flex'; return; }
  dom.monitorEmpty.style.display = 'none';
  const fragment = document.createDocumentFragment();
  let cardIndex = 0;
  const maxVisibleTrackingCards = 8;
  const sortedTrackingKeys = remainingKeys.sort((a, b) => {
    const aTime = state.trackedTokens[a]?.signalAt || 0;
    const bTime = state.trackedTokens[b]?.signalAt || 0;
    return bTime - aTime;
  });
  const visibleKeys = sortedTrackingKeys.slice(0, maxVisibleTrackingCards);
  const archivedKeys = sortedTrackingKeys.slice(maxVisibleTrackingCards);
  const badgeLabels = { 'ai-score': 'AI', 'price-surge': '飙升', 'volume-spike': '放量', 'buy-pressure': '买压' };
  for (const key of visibleKeys) {
    const tracked = state.trackedTokens[key];
    const elapsed = now - tracked.signalAt;
    const isActive = activeAddresses.has(key);
    const analysis = analyzeTrackedToken(tracked, isActive, now);
    const priceChange = analysis.currentChange;
    const statusLabel = isActive ? '🟢 5分钟信号中' : '📜 历史追踪';
    const statusClass = isActive ? 'active' : 'history';
    const isExpanded = !!state.aiExpanded[key];
    const card = document.createElement('div');
    card.className = `monitor-card ${tracked.moonshot?.active ? 'moonshot-card' : ''} ${tracked.moonshot?.selloffAlertedAt ? 'moonshot-alert-card' : ''}`.trim();
    card.style.animationDelay = `${cardIndex * 0.05}s`;
    cardIndex++;
    const dotClass = getChainDotClass(tracked.chain);
    const explorerUrl = getExplorerUrl(tracked.chain, tracked.address);
    const gmgnUrl = getGmgnUrl(tracked.chain, tracked.address);
    card.innerHTML = `
      <div class="monitor-card-top">
        <div class="monitor-token-group">
          <div class="monitor-token-icon">${tracked.icon ? `<img src="${tracked.icon}" alt="" onerror="this.style.display='none'" />` : (tracked.symbol?.charAt(0) || '?')}</div>
          <span class="monitor-token-symbol">${tracked.symbol}</span>
          <span class="monitor-chain-dot ${dotClass}"></span>
        </div>
        <span class="monitor-signal-badge ${tracked.signalReason}">${badgeLabels[tracked.signalReason] || '信号'}</span>
        <span class="monitor-status-badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="ai-chip-row">
        ${tracked.moonshot?.active ? `<span class="ai-chip moonshot">🚀 500%+ · 保留1个月</span>` : ''}
        ${tracked.moonshot?.selloffAlertedAt ? `<span class="ai-chip danger">⚠️ ${tracked.moonshot.selloffReason || '高收益回撤'}</span>` : ''}
        <span class="ai-chip ${getLevelClass(analysis.signalLevel)}">AI：${analysis.signalLevel} ${analysis.aiScore}/100</span>
        <span class="ai-chip ${getLevelClass(analysis.riskLevel)}">风险：${analysis.riskLevel}</span>
        <span class="ai-chip ${getLevelClass(analysis.resonanceLevel)}">共振：${analysis.resonanceLevel}</span>
        <span class="ai-chip ${getLevelClass(analysis.entryGrade)}">买点：${analysis.entryGrade} · ${analysis.entryAction}</span>
      </div>
      <div class="monitor-chart-area"><canvas data-tracked-key="${key}"></canvas></div>
      <div class="monitor-stats">
        <div class="monitor-stat"><span class="monitor-stat-label">买入标注点</span><span class="monitor-stat-value" style="font-size:11px;color:var(--accent-green)">${formatPrice(tracked.priceAtSignal)}</span></div>
        <div class="monitor-stat"><span class="monitor-stat-label">当前价格</span><span class="monitor-stat-value" style="font-size:11px">${formatPrice(tracked.currentPrice)}</span></div>
        <div class="monitor-stat"><span class="monitor-stat-label">变化</span><span class="monitor-stat-value ${getChangeClass(priceChange)}">${formatChange(priceChange)}</span></div>
        <div class="monitor-stat" style="margin-left:auto"><span class="monitor-stat-label">已追踪</span><span class="monitor-stat-value" style="font-size:11px;color:var(--text-muted)">${formatDuration(elapsed)}</span></div>
      </div>
      <div class="monitor-actions">
        <button class="monitor-action-btn primary ai-detail-toggle" data-tracked-key="${key}">${isExpanded ? '收起' : '详情'}</button>
        <button class="monitor-action-btn strategy-preview-btn" data-tracked-key="${key}">策略预览</button>
        <a href="${gmgnUrl}" target="_blank" rel="noopener" class="monitor-action-btn">GMGN</a>
        <a href="${explorerUrl}" target="_blank" rel="noopener" class="monitor-action-btn">链上</a>
      </div>
      ${renderAiDetailPanel(tracked, analysis, key, isExpanded)}`;
    fragment.appendChild(card);
  }
  const nameCounts = sortedTrackingKeys.reduce((acc, key) => {
    const tracked = state.trackedTokens[key];
    const name = getTokenDisplayName(tracked).toLowerCase();
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});
  const archiveCard = document.createElement('div');
  archiveCard.className = 'monitor-archive-card';
  const archivedRows = archivedKeys.map((key) => {
    const tracked = state.trackedTokens[key];
    const analysis = analyzeTrackedToken(tracked, false, now);
    const displayName = getTokenDisplayName(tracked);
    const isDuplicateName = nameCounts[displayName.toLowerCase()] > 1;
    const fingerprint = uniqueTokenFingerprint(tracked.address || '');
    const moonshot = !!tracked.moonshot?.active || analysis.maxGain >= 500 || analysis.currentChange >= 500;
    const alertReason = tracked.moonshot?.selloffReason || '';
    return `
      <div class="archive-token-row ${moonshot ? 'moonshot-row' : ''} ${alertReason ? 'moonshot-alert-row' : ''}" title="${tracked.address || ''}">
        <span class="archive-token-id">
          <strong>${moonshot ? '🚀 ' : ''}${displayName}</strong>
          <button class="archive-address-copy" type="button" data-copy-address="${tracked.address || ''}" title="左键点击复制完整合约地址">
            ${isDuplicateName ? '同名·' : ''}${fingerprint}${moonshot ? ' · 500%+保留1月' : ''}
            <span class="archive-copy-hint">复制</span>
          </button>
          ${alertReason ? `<small>提醒原因：${alertReason}</small>` : ''}
        </span>
        <span class="archive-return ${moonshot ? 'moonshot' : getChangeClass(analysis.currentChange)}">买入点→当前 PNL ${formatChange(analysis.currentChange)}</span>
      </div>`;
  }).join('');
  const emptyArchive = '<div class="archive-empty-row">当前只追踪了最新 8 个以内，暂无额外历史记录</div>';
  archiveCard.innerHTML = `
    <button class="archive-toggle" type="button">
      <span>📦 已追踪历史记录</span>
      <strong>${archivedKeys.length}</strong>
      <em>${state.archiveExpanded ? '收起' : '点击查看'}</em>
    </button>
    ${state.archiveExpanded ? `<div class="archive-token-list simple-history-list">${archivedRows || emptyArchive}</div>` : ''}`;
  fragment.appendChild(archiveCard);
  dom.monitorCards.innerHTML = '';
  dom.monitorCards.appendChild(fragment);
  dom.monitorCards.querySelectorAll('.archive-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.archiveExpanded = !state.archiveExpanded;
      renderMemecoinMonitoring();
    });
  });
  dom.monitorCards.querySelectorAll('.archive-address-copy').forEach((btn) => {
    btn.addEventListener('click', (e) => copyAddress(e.currentTarget.dataset.copyAddress, e));
  });
  dom.monitorCards.querySelectorAll('.ai-detail-toggle').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const key = e.currentTarget.dataset.trackedKey;
      state.aiExpanded[key] = !state.aiExpanded[key];
      renderMemecoinMonitoring();
    });
  });
  dom.monitorCards.querySelectorAll('.strategy-preview-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const key = e.currentTarget.dataset.trackedKey;
      const tracked = state.trackedTokens[key];
      if (!tracked) return;
      const isActive = state.signals.some((s) => s.active && getTrackingKey(s.tokenAddress, s.tokenChain) === key);
      showStrategyPreview(tracked, analyzeTrackedToken(tracked, isActive));
    });
  });
  requestAnimationFrame(() => {
    dom.monitorCards.querySelectorAll('canvas[data-tracked-key]').forEach((canvas) => {
      const key = canvas.dataset.trackedKey;
      const tracked = state.trackedTokens[key];
      if (tracked) drawSparkline(canvas, tracked.priceHistory, tracked);
    });
  });
}

// ===== Sparkline =====

function drawSparkline(canvas, priceHistory, tracked = null) {
  if (!canvas || !priceHistory || priceHistory.length === 0) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 280;
  const height = rect.height || 48;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const validPricePoints = priceHistory.filter((p) => p.price != null);
  if (validPricePoints.length === 0) return;
  const buyPoint = tracked?.buyMarker || { time: tracked?.signalAt, price: tracked?.priceAtSignal, label: '信号买入点' };
  const allPrices = validPricePoints.map((p) => p.price);
  if (buyPoint.price != null) allPrices.push(buyPoint.price);
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const hasPriceRange = max !== min;
  const range = hasPriceRange ? (max - min) : 1;
  const padding = { top: 8, bottom: 8, left: 8, right: 8 };
  const chartWidth = Math.max(20, width - padding.left - padding.right);
  const chartHeight = Math.max(20, height - padding.top - padding.bottom);
  // Use index-based spacing for the sparkline, matching the original complete curve behavior.
  // Time-based spacing creates large empty gaps and compressed fragments when points are sparse.
  const xFor = (_time, index = 0, total = validPricePoints.length) => {
    const denom = Math.max(1, total - 1);
    return padding.left + (index / denom) * chartWidth;
  };
  const yFor = (price) => hasPriceRange ? padding.top + (1 - (price - min) / range) * chartHeight : padding.top + chartHeight / 2;
  const isUp = validPricePoints[validPricePoints.length - 1].price >= (tracked?.priceAtSignal ?? validPricePoints[0].price);
  const lineColor = isUp ? '#22c55e' : '#ef4444';
  const fillColor = isUp ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
  const glowColor = isUp ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';

  // Persistent buy marker: horizontal benchmark line at signal-trigger buy price.
  if (buyPoint.price != null) {
    const buyY = yFor(buyPoint.price);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(34,197,94,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, buyY);
    ctx.lineTo(width - padding.right, buyY);
    ctx.stroke();
    ctx.setLineDash([]);
    const buyX = padding.left;
    ctx.beginPath();
    ctx.arc(buyX, buyY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(11,14,20,0.95)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(34,197,94,0.9)';
    ctx.font = '9px sans-serif';
    ctx.fillText('买入', Math.min(buyX + 5, width - 28), Math.max(buyY - 4, 9));
    ctx.restore();
  }

  // Draw one continuous curve over every valid point. Null / missing ticks are ignored,
  // not treated as line breaks, so older tracked tokens keep a complete price curve.
  let segPoints = validPricePoints.map((p, i) => ({ x: xFor(p.time, i, validPricePoints.length), y: yFor(p.price) }));
  if (segPoints.length === 1) {
    // Draw a full-width flat line for one-point/fresh history instead of a lone dot.
    segPoints = [
      { x: padding.left, y: segPoints[0].y },
      { x: width - padding.right, y: segPoints[0].y },
    ];
  }
  ctx.beginPath(); ctx.moveTo(segPoints[0].x, segPoints[0].y);
  for (let i = 1; i < segPoints.length; i++) ctx.lineTo(segPoints[i].x, segPoints[i].y);
  ctx.strokeStyle = glowColor; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(segPoints[0].x, segPoints[0].y);
  for (let i = 1; i < segPoints.length; i++) ctx.lineTo(segPoints[i].x, segPoints[i].y);
  ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(segPoints[0].x, height - padding.bottom);
  for (const p of segPoints) ctx.lineTo(p.x, p.y);
  ctx.lineTo(segPoints[segPoints.length - 1].x, height - padding.bottom); ctx.closePath();
  ctx.fillStyle = fillColor; ctx.fill();
  ctx.beginPath(); ctx.arc(segPoints[segPoints.length - 1].x, segPoints[segPoints.length - 1].y, 3, 0, Math.PI * 2); ctx.fillStyle = lineColor; ctx.fill();
}

// ====================================================================================
// OTHERCOIN PAGE — Signal-Based Scanner
// ====================================================================================

async function fetchOthercoinApi() {
  // Othercoin = CEX multi-market signals only (not per-chain memecoin boards)
  const response = await fetch(getApiUrl('/api/othercoin?chain=multi'), {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API错误: ${response.status}`);
  }
  return response.json();
}

async function loadOthercoinData() {
  if (state.otherLoading) return;
  state.otherLoading = true;
  state.otherError = null;
  dom.otherErrorState.style.display = 'none';
  dom.otherLoadingState.style.display = 'flex';
  dom.otherTokenList.innerHTML = '';
  setStatus('loading');
  try {
    const data = await fetchOthercoinApi();
    if (!data.success || !Array.isArray(data.data)) throw new Error('API返回数据格式异常');
    state.otherTokens = data.data;
    renderOthercoinSortedTokens(data.data);
    updateOthercoinStats(data.data, data.timestamp);
    setStatus('');
    dom.otherLoadingState.style.display = 'none';
  } catch (err) {
    console.error('Othercoin load error:', err);
    state.otherError = err.message;
    showToast(`信号扫描失败: ${err.message}`, 'error');
    dom.otherLoadingState.style.display = 'none';
    dom.otherTokenList.innerHTML = '';
    dom.otherErrorState.style.display = 'flex';
    dom.otherErrorMessage.textContent = err.message;
    setStatus('error');
  } finally {
    state.otherLoading = false;
  }
}

function renderOthercoinSortedTokens(tokens) {
  const sorted = [...tokens].sort((a, b) => {
    switch (state.otherSortBy) {
      case 'signalScore': return (b.signalScore ?? b.score ?? 0) - (a.signalScore ?? a.score ?? 0);
      case 'volume': return (b.volume24h || 0) - (a.volume24h || 0);
      case 'priceChange': return Math.abs(b.priceChange24h || 0) - Math.abs(a.priceChange24h || 0);
      default: return 0;
    }
  });
  dom.otherCount.textContent = tokens.length;
  renderOthercoinTokenRows(sorted);
}

const SIGNAL_BADGE_LABELS = {
  funding: '资金费率',
  price: '价格异动',
  volume: '交易量',
  oi: '持仓量',
};

function renderOthercoinTokenRows(tokens) {
  if (!tokens || tokens.length === 0) {
    dom.otherTokenList.innerHTML = '<div class="empty-state"><div class="empty-icon">🔍</div><p>暂无信号数据</p></div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  tokens.forEach((token, index) => {
    const row = document.createElement('div');
    row.className = 'token-row othercoin-token-row';
    row.style.animationDelay = `${index * 0.03}s`;
    const rankEmoji = index < 3 ? ['🥇', '🥈', '🥉'][index] : index + 1;
    const iconHtml = getTokenIcon(token);
    const chainBadge = getChainBadgeHtml(token.chain || 'multi');
    const dexChartUrl = getOthercoinDexScreenerUrl(token);

    // Build signal badges
    let badgesHtml = '';
    const signals = token.signals || [];
    if (signals.length > 0) {
      badgesHtml = '<div class="signal-badge-row">';
      const badgeType = signals.length >= 3 ? 'multi' : '';
      if (signals.length >= 3) {
        badgesHtml += `<span class="signal-badge multi">+${signals.length} 信号</span>`;
      } else {
        for (const sig of signals.slice(0, 2)) {
          badgesHtml += `<span class="signal-badge ${sig.type}">${SIGNAL_BADGE_LABELS[sig.type] || sig.type}</span>`;
        }
      }
      badgesHtml += '</div>';
    }

    // Signal detail text
    let detailText = '';
    if (signals.length > 0) {
      detailText = signals[0].detail || signals[0].label || '';
    }

    // Signal score bar
    const score = token.signalScore ?? token.score ?? 0;
    const scoreBarWidth = Math.min(score, 100);
    const scoreClass = score >= 60 ? 'high' : score >= 30 ? 'med' : 'low';

    row.innerHTML = `
      <div class="td ${index < 3 ? 'rank-cell top-3' : 'rank-cell'}">${rankEmoji}</div>
      <div class="td token-cell">
        <div class="token-icon">${iconHtml}</div>
        <div class="token-info">
          <span class="token-symbol" title="${token.name || ''}">${token.symbol || 'Unknown'}${chainBadge}</span>
          <span class="token-name">${token.name || ''}</span>
        </div>
      </div>
      <div class="td price-cell">${formatPrice(token.priceUsd ?? token.price)}</div>
      <div class="td"><span class="change-cell ${getChangeClass(token.priceChange24h)}">${formatChange(token.priceChange24h)}</span></div>
      <div class="td volume-cell">${formatCompact(token.volume24h || 0)}</div>
      <div class="td signal-col">
        <div class="signal-score-cell">
          <div class="signal-score-bar"><div class="signal-score-fill ${scoreClass}" style="width:${scoreBarWidth}%"></div></div>
          <span class="signal-score-label">${Math.round(score)}</span>
        </div>
        ${badgesHtml}
      </div>
      <div class="td signal-detail"><span class="signal-detail-text" title="${detailText}">${detailText || '--'}</span></div>
      <div class="td actions-cell">
        <a href="${dexChartUrl}" target="_blank" rel="noopener" class="action-btn primary" title="DexScreener 价格曲线">查看</a>
      </div>`;
    fragment.appendChild(row);
  });
  dom.otherTokenList.innerHTML = '';
  dom.otherTokenList.appendChild(fragment);
}

function updateOthercoinStats(tokens, timestamp) {
  if (!dom.statsBarOther) return;
  if (dom.statCountOther) dom.statCountOther.textContent = tokens.length;
  const totalVolume = tokens.reduce((sum, t) => sum + (t.volume24h || 0), 0);
  if (dom.statVolOther) dom.statVolOther.textContent = formatCompact(totalVolume);
  const totalScore = tokens.reduce((sum, t) => sum + (t.signalScore ?? t.score ?? 0), 0);
  const avgScore = tokens.length > 0 ? (totalScore / tokens.length).toFixed(1) : '--';
  if (dom.statCapOther) dom.statCapOther.textContent = avgScore;
  if (dom.statUpdatedOther) dom.statUpdatedOther.textContent = formatTime(timestamp || Date.now());
}

// ====================================================================================
// BITCOIN PAGE
// ====================================================================================

async function fetchBitcoinApi(source = 'auto') {
  const path = source && source !== 'auto' ? `/api/bitcoin?source=${source}` : '/api/bitcoin';
  const response = await fetch(getApiUrl(path), { headers: { 'Accept': 'application/json' } });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `API错误: ${response.status}`); }
  return response.json();
}

async function loadBitcoinData() {
  state.btcLoading = true;
  state.btcError = null;
  dom.btcHeroLoading.style.display = 'flex';
  dom.btcHeroContent.style.display = 'none';
  setStatus('loading');
  updateSourceStatus('loading', '连接中...');
  try {
    const result = await fetchBitcoinApi(state.btcPreferredSource);
    if (!result.success || !result.data) throw new Error('BTC API返回数据异常');
    state.btcData = result.data;
    // Track source info
    const sourceInfo = result.source || { active: 'auto', label: '自动', autoFallback: false };
    // Add to price history for sparkline
    const price = result.data.price?.index || result.data.price?.spot || 0;
    if (price > 0) {
      state.btcPriceHistory.push({ time: Date.now(), price });
      if (state.btcPriceHistory.length > 50) state.btcPriceHistory = state.btcPriceHistory.slice(-50);
    }
    renderBitcoinData();
    setStatus('');
    dom.btcHeroLoading.style.display = 'none';
    dom.btcHeroContent.style.display = 'block';
    state.btcSourceRetryCount = 0;
    // Update source status
    updateSourceStatus(sourceInfo, result.sourceHealth);
  } catch (err) {
    console.error('BTC load error:', err);
    state.btcError = err.message;
    state.btcSourceRetryCount++;
    // Attempt auto-fallback: if we have a specific source selected, try auto mode
    if (state.btcPreferredSource !== 'auto' && state.btcSourceRetryCount <= state.btcSourceMaxRetries) {
      const sourceName = state.btcPreferredSource.charAt(0).toUpperCase() + state.btcPreferredSource.slice(1);
      showToast(`${sourceName} 无响应，自动回退到其他数据源...`, 'warning');
      state.btcPreferredSource = 'auto';
      // Update UI to show auto mode
      dom.btcSourceBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.source === 'auto');
      });
      setTimeout(() => loadBitcoinData(), 1000);
      return;
    }
    showToast(`BTC数据加载失败: ${err.message}`, 'error');
    dom.btcHeroLoading.innerHTML = `<div class="error-icon">⚠️</div><p style="color:var(--accent-red)">BTC 数据加载失败</p><button class="retry-btn" onclick="loadBitcoinData()" style="margin-top:12px">重试</button>`;
    updateSourceStatus('error', '所有数据源不可用');
    setStatus('error');
  } finally {
    state.btcLoading = false;
  }
}

function updateSourceStatus(status, detail) {
  if (!dom.sourceStatusDot || !dom.sourceStatusText) return;
  if (typeof status === 'object') {
    // status is sourceInfo from API
    const si = status;
    const health = detail || {};
    const label = si.label || '未知';
    const isAuto = si.active === 'auto';
    const hadFallback = si.autoFallback;
    dom.sourceStatusDot.className = 'source-status-dot healthy';
    if (hadFallback) {
      dom.sourceStatusText.innerHTML = `<span class="fallback">⚠ 已回退</span> · <span class="source-name">${label}</span>`;
    } else if (isAuto) {
      dom.sourceStatusText.innerHTML = `🤖 自动 · <span class="source-name">${label}</span>`;
    } else {
      dom.sourceStatusText.textContent = `✓ ${label}`;
    }
    // Check if any sources are unhealthy
    let unhealthyCount = 0;
    if (health && typeof health === 'object') {
      for (const [key, h] of Object.entries(health)) {
        if (h && !h.healthy) unhealthyCount++;
      }
    }
    if (unhealthyCount > 1) {
      dom.sourceStatusDot.className = 'source-status-dot warning';
    }
    return;
  }
  // Simple string mode
  dom.sourceStatusDot.className = 'source-status-dot';
  if (status === 'loading') {
    dom.sourceStatusDot.classList.add('warning');
    dom.sourceStatusText.innerHTML = `<span class="fallback">⟳ ${detail || '请求中'}</span>`;
  } else if (status === 'error') {
    dom.sourceStatusDot.classList.add('error');
    dom.sourceStatusText.textContent = `✗ ${detail || '错误'}`;
  } else {
    dom.sourceStatusDot.classList.add('healthy');
    dom.sourceStatusText.textContent = detail || '正常';
  }
}

function renderBitcoinData() {
  if (!state.btcData) return;
  const d = state.btcData;

  // Sync source buttons with actual active source from API
  if (d.source && d.source.active) {
    dom.btcSourceBtns.forEach((btn) => {
      const isActive = btn.dataset.source === d.source.active;
      btn.classList.toggle('active', isActive);
    });
  }

  // Price hero
  const price = d.price?.index || d.price?.spot || 0;
  const change = d.changes?.priceChange24h || 0;
  if (dom.btcPrice) dom.btcPrice.textContent = `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (dom.btc24hChange) {
    dom.btc24hChange.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)}% · 24h`;
    dom.btc24hChange.className = `btc-hero-change ${getChangeClass(change)}`;
  }
  if (dom.btcHigh24h) dom.btcHigh24h.textContent = `$${(d.price?.high24h || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (dom.btcLow24h) dom.btcLow24h.textContent = `$${(d.price?.low24h || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (dom.btcVolume24h) dom.btcVolume24h.textContent = formatCompact(d.changes?.volume24h || 0);
  if (dom.btcUpdated) dom.btcUpdated.textContent = formatTime(Date.now());

  // Sparkline
  if (dom.btcSparkline && state.btcPriceHistory.length >= 2) {
    drawSparkline(dom.btcSparkline, state.btcPriceHistory);
  }

  // Futures card
  const fundingRate = d.futures?.fundingRate || 0;
  const annualRate = d.futures?.annualFundingRate || 0;
  if (dom.btcFundingRate) {
    const frText = fundingRate !== 0 ? `${(fundingRate * 100).toFixed(4)}%` : '--';
    dom.btcFundingRate.textContent = frText;
    dom.btcFundingRate.className = `btc-metric-value ${getChangeClass(fundingRate)}`;
  }
  if (dom.btcAnnualFunding) {
    const afText = annualRate !== 0 ? `${annualRate.toFixed(2)}%` : '--';
    dom.btcAnnualFunding.textContent = afText;
    dom.btcAnnualFunding.className = `btc-metric-value ${getChangeClass(annualRate)}`;
  }
  const oi = d.futures?.openInterestUsd || d.futures?.openInterest || 0;
  const isOiUsd = d.futures?.openInterestUsd > 0;
  if (dom.btcOpenInterest) dom.btcOpenInterest.textContent = isOiUsd ? formatCompact(oi) : `${(oi || 0).toLocaleString()} BTC`;
  if (dom.btcMarkPrice) dom.btcMarkPrice.textContent = d.price?.mark ? `$${d.price.mark.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '$--';
  if (dom.btcNextFundingTime) {
    if (d.futures?.nextFundingTime) {
      const remaining = d.futures.nextFundingTime - Date.now();
      dom.btcNextFundingTime.textContent = remaining > 0 ? formatDuration(remaining) : '即将';
    } else {
      dom.btcNextFundingTime.textContent = '--';
    }
  }

  // Sentiment card
  if (dom.btcDominance) dom.btcDominance.textContent = `${(d.sentiment?.btcDominance || 0).toFixed(1)}%`;
  if (dom.btcTotalMarketCap) dom.btcTotalMarketCap.textContent = formatCompact(d.sentiment?.totalMarketCap || 0);
  if (dom.btcTotalVolume) dom.btcTotalVolume.textContent = formatCompact(d.sentiment?.totalVolume24h || 0);
  if (dom.btcMarketCapChange) {
    const mcChange = d.sentiment?.marketCapChange24h || 0;
    dom.btcMarketCapChange.textContent = formatChange(mcChange);
    dom.btcMarketCapChange.className = `btc-metric-value ${getChangeClass(mcChange)}`;
  }

  // Sources
  const sources = d.sources || [];
  if (dom.btcSources) dom.btcSources.textContent = sources.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' · ');

  // ---- Long/Short Ratio ----
  renderLongShortRatio(d.longShortRatio);

  // ---- Liquidations ----
  renderLiquidations(d.liquidations);

  // ---- HyperLiquid ----
  renderHyperLiquid(d.hyperLiquid);

  // ---- Historical Funding Rate ----
  renderFundingHistory(d.fundingHistory);
}

// ===== Long/Short Ratio Rendering =====
function renderLongShortRatio(lsr) {
  if (!dom.lsGrid || !dom.lsStatus) return;
  if (!lsr || !lsr.summary || !lsr.summary.available) {
    dom.lsStatus.textContent = '⏸ 数据不可用';
    dom.lsStatus.style.background = 'rgba(255,193,7,0.1)';
    dom.lsStatus.style.color = '#fbbf24';
    dom.lsGrid.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><p>多空比数据不可用</p></div>';
    return;
  }

  dom.lsStatus.textContent = '✅ 已连接';
  dom.lsStatus.style.background = 'rgba(34,197,94,0.1)';
  dom.lsStatus.style.color = '#22c55e';    // Clear grid
    dom.lsGrid.innerHTML = '';

  // Render each source
  const sources = lsr.sources || {};
  for (const [key, src] of Object.entries(sources)) {
    if (!src || !src.ratio) continue;

    const card = document.createElement('div');
    card.className = 'ls-source-card';

    const ratio = src.ratio;
    const longPct = parseFloat(src.longPct) || 0;
    const shortPct = parseFloat(src.shortPct) || 0;
    const totalPct = longPct + shortPct;
    const longWidth = totalPct > 0 ? (longPct / totalPct * 100) : 50;
    const shortWidth = totalPct > 0 ? (shortPct / totalPct * 100) : 50;

    const signalClass = ratio > 1.2 ? 'bullish' : ratio < 0.8 ? 'bearish' : 'neutral';
    const signalText = ratio > 1.2 ? '偏多' : ratio < 0.8 ? '偏空' : '中性';

    const sourceLabel = { binance: 'Binance 全网账户', bybit: 'Bybit 账户' }[key] || key;

    card.innerHTML = `
      <div class="ls-source-header">
        <span class="ls-source-name">${sourceLabel}</span>
        <span class="ls-ratio-value">${ratio.toFixed(3)}</span>
      </div>
      <div class="ls-bar-container">
        <div class="ls-bar-label">多 ${longPct.toFixed(1)}%</div>
        <div class="ls-bar-track">
          <div class="ls-bar-fill long" style="width:${longWidth}%"></div>
          <div class="ls-bar-fill short" style="width:${shortWidth}%"></div>
        </div>
        <div class="ls-bar-label right">空 ${shortPct.toFixed(1)}%</div>
      </div>
      <span class="ls-signal-tag ${signalClass}">${signalText}</span>`;
    dom.lsGrid.appendChild(card);
  }

  // Summary signal
  if (dom.lsSignal) {
    const signalText = lsr.summary.signal || '中性';
    dom.lsSignal.textContent = signalText;
    dom.lsSignal.className = 'ls-summary-value';
    const signalClass = signalText.includes('偏多') ? 'bullish' : signalText.includes('偏空') ? 'bearish' : 'neutral';
    dom.lsSignal.classList.add(signalClass);
  }
}

// ===== Liquidations Rendering =====
function renderLiquidations(liq) {
  if (!dom.liqTotalUsd || !dom.liqStatus) return;
  if (!liq || !liq.summary || !liq.summary.available) {
    dom.liqStatus.textContent = '⏸ 数据加载中';
    dom.liqStatus.style.background = 'rgba(255,193,7,0.1)';
    dom.liqStatus.style.color = '#fbbf24';
    return;
  }

  dom.liqStatus.textContent = '✅ 已连接';
  dom.liqStatus.style.background = 'rgba(34,197,94,0.1)';
  dom.liqStatus.style.color = '#22c55e';

  const s = liq.summary;
  dom.liqTotalUsd.textContent = formatCompact(s.totalUsd || 0);
  dom.liqCount.textContent = (s.count || 0).toString();
  dom.liqSignal.textContent = s.side || '均衡';

  const longPct = parseFloat(s.longPct) || 0;
  const shortPct = parseFloat(s.shortPct) || 0;
  dom.liqLongBar.style.width = Math.max(longPct, 5) + '%';
  dom.liqShortBar.style.width = Math.max(shortPct, 5) + '%';
  dom.liqLongPct.textContent = longPct.toFixed(1) + '%';
  dom.liqShortPct.textContent = shortPct.toFixed(1) + '%';

  // Sources info
  if (dom.liqSources) {
    const sourceKeys = Object.keys(liq.sources || {});
    if (sourceKeys.length > 0) {
      dom.liqSources.textContent = '来源: ' + sourceKeys.map(k => k === 'binance' ? 'Binance' : 'Bybit').join(' · ');
    }
  }
}

// ===== HyperLiquid Rendering =====
function renderHyperLiquid(hl) {
  if (!dom.hlPrice || !dom.hlStatus) return;
  if (!hl || !hl.price) {
    dom.hlStatus.textContent = '⏸ 未连接';
    dom.hlStatus.style.background = 'rgba(255,193,7,0.1)';
    dom.hlStatus.style.color = '#fbbf24';
    return;
  }

  dom.hlStatus.textContent = '✅ 已连接';
  dom.hlStatus.style.background = 'rgba(34,197,94,0.1)';
  dom.hlStatus.style.color = '#22c55e';

  dom.hlPrice.textContent = hl.price ? `$${hl.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$--';

  const fr = hl.fundingRate || 0;
  dom.hlFundingRate.textContent = fr !== 0 ? `${(fr * 100).toFixed(4)}%` : '--';
  dom.hlFundingRate.className = `btc-metric-value ${getChangeClass(fr)}`;

  const af = hl.annualFundingRate || (fr * 3 * 365 * 100);
  dom.hlAnnualFunding.textContent = af !== 0 ? `${af.toFixed(2)}%` : '--';
  dom.hlAnnualFunding.className = `btc-metric-value ${getChangeClass(af)}`;

  const pf = hl.predictedFundingRate || 0;
  dom.hlPredictedFunding.textContent = pf !== 0 ? `${(pf * 100).toFixed(4)}%` : '--';
  dom.hlPredictedFunding.className = `btc-metric-value ${getChangeClass(pf)}`;

  const oi = hl.openInterestUsd || (hl.openInterest * (hl.price || 1)) || 0;
  dom.hlOpenInterest.textContent = oi > 0 ? formatCompact(oi) : '--';
}

// ===== Historical Funding Rate Rendering =====
function renderFundingHistory(fh) {
  if (!dom.fundingHistoryStatus) return;

  if (!fh || fh.current === undefined || !fh.history) {
    dom.fundingHistoryStatus.textContent = '⏸ 数据不可用';
    dom.fundingHistoryStatus.style.background = 'rgba(255,193,7,0.1)';
    dom.fundingHistoryStatus.style.color = '#fbbf24';
    return;
  }

  dom.fundingHistoryStatus.textContent = '✅ 已连接';
  dom.fundingHistoryStatus.style.background = 'rgba(34,197,94,0.1)';
  dom.fundingHistoryStatus.style.color = '#22c55e';

  // Current funding rate
  const currentFr = fh.current != null ? fh.current : 0;
  if (dom.fhCurrent) {
    dom.fhCurrent.textContent = currentFr !== 0 ? `${(currentFr * 100).toFixed(4)}%` : '0.0000%';
    dom.fhCurrent.className = `btc-metric-value ${getChangeClass(currentFr)}`;
  }

  // Stats
  const stats = fh.stats || {};
  if (dom.fhHigh) dom.fhHigh.textContent = `${(stats.high24h * 100).toFixed(4)}%`;
  if (dom.fhLow) dom.fhLow.textContent = `${(stats.low24h * 100).toFixed(4)}%`;
  if (dom.fhAvg) dom.fhAvg.textContent = `${(stats.avg24h * 100).toFixed(4)}%`;
  if (dom.fhSource) dom.fhSource.textContent = `Binance Futures · ${stats.count || 0} 条记录`;

  // Draw funding history sparkline
  const history = fh.history || [];
  if (dom.fundingSparkline && history.length >= 2) {
    drawFundingSparkline(dom.fundingSparkline, history);
  }
}

function drawFundingSparkline(canvas, history) {
  if (!canvas || !history || history.length < 2) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 600;
  const height = rect.height || 64;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const rates = history.map(h => h.rate).filter(r => r != null);
  if (rates.length < 2) return;

  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const range = max - min || 0.0001;
  const padding = { top: 8, bottom: 8, left: 8, right: 8 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Find zero line Y
  const zeroY = padding.top + (1 - (0 - min) / range) * chartHeight;

  // Draw zero line
  ctx.beginPath();
  ctx.moveTo(padding.left, zeroY);
  ctx.lineTo(width - padding.right, zeroY);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Build points
  const points = history.map((h, i) => ({
    x: padding.left + (i / (history.length - 1)) * chartWidth,
    y: padding.top + (1 - (h.rate - min) / range) * chartHeight,
    rate: h.rate,
  }));

  // Draw area fill (green above zero, red below)
  ctx.beginPath();
  ctx.moveTo(points[0].x, zeroY);
  for (let i = 0; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.lineTo(points[points.length - 1].x, zeroY);
  ctx.closePath();

  // Create gradient based on position relative to zero
  const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
  gradient.addColorStop(0, 'rgba(34, 197, 94, 0.15)');
  gradient.addColorStop(0.45, 'rgba(34, 197, 94, 0.05)');
  gradient.addColorStop(0.55, 'rgba(239, 68, 68, 0.05)');
  gradient.addColorStop(1, 'rgba(239, 68, 68, 0.15)');
  ctx.fillStyle = gradient;
  ctx.fill();

  // Draw the line (green for positive rates, red for negative)
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  // Color the line based on latest rate direction
  const latestRate = rates[rates.length - 1];
  const lineColor = latestRate >= 0 ? '#22c55e' : '#ef4444';

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // Glow effect
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.strokeStyle = lineColor + '33'; // 20% opacity
  ctx.lineWidth = 5;
  ctx.stroke();

  // Draw start/end dots
  const startColor = rates[0] >= 0 ? '#22c55e' : '#ef4444';
  ctx.beginPath();
  ctx.arc(points[0].x, points[0].y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = startColor;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(points[points.length - 1].x, points[points.length - 1].y, 3, 0, Math.PI * 2);
  ctx.fillStyle = lineColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(points[points.length - 1].x, points[points.length - 1].y, 6, 0, Math.PI * 2);
  ctx.fillStyle = lineColor + '33';
  ctx.fill();
}

// ====================================================================================
// CHAIN SWITCHING
// ====================================================================================

function switchChain(chain) {
  // Chain tabs only control Memecoin boards
  if (state.currentPage !== 'memecoin') return;
  if (chain === state.currentChain && state.tokens.length > 0 && !state.isLoading) return;
  state.currentChain = chain;
  dom.chainTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.chain === chain));
  // Always force a new load (loadId invalidates in-flight previous chain)
  loadMemecoinData(chain);
}

// ====================================================================================
// AUTO REFRESH
// ====================================================================================

function startAutoRefresh() {
  stopAutoRefresh();
  state.autoRefreshInterval = setInterval(() => {
    const shouldSkip = window.TrackingStorage?.shouldSkipAutoRefresh
      ? window.TrackingStorage.shouldSkipAutoRefresh({ hidden: document.hidden, autoRefreshEnabled: dom.autoRefreshToggle.checked })
      : (document.hidden || !dom.autoRefreshToggle.checked);
    if (shouldSkip) return;
    if (state.currentPage === 'memecoin' && !state.isLoading) {
      loadMemecoinData(state.currentChain);
    } else if (state.currentPage === 'othercoin' && !state.otherLoading) {
      loadOthercoinData();
    } else if (state.currentPage === 'bitcoin' && !state.btcLoading) {
      loadBitcoinData();
    }
  }, state.autoRefreshDelay);
}

function stopAutoRefresh() {
  if (state.autoRefreshInterval) { clearInterval(state.autoRefreshInterval); state.autoRefreshInterval = null; }
}

// ====================================================================================
// EVENT LISTENERS
// ====================================================================================

// Page tabs
dom.pageTabs.forEach((tab) => {
  tab.addEventListener('click', () => switchPage(tab.dataset.page));
});

// Chain tabs
dom.chainTabs.forEach((tab) => {
  tab.addEventListener('click', () => switchChain(tab.dataset.chain));
});

// Refresh
dom.refreshBtn.addEventListener('click', () => {
  dom.refreshBtn.classList.add('spinning');
  if (state.currentPage === 'memecoin') loadMemecoinData(state.currentChain);
  else if (state.currentPage === 'othercoin') loadOthercoinData();
  else if (state.currentPage === 'bitcoin') loadBitcoinData();
  showToast('正在刷新...', 'info');
});

// Auto-refresh toggle
dom.autoRefreshToggle.addEventListener('change', () => {
  if (dom.autoRefreshToggle.checked) { startAutoRefresh(); showToast('自动刷新已开启', 'success'); }
  else { stopAutoRefresh(); showToast('自动刷新已关闭', 'info'); }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && dom.autoRefreshToggle.checked) {
    if (state.currentPage === 'memecoin' && !state.isLoading) loadMemecoinData(state.currentChain);
    else if (state.currentPage === 'othercoin' && !state.otherLoading) loadOthercoinData();
    else if (state.currentPage === 'bitcoin' && !state.btcLoading) loadBitcoinData();
  }
});

// Memecoin retry
dom.retryBtn.addEventListener('click', () => {
  dom.errorState.style.display = 'none';
  loadMemecoinData(state.currentChain);
});

// Detect API build — Robinhood is a permanent memecoin module; never hide the tab.
// Only warn if the backend is stale so users know to use local same-origin API.
(async function detectApiBuild() {
  try {
    const host = location.host || '';
    const res = await fetch(getApiUrl('/api/chains'), { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    const ids = (data.data || data.chains || []).map((c) => c.id || c).filter(Boolean);
    const badge = document.getElementById('buildBadge');
    if (badge) {
      badge.textContent = `API host: ${host || 'local'} · chains: ${ids.join(', ') || 'unknown'}`;
    }
    // Always show Robinhood tab (user requirement: do not cancel RH monitoring)
    document.querySelectorAll('.chain-tab[data-chain="robinhood"]').forEach((el) => {
      el.style.display = '';
    });
    if (ids.length && !ids.includes('robinhood')) {
      showToast(
        '当前 API 未声明 robinhood（可能是旧版部署）。本地请用 http://127.0.0.1:8788 + npm run dev；Robinhood 标签已保留。',
        'error'
      );
    }
  } catch (e) {
    console.warn('detectApiBuild failed', e);
  }
})();

// Memecoin sort
dom.sortBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    dom.sortBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.sortBy = btn.dataset.sort;
    if (state.tokens.length > 0) renderMemecoinSortedTokens(state.tokens);
  });
});

// Othercoin sort
dom.otherSortBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    dom.otherSortBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.otherSortBy = btn.dataset.sort;
    if (state.otherTokens.length > 0) renderOthercoinSortedTokens(state.otherTokens);
  });
});

// Othercoin retry
dom.otherRetryBtn.addEventListener('click', () => {
  dom.otherErrorState.style.display = 'none';
  loadOthercoinData();
});

// Clear signals
dom.clearSignalsBtn.addEventListener('click', () => {
  state.signals.forEach((s) => (s.active = false));
  saveSignalTracking();
  renderMemecoinSignals();
  renderMemecoinMonitoring();
  showToast('所有信号已清除', 'info');
});

// BTC Source Selector
dom.btcSourceBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const source = btn.dataset.source;
    if (source === state.btcPreferredSource) return;
    // Update button states
    dom.btcSourceBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    // Update state
    state.btcPreferredSource = source;
    state.btcSourceRetryCount = 0;
    // Reload with new source
    showToast(`切换到 ${btn.querySelector('.source-btn-label')?.textContent || source} 数据源`, 'info');
    loadBitcoinData();
  });
});

// ====================================================================================
// INITIALIZE
// ====================================================================================

function init() {
  setStatus('loading');
  loadSignalTracking();
  renderMemecoinSignals();
  renderMemecoinMonitoring();
  loadMemecoinData('solana');
  startAutoRefresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

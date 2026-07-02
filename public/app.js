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
  isLoading: false,
  error: null,
  lastUpdated: null,
  autoRefreshInterval: null,
  autoRefreshDelay: 30000,
  retryCount: 0,
  maxRetries: 3,
  sortBy: 'volume',
  signalIdCounter: 0,
  signalExpiryMs: 300000, // 5 min
  maxPriceHistory: 30,
  memecoinLimit: 10,

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

// ===== Signal Thresholds =====
const SIGNAL_THRESHOLDS = {
  priceSurge: 15,
  volumeSpike: 500000,
  buyPressure: 75,
};

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

function getTokenIcon(token) {
  if (token.icon) {
    return `<img src="${token.icon}" alt="${token.symbol}" onerror="this.style.display='none'" />`;
  }
  return token.symbol?.charAt(0)?.toUpperCase() || '?';
}

function getExplorerUrl(chain, address) {
  const explorers = { solana: `https://solscan.io/token/${address}`, ethereum: `https://etherscan.io/token/${address}`, base: `https://basescan.org/token/${address}`, bsc: `https://bscscan.com/token/${address}` };
  return explorers[chain] || `https://solscan.io/token/${address}`;
}

function getGmgnUrl(chain, address) {
  const slugs = { solana: 'sol', base: 'base', bsc: 'bsc', ethereum: 'eth' };
  return `https://gmgn.ai/${slugs[chain] || 'sol'}/token/${address}`;
}

function getChainDotClass(chain) {
  return { solana: 'sol', ethereum: 'eth', base: 'base', bsc: 'bsc' }[chain] || 'sol';
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

// ===== Status =====
function setStatus(type, text) {
  dom.statusDot.className = 'status-dot';
  if (type) dom.statusDot.classList.add(type);
  dom.statusText.textContent = text;
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
  const labels = { memecoin: 'Meme 代币监控 · 信号预警', othercoin: 'Coinglass 信号扫描 · 动态收录', bitcoin: 'BTC 市场数据 · Coinglass' };
  dom.logoSubtitle.textContent = labels[page] || labels.memecoin;

  // Load data for the page
  if (page === 'memecoin') {
    if (state.tokens.length === 0) loadMemecoinData();
    else { renderMemecoinSignals(); renderMemecoinTokens(); renderMemecoinMonitoring(); }
  } else if (page === 'othercoin') {
    if (state.otherTokens.length === 0) loadOthercoinData();
    else renderOthercoinTokens();
  } else if (page === 'bitcoin') {
    if (state.btcData) renderBitcoinData();
    else loadBitcoinData();
  }
}

// ====================================================================================
// MEMECOIN PAGE
// ====================================================================================

// --- Signal System ---

function detectSignals(tokens) {
  const newSignals = [];
  for (const token of tokens) {
    const existingSignal = state.signals.find((s) => s.tokenAddress === token.address && s.active);
    if (existingSignal) continue;
    if (token.priceChange1h != null && token.priceChange1h > SIGNAL_THRESHOLDS.priceSurge) {
      newSignals.push(createSignal(token, 'price-surge', `价格 1h 暴涨 ${formatChange(token.priceChange1h)}`));
    }
    const volume = token.volume24h || token.volume1h || 0;
    if (volume > SIGNAL_THRESHOLDS.volumeSpike) {
      newSignals.push(createSignal(token, 'volume-spike', `24h 交易量 ${formatCompact(volume)}`));
    }
    const buyPercent = calculateBuyPercent(token);
    if (buyPercent > SIGNAL_THRESHOLDS.buyPressure) {
      newSignals.push(createSignal(token, 'buy-pressure', `买入占比 ${buyPercent.toFixed(0)}%`));
    }
  }
  for (const signal of newSignals) {
    state.signalIdCounter++;
    signal.id = state.signalIdCounter;
    state.signals.push(signal);
    startTrackingToken(signal);
    showToast(`🔔 信号: ${signal.tokenSymbol} - ${signal.reasonText}`, 'info');
  }
  if (newSignals.length > 0) renderMemecoinSignals();
}

function createSignal(token, reason, reasonText) {
  // Use the token's actual chain from the data, NOT state.currentChain
  const actualChain = token.chain || state.currentChain;
  return { id: 0, tokenAddress: token.address, tokenSymbol: token.symbol || 'Unknown', tokenName: token.name || '', tokenIcon: token.icon || '', tokenChain: actualChain, reason, reasonText, priceAtSignal: token.priceUsd || 0, timestamp: Date.now(), active: true };
}

function calculateBuyPercent(token) {
  const buys = (token.txns24h?.buys != null ? token.txns24h.buys : (token.txns1h?.buys ?? 0));
  const sells = (token.txns24h?.sells != null ? token.txns24h.sells : (token.txns1h?.sells ?? 0));
  const total = buys + sells;
  if (total === 0) return 50;
  return (buys / total) * 100;
}

function startTrackingToken(signal) {
  const key = signal.tokenAddress;
  if (state.trackedTokens[key]) return;
  state.trackedTokens[key] = { address: signal.tokenAddress, symbol: signal.tokenSymbol, name: signal.tokenName, icon: signal.tokenIcon, chain: signal.tokenChain, signalAt: signal.timestamp, signalReason: signal.reason, signalReasonText: signal.reasonText, priceAtSignal: signal.priceAtSignal, priceHistory: [{ time: signal.timestamp, price: signal.priceAtSignal }], currentPrice: signal.priceAtSignal };
}

function getChainBadgeHtml(chain) {
  const chainBadges = {
    solana: '<span class="chain-badge sol" title="Solana">Sol</span>',
    base: '<span class="chain-badge base" title="Base">Base</span>',
    bsc: '<span class="chain-badge bsc" title="BSC">BSC</span>',
  };
  return chainBadges[chain] || '';
}

function renderMemecoinSignals() {
  const now = Date.now();
  state.signals = state.signals.filter((s) => s.active && (now - s.timestamp <= state.signalExpiryMs));
  
  // Filter signals by current chain if not viewing "all"
  const isAllChain = state.currentChain === 'all';
  const visibleSignals = isAllChain 
    ? state.signals 
    : state.signals.filter((s) => s.tokenChain === state.currentChain);
  
  dom.signalCount.textContent = visibleSignals.length;
  if (visibleSignals.length === 0) { dom.signalsList.innerHTML = ''; dom.signalsEmpty.style.display = 'flex'; return; }
  dom.signalsEmpty.style.display = 'none';
  const fragment = document.createDocumentFragment();
  const typeLabels = { 'price-surge': '📈 价格飙升', 'volume-spike': '💎 交易量激增', 'buy-pressure': '🟢 买入压力' };
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
      renderMemecoinSignals();
      renderMemecoinMonitoring();
    });
  });
}

// --- Data Fetching ---

async function fetchMemecoinApi(chain) {
  const response = await fetch(`/api/trending?chain=${chain}&limit=${state.memecoinLimit}`, { headers: { 'Accept': 'application/json' } });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `API错误: ${response.status}`); }
  return response.json();
}

async function loadMemecoinData(chain = state.currentChain, isRetry = false) {
  if (state.isLoading) return;
  state.isLoading = true;
  if (!isRetry) {
    state.error = null;
    dom.errorState.style.display = 'none';
    dom.loadingState.style.display = 'flex';
    dom.tokenList.innerHTML = '';
  }
  setStatus('loading', '加载中...');
  try {
    const data = await fetchMemecoinApi(chain);
    if (!data.success || !Array.isArray(data.data)) throw new Error('API返回数据格式异常');
    state.tokens = data.data;
    state.lastUpdated = data.timestamp || Date.now();
    state.retryCount = 0;
    detectSignals(data.data);
    updateTrackedPrices(data.data);
    renderMemecoinSortedTokens(data.data);
    updateMemecoinStats(data.data, data.timestamp);
    renderMemecoinMonitoring();
    setStatus('', `${data.data.length} 个代币 · ${formatTime(data.timestamp)}`);
    dom.loadingState.style.display = 'none';
  } catch (err) {
    console.error('Memecoin load error:', err);
    state.error = err.message;
    if (state.retryCount < state.maxRetries && !isRetry) {
      state.retryCount++;
      setStatus('loading', `重试中 (${state.retryCount}/${state.maxRetries})...`);
      setTimeout(() => loadMemecoinData(chain, true), 2000);
      return;
    }
    showToast(`数据加载失败: ${err.message}`, 'error');
    dom.loadingState.style.display = 'none';
    dom.tokenList.innerHTML = '';
    dom.errorState.style.display = 'flex';
    dom.errorMessage.textContent = err.message;
    setStatus('error', '连接失败');
  } finally {
    state.isLoading = false;
    dom.refreshBtn.classList.remove('spinning');
  }
}

// --- Tracked Prices ---

function updateTrackedPrices(tokens) {
  const keys = Object.keys(state.trackedTokens);
  if (keys.length === 0) return;
  const now = Date.now();
  for (const key of keys) {
    const tracked = state.trackedTokens[key];
    const found = tokens.find((t) => t.address?.toLowerCase() === key.toLowerCase());
    if (found) {
      const price = found.priceUsd || 0;
      tracked.currentPrice = price;
      tracked.priceHistory.push({ time: now, price });
      if (tracked.priceHistory.length > state.maxPriceHistory) tracked.priceHistory = tracked.priceHistory.slice(-state.maxPriceHistory);
    } else {
      tracked.priceHistory.push({ time: now, price: null });
      if (tracked.priceHistory.length > state.maxPriceHistory) tracked.priceHistory = tracked.priceHistory.slice(-state.maxPriceHistory);
    }
  }
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
    row.innerHTML = `
      <div class="td ${index < 3 ? 'rank-cell top-3' : 'rank-cell'}">${rankEmoji}</div>
      <div class="td token-cell">
        <div class="token-icon">${iconHtml}</div>
        <div class="token-info">
          <span class="token-symbol" title="${token.name || ''}">${token.symbol || 'Unknown'}</span>
          <span class="token-name">${token.name || shortAddress(token.address)}</span>
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
    btn.textContent = '✅';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '📋';
      btn.classList.remove('copied');
    }, 1500);
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

// --- Monitoring ---

function renderMemecoinMonitoring() {
  const keys = Object.keys(state.trackedTokens);
  const activeAddresses = new Set(state.signals.filter((s) => s.active).map((s) => s.tokenAddress));
  const now = Date.now();
  for (const key of keys) {
    const tracked = state.trackedTokens[key];
    if (now - tracked.signalAt > state.signalExpiryMs * 2) delete state.trackedTokens[key];
  }
  const remainingKeys = Object.keys(state.trackedTokens);
  dom.trackedCount.textContent = remainingKeys.length;
  if (remainingKeys.length === 0) { dom.monitorCards.innerHTML = ''; dom.monitorEmpty.style.display = 'flex'; return; }
  dom.monitorEmpty.style.display = 'none';
  const fragment = document.createDocumentFragment();
  let cardIndex = 0;
  const badgeLabels = { 'price-surge': '飙升', 'volume-spike': '放量', 'buy-pressure': '买压' };
  for (const key of remainingKeys) {
    const tracked = state.trackedTokens[key];
    const priceChange = tracked.priceAtSignal > 0 ? ((tracked.currentPrice - tracked.priceAtSignal) / tracked.priceAtSignal) * 100 : 0;
    const elapsed = now - tracked.signalAt;
    const isActive = activeAddresses.has(key);
    const card = document.createElement('div');
    card.className = 'monitor-card';
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
      </div>
      <div class="monitor-chart-area"><canvas data-tracked-key="${key}"></canvas></div>
      <div class="monitor-stats">
        <div class="monitor-stat"><span class="monitor-stat-label">信号价格</span><span class="monitor-stat-value" style="font-size:11px;color:var(--text-secondary)">${formatPrice(tracked.priceAtSignal)}</span></div>
        <div class="monitor-stat"><span class="monitor-stat-label">当前价格</span><span class="monitor-stat-value" style="font-size:11px">${formatPrice(tracked.currentPrice)}</span></div>
        <div class="monitor-stat"><span class="monitor-stat-label">变化</span><span class="monitor-stat-value ${getChangeClass(priceChange)}">${formatChange(priceChange)}</span></div>
        <div class="monitor-stat" style="margin-left:auto"><span class="monitor-stat-label">已追踪</span><span class="monitor-stat-value" style="font-size:11px;color:var(--text-muted)">${formatDuration(elapsed)}</span></div>
      </div>
      <div class="monitor-actions">
        <a href="${gmgnUrl}" target="_blank" rel="noopener" class="monitor-action-btn primary">交易</a>
        <a href="${explorerUrl}" target="_blank" rel="noopener" class="monitor-action-btn">详情</a>
        ${isActive ? '<span class="monitor-action-btn" style="border-color:rgba(34,197,94,0.3);color:var(--accent-green);cursor:default">🟢 信号中</span>' : ''}
      </div>`;
    fragment.appendChild(card);
  }
  dom.monitorCards.innerHTML = '';
  dom.monitorCards.appendChild(fragment);
  requestAnimationFrame(() => {
    dom.monitorCards.querySelectorAll('canvas[data-tracked-key]').forEach((canvas) => {
      const key = canvas.dataset.trackedKey;
      const tracked = state.trackedTokens[key];
      if (tracked) drawSparkline(canvas, tracked.priceHistory);
    });
  });
}

// ===== Sparkline =====

function drawSparkline(canvas, priceHistory) {
  if (!canvas || !priceHistory || priceHistory.length < 2) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 280;
  const height = rect.height || 48;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const validPoints = [];
  let currentSegment = [];
  for (let i = 0; i < priceHistory.length; i++) {
    if (priceHistory[i].price != null) { currentSegment.push(priceHistory[i]); }
    else { if (currentSegment.length > 0) { validPoints.push(currentSegment); currentSegment = []; } }
  }
  if (currentSegment.length > 0) validPoints.push(currentSegment);
  if (validPoints.length === 0) return;

  const allPrices = priceHistory.filter((p) => p.price != null).map((p) => p.price);
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const range = max - min || 1;
  const padding = { top: 4, bottom: 4, left: 4, right: 4 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const isUp = allPrices[allPrices.length - 1] >= allPrices[0];
  const lineColor = isUp ? '#22c55e' : '#ef4444';
  const fillColor = isUp ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)';
  const glowColor = isUp ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)';

  for (const segment of validPoints) {
    const segPoints = segment.map((p) => {
      const globalIndex = priceHistory.indexOf(p);
      return { x: padding.left + (globalIndex / (priceHistory.length - 1)) * chartWidth, y: padding.top + (1 - (p.price - min) / range) * chartHeight };
    });
    ctx.beginPath(); ctx.moveTo(segPoints[0].x, segPoints[0].y);
    for (let i = 1; i < segPoints.length; i++) ctx.lineTo(segPoints[i].x, segPoints[i].y);
    ctx.strokeStyle = glowColor; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(segPoints[0].x, segPoints[0].y);
    for (let i = 1; i < segPoints.length; i++) ctx.lineTo(segPoints[i].x, segPoints[i].y);
    ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(segPoints[0].x, height - padding.bottom);
    for (let i = 0; i < segPoints.length; i++) ctx.lineTo(segPoints[i].x, segPoints[i].y);
    ctx.lineTo(segPoints[segPoints.length - 1].x, height - padding.bottom); ctx.closePath();
    ctx.fillStyle = fillColor; ctx.fill();
    if (segment === validPoints[0] || segment === validPoints[validPoints.length - 1]) {
      ctx.beginPath(); ctx.arc(segPoints[0].x, segPoints[0].y, 2.5, 0, Math.PI * 2); ctx.fillStyle = lineColor; ctx.fill();
      ctx.beginPath(); ctx.arc(segPoints[segPoints.length - 1].x, segPoints[segPoints.length - 1].y, 3, 0, Math.PI * 2); ctx.fillStyle = lineColor; ctx.fill();
      ctx.beginPath(); ctx.arc(segPoints[segPoints.length - 1].x, segPoints[segPoints.length - 1].y, 5, 0, Math.PI * 2); ctx.fillStyle = isUp ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'; ctx.fill();
    }
  }
}

// ====================================================================================
// OTHERCOIN PAGE — Signal-Based Scanner
// ====================================================================================

async function fetchOthercoinApi() {
  const response = await fetch('/api/othercoin', { headers: { 'Accept': 'application/json' } });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `API错误: ${response.status}`); }
  return response.json();
}

async function loadOthercoinData() {
  if (state.otherLoading) return;
  state.otherLoading = true;
  state.otherError = null;
  dom.otherErrorState.style.display = 'none';
  dom.otherLoadingState.style.display = 'flex';
  dom.otherTokenList.innerHTML = '';
  setStatus('loading', '扫描信号...');
  try {
    const data = await fetchOthercoinApi();
    if (!data.success || !Array.isArray(data.data)) throw new Error('API返回数据格式异常');
    state.otherTokens = data.data;
    renderOthercoinSortedTokens(data.data);
    updateOthercoinStats(data.data, data.timestamp);
    setStatus('', `${data.data.length} 个信号币 · ${formatTime(data.timestamp)}`);
    dom.otherLoadingState.style.display = 'none';
  } catch (err) {
    console.error('Othercoin load error:', err);
    state.otherError = err.message;
    showToast(`信号扫描失败: ${err.message}`, 'error');
    dom.otherLoadingState.style.display = 'none';
    dom.otherTokenList.innerHTML = '';
    dom.otherErrorState.style.display = 'flex';
    dom.otherErrorMessage.textContent = err.message;
    setStatus('error', '扫描失败');
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
    const coinGeckoUrl = token.url || (token.id ? `https://www.coingecko.com/en/coins/${token.id}` : `https://www.coingecko.com/en/search?query=${encodeURIComponent(token.symbol || '')}`);

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
          <span class="token-symbol" title="${token.name || ''}">${token.symbol || 'Unknown'}</span>
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
        <a href="${coinGeckoUrl}" target="_blank" rel="noopener" class="action-btn primary">查看</a>
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
  const url = source && source !== 'auto' ? `/api/bitcoin?source=${source}` : '/api/bitcoin';
  const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `API错误: ${response.status}`); }
  return response.json();
}

async function loadBitcoinData() {
  state.btcLoading = true;
  state.btcError = null;
  dom.btcHeroLoading.style.display = 'flex';
  dom.btcHeroContent.style.display = 'none';
  setStatus('loading', '加载 BTC 数据...');
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
    setStatus('', `BTC $${price.toLocaleString()} · ${formatTime(result.timestamp)}`);
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
    setStatus('error', 'BTC 连接失败');
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
  if (chain === state.currentChain || state.currentPage !== 'memecoin') return;
  state.currentChain = chain;
  dom.chainTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.chain === chain));
  dom.tokenList.innerHTML = '';
  dom.loadingState.style.display = 'flex';
  loadMemecoinData(chain);
}

// ====================================================================================
// AUTO REFRESH
// ====================================================================================

function startAutoRefresh() {
  stopAutoRefresh();
  state.autoRefreshInterval = setInterval(() => {
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

// Memecoin retry
dom.retryBtn.addEventListener('click', () => {
  dom.errorState.style.display = 'none';
  loadMemecoinData(state.currentChain);
});

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
  setStatus('loading', '初始化...');
  loadMemecoinData('solana');
  startAutoRefresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

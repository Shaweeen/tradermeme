/**
 * MemeWatch - Frontend Application
 * Three-section dashboard: Signal Alerts, 15-min Hot Tokens, Post-signal Monitoring
 */

// ===== State =====
const state = {
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
};

// ===== Signal Detection Thresholds =====
const SIGNAL_THRESHOLDS = {
  priceSurge: 15,      // 1h price change > 15%
  volumeSpike: 500000, // 24h volume > $500K
  buyPressure: 75,     // Buy ratio > 75%
};

// ===== DOM References =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  // Header
  chainTabs: $$('.chain-tab'),
  statusDot: $('.status-dot'),
  statusText: $('#statusText'),
  refreshBtn: $('#refreshBtn'),
  autoRefreshToggle: $('#autoRefreshToggle'),

  // Signals
  signalsList: $('#signalsList'),
  signalsEmpty: $('#signalsEmpty'),
  signalCount: $('#signalCount'),
  clearSignalsBtn: $('#clearSignalsBtn'),

  // Hot Tokens
  tokenList: $('#tokenList'),
  loadingState: $('#loadingState'),
  errorState: $('#errorState'),
  errorMessage: $('#errorMessage'),
  retryBtn: $('#retryBtn'),
  hotCount: $('#hotCount'),
  sortBtns: $$('.filter-btn'),

  // Monitoring
  monitorCards: $('#monitorCards'),
  monitorEmpty: $('#monitorEmpty'),
  trackedCount: $('#trackedCount'),

  // Stats
  statCount: $('#statCount .stat-value'),
  statVolume: $('#statVolume .stat-value'),
  statNewest: $('#statNewest .stat-value'),
  statUpdated: $('#statUpdated .stat-value'),
  statsBar: $('#statsBar'),

  // Toast
  toastContainer: $('#toastContainer'),
};

// ===== Utility Functions =====

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
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function formatTxns(num) {
  if (num == null || isNaN(num)) return '--';
  if (num === 0) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
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

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const explorers = {
    solana: `https://solscan.io/token/${address}`,
    base: `https://basescan.org/token/${address}`,
    bsc: `https://bscscan.com/token/${address}`,
  };
  return explorers[chain] || `https://solscan.io/token/${address}`;
}

function getGmgnUrl(chain, address) {
  const slugs = { solana: 'sol', base: 'base', bsc: 'bsc' };
  const slug = slugs[chain] || 'sol';
  return `https://gmgn.ai/${slug}/token/${address}`;
}

function getChainDotClass(chain) {
  const map = { solana: 'sol', base: 'base', bsc: 'bsc' };
  return map[chain] || 'sol';
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

// ===== Toast Notifications =====

function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type]}</span>
    <span class="toast-message">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
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

// ===== Status Updates =====

function setStatus(type, text) {
  dom.statusDot.className = 'status-dot';
  if (type) dom.statusDot.classList.add(type);
  dom.statusText.textContent = text;
}

// ===== Signal Detection System =====

function detectSignals(tokens) {
  const newSignals = [];

  for (const token of tokens) {
    // Check if we already have an active signal for this token
    const existingSignal = state.signals.find(
      (s) => s.tokenAddress === token.address && s.active
    );
    if (existingSignal) continue;

    // 1. Price Surge: 1h change > threshold
    if (token.priceChange1h != null && token.priceChange1h > SIGNAL_THRESHOLDS.priceSurge) {
      newSignals.push(createSignal(token, 'price-surge', `价格 1h 暴涨 ${formatChange(token.priceChange1h)}`));
    }

    // 2. Volume Spike: 24h volume > threshold
    const volume = token.volume24h || token.volume1h || 0;
    if (volume > SIGNAL_THRESHOLDS.volumeSpike) {
      newSignals.push(createSignal(token, 'volume-spike', `24h 交易量 ${formatCompact(volume)}`));
    }

    // 3. Buy Pressure: buy ratio > threshold
    const buyPercent = calculateBuyPercent(token);
    if (buyPercent > SIGNAL_THRESHOLDS.buyPressure) {
      newSignals.push(createSignal(token, 'buy-pressure', `买入占比 ${buyPercent.toFixed(0)}%`));
    }
  }

  // Add new signals to state
  for (const signal of newSignals) {
    state.signalIdCounter++;
    signal.id = state.signalIdCounter;
    state.signals.push(signal);

    // Start tracking this token for post-signal monitoring
    startTrackingToken(signal);

    showToast(`🔔 信号: ${signal.tokenSymbol} - ${signal.reasonText}`, 'info');
  }

  if (newSignals.length > 0) {
    renderSignals();
  }
}

function createSignal(token, reason, reasonText) {
  return {
    id: 0, // assigned later
    tokenAddress: token.address,
    tokenSymbol: token.symbol || 'Unknown',
    tokenName: token.name || '',
    tokenIcon: token.icon || '',
    tokenChain: state.currentChain,
    reason,
    reasonText,
    priceAtSignal: token.priceUsd || 0,
    timestamp: Date.now(),
    active: true,
  };
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
    priceHistory: [{ time: signal.timestamp, price: signal.priceAtSignal }],
    currentPrice: signal.priceAtSignal,
  };
}

// ===== Signal Display =====

function renderSignals() {
  // Clean expired signals
  const now = Date.now();
  state.signals = state.signals.filter((s) => {
    if (!s.active) return false;
    if (now - s.timestamp > state.signalExpiryMs) return false;
    return true;
  });

  const activeSignals = state.signals.filter((s) => s.active);
  dom.signalCount.textContent = activeSignals.length;

  if (activeSignals.length === 0) {
    dom.signalsList.innerHTML = '';
    dom.signalsEmpty.style.display = 'flex';
    return;
  }

  dom.signalsEmpty.style.display = 'none';

  const fragment = document.createDocumentFragment();
  for (const signal of activeSignals) {
    const card = document.createElement('div');
    card.className = `signal-card signal-${signal.reason}`;
    card.dataset.signalId = signal.id;

    const typeLabels = {
      'price-surge': '📈 价格飙升',
      'volume-spike': '💎 交易量激增',
      'buy-pressure': '🟢 买入压力',
    };
    const age = formatDuration(now - signal.timestamp);

    card.innerHTML = `
      <button class="signal-dismiss-btn" data-signal-id="${signal.id}" title="关闭信号">✕</button>
      <div class="signal-header">
        <span class="signal-type">${typeLabels[signal.reason] || '信号'}</span>
        <span class="signal-time">${age}</span>
      </div>
      <div class="signal-body">
        <div class="signal-token-icon">${signal.tokenIcon ? `<img src="${signal.tokenIcon}" alt="" onerror="this.style.display='none'" />` : (signal.tokenSymbol?.charAt(0) || '?')}</div>
        <div class="signal-token-info">
          <span class="signal-token-symbol">${signal.tokenSymbol}</span>
          <span class="signal-token-name">${signal.tokenName || shortAddress(signal.tokenAddress)}</span>
        </div>
      </div>
      <div class="signal-message">${signal.reasonText}</div>
    `;

    fragment.appendChild(card);
  }

  dom.signalsList.innerHTML = '';
  dom.signalsList.appendChild(fragment);

  // Attach dismiss handlers
  dom.signalsList.querySelectorAll('.signal-dismiss-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const id = parseInt(e.currentTarget.dataset.signalId);
      dismissSignal(id);
    });
  });
}

function dismissSignal(id) {
  const signal = state.signals.find((s) => s.id === id);
  if (signal) signal.active = false;
  renderSignals();
  renderMonitoring();
}

// ===== Data Fetching =====

async function fetchTrending(chain) {
  const response = await fetch(`/api/trending?chain=${chain}&limit=50`, {
    headers: { 'Accept': 'application/json' },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API错误: ${response.status}`);
  }

  return response.json();
}

async function loadData(chain = state.currentChain, isRetry = false) {
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
    const data = await fetchTrending(chain);

    if (!data.success || !Array.isArray(data.data)) {
      throw new Error('API返回数据格式异常');
    }

    state.tokens = data.data;
    state.lastUpdated = data.timestamp || Date.now();
    state.retryCount = 0;

    // Run signal detection on new data
    detectSignals(data.data);

    // Update tracked token prices
    updateTrackedPrices(data.data);

    // Render all sections
    renderSortedTokens(data.data);
    updateStats(data.data, data.timestamp);
    renderMonitoring();

    setStatus('', `${data.count} 个代币 · ${formatTime(data.timestamp)}`);
    dom.loadingState.style.display = 'none';
  } catch (err) {
    console.error('Load data error:', err);
    state.error = err.message;

    if (state.retryCount < state.maxRetries && !isRetry) {
      state.retryCount++;
      setStatus('loading', `重试中 (${state.retryCount}/${state.maxRetries})...`);
      setTimeout(() => loadData(chain, true), 2000);
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

// ===== Tracked Token Price Updates =====

function updateTrackedPrices(tokens) {
  const trackedKeys = Object.keys(state.trackedTokens);
  if (trackedKeys.length === 0) return;

  const now = Date.now();

  for (const key of trackedKeys) {
    const tracked = state.trackedTokens[key];
    const found = tokens.find(
      (t) => t.address.toLowerCase() === key.toLowerCase()
    );

    if (found) {
      const price = found.priceUsd || 0;
      tracked.currentPrice = price;
      tracked.priceHistory.push({ time: now, price });

      // Keep only last N data points
      if (tracked.priceHistory.length > state.maxPriceHistory) {
        tracked.priceHistory = tracked.priceHistory.slice(-state.maxPriceHistory);
      }
    } else {
      // Token not in current data - add a placeholder with null price for gap indication
      // This creates visible gaps in the sparkline
      tracked.priceHistory.push({ time: now, price: null });

      if (tracked.priceHistory.length > state.maxPriceHistory) {
        tracked.priceHistory = tracked.priceHistory.slice(-state.maxPriceHistory);
      }
    }
  }
}

// ===== Token Rendering with Sorting =====

function renderSortedTokens(tokens) {
  const sorted = [...tokens].sort((a, b) => {
    switch (state.sortBy) {
      case 'volume': {
        const bVol = b.volume24h || b.volume1h || 0;
        const aVol = a.volume24h || a.volume1h || 0;
        return bVol - aVol;
      }
      case 'priceChange': {
        const bChg = Math.abs(b.priceChange1h || 0);
        const aChg = Math.abs(a.priceChange1h || 0);
        return bChg - aChg;
      }
      case 'buyRatio': {
        const bBuy = calculateBuyPercent(b);
        const aBuy = calculateBuyPercent(a);
        return bBuy - aBuy;
      }
      default:
        return 0;
    }
  });

  dom.hotCount.textContent = tokens.length;
  renderTokens(sorted);
}

function renderTokens(tokens) {
  if (!tokens || tokens.length === 0) {
    dom.tokenList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>暂无代币数据</p>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();

  tokens.forEach((token, index) => {
    const row = document.createElement('div');
    row.className = 'token-row';
    row.style.animationDelay = `${index * 0.03}s`;

    const rankClass = index < 3 ? 'rank-cell top-3' : 'rank-cell';
    const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : index + 1;

    const iconHtml = getTokenIcon(token);
    const explorerUrl = getExplorerUrl(state.currentChain, token.address);
    const gmgnUrl = getGmgnUrl(state.currentChain, token.address);
    const buyPercent = calculateBuyPercent(token);

    row.innerHTML = `
      <div class="td ${rankClass}">${rankEmoji}</div>

      <div class="td token-cell">
        <div class="token-icon">${iconHtml}</div>
        <div class="token-info">
          <span class="token-symbol" title="${token.name || ''}">${token.symbol || 'Unknown'}</span>
          <span class="token-name">${token.name || shortAddress(token.address)}</span>
          <div class="token-links">
            <a href="${gmgnUrl}" target="_blank" rel="noopener" class="token-link" title="在 GMGN 查看">GMGN</a>
            <a href="${explorerUrl}" target="_blank" rel="noopener" class="token-link" title="在区块链浏览器查看">🔗</a>
          </div>
        </div>
      </div>

      <div class="td price-cell">${formatPrice(token.priceUsd)}</div>

      <div class="td">
        <span class="change-cell ${getChangeClass(token.priceChange1h)}">
          ${formatChange(token.priceChange1h)}
        </span>
      </div>

      <div class="td">
        <span class="change-cell ${getChangeClass(token.priceChange24h)}">
          ${formatChange(token.priceChange24h)}
        </span>
      </div>

      <div class="td volume-cell">${formatCompact(token.volume24h != null ? token.volume24h : token.volume1h)}</div>
      <div class="td liquidity-cell">${formatCompact(token.liquidity)}</div>
      <div class="td fdv-cell">${formatCompact(token.fdv)}</div>

      <div class="td txns-cell">
        ${token.txns24h?.total != null ? formatTxns(token.txns24h.total) : '--'}
      </div>

      <div class="td trades-cell">
        <div class="buy-sell-bar">
          <div class="buys" style="width: ${buyPercent}%"></div>
        </div>
        <span class="buy-sell-ratio">${buyPercent.toFixed(0)}%</span>
      </div>

      <div class="td actions-cell">
        <a href="${gmgnUrl}" target="_blank" rel="noopener" class="action-btn primary">交易</a>
        <a href="${explorerUrl}" target="_blank" rel="noopener" class="action-btn">详情</a>
      </div>
    `;

    fragment.appendChild(row);
  });

  dom.tokenList.innerHTML = '';
  dom.tokenList.appendChild(fragment);
}

// ===== Stats =====

function updateStats(tokens, timestamp) {
  if (!dom.statsBar) return;

  const count = tokens.length;
  if (dom.statCount) dom.statCount.textContent = count;

  const totalVolume = tokens.reduce((sum, t) => sum + (t.volume24h != null ? t.volume24h : (t.volume1h ?? 0)), 0);
  if (dom.statVolume) dom.statVolume.textContent = formatCompact(totalVolume);

  const newest = tokens.reduce((latest, t) => {
    if (!latest) return t;
    const tTime = t.createdAt || 0;
    const lTime = latest.createdAt || 0;
    return tTime > lTime ? t : latest;
  }, null);
  if (dom.statNewest) dom.statNewest.textContent = newest?.symbol || '--';

  if (dom.statUpdated) dom.statUpdated.textContent = formatTime(timestamp || Date.now());
}

// ===== Post-Signal Monitoring =====

function renderMonitoring() {
  const trackedKeys = Object.keys(state.trackedTokens);
  const activeSignalAddresses = new Set(
    state.signals.filter((s) => s.active).map((s) => s.tokenAddress)
  );

  // Remove tracked tokens that are no longer in active signals (optional: keep for a while)
  // Keep tracked tokens for monitoring even after signal dismissed, but remove if old
  const now = Date.now();
  for (const key of trackedKeys) {
    const tracked = state.trackedTokens[key];
    if (now - tracked.signalAt > state.signalExpiryMs * 2) {
      delete state.trackedTokens[key];
    }
  }

  const remainingKeys = Object.keys(state.trackedTokens);
  dom.trackedCount.textContent = remainingKeys.length;

  if (remainingKeys.length === 0) {
    dom.monitorCards.innerHTML = '';
    dom.monitorEmpty.style.display = 'flex';
    return;
  }

  dom.monitorEmpty.style.display = 'none';

  const fragment = document.createDocumentFragment();
  let cardIndex = 0;

  for (const key of remainingKeys) {
    const tracked = state.trackedTokens[key];
    const priceChange = tracked.priceAtSignal > 0
      ? ((tracked.currentPrice - tracked.priceAtSignal) / tracked.priceAtSignal) * 100
      : 0;
    const elapsed = now - tracked.signalAt;
    const isActive = activeSignalAddresses.has(key);

    const badgeLabels = {
      'price-surge': '飙升',
      'volume-spike': '放量',
      'buy-pressure': '买压',
    };

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
      <div class="monitor-chart-area">
        <canvas data-tracked-key="${key}"></canvas>
      </div>
      <div class="monitor-stats">
        <div class="monitor-stat">
          <span class="monitor-stat-label">信号价格</span>
          <span class="monitor-stat-value" style="font-size:11px;color:var(--text-secondary)">${formatPrice(tracked.priceAtSignal)}</span>
        </div>
        <div class="monitor-stat">
          <span class="monitor-stat-label">当前价格</span>
          <span class="monitor-stat-value" style="font-size:11px">${formatPrice(tracked.currentPrice)}</span>
        </div>
        <div class="monitor-stat">
          <span class="monitor-stat-label">变化</span>
          <span class="monitor-stat-value ${getChangeClass(priceChange)}">${formatChange(priceChange)}</span>
        </div>
        <div class="monitor-stat" style="margin-left:auto">
          <span class="monitor-stat-label">已追踪</span>
          <span class="monitor-stat-value" style="font-size:11px;color:var(--text-muted)">${formatDuration(elapsed)}</span>
        </div>
      </div>
      <div class="monitor-actions">
        <a href="${gmgnUrl}" target="_blank" rel="noopener" class="monitor-action-btn primary">交易</a>
        <a href="${explorerUrl}" target="_blank" rel="noopener" class="monitor-action-btn">详情</a>
        ${isActive ? '<span class="monitor-action-btn" style="border-color:rgba(34,197,94,0.3);color:var(--accent-green);cursor:default">🟢 信号中</span>' : ''}
      </div>
    `;

    fragment.appendChild(card);
  }

  dom.monitorCards.innerHTML = '';
  dom.monitorCards.appendChild(fragment);

  // Render sparkline charts after DOM is updated
  requestAnimationFrame(() => {
    dom.monitorCards.querySelectorAll('canvas[data-tracked-key]').forEach((canvas) => {
      const key = canvas.dataset.trackedKey;
      const tracked = state.trackedTokens[key];
      if (tracked) {
        drawSparkline(canvas, tracked.priceHistory);
      }
    });
  });
}

// ===== Sparkline Chart Drawing =====

function drawSparkline(canvas, priceHistory) {
  if (!canvas || !priceHistory || priceHistory.length < 2) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Get actual CSS size
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || 280;
  const height = rect.height || 48;

  // Set canvas size accounting for device pixel ratio
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  // Clear
  ctx.clearRect(0, 0, width, height);

  // Filter out null prices for drawing, but track gaps
  const validPoints = [];
  let currentSegment = [];

  for (let i = 0; i < priceHistory.length; i++) {
    if (priceHistory[i].price != null) {
      currentSegment.push(priceHistory[i]);
    } else {
      if (currentSegment.length > 0) {
        validPoints.push(currentSegment);
        currentSegment = [];
      }
    }
  }
  if (currentSegment.length > 0) {
    validPoints.push(currentSegment);
  }

  // If no valid data, exit
  if (validPoints.length === 0) return;

  // Get all valid prices for min/max calculation
  const allValidPrices = validPoints.flat().map((p) => p.price);
  const allPrices = priceHistory.filter((p) => p.price != null).map((p) => p.price);
  const min = Math.min(...allPrices);
  const max = Math.max(...allPrices);
  const range = max - min || 1;

  const padding = { top: 4, bottom: 4, left: 4, right: 4 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Determine if trending up or down based on first and last valid prices
  const firstValidPrice = allPrices[0];
  const lastValidPrice = allPrices[allPrices.length - 1];
  const isUp = lastValidPrice >= firstValidPrice;

  const lineColor = isUp ? '#22c55e' : '#ef4444';
  const fillColor = isUp ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)';
  const glowColor = isUp ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)';

  // Draw each valid segment
  for (const segment of validPoints) {
    const segPrices = segment.map((p) => p.price);
    const segMin = Math.min(...segPrices);
    const segMax = Math.max(...segPrices);
    const segRange = segMax - segMin || 1;

    const segPoints = segment.map((p, i) => {
      // Need to map each point's position based on its index in the full history
      const globalIndex = priceHistory.indexOf(p);
      return {
        x: padding.left + (globalIndex / (priceHistory.length - 1)) * chartWidth,
        y: padding.top + (1 - (p.price - min) / range) * chartHeight,
      };
    });

    // Draw glow line
    ctx.beginPath();
    ctx.moveTo(segPoints[0].x, segPoints[0].y);
    for (let i = 1; i < segPoints.length; i++) {
      ctx.lineTo(segPoints[i].x, segPoints[i].y);
    }
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // Draw main line
    ctx.beginPath();
    ctx.moveTo(segPoints[0].x, segPoints[0].y);
    for (let i = 1; i < segPoints.length; i++) {
      ctx.lineTo(segPoints[i].x, segPoints[i].y);
    }
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw fill
    ctx.beginPath();
    ctx.moveTo(segPoints[0].x, height - padding.bottom);
    for (let i = 0; i < segPoints.length; i++) {
      ctx.lineTo(segPoints[i].x, segPoints[i].y);
    }
    ctx.lineTo(segPoints[segPoints.length - 1].x, height - padding.bottom);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Draw start and end dots for first and last segment
    if (segment === validPoints[0] || segment === validPoints[validPoints.length - 1]) {
      ctx.beginPath();
      ctx.arc(segPoints[0].x, segPoints[0].y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(segPoints[segPoints.length - 1].x, segPoints[segPoints.length - 1].y, 3, 0, Math.PI * 2);
      ctx.fillStyle = lineColor;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(segPoints[segPoints.length - 1].x, segPoints[segPoints.length - 1].y, 5, 0, Math.PI * 2);
      ctx.fillStyle = isUp ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
      ctx.fill();
    }
  }
}

// ===== Chain Switching =====

function switchChain(chain) {
  if (chain === state.currentChain) return;
  state.currentChain = chain;
  dom.chainTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.chain === chain);
  });

  dom.tokenList.innerHTML = '';
  dom.loadingState.style.display = 'flex';
  loadData(chain);
}

// ===== Auto Refresh =====

function startAutoRefresh() {
  stopAutoRefresh();
  state.autoRefreshInterval = setInterval(() => {
    if (!state.isLoading) {
      loadData(state.currentChain);
    }
  }, state.autoRefreshDelay);
}

function stopAutoRefresh() {
  if (state.autoRefreshInterval) {
    clearInterval(state.autoRefreshInterval);
    state.autoRefreshInterval = null;
  }
}

// ===== Event Listeners =====

// Chain tab switching
dom.chainTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    switchChain(tab.dataset.chain);
  });
});

// Manual refresh
dom.refreshBtn.addEventListener('click', () => {
  dom.refreshBtn.classList.add('spinning');
  showToast('正在刷新数据...', 'info');
  loadData(state.currentChain);
});

// Auto-refresh toggle
dom.autoRefreshToggle.addEventListener('change', () => {
  if (dom.autoRefreshToggle.checked) {
    startAutoRefresh();
    showToast('自动刷新已开启', 'success');
  } else {
    stopAutoRefresh();
    showToast('自动刷新已关闭', 'info');
  }
});

// Retry button
dom.retryBtn.addEventListener('click', () => {
  dom.errorState.style.display = 'none';
  loadData(state.currentChain);
});

// Sort buttons
dom.sortBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    dom.sortBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.sortBy = btn.dataset.sort;
    if (state.tokens.length > 0) {
      renderSortedTokens(state.tokens);
    }
  });
});

// Clear signals
dom.clearSignalsBtn.addEventListener('click', () => {
  state.signals.forEach((s) => (s.active = false));
  renderSignals();
  renderMonitoring();
  showToast('所有信号已清除', 'info');
});

// ===== Initialize =====

function init() {
  setStatus('loading', '初始化...');
  loadData('solana');
  startAutoRefresh();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

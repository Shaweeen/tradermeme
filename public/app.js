/**
 * MemeWatch - Frontend Application
 * Handles data fetching, real-time updates, and UI interactions
 */

// ===== State =====
const state = {
  currentChain: 'solana',
  tokens: [],
  isLoading: false,
  error: null,
  lastUpdated: null,
  autoRefreshInterval: null,
  autoRefreshDelay: 30000, // 30 seconds
  retryCount: 0,
  maxRetries: 3,
};

// ===== DOM References =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
  chainTabs: $$('.chain-tab'),
  tokenList: $('#tokenList'),
  loadingState: $('#loadingState'),
  errorState: $('#errorState'),
  errorMessage: $('#errorMessage'),
  retryBtn: $('#retryBtn'),
  refreshBtn: $('#refreshBtn'),
  statusDot: $('.status-dot'),
  statusText: $('#statusText'),
  autoRefreshToggle: $('#autoRefreshToggle'),
  statCount: $('#statCount .stat-value'),
  statVolume: $('#statVolume .stat-value'),
  statNewest: $('#statNewest .stat-value'),
  statUpdated: $('#statUpdated .stat-value'),
  toastContainer: $('#toastContainer'),
};

// ===== Utility Functions =====

/** Format price with appropriate precision */
function formatPrice(price) {
  if (price == null || price === '' || isNaN(price)) return '$--';
  if (price === 0) return '$0.00';
  if (price < 0.000001) return `$${price.toExponential(2)}`;
  if (price < 0.01) return `$${price.toFixed(6)}`;
  if (price < 1) return `$${price.toFixed(4)}`;
  if (price < 100) return `$${price.toFixed(2)}`;
  return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format large numbers with K/M/B suffixes */
function formatCompact(num) {
  if (num == null || isNaN(num)) return '$--';
  if (num === 0) return '$0';
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

/** Format transaction count */
function formatTxns(num) {
  if (num == null || isNaN(num)) return '--';
  if (num === 0) return '0';
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

/** Format percentage change */
function formatChange(value) {
  if (value == null || isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/** Get change class based on value */
function getChangeClass(value) {
  if (value == null || isNaN(value)) return 'neutral';
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

/** Format timestamp */
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

/** Generate short address */
function shortAddress(addr) {
  if (!addr || addr.length < 10) return addr ?? '';
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

/** Get token icon element */
function getTokenIcon(token) {
  if (token.icon) {
    return `<img src="${token.icon}" alt="${token.symbol}" onerror="this.style.display='none'" />`;
  }
  return token.symbol?.charAt(0)?.toUpperCase() || '?';
}

/** Get chain explorer URL */
function getExplorerUrl(chain, address) {
  const explorers = {
    solana: `https://solscan.io/token/${address}`,
    base: `https://basescan.org/token/${address}`,
    bsc: `https://bscscan.com/token/${address}`,
  };
  return explorers[chain] || `https://solscan.io/token/${address}`;
}

/** Get gmgn.ai URL */
function getGmgnUrl(chain, address) {
  const slugs = { solana: 'sol', base: 'base', bsc: 'bsc' };
  const slug = slugs[chain] || 'sol';
  return `https://gmgn.ai/${slug}/token/${address}`;
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

  // Auto-remove after 4 seconds
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

    renderTokens(data.data);
    updateStats(data.data, data.timestamp);
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

// ===== Rendering =====

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

function calculateBuyPercent(token) {
  const buys = (token.txns24h?.buys != null ? token.txns24h.buys : (token.txns1h?.buys ?? 0));
  const sells = (token.txns24h?.sells != null ? token.txns24h.sells : (token.txns1h?.sells ?? 0));
  const total = buys + sells;
  if (total === 0) return 50;
  return (buys / total) * 100;
}

// ===== Stats =====

function updateStats(tokens, timestamp) {
  const count = tokens.length;
  dom.statCount.textContent = count;

  // Total 24h volume
  const totalVolume = tokens.reduce((sum, t) => sum + (t.volume24h != null ? t.volume24h : (t.volume1h ?? 0)), 0);
  dom.statVolume.textContent = formatCompact(totalVolume);

  // Newest token (by creation time)
  const newest = tokens.reduce((latest, t) => {
    if (!latest) return t;
    const tTime = t.createdAt || 0;
    const lTime = latest.createdAt || 0;
    return tTime > lTime ? t : latest;
  }, null);
  dom.statNewest.textContent = newest?.symbol || '--';

  // Last updated time
  dom.statUpdated.textContent = formatTime(timestamp || Date.now());
}

// ===== Chain Switching =====

function switchChain(chain) {
  if (chain === state.currentChain) return;

  state.currentChain = chain;
  dom.chainTabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.chain === chain);
  });

  // Clear and reload
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

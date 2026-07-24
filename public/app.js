/**
 * DreamStudio - Frontend Application
 * Multi-page dashboard: Memecoin · Altcoin · Bitcoin
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
  // Settled buy-point outcomes (win/loss) for 24H AI 胜率 & selection learning
  signalOutcomes: [],
  sessionRemovedInvalid: 0, // cleared invalids this session (for UI)
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
  sortBy: 'value', // default: server value-rank Top20
  signalIdCounter: 0,
  signalExpiryMs: 300000, // 5 min active signal carousel
  // Fixed compact bottom-right signal frame (auto-hide 3s idle)
  signalTickerIndex: 0,
  signalTickerTimer: null,
  signalTickerHideTimer: null,
  signalTickerHovering: false,
  signalTickerRotateMs: 2800,
  signalTickerIdleHideMs: 3000,
  signalFlashMs: 1000,
  trackingRetentionMs: 24 * 60 * 60 * 1000, // 24H AI 信号观察窗口（买入标注点起）
  moonshotRetentionMs: 30 * 24 * 60 * 60 * 1000, // >500% projects are kept for 1 month
  maxPriceHistory: 2880, // normal 24h at 30s refresh cadence
  maxMoonshotPriceHistory: 900, // compressed 1-month moonshot history for localStorage safety
  maxTrackingStorageBytes: 4_000_000, // keep below common 5MB localStorage quota
  zeroNoInflowCleanupMs: 4 * 60 * 60 * 1000, // remove zero-price archive rows after 4h without capital inflow
  // 失效：跌破买入点持续 N 分钟后从 24H 列表移除并记为 loss
  invalidLossHoldMs: 30 * 60 * 1000,
  memecoinLimit: 20, // 仅展示价值排序后 Top 20

  // Altcoin state (legacy key: othercoin) — independent of Memecoin
  otherTokens: [],
  otherLoading: false,
  otherError: null,
  otherSortBy: 'signalScore',
  altcoinActionFilter: 'all', // all | prefer | watch | fade
  altcoinEnvironment: null,
  altcoinMeta: null,

  // Bitcoin state
  btcData: null,
  btcLoading: false,
  btcError: null,
  btcPriceHistory: [],
  btcPreferredSource: 'auto',
  btcSourceRetryCount: 0,
  btcSourceMaxRetries: 2,
  btcPeriod: '1h', // 计费窗：1h | 2h | 4h
  btcSeriesUnit: 'day', // hour | day | month | year
  btcSourceMeta: null,
  btcSourceHealth: {},
};

// ===== Signal Thresholds (prefer SignalEngine.thresholds when loaded) =====
// Keep in sync with SignalEngine.thresholds (monitor-heat-v4)
const SIGNAL_THRESHOLDS = {
  priceSurge: 15,
  volumeSpike: 500000,
  volume1hMin: 80000,
  buyPressure: 75,
  aiScore: 62,
  maxAiRisk: 72,
  monitorInflow: 62,
  monitorMaxRisk: 68,
  monitorHeatScore: 58,
};

const TRACKING_STORAGE_KEY = 'coinwatch_memecoin_signal_tracking_v1';

// ===== DOM =====
const $ = (sel) =>document.querySelector(sel);
const $$ = (sel) =>document.querySelectorAll(sel);

const dom = {
  // Page Nav
  pageTabs: $$('.page-tab'),
  pageContents: {
    memecoin: $('#pageMemecoin'),
    altcoin: $('#pageAltcoin'),
    othercoin: $('#pageAltcoin'), // alias
    bitcoin: $('#pageBitcoin'),
  },
  logoSubtitle: $('#logoSubtitle'),

  // Shared
  statusDot: $('.status-dot'),
  statusText: $('#statusText'),
  refreshBtn: $('#refreshBtn'),
  autoRefreshToggle: $('#autoRefreshToggle'),
  chainTabs: $$('.chain-tab'),

  // Memecoin - Signals (compact section + fixed ticker)
  signalsList: $('#signalsList'),
  signalsEmpty: $('#signalsEmpty'),
  signalCount: $('#signalCount'),
  clearSignalsBtn: $('#clearSignalsBtn'),
  signalTicker: $('#signalTicker'),
  signalTickerBody: $('#signalTickerBody'),
  signalTickerText: $('#signalTickerText'),
  signalTickerList: $('#signalTickerList'),
  signalTickerCount: $('#signalTickerCount'),
  signalTickerClear: $('#signalTickerClear'),

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
  btcFearGreed: $('#btcFearGreed'),
  btcRainbowBand: $('#btcRainbowBand'),
  btcHalvingCycle: $('#btcHalvingCycle'),
  btcMa200: $('#btcMa200'),
  btcSources: $('#btcSources'),
  sentimentDataStatus: $('#sentimentDataStatus'),
  sentimentDataHint: $('#sentimentDataHint'),
  btcBiasStrip: $('#btcBiasStrip'),
  btcBiasLabel: $('#btcBiasLabel'),
  btcBiasScore: $('#btcBiasScore'),
  btcBiasBar: $('#btcBiasBar'),
  btcBiasSummary: $('#btcBiasSummary'),
  btcFundingVenues: $('#btcFundingVenues'),
  fundSelfAvg: $('#fundSelfAvg'),
  btcSelfSourceMeta: $('#btcSelfSourceMeta'),
  // BTC multi-timeframe venues
  btcTfBar: $('#btcTfBar'),
  btcTfBtns: $$('#btcTfBar .btc-tf-btn'),
  periodVenueStatus: $('#periodVenueStatus'),
  btcVenueTableBody: $('#btcVenueTableBody'),
  btcAvgPeriodLabel: $('#btcAvgPeriodLabel'),
  aggPrice: $('#aggPrice'),
  aggFunding: $('#aggFunding'),
  aggOi: $('#aggOi'),
  aggOiEnd: $('#aggOiEnd'),
  aggVol: $('#aggVol'),
  aggVenues: $('#aggVenues'),
  btcFundOutlierAlert: $('#btcFundOutlierAlert'),
  btcFundOutlierList: $('#btcFundOutlierList'),
  btcFundOutlierNote: $('#btcFundOutlierNote'),
  btcStageGrid: $('#btcStageGrid'),
  btcPeriodHint: $('#btcPeriodHint'),
  // BTC Source Selector
  btcSourceBtns: $$('#btcSourceBtns .btc-source-btn'),
  sourceStatusDot: $('#sourceStatusDot'),
  sourceStatusText: $('#sourceStatusText'),

  // BTC - 田字框架（多空 + 清算合并）
  tianStatus: $('#tianStatus'),
  tianFrame: $('#tianFrame'),
  tianCanvas: $('#tianCanvas'),
  tianShortVol: $('#tianShortVol'),
  tianShortPct: $('#tianShortPct'),
  tianLongOpen: $('#tianLongOpen'),
  tianLongPct: $('#tianLongPct'),
  tianPriceTag: $('#tianPriceTag'),
  tianPriceTag2: $('#tianPriceTag2'),
  tianPriceBelow: $('#tianPriceBelow'),
  tianPriceWindow: $('#tianPriceWindow'),
  tianOiTag: $('#tianOiTag'),
  tianLongLiqList: $('#tianLongLiqList'),
  tianShortLiqList: $('#tianShortLiqList'),
  tianLongLiqUsd: $('#tianLongLiqUsd'),
  tianShortLiqUsd: $('#tianShortLiqUsd'),
  tianHint: $('#tianHint'),
  tianReadout: $('#tianReadout'),
  tianClickTip: $('#tianClickTip'),
  // legacy hidden ids
  lsGrid: $('#lsGrid'),
  lsStatus: $('#lsStatus'),
  lsSignal: $('#lsSignal'),
  lsRatioValue: $('#lsRatioValue'),
  lsLongPct: $('#lsLongPct'),
  lsShortPct: $('#lsShortPct'),
  lsLongBar: $('#lsLongBar'),
  lsShortBar: $('#lsShortBar'),
  liqTotalUsd: $('#liqTotalUsd'),
  liqLongUsd: $('#liqLongUsd'),
  liqShortUsd: $('#liqShortUsd'),
  liqCount: $('#liqCount'),
  liqSignal: $('#liqSignal'),
  liqLongBar: $('#liqLongBar'),
  liqShortBar: $('#liqShortBar'),
  liqLongPct: $('#liqLongPct'),
  liqShortPct: $('#liqShortPct'),
  liqSources: $('#liqSources'),
  liqStatus: $('#liqStatus'),

  // BTC - 合约数据明细
  contractDataStatus: $('#contractDataStatus'),
  contractDataHint: $('#contractDataHint'),
  btcContractNodes: $('#btcContractNodes'),
  btcContractVol: $('#btcContractVol'),
  btcContractStability: $('#btcContractStability'),

  // BTC - 自信号源三量图（资金费率 / 成交量 / 合约开仓量）
  selfTriStatus: $('#selfTriStatus'),
  selfTriBody: $('#selfTriBody'),
  selfTriShell: $('#selfTriShell'),
  selfTriChart: $('#selfTriChart'),
  selfTriTooltip: $('#selfTriTooltip'),
  selfTriHint: $('#selfTriHint'),
  selfTriHud: $('#selfTriHud'),
  triHudPrice: $('#triHudPrice'),
  triHudDate: $('#triHudDate'),
  triHudFund: $('#triHudFund'),
  triHudVol: $('#triHudVol'),
  triHudOi: $('#triHudOi'),
  btcSeriesUnitBar: $('#btcSeriesUnitBar'),
  btcSeriesUnitBtns: $$('#btcSeriesUnitBar .btc-unit-btn'),
  btcTriLegend: $('#btcTriLegend'),
  triLegBtns: $$('#btcTriLegend .tri-leg-btn'),
  triPrice: $('#triPrice'),
  triFund: $('#triFund'),
  triVol: $('#triVol'),
  triOi: $('#triOi'),
  triSource: $('#triSource'),

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
  const sign = value >0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function getChangeClass(value) {
  if (value == null || isNaN(value)) return 'neutral';
  if (value >0) return 'positive';
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
  const c = normalizeMarketChain(chain);
  const explorers = {
    solana: `https://solscan.io/token/${address}`,
    ethereum: `https://etherscan.io/token/${address}`,
    base: `https://basescan.org/token/${address}`,
    bsc: `https://bscscan.com/token/${address}`,
    robinhood: `https://robinhoodchain.blockscout.com/token/${address}`,
  };
  return explorers[c] || `https://solscan.io/token/${address}`;
}

/** Normalize chain id for market detail routing */
function normalizeMarketChain(chain) {
  const c = String(chain || '').toLowerCase().trim();
  if (!c) return '';
  if (c === 'sol' || c === 'solana') return 'solana';
  if (c === 'eth' || c === 'ethereum') return 'ethereum';
  if (c === 'bnb' || c === 'bsc' || c === 'bnb-chain' || c === 'bnbchain') return 'bsc';
  if (c === 'rh' || c === 'hood' || c === 'robinhood') return 'robinhood';
  if (c === 'arb' || c === 'arbitrum') return 'arbitrum';
  if (c === 'op' || c === 'optimism') return 'optimism';
  if (c === 'matic' || c === 'polygon' || c === 'poly') return 'polygon';
  if (c === 'avax' || c === 'avalanche') return 'avalanche';
  if (c === 'base') return 'base';
  return c;
}

/** EVM chains that always open DexScreener (never GMGN for detail) */
const EVM_DEXSCREENER_CHAINS = new Set([
  'ethereum', 'base', 'bsc', 'arbitrum', 'optimism', 'polygon', 'avalanche', 'robinhood',
]);

/** DexScreener path slug per chain (must match dexscreener.com/{slug}/…) */
const DEXSCREENER_CHAIN_SLUG = {
  ethereum: 'ethereum',
  base: 'base',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  optimism: 'optimism',
  polygon: 'polygon',
  avalanche: 'avalanche',
  robinhood: 'robinhood',
  solana: 'solana',
};

/**
 * Normalize EVM address → lowercase 0x + 40 hex (DexScreener-friendly).
 * Accepts with/without 0x, mixed case.
 */
function normalizeEvmAddress(addr) {
  let a = String(addr || '').trim();
  if (!a) return '';
  // strip wrappers / query noise
  a = a.split('?')[0].split('#')[0].trim();
  if (/^0x[a-fA-F0-9]{40}$/i.test(a)) return a.toLowerCase();
  // bare 40 hex without 0x
  if (/^[a-fA-F0-9]{40}$/i.test(a)) return `0x${a.toLowerCase()}`;
  return '';
}

function looksLikeContractAddress(addr) {
  const a = String(addr || '').trim();
  if (!a) return false;
  if (normalizeEvmAddress(a)) return true;
  // Solana mint / base58 (not a short CEX ticker like FLOCK)
  if (a.length >= 32 && !/^[A-Z0-9]{2,20}$/.test(a) && !a.startsWith('0x')) return true;
  return false;
}

/**
 * Build a guaranteed DexScreener chart URL for a chain + contract/pair.
 * Prefer token contract; fall back to pair address.
 * e.g. https://dexscreener.com/base/0x7af45d…
 */
function getDexScreenerTokenUrl(chain, address, pairAddress = '') {
  const c = normalizeMarketChain(chain);
  const slug = DEXSCREENER_CHAIN_SLUG[c];
  if (!slug || slug === 'solana') return ''; // Solana detail uses GMGN

  const tokenNorm = normalizeEvmAddress(address);
  const pairNorm = normalizeEvmAddress(pairAddress);
  // Non-EVM style addresses (rare on RH etc.)
  const rawToken = String(address || '').trim();
  const rawPair = String(pairAddress || '').trim();

  let pathAddr = tokenNorm || pairNorm;
  if (!pathAddr && looksLikeContractAddress(rawToken) && !rawToken.startsWith('0x')) {
    pathAddr = rawToken;
  }
  if (!pathAddr && looksLikeContractAddress(rawPair) && !rawPair.startsWith('0x')) {
    pathAddr = rawPair;
  }

  if (!pathAddr) return '';
  return `https://dexscreener.com/${slug}/${pathAddr}`;
}

/**
 * Parse a dexscreener.com URL → { chain, address } if valid chart path.
 */
function parseDexScreenerUrl(url) {
  const m = String(url || '').match(
    /dexscreener\.com\/([a-z0-9-]+)\/(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,})/i
  );
  if (!m) return null;
  return { chain: m[1].toLowerCase(), address: m[2] };
}

/**
 * GMGN Solana token market page only.
 * e.g. https://gmgn.ai/sol/token/{mint}
 */
function getGmgnSolanaUrl(address) {
  const addr = String(address || '').trim();
  if (!looksLikeContractAddress(addr) || addr.startsWith('0x')) return '';
  return `https://gmgn.ai/sol/token/${addr}`;
}

/**
 * Legacy helper — Solana → GMGN; other chains → DexScreener (same as detail policy).
 */
function getGmgnUrl(chain, address) {
  return getTokenMarketDetailUrl({ chain, address });
}

/**
 * Memecoin + Othercoin 详情点击统一路由（强制有效链接）：
 *   - Solana  → GMGN 该合约行情页
 *   - 所有 EVM / 非 Sol  → DexScreener 该合约行情页
 *                绝不落到 gmgn.ai/base|bsc|eth（那是数据源 url，不是详情策略）
 * Accepts token object or (chain, address[, pairAddress]).
 * Optional 3rd arg: boardChain (selected tab) when token.chain missing.
 */
function getTokenMarketDetailUrl(tokenOrChain, addressMaybe, pairOrBoardMaybe) {
  let chain = '';
  let address = '';
  let pairAddress = '';
  let symbol = '';
  let existingUrl = '';
  let boardChain = '';

  if (tokenOrChain && typeof tokenOrChain === 'object') {
    const t = tokenOrChain;
    chain = normalizeMarketChain(t.chain);
    address = String(t.address || t.tokenAddress || t.baseAddress || '').trim();
    pairAddress = String(t.pairAddress || t.poolAddress || '').trim();
    symbol = String(t.symbol || t.name || '').replace(/USDT$/i, '').trim();
    existingUrl = String(t.url || t.dexscreenerUrl || t.marketUrl || '').trim();
    // Prefer selected board when token.chain empty/wrong
    boardChain = normalizeMarketChain(
      typeof addressMaybe === 'string' && !addressMaybe.startsWith('0x')
        ? addressMaybe
        : (typeof state !== 'undefined' ? state.currentChain : '')
    );
  } else {
    chain = normalizeMarketChain(tokenOrChain);
    address = String(addressMaybe || '').trim();
    pairAddress = String(pairOrBoardMaybe || '').trim();
  }

  if (!chain && boardChain) chain = boardChain;
  // If still empty but board is EVM, use board (fixes Base tab tokens missing chain stamp)
  if (!chain && typeof state !== 'undefined') {
    chain = normalizeMarketChain(state.currentChain);
  }

  // --- Solana → GMGN only ---
  if (chain === 'solana') {
    const mint = looksLikeContractAddress(address) && !normalizeEvmAddress(address)
      ? address
      : looksLikeContractAddress(pairAddress) && !normalizeEvmAddress(pairAddress)
        ? pairAddress
        : '';
    const gmgn = getGmgnSolanaUrl(mint || address);
    if (gmgn) return gmgn;
  }

  // --- EVM / non-Solana → ALWAYS DexScreener (ignore gmgn.ai urls from API) ---
  const isEvm = EVM_DEXSCREENER_CHAINS.has(chain) || chain === 'base' || chain === 'bsc' || chain === 'ethereum';

  // Only reuse existing URL if it is already a valid DexScreener chart for this chain
  if (isEvm || (chain && chain !== 'solana')) {
    const parsed = parseDexScreenerUrl(existingUrl);
    if (parsed) {
      const parsedChain = normalizeMarketChain(parsed.chain);
      // Accept if same chain family, or existing DS url when chain unknown
      if (!chain || parsedChain === chain || DEXSCREENER_CHAIN_SLUG[parsedChain] === DEXSCREENER_CHAIN_SLUG[chain]) {
        const rebuilt = getDexScreenerTokenUrl(parsedChain || chain, parsed.address, '');
        if (rebuilt) return rebuilt;
      }
    }

    // Build from contract — force DexScreener, never GMGN for Base/ETH/BSC/…
    const ds = getDexScreenerTokenUrl(chain, address, pairAddress);
    if (ds) return ds;

    // Try extract 0x from any url field (including gmgn.ai/base/token/0x…)
    const fromGmgnPath = String(existingUrl).match(/0x[a-fA-F0-9]{40}/i);
    if (fromGmgnPath && chain) {
      const ds2 = getDexScreenerTokenUrl(chain, fromGmgnPath[0], '');
      if (ds2) return ds2;
    }
  }

  // multi / CEX stub without on-chain address → search (last resort)
  if (existingUrl && /dexscreener\.com\/search/i.test(existingUrl)) return existingUrl;
  const q = symbol || normalizeEvmAddress(address) || address || pairAddress || '';
  return q
    ? `https://dexscreener.com/search?q=${encodeURIComponent(q)}`
    : 'https://dexscreener.com/';
}

/** Button label for market detail link */
function getMarketDetailLabel(chain) {
  return normalizeMarketChain(chain) === 'solana' ? 'GMGN' : 'DexScreener';
}

/**
 * Othercoin「查看」— same policy as Memecoin detail (Sol→GMGN, else→DexScreener).
 */
function getOthercoinDexScreenerUrl(token) {
  return getTokenMarketDetailUrl(token);
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

/**
 * Compact clock/date duration for UI (已追踪 etc).
 * Uses d/h/m/s units, keeps at most 2 significant units, no spaces.
 * e.g. 6224m31s → 4d7h ; 3h12m5s → 3h12m ; 45m → 45m ; 31s → 31s
 */
function formatDuration(ms) {
  let totalSec = Math.floor(Number(ms) / 1000);
  if (!Number.isFinite(totalSec) || totalSec < 0) totalSec = 0;
  if (totalSec < 60) return `${totalSec}s`;

  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  // Prefer largest units; at most 2 parts for minimal character width
  if (days >= 1) {
    if (hours >0) return `${days}d${hours}h`;
    if (minutes >0 && days < 3) return `${days}d${minutes}m`;
    return `${days}d`;
  }
  if (hours >= 1) {
    if (minutes >0) return `${hours}h${minutes}m`;
    return `${hours}h`;
  }
  // under 1h: show m, append s only when under 10m (still useful)
  if (minutes >= 10) return `${minutes}m`;
  if (seconds >0) return `${minutes}m${seconds}s`;
  return `${minutes}m`;
}

// ===== Toast =====
function showToast(message, type = 'info') {
  const icons = { success: '', error: '', info: '', warning: '' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type]}</span><span class="toast-message">${message}</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
  dom.toastContainer.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() =>toast.remove(), 300);
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
  // 主模块顺序：1 memecoin · 2 altcoin · 3 bitcoin（兼容旧 id othercoin）
  if (page === 'othercoin') page = 'altcoin';
  if (page === state.currentPage) return;
  state.currentPage = page;

  // Update tabs
  dom.pageTabs.forEach((tab) => {
    const id = tab.dataset.page === 'othercoin' ? 'altcoin' : tab.dataset.page;
    tab.classList.toggle('active', id === page);
  });

  // Show/hide page content
  Object.entries(dom.pageContents).forEach(([key, el]) => {
    if (!el) return;
    const id = key === 'othercoin' ? 'altcoin' : key;
    el.classList.toggle('active', id === page);
  });

  // Update header brand line
  if (dom.logoSubtitle) {
    dom.logoSubtitle.textContent = 'multi trader';
  }

  // Chain tabs = Memecoin only (Altcoin is CEX multi-market, not per-chain)
  const chainNav = document.getElementById('chainTabs');
  if (chainNav) chainNav.style.display = page === 'memecoin' ? '' : 'none';

  // Signal ticker only on Memecoin
  if (page !== 'memecoin') {
    stopSignalTicker();
    if (dom.signalTicker) dom.signalTicker.hidden = true;
  } else {
    renderMemecoinSignals();
  }

  // Load data for the page
  if (page === 'memecoin') {
    loadMemecoinData(state.currentChain);
  } else if (page === 'altcoin') {
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
  return smartNetInflow >0 || buyVolume >0 || (shortVolume >0 && buys >sells) || (buys >0 && sells === 0);
}

function shouldCleanupZeroNoInflow(tracked = {}, now = Date.now()) {
  const lastPrice = getTrackedLastPrice(tracked);
  if (!(Number.isFinite(lastPrice) && lastPrice <= Number.EPSILON)) return false;
  const lastInflowAt = Number(tracked.lastCapitalInflowAt || tracked.signalAt || 0);
  return lastInflowAt >0 && now - lastInflowAt >= state.zeroNoInflowCleanupMs;
}

/**
 * Build / append a settled outcome from signal buy-point. Dedupes by key+signalAt.
 */
function recordSignalOutcome(tracked, extra = {}) {
  if (!tracked) return null;
  const engine = window.SignalEngine;
  const key = getTrackingKey(tracked.address, tracked.chain);
  const evalOpts = {
    now: extra.now || Date.now(),
    forceSettle: true,
    invalidReason: extra.invalidReason || tracked.invalidReason || '',
    retentionMs: getTrackedRetentionMs(tracked, extra.now || Date.now()),
  };
  const outcome = engine?.evaluateSignalOutcome
    ? engine.evaluateSignalOutcome(tracked, evalOpts)
    : {
        status: extra.invalidReason ? 'invalid' : 'flat',
        isSettled: true,
        isWin: false,
        isLoss: !!extra.invalidReason,
        maxGain: 0,
        currentChange: 0,
        patternKey: `${tracked.signalReason || 'unknown'}|C|-`,
      };

  const row = {
    id: `${key}|${tracked.signalAt}`,
    key,
    symbol: tracked.symbol || '',
    chain: tracked.chain || '',
    address: tracked.address || '',
    signalAt: tracked.signalAt,
    settledAt: Date.now(),
    status: outcome.status,
    tier: outcome.tier || '',
    isSettled: true,
    isWin: !!outcome.isWin,
    isLoss: !!outcome.isLoss,
    maxGain: Number(outcome.maxGain || 0),
    maxDrawdown: Number(outcome.maxDrawdown || 0),
    currentChange: Number(outcome.currentChange || 0),
    buyPrice: Number(tracked.priceAtSignal || outcome.buyPrice || 0),
    exitPrice: Number(tracked.currentPrice || 0),
    patternKey: outcome.patternKey || '',
    entryGrade: outcome.entryGrade || tracked.signalScoreSnapshot?.entryGrade || 'C',
    signalReason: tracked.signalReason || '',
    heatWindow: tracked.signalMeta?.heatWindow || '',
    invalidReason: extra.invalidReason || '',
    removeReason: extra.removeReason || '',
  };

  // Replace existing same signal
  const prevIdx = state.signalOutcomes.findIndex((o) =>o.id === row.id || (o.key === key && o.signalAt === tracked.signalAt));
  if (prevIdx >= 0) state.signalOutcomes[prevIdx] = row;
  else state.signalOutcomes.unshift(row);
  // Cap in memory
  if (state.signalOutcomes.length >250) state.signalOutcomes = state.signalOutcomes.slice(0, 250);
  return row;
}

function getOutcomeStatsCached() {
  const engine = window.SignalEngine;
  if (engine?.computeOutcomeStats) return engine.computeOutcomeStats(state.signalOutcomes);
  const total = state.signalOutcomes.length;
  const wins = state.signalOutcomes.filter((o) =>o.isWin).length;
  return { total, wins, losses: total - wins, winRate: total ? wins / total : 0, byPattern: {}, byGrade: {} };
}

/**
 * Remove tracked token after recording outcome (失效 / 到期 / 主动放弃).
 */
function removeTrackedWithOutcome(key, tracked, { invalidReason = '', removeReason = '', countInvalid = false } = {}) {
  if (tracked) {
    recordSignalOutcome(tracked, { invalidReason, removeReason });
  }
  delete state.trackedTokens[key];
  state.signals = state.signals.filter((s) =>getTrackingKey(s.tokenAddress, s.tokenChain) !== key);
  delete state.aiExpanded[key];
  if (countInvalid) state.sessionRemovedInvalid = (state.sessionRemovedInvalid || 0) + 1;
}

/**
 * 失效判定：相对买入点持续亏损，或市场死亡。
 * Returns reason string if should remove, else ''.
 */
function getInvalidReasonForTracked(tracked, now = Date.now()) {
  if (!tracked) return '空记录';
  if (shouldCleanupZeroNoInflow(tracked, now)) return '价格归零且长时间无资金流入';

  const engine = window.SignalEngine;
  const outcome = engine?.evaluateSignalOutcome
    ? engine.evaluateSignalOutcome(tracked, { now })
    : null;

  // Sustained break below buy point without ever soft-winning
  if (outcome && outcome.status === 'loss' && outcome.isSettled) {
    const brokeAt = Number(tracked.brokeBuyAt || 0);
    if (!brokeAt) {
      tracked.brokeBuyAt = now;
      return '';
    }
    if (now - brokeAt >= state.invalidLossHoldMs) {
      return `跌破买入点 ${(outcome.currentChange || 0).toFixed(1)}% 超过 ${Math.round(state.invalidLossHoldMs / 60000)} 分钟`;
    }
  } else if (outcome && (outcome.isWin || (outcome.currentChange || 0) > -10)) {
    // Recovered — clear break timer
    delete tracked.brokeBuyAt;
  }

  return '';
}

function pruneSignalTracking(now = Date.now()) {
  state.signals = state.signals.filter((s) =>s.active && (now - s.timestamp <= state.signalExpiryMs));
  for (const [key, tracked] of Object.entries(state.trackedTokens)) {
    if (!tracked) {
      delete state.trackedTokens[key];
      continue;
    }

    // 每次刷新：移除已失效
    const invalidReason = getInvalidReasonForTracked(tracked, now);
    if (invalidReason) {
      removeTrackedWithOutcome(key, tracked, {
        invalidReason,
        removeReason: 'invalid-refresh',
        countInvalid: true,
      });
      continue;
    }

    const retentionMs = getTrackedRetentionMs(tracked, now);
    if (now - tracked.signalAt >retentionMs) {
      // 24H 到期：强制结算胜负后移除
      removeTrackedWithOutcome(key, tracked, {
        removeReason: 'retention-expired',
      });
      continue;
    }

    tracked.historyStatus = now - tracked.signalAt <= state.signalExpiryMs ? 'active' : 'history';
    const historyLimit = tracked.moonshot?.active ? state.maxMoonshotPriceHistory : state.maxPriceHistory;
    tracked.priceHistory = (tracked.priceHistory || [])
      .filter((p) =>p && (p.time === tracked.signalAt || now - p.time <= retentionMs))
      .slice(-historyLimit);
    // 买入标注点始终保留
    if (!tracked.priceHistory.some((p) =>p.time === tracked.signalAt && p.price === tracked.priceAtSignal)) {
      tracked.priceHistory.unshift({ time: tracked.signalAt, price: tracked.priceAtSignal, marker: 'buy' });
    }

    // 已达明确胜利：写入 outcomes（仍可留在列表观察，不删）
    const live = window.SignalEngine?.evaluateSignalOutcome?.(tracked, { now });
    if (live?.isSettled && live.isWin && !tracked.outcomeRecorded) {
      recordSignalOutcome(tracked, { removeReason: 'live-win' });
      tracked.outcomeRecorded = true;
      tracked.outcomeStatus = live.status;
      tracked.outcomeTier = live.tier;
    } else if (live) {
      tracked.outcomeStatus = live.status;
      tracked.outcomeTier = live.tier;
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
      signalOutcomes: state.signalOutcomes,
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
    if (Array.isArray(prepared.signalOutcomes)) {
      state.signalOutcomes = prepared.signalOutcomes;
    }
  } catch (e) {
    console.warn('Failed to save signal tracking state:', e);
    try {
      const fallback = window.TrackingStorage?.prepareTrackingStateForStorage?.({
        savedAt: Date.now(),
        signalIdCounter: state.signalIdCounter,
        signals: state.signals.slice(0, 20),
        trackedTokens: state.trackedTokens,
        signalOutcomes: state.signalOutcomes.slice(0, 80),
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
    // Normalize legacy tokenChain (sol → solana) so chain filter works
    state.signals = state.signals.map((s) => ({
      ...s,
      tokenChain: normalizeChainId(s.tokenChain) || s.tokenChain || 'solana',
    }));
    state.trackedTokens = parsed.trackedTokens && typeof parsed.trackedTokens === 'object' ? parsed.trackedTokens : {};
    state.signalOutcomes = Array.isArray(parsed.signalOutcomes) ? parsed.signalOutcomes : [];
    pruneSignalTracking();
  } catch (e) {
    console.warn('Failed to load signal tracking state:', e);
    state.signals = [];
    state.trackedTokens = {};
    state.signalOutcomes = [];
  }
}

// --- Signal System ---

function detectSignals(tokens) {
  const newSignals = [];
  pruneSignalTracking();
  const engine = window.SignalEngine;
  const boardChain = normalizeChainId(state.currentChain);
  // 用历史买入点胜率优化本次选中
  const outcomeStats = getOutcomeStatsCached();

  for (const token of tokens) {
    // Hard isolation: never emit a signal for another chain on this board
    const tokenChain = normalizeChainId(token.chain || boardChain);
    if (boardChain && boardChain !== 'all' && tokenChain && tokenChain !== boardChain) continue;

    // Already tracking this token — do not re-fire
    const trackKey = getTrackingKey(token.address, tokenChain);
    if (state.trackedTokens[trackKey]) continue;

    const existingSignal = state.signals.find(
      (s) =>
        s.tokenAddress === token.address &&
        normalizeChainId(s.tokenChain) === tokenChain &&
        s.active
    );
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

    // 胜率反馈：过滤低胜率模式、抬高/压低分数门槛
    if (decision.fire && engine?.getSelectionAdvice && engine?.applySelectionAdvice) {
      const advice = engine.getSelectionAdvice(decision, outcomeStats, { minSamples: 5 });
      decision = engine.applySelectionAdvice(decision, advice, { baseScoreFloor: SIGNAL_THRESHOLDS.aiScore });
    }

    if (!decision.fire) continue;
    // Ensure token carries normalized chain before createSignal
    const sig = createSignal({ ...token, chain: tokenChain }, decision.reason, decision.text, decision.score);
    // Stamp Monitor heat window for AI module / ticker
    if (decision.heat?.primaryWindow) {
      sig.meta = {
        ...(sig.meta || {}),
        heatWindow: decision.heat.primaryWindow,
        heatWindows: decision.heat.windows || [],
        heatDetail: decision.heat.detail || '',
      };
    }
    if (decision.selectionAdvice) {
      sig.meta = {
        ...(sig.meta || {}),
        selectionAdvice: decision.selectionAdvice,
      };
    }
    newSignals.push(sig);
  }
  for (const signal of newSignals) {
    state.signalIdCounter++;
    signal.id = state.signalIdCounter;
    state.signals.push(signal);
    startTrackingToken(signal);
    // No long toast — ticker frame is the alert surface
  }
  if (newSignals.length >0) {
    saveSignalTracking();
    // New signals → actively show the frame
    renderMemecoinSignals({ forceShow: true });
  } else {
    renderMemecoinSignals();
  }
}

function createSignal(token, reason, reasonText, scoreSnapshot = null) {
  // Stamp chain from token data, fall back to selected board — always normalized
  const actualChain = normalizeChainId(token.chain || state.currentChain) || state.currentChain;
  const buyPercent = calculateBuyPercent(token);
  const signalScoreSnapshot = scoreSnapshot || window.SignalEngine?.scoreTokenSignal(token) || null;
  const heatWindow =
    signalScoreSnapshot?.heat?.primaryWindow ||
    (String(reason || '').includes('5m') ? '5m' : String(reason || '').includes('1h') ? '1h' : '15m');
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
      // Monitor Smart Net Inflow
      smartNetInflow5m: token.smartNetInflow5m,
      smartNetInflow15m: token.smartNetInflow15m,
      smartNetInflow1h: token.smartNetInflow1h,
      // Monitor KOL Net Inflow
      kolNetInflow5m: token.kolNetInflow5m,
      kolNetInflow15m: token.kolNetInflow15m,
      kolNetInflow1h: token.kolNetInflow1h,
      volume5m: token.volume5m,
      volume15m: token.volume15m,
      newWallets5m: token.newWallets5m,
      newWallets15m: token.newWallets15m,
      smartWallets5m: token.smartWallets5m,
      smartWallets15m: token.smartWallets15m,
      smartWallets1h: token.smartWallets1h,
      kolWallets5m: token.kolWallets5m,
      kolWallets15m: token.kolWallets15m,
      kolWallets1h: token.kolWallets1h,
      smartCount: token.smartCount ?? token.smart_degen_count,
      top10Holders: token.top10Holders ?? token.top10,
      isHoneypot: !!token.isHoneypot,
      isRug: !!token.isRug,
      isBan: !!token.isBan,
      security: token.security || null,
      kolSource: token.kolSource || null,
      kolHandlesUnique: token.kolHandlesUnique || null,
      // Top SM/KOL wallets on this token (1h) for 钱包画像
      topWallets: Array.isArray(token.topWallets) ? token.topWallets.slice(0, 6) : [],
      buyPercent,
      dataQuality: token.dataQuality,
      hasSmartMoneyData: token.hasSmartMoneyData,
      securityChecked: !!token.securityChecked,
      heatWindow,
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
  const sellPercent = total >0 ? (sells / total) * 100 : Number(previous.sellPercent || 0);
  const smartCount = Number(token.smartCount ?? token.smart_degen_count ?? previous.smartCount ?? 0);
  const previousSmartCount = Number(previous.smartCount ?? smartCount);
  const smartCountDrop = previousSmartCount >0 ? ((previousSmartCount - smartCount) / previousSmartCount) * 100 : 0;
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
  if (zeroPrice && lastInflowAt >0 && now - lastInflowAt >= state.zeroNoInflowCleanupMs) return '价格归零且4小时无资金流入';
  if (!zeroPrice && a.liquidity <= 0 && a.volume <= 0) return '流动性和成交额均为 0';
  if (!zeroPrice && a.volume <= 0 && a.totalTxns <= 0) return '无成交量且无买卖交易';
  return '';
}

function abandonTrackedTarget(key, tracked, reason) {
  removeTrackedWithOutcome(key, tracked, {
    invalidReason: reason || '市场失效',
    removeReason: 'abandon-refresh',
    countInvalid: true,
  });
  if (tracked?.symbol) showToast(`已移除失效 ${tracked.symbol}: ${reason}`, 'warning');
}

function maybeRaiseMoonshotSelloffAlert(key, tracked, token, now = Date.now()) {
  if (!tracked?.moonshot?.active || tracked.moonshot.selloffAlertedAt) return false;
  const analysis = analyzeTrackedToken(tracked, false, now);
  const maxGain = Math.max(Number(tracked.moonshot.maxGain || 0), analysis.maxGain || 0);
  const dropFromPeak = maxGain >0 ? maxGain - analysis.currentChange : 0;
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
  showToast(`${tracked.symbol} 高收益回撤：聪明钱多数卖出`, 'warning');
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
    // 信号发出时刻 = 买入标注点（胜负统计基准）
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
    outcomeStatus: 'pending',
    outcomeTier: '观察中',
    outcomeRecorded: false,
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

/** Normalize chain id for signal isolation (sol / SOL / solana → solana) */
function normalizeChainId(chain) {
  const c = String(chain || '').toLowerCase().trim();
  if (!c) return '';
  if (c === 'sol' || c === 'solana') return 'solana';
  if (c === 'eth' || c === 'ethereum') return 'ethereum';
  if (c === 'bnb' || c === 'bsc' || c === 'bnb-chain') return 'bsc';
  if (c === 'rh' || c === 'hood' || c === 'robinhood') return 'robinhood';
  if (c === 'base') return 'base';
  if (c === 'all' || c === 'multi') return c;
  return c;
}

/** Active signals for the currently selected network only */
function getVisibleMemecoinSignals() {
  const want = normalizeChainId(state.currentChain);
  const active = (state.signals || []).filter((s) =>s && s.active);
  if (!want || want === 'all') return active;
  return active.filter((s) =>normalizeChainId(s.tokenChain) === want);
}

/**
 * Brief signal parts for mini frame: name + % only (no SM / KOL in ticker)
 */
function getBriefSignalParts(signal) {
  const name = String(signal.tokenSymbol || signal.tokenName || '?').slice(0, 10);
  const meta = signal.meta || {};
  let pct = Number(meta.priceChange1h);
  if (!Number.isFinite(pct) || pct === 0) pct = Number(meta.priceChange24h);
  if (!Number.isFinite(pct)) pct = NaN;
  return { name, pct };
}

/** Ultra-brief line: "PEPE · +18.2%" — SM/KOL never shown in mini ticker */
function formatBriefSignalText(signal) {
  const { name, pct } = getBriefSignalParts(signal);
  const parts = [name];
  if (Number.isFinite(pct) && pct !== 0) {
    parts.push(`${pct >0 ? '+' : ''}${pct.toFixed(1)}%`);
  }
  return parts.join(' · ');
}

function stopSignalTicker() {
  if (state.signalTickerTimer) {
    clearInterval(state.signalTickerTimer);
    state.signalTickerTimer = null;
  }
}

function clearSignalTickerHideTimer() {
  if (state.signalTickerHideTimer) {
    clearTimeout(state.signalTickerHideTimer);
    state.signalTickerHideTimer = null;
  }
}

/** 3s no click & no hover → auto hide (signals stay in memory) */
function resetSignalTickerIdleTimer() {
  clearSignalTickerHideTimer();
  if (!dom.signalTicker || dom.signalTicker.hidden) return;
  if (state.signalTickerHovering) return;
  state.signalTickerHideTimer = setTimeout(() => {
    if (state.signalTickerHovering) return;
    hideSignalTickerFrame();
  }, state.signalTickerIdleHideMs || 3000);
}

function hideSignalTickerFrame() {
  clearSignalTickerHideTimer();
  if (!dom.signalTicker) return;
  dom.signalTicker.classList.add('is-hiding');
  setTimeout(() => {
    if (!dom.signalTicker) return;
    dom.signalTicker.hidden = true;
    dom.signalTicker.classList.remove('is-hiding');
  }, 220);
}

/** Show frame; forceShow from new signals */
function showSignalTickerFrame() {
  if (!dom.signalTicker) return;
  dom.signalTicker.classList.remove('is-hiding');
  dom.signalTicker.hidden = false;
  // Soft enter (React Bits Fade/list feel) — restarts when re-shown
  dom.signalTicker.classList.remove('is-entering');
  void dom.signalTicker.offsetWidth;
  dom.signalTicker.classList.add('is-entering');
  resetSignalTickerIdleTimer();
}

function buildSignalTickerList(signals) {
  if (!dom.signalTickerList) return;
  const frag = document.createDocumentFragment();
  signals.forEach((signal, idx) => {
    const { name, pct } = getBriefSignalParts(signal);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'signal-ticker-item' + (idx === state.signalTickerIndex ? ' is-active' : '');
    btn.style.setProperty('--i', String(Math.min(idx, 12)));
    btn.dataset.signalId = String(signal.id);
    btn.dataset.address = signal.tokenAddress || '';
    btn.dataset.chain = normalizeChainId(signal.tokenChain) || '';
    btn.dataset.symbol = signal.tokenSymbol || '';
    btn.title = '点击定位到代币列表';

    // Mini frame: name + % only — no SM / KOL tags
    let html = `<span class="signal-ticker-item-text">${name}</span>`;
    if (Number.isFinite(pct) && pct !== 0) {
      const cls = pct >= 0 ? 'signal-ticker-item-pct' : 'signal-ticker-item-pct down';
      html += `<span class="${cls}">${pct >0 ? '+' : ''}${pct.toFixed(1)}%</span>`;
    }
    btn.innerHTML = html;
    btn.addEventListener('click', () => {
      state.signalTickerIndex = idx;
      highlightTickerActive(signals);
      resetSignalTickerIdleTimer(); // user click — restart 3s idle
      focusTokenFromSignal({
        tokenAddress: signal.tokenAddress,
        tokenChain: signal.tokenChain,
        tokenSymbol: signal.tokenSymbol,
        address: signal.tokenAddress,
        chain: signal.tokenChain,
        symbol: signal.tokenSymbol,
      });
    });
    frag.appendChild(btn);
  });
  dom.signalTickerList.innerHTML = '';
  dom.signalTickerList.appendChild(frag);
}

function highlightTickerActive(signals) {
  if (!dom.signalTickerList) return;
  const items = dom.signalTickerList.querySelectorAll('.signal-ticker-item');
  const i = signals.length
    ? ((state.signalTickerIndex % signals.length) + signals.length) % signals.length
    : 0;
  items.forEach((el, idx) => {
    el.classList.toggle('is-active', idx === i);
    if (idx === i) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      if (dom.signalTickerBody) {
        dom.signalTickerBody.dataset.signalId = el.dataset.signalId || '';
        dom.signalTickerBody.dataset.address = el.dataset.address || '';
        dom.signalTickerBody.dataset.chain = el.dataset.chain || '';
        dom.signalTickerBody.dataset.symbol = el.dataset.symbol || '';
      }
      if (dom.signalTickerText) {
        const sig = signals[i];
        if (sig) dom.signalTickerText.textContent = formatBriefSignalText(sig);
      }
    }
  });
}

function showSignalTickerItem(signals, index) {
  if (!signals.length) return;
  const i = ((index % signals.length) + signals.length) % signals.length;
  state.signalTickerIndex = i;
  // Rebuild if count changed
  const existing = dom.signalTickerList?.querySelectorAll('.signal-ticker-item').length || 0;
  if (existing !== signals.length) {
    buildSignalTickerList(signals);
  }
  highlightTickerActive(signals);
}

function startSignalTicker(signals) {
  stopSignalTicker();
  if (!signals.length) return;
  if (dom.signalTickerCount) dom.signalTickerCount.textContent = String(signals.length);
  buildSignalTickerList(signals);
  showSignalTickerItem(signals, state.signalTickerIndex);
  if (signals.length <= 1) return;
  state.signalTickerTimer = setInterval(() => {
    const list = getVisibleMemecoinSignals();
    if (!list.length) {
      stopSignalTicker();
      hideSignalTickerFrame();
      return;
    }
    // Don't rotate while hidden
    if (dom.signalTicker?.hidden) return;
    if (dom.signalTickerCount) dom.signalTickerCount.textContent = String(list.length);
    state.signalTickerIndex = (state.signalTickerIndex + 1) % list.length;
    showSignalTickerItem(list, state.signalTickerIndex);
  }, state.signalTickerRotateMs);
}

/**
 * Click ticker → Memecoin page, scroll to token list, highlight row 1s
 */
function focusTokenFromSignal(signalOrMeta) {
  const address = String(signalOrMeta.tokenAddress || signalOrMeta.address || '').trim();
  const chain = normalizeChainId(signalOrMeta.tokenChain || signalOrMeta.chain || state.currentChain);
  const symbol = String(signalOrMeta.tokenSymbol || signalOrMeta.symbol || '').toUpperCase();

  // Ensure Memecoin page
  if (state.currentPage !== 'memecoin' && typeof switchPage === 'function') {
    switchPage('memecoin');
  }

  const section = document.getElementById('hotTokensSection');
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Find row: address match first, then symbol
  const rows = dom.tokenList?.querySelectorAll('.token-row[data-token-address], .token-row') || [];
  let target = null;
  const addrLower = address.toLowerCase();
  for (const row of rows) {
    const ra = String(row.dataset.tokenAddress || '').toLowerCase();
    const rc = normalizeChainId(row.dataset.tokenChain || '');
    if (addrLower && ra === addrLower && (!chain || !rc || rc === chain)) {
      target = row;
      break;
    }
  }
  if (!target && symbol) {
    for (const row of rows) {
      if (String(row.dataset.tokenSymbol || '').toUpperCase() === symbol) {
        target = row;
        break;
      }
    }
  }
  // Fallback: match from state.tokens and query by data attr after re-render
  if (!target && address) {
    const tok = (state.tokens || []).find(
      (t) =>
        String(t.address || '').toLowerCase() === addrLower &&
        (!chain || normalizeChainId(t.chain) === chain || !t.chain)
    );
    if (tok) {
      // wait a frame for DOM
      requestAnimationFrame(() => {
        const row = dom.tokenList?.querySelector(
          `.token-row[data-token-address="${CSS.escape(tok.address)}"]`
        );
        if (row) flashTokenRow(row);
      });
      return;
    }
  }
  if (target) flashTokenRow(target);
  else showToast(`未在当前列表找到 ${symbol || address.slice(0, 8)}`, 'info');
}

function flashTokenRow(row) {
  if (!row) return;
  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row.classList.remove('token-row-signal-flash');
  // reflow to restart animation
  void row.offsetWidth;
  row.classList.add('token-row-signal-flash');
  setTimeout(() => {
    row.classList.remove('token-row-signal-flash');
  }, state.signalFlashMs || 1000);
}

/**
 * @param {{ forceShow?: boolean }} [opts]
 * forceShow: new signal arrived → open frame and reset 3s idle hide
 */
function renderMemecoinSignals(opts = {}) {
  pruneSignalTracking();

  // ONLY show signals for the selected chain tab
  const visibleSignals = getVisibleMemecoinSignals();

  if (dom.signalCount) dom.signalCount.textContent = visibleSignals.length;

  // Hide legacy in-page card list (ticker is the alert surface)
  if (dom.signalsList) dom.signalsList.innerHTML = '';
  if (dom.signalsEmpty) dom.signalsEmpty.style.display = 'none';

  // Compact bottom-right frame — only on Memecoin page
  if (!dom.signalTicker) return;
  if (state.currentPage !== 'memecoin' || visibleSignals.length === 0) {
    stopSignalTicker();
    clearSignalTickerHideTimer();
    if (dom.signalTicker) {
      dom.signalTicker.hidden = true;
      dom.signalTicker.classList.remove('is-hiding');
    }
    return;
  }

  // Keep index in range
  if (state.signalTickerIndex >= visibleSignals.length) state.signalTickerIndex = 0;

  // New signals force show; otherwise only refresh content if already visible
  if (opts.forceShow) {
    showSignalTickerFrame();
    startSignalTicker(visibleSignals);
  } else if (!dom.signalTicker.hidden) {
    startSignalTicker(visibleSignals);
    resetSignalTickerIdleTimer();
  }
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
    if (!(price >0)) return false;
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
    // Immediately filter 实时信号 to selected network (hide Solana cards on BSC etc.)
    state.currentChain = requestChain;
    renderMemecoinSignals();
  } else {
    setStatus('loading');
  }

  try {
    const data = await fetchMemecoinApi(requestChain);
    // Stale response (user already switched chain)
    if (loadId !== state.memecoinLoadId) return;
    if (!data.success || !Array.isArray(data.data)) throw new Error('API返回数据格式异常');

    const filtered = filterMemecoinTokens(data.data, requestChain);
    // Force stamp request chain so signals never inherit wrong network (e.g. always sol)
    const stamped = filtered.map((t) => ({
      ...t,
      chain: requestChain === 'all' ? normalizeChainId(t.chain) || t.chain : requestChain,
    }));

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
    // Guarantee 实时信号 panel matches current chain even if no new fires
    renderMemecoinSignals();

    setStatus(''); // green light only — no quality 说明
    dom.loadingState.style.display = 'none';
    if (stamped.length === 0) {
      dom.tokenList.innerHTML = `<div class="empty-state"><div class="empty-icon"></div><p>${requestChain} 暂无合格代币（已过滤低质/错链）</p></div>`;
    }
  } catch (err) {
    if (loadId !== state.memecoinLoadId) return;
    console.error('Memecoin load error:', err);
    state.error = err.message;
    if (state.retryCount < state.maxRetries && !isRetry) {
      state.retryCount++;
      setStatus('loading');
      setTimeout(() =>loadMemecoinData(requestChain, true), 1500);
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
    const found = tokens.find((t) =>getTrackingKey(t.address, t.chain || state.currentChain) === key);
    const abandonReason = getAbandonReasonForTracked(found, tracked, now);
    if (abandonReason) {
      abandonTrackedTarget(key, tracked, abandonReason);
      abandoned++;
      continue;
    }

    if (!found) {
      const lastKnown = tracked.currentPrice || tracked.priceAtSignal || 0;
      if (lastKnown >0) tracked.priceHistory.push({ time: now, price: lastKnown, carried: true });
      tracked.historyStatus = now - tracked.signalAt <= state.signalExpiryMs ? 'active' : 'history';
      const retentionMs = getTrackedRetentionMs(tracked, now);
      const historyLimit = tracked.moonshot?.active ? state.maxMoonshotPriceHistory : state.maxPriceHistory;
      tracked.priceHistory = tracked.priceHistory
        .filter((p) =>p && (p.time === tracked.signalAt || now - p.time <= retentionMs))
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
      .filter((p) =>p && (p.time === tracked.signalAt || now - p.time <= retentionMs))
      .slice(-historyLimit);
  }
  if (abandoned >0) {
    renderMemecoinSignals();
  }
  saveSignalTracking();
}

// --- Token Rendering ---

function renderMemecoinSortedTokens(tokens) {
  // Hard UI cap: never show more than Top 20
  const capped = (tokens || []).slice(0, state.memecoinLimit || 20);
  const sorted = [...capped].sort((a, b) => {
    switch (state.sortBy) {
      case 'value': {
        // Prefer explicit valueScore; fall back to server rank order
        if (Number.isFinite(Number(a.valueScore)) || Number.isFinite(Number(b.valueScore))) {
          return (Number(b.valueScore) || 0) - (Number(a.valueScore) || 0);
        }
        return (Number(a.rank) || 999) - (Number(b.rank) || 999);
      }
      case 'volume': { return (b.volume24h || b.volume1h || 0) - (a.volume24h || a.volume1h || 0); }
      case 'priceChange': { return Math.abs(b.priceChange1h || 0) - Math.abs(a.priceChange1h || 0); }
      case 'buyRatio': { return calculateBuyPercent(b) - calculateBuyPercent(a); }
      default: return (Number(a.rank) || 999) - (Number(b.rank) || 999);
    }
  });
  dom.hotCount.textContent = sorted.length;
  renderMemecoinTokenRows(sorted);
}

function renderMemecoinTokenRows(tokens) {
  if (!tokens || tokens.length === 0) {
    dom.tokenList.innerHTML = '<div class="empty-state"><div class="empty-icon"></div><p>暂无代币数据</p></div>';
    return;
  }
  const fragment = document.createDocumentFragment();
  tokens.forEach((token, index) => {
    const row = document.createElement('div');
    row.className = 'token-row';
    // List stagger: first 20 rows only (React Bits Animated List–style, capped for perf)
    row.style.animationDelay = `${Math.min(index, 20) * 0.028}s`;
    // Prefer token.chain; fall back to selected board so Base tab never loses chain stamp
    const tokenChain = normalizeMarketChain(token.chain || state.currentChain) || state.currentChain;
    row.dataset.tokenAddress = token.address || '';
    row.dataset.tokenChain = tokenChain || '';
    row.dataset.tokenSymbol = token.symbol || '';
    const rankEmoji = index + 1;
    const iconHtml = getTokenIcon(token);
    const tokenForLink = { ...token, chain: tokenChain };
    const explorerUrl = getExplorerUrl(tokenChain, token.address);
    // 详情/行情：Solana→GMGN，所有 EVM（含 Base）→ DexScreener 合约页
    const marketUrl = getTokenMarketDetailUrl(tokenForLink);
    const marketLabel = getMarketDetailLabel(tokenChain);
    const buyPercent = calculateBuyPercent(token);
    const chainBadge = getChainBadgeHtml(tokenChain);
    const qualityBits = [];
    if (token.isHoneypot || token.isRug) qualityBits.push('<span class="chain-badge multi" title="高风险">风险</span>');
    else if (token.securityChecked) qualityBits.push('<span class="chain-badge base" title="已抽检 security">SEC</span>');
    if (token.hasSmartMoneyData) qualityBits.push('<span class="chain-badge sol" title="含聪明钱富化">SM</span>');
    else qualityBits.push('<span class="chain-badge multi" title="无聪明钱富化">无SM</span>');
    if (token.fromTrenches) qualityBits.push('<span class="chain-badge bsc" title="Trenches 新盘">新</span>');
    if (token.fromHotSearch) qualityBits.push('<span class="chain-badge robinhood" title="Hot Search">热搜</span>');
    if (Number(token.valueScore) >0) {
      const vs = Math.round(Number(token.valueScore));
      const tip = (token.valueReasons || []).slice(0, 3).join(' · ') || '多源价值分';
      qualityBits.push(`<span class="chain-badge sol" title="价值分 ${vs} · ${tip}">V${vs}</span>`);
    }
    if (Number(token.sourceHitCount) >= 2) {
      qualityBits.push(`<span class="chain-badge multi" title="多平台命中 ${token.sourceHitCount}">×${token.sourceHitCount}</span>`);
    }
    const qualityHtml = qualityBits.join('');
    row.innerHTML = `
      <div class="td ${index < 3 ? 'rank-cell top-3' : 'rank-cell'}">${rankEmoji}</div>
      <div class="td token-cell">
        <div class="token-icon">${iconHtml}</div>
        <div class="token-info">
          <span class="token-symbol" title="${token.name || ''}">${token.symbol || 'Unknown'}</span>
          <span class="token-name">${token.name || shortAddress(token.address)} ${qualityHtml}</span>
          <div class="token-links"><a href="${marketUrl}" target="_blank" rel="noopener" class="token-link" title="${marketUrl}">${marketLabel}</a><button class="token-copy-btn" onclick="copyAddress('${token.address}', event)" title="复制合约地址">复制</button></div>
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
      <div class="td actions-cell"><a href="${marketUrl}" target="_blank" rel="noopener" class="action-btn primary" title="${marketUrl}">详情</a><a href="${explorerUrl}" target="_blank" rel="noopener" class="action-btn">链上</a></div>`;
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
      btn.textContent = '已复制';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '复制';
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
  const totalVolume = tokens.reduce((sum, t) =>sum + (t.volume24h != null ? t.volume24h : (t.volume1h ?? 0)), 0);
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
  const points = (tracked.priceHistory || []).filter((p) =>p && p.price != null && Number(p.price) >0);
  const prices = points.map((p) =>Number(p.price));
  if (base >0) prices.push(base);
  if (current >0) prices.push(current);
  const maxPrice = prices.length ? Math.max(...prices) : current;
  const minPrice = prices.length ? Math.min(...prices) : current;
  const currentChange = base >0 ? ((current - base) / base) * 100 : 0;
  const maxGain = base >0 ? ((maxPrice - base) / base) * 100 : 0;
  const maxDrawdown = base >0 ? ((minPrice - base) / base) * 100 : 0;
  return { base, current, currentChange, maxGain, maxDrawdown, maxPrice, minPrice };
}

function analyzeTrackedToken(tracked, isActive, now = Date.now()) {
  const perf = getTrackedPerformance(tracked);
  const meta = tracked.signalMeta || {};
  const signalSnapshot = tracked.signalScoreSnapshot || meta.signalScoreSnapshot || null;
  const buyPercent = Number(
    signalSnapshot?.buyPercent ?? meta.buyPercent
  );
  const volume = Number(meta.volume24h ?? meta.volume1h ?? 0);
  const liquidity = Number(meta.liquidity || 0);
  const priceChange1h = Number(meta.priceChange1h || 0);
  const elapsed = now - tracked.signalAt;

  let phase = '可观察';
  if (perf.currentChange >= 80) phase = '高位加速';
  else if (perf.currentChange >= 30) phase = '突破加速';
  else if (perf.currentChange >= 8) phase = '趋势延续';
  else if (perf.currentChange <= -15) phase = '跌破买入点';
  else if (!isActive && elapsed >state.signalExpiryMs) phase = '历史观察';

  // Rebuild security + resonance from snapshot / signal meta (GMGN real fields)
  const engine = window.SignalEngine;
  const tokenLike = {
    ...meta,
    security: meta.security || signalSnapshot?.security || null,
    securityChecked: meta.securityChecked ?? signalSnapshot?.securityChecked,
    isHoneypot: meta.isHoneypot ?? signalSnapshot?.security?.isHoneypot,
    isRug: meta.isRug ?? signalSnapshot?.security?.isRug,
    isBan: meta.isBan ?? signalSnapshot?.security?.isBan,
    top10Holders: meta.top10Holders ?? signalSnapshot?.security?.top10Holders,
    hasSmartMoneyData: meta.hasSmartMoneyData ?? signalSnapshot?.hasSmartMoneyData,
    dataQuality: meta.dataQuality ?? signalSnapshot?.dataQuality,
    smartCount: meta.smartCount ?? signalSnapshot?.monitor?.smartCount,
    smartNetInflow5m: meta.smartNetInflow5m ?? signalSnapshot?.monitor?.smartNetInflow5m,
    smartNetInflow15m: meta.smartNetInflow15m ?? signalSnapshot?.monitor?.smartNetInflow15m,
    smartNetInflow1h: meta.smartNetInflow1h ?? signalSnapshot?.monitor?.smartNetInflow1h,
    kolNetInflow5m: meta.kolNetInflow5m ?? signalSnapshot?.monitor?.kolNetInflow5m,
    kolNetInflow15m: meta.kolNetInflow15m ?? signalSnapshot?.monitor?.kolNetInflow15m,
    kolNetInflow1h: meta.kolNetInflow1h ?? signalSnapshot?.monitor?.kolNetInflow1h,
    smartWallets5m: meta.smartWallets5m ?? signalSnapshot?.monitor?.smartWallets5m,
    smartWallets15m: meta.smartWallets15m ?? signalSnapshot?.monitor?.smartWallets15m,
    kolWallets5m: meta.kolWallets5m ?? signalSnapshot?.monitor?.kolWallets5m,
    kolWallets15m: meta.kolWallets15m ?? signalSnapshot?.monitor?.kolWallets15m,
    kolSource: meta.kolSource,
    volume5m: meta.volume5m,
    volume15m: meta.volume15m,
    volume1h: meta.volume1h,
    newWallets5m: meta.newWallets5m,
    newWallets15m: meta.newWallets15m,
  };

  const security =
    signalSnapshot?.security && signalSnapshot.security.summary
      ? signalSnapshot.security
      : engine?.buildSecurityReport
        ? engine.buildSecurityReport(tokenLike, {
            riskScore: signalSnapshot?.riskScore,
            riskLevel: signalSnapshot?.riskLevel,
            riskFlags: signalSnapshot?.riskFlags || [],
            securityChecked: tokenLike.securityChecked,
          })
        : null;

  const resonance =
    signalSnapshot?.resonance && signalSnapshot.resonance.summary
      ? signalSnapshot.resonance
      : engine?.buildResonanceReport
        ? engine.buildResonanceReport(tokenLike, signalSnapshot?.monitor || null)
        : null;

  // Fallback only if engine helpers unavailable (legacy storage)
  let riskFlags = security?.riskFlags?.length
    ? security.riskFlags
    : (signalSnapshot?.riskFlags || []);
  let riskScore = security?.riskScore ?? signalSnapshot?.riskScore ?? 25;
  let riskLevel = security?.riskLevel ?? signalSnapshot?.riskLevel ?? '中';
  if (!security && !signalSnapshot) {
    riskFlags = [];
    riskScore = 25;
    if (liquidity && liquidity < 10000) { riskScore += 28; riskFlags.push('流动性偏低'); }
    else if (liquidity && liquidity < 50000) { riskScore += 14; riskFlags.push('流动性一般'); }
    if (perf.maxDrawdown <= -40) { riskScore += 22; riskFlags.push('信号后回撤过大'); }
    if (priceChange1h >= 80 || perf.currentChange >= 120) { riskScore += 18; riskFlags.push('短线涨幅过高'); }
    if (Number.isFinite(buyPercent) && buyPercent < 50) { riskScore += 15; riskFlags.push('买入占比不足'); }
    if (!volume || volume < 100000) { riskScore += 10; riskFlags.push('成交量不足'); }
    riskScore = clampScore(riskScore);
    riskLevel = riskScore >= 78 ? '极高' : riskScore >= 58 ? '高' : riskScore >= 38 ? '中' : '低';
  }

  // Post-signal path risk overlays (do not invent SM resonance from volume text)
  if (perf.maxDrawdown <= -40 && !riskFlags.includes('信号后回撤过大')) {
    riskFlags = riskFlags.concat(['信号后回撤过大']);
  }

  const resonanceScore = resonance?.score ?? signalSnapshot?.resonanceScore ?? 0;
  const resonanceLevel = resonance?.level ?? signalSnapshot?.resonanceLevel ?? '未知';
  const securitySummary = security?.summary
    || (riskFlags.length ? riskFlags.join(' / ') : '未发现明显硬风险');
  const resonanceSummary = resonance?.summary
    || '缺少 Monitor Smart/KOL 富化数据';

  let action = '继续观察';
  if (riskLevel === '极高' || security?.isHoneypot || security?.isRug) action = '禁止交易';
  else if (perf.currentChange <= -15) action = '信号失效';
  else if (perf.currentChange >= 80) action = '等待回踩';
  else if (resonanceLevel === '强' && riskLevel !== '高' && riskLevel !== '极高') action = '重点观察';

  const trackedModel = engine?.analyzeTrackedSignal({
    ...tracked,
    signalScoreSnapshot: signalSnapshot,
  }) || {};
  const modelRiskScore = riskScore;
  const modelRiskLevel = riskLevel;
  const modelRiskFlags = riskFlags;
  const modelAction = trackedModel.entryAction || signalSnapshot?.suggestedAction || action;
  const entryGrade = trackedModel.entryGrade || signalSnapshot?.entryGrade || 'C';
  const signalLevel = signalSnapshot?.signalLevel || '观察';
  const aiScore = signalSnapshot?.signalScore
    ?? clampScore(50 + Math.min(perf.currentChange, 80) * 0.25 + resonanceScore * 0.22 - riskScore * 0.25);
  const confidence = signalSnapshot?.confidence || (aiScore >= 75 ? '中高' : aiScore >= 55 ? '中' : '偏低');
  const historyStatus = trackedModel.resultLabel
    || (perf.currentChange <= -15
      ? '跌破买入点'
      : perf.maxGain >= 80 && perf.currentChange < perf.maxGain * 0.45
        ? '疑似出货'
        : perf.currentChange >= 20
          ? '趋势延续'
          : '高位观察');
  const heatWin = meta.heatWindow || signalSnapshot?.heat?.primaryWindow || '';
  const summary = `${tracked.symbol} 触发 ${tracked.signalReasonText || '交易信号'}${heatWin ? `（${heatWin}）` : ''}。GMGN AI ${signalLevel} ${aiScore}/100，买点 ${entryGrade}，相对买入点 ${formatChange(perf.currentChange)}，风险 ${modelRiskLevel}，共振 ${resonanceLevel}。`;
  const suggestion = modelAction === '禁止交易'
    ? '风险过高，仅保留观察，不建议进入策略订单。'
    : modelAction === '禁止追高' || modelAction === '等待回踩'
      ? '短线涨幅较高，不建议直接追高，等待回踩或二次放量确认。'
      : modelAction === '重点观察'
        ? '信号质量较好，可加入重点观察，策略订单仍需二次确认。'
        : '继续观察价格是否守住买入标注点。';

  return {
    ...perf,
    ...trackedModel,
    phase,
    riskScore: modelRiskScore,
    riskLevel: modelRiskLevel,
    riskFlags: modelRiskFlags,
    security,
    securitySummary,
    securityChecked: !!(security?.checked ?? meta.securityChecked ?? signalSnapshot?.securityChecked),
    resonance,
    resonanceScore,
    resonanceLevel,
    resonanceSummary,
    action: modelAction,
    entryAction: modelAction,
    entryGrade,
    signalLevel,
    aiScore,
    confidence,
    historyStatus,
    summary,
    suggestion,
    modelReasons: signalSnapshot?.reasons || [],
  };
}

function getLevelClass(level) {
  if (['低', '强', '重点观察', '趋势延续', '中高', '重点报警', '强报警', 'A', 'B', '高收益验证', '超级收益', '有效信号', '软胜', '软胜·到期', '超级收益·回撤', '胜'].includes(level)) return 'good';
  if (['中', '弱', '等待回踩', '高位观察', '历史观察', '普通报警', '观察', 'C', '小仓试探', '继续观察', '观察中', '横盘到期', '平', '未知'].includes(level)) return 'warn';
  if (['高', '极高', '禁止交易', '禁止追高', '跌破买入点', '信号失效', '疑似出货', '高收益回撤', 'D', '失败/跌破', '失效移除', '负', '无'].includes(level)) return 'danger';
  return 'neutral';
}

function shortWalletAddr(addr = '') {
  const a = String(addr || '');
  if (a.length <= 12) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function formatUsdShort(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `$${Math.round(v)}`;
  return '$0';
}

function getTrackedTopWallets(tracked = {}) {
  const meta = tracked.signalMeta || {};
  const list = meta.topWallets || tracked.topWallets || [];
  return Array.isArray(list) ? list : [];
}

function renderWalletProfileCard(tracked, analysis) {
  const wallets = getTrackedTopWallets(tracked);
  const chain = tracked.chain || state.currentChain || 'solana';
  if (!wallets.length) {
    const sm = Number(tracked.signalMeta?.smartWallets5m || tracked.signalMeta?.smartWallets15m || 0);
    const kol = Number(tracked.signalMeta?.kolWallets5m || tracked.signalMeta?.kolWallets15m || 0);
    if (sm || kol) {
      return `<div class="ai-mini-main neutral">有 SM ${sm} / KOL ${kol} 参与，但未解析到地址明细</div>
        <p>刷新后若 GMGN Monitor 富化成功，将列出买入该币的聪明钱/KOL 钱包。</p>`;
    }
    return `<div class="ai-mini-main neutral">暂无钱包明细</div>
      <p>信号未附带 SM/KOL 交易地址时无法画像。等待 Monitor 富化或切换有聪明钱的链。</p>`;
  }
  const rows = wallets.slice(0, 6).map((w, idx) => {
    const role = w.role === 'kol' ? 'KOL' : 'SM';
    const roleClass = w.role === 'kol' ? 'wallet-role-kol' : 'wallet-role-sm';
    const side = w.side === 'sell' ? '卖' : w.side === 'mixed' ? '混' : '买';
    const sideClass = w.side === 'sell' ? 'danger' : w.side === 'mixed' ? 'warn' : 'good';
    const label = w.twitter ? `@${w.twitter}` : (w.name || shortWalletAddr(w.address));
    const statsId = `wp-${String(tracked.address || '').slice(0, 8)}-${idx}`;
    return `
      <div class="wallet-profile-row" data-wallet="${w.address}" data-chain="${chain}" data-role="${w.role || 'smart'}" data-twitter="${w.twitter || ''}" data-name="${w.name || ''}" data-stats-id="${statsId}">
        <button type="button" class="wallet-profile-main wallet-profile-load" title="加载 GMGN wallet stats">
          <span class="wallet-role-badge ${roleClass}">${role}</span>
          <span class="wallet-profile-name">${label}</span>
          <span class="wallet-side ${sideClass}">${side} ${formatUsdShort(w.netUsd || w.buyUsd)}</span>
          <span class="wallet-profile-meta">${w.tradeCount || 1}笔</span>
        </button>
        <div class="wallet-profile-stats" id="${statsId}" hidden></div>
      </div>`;
  }).join('');
  return `
    <div class="ai-mini-main good">${wallets.length} 个关联钱包 · 1h Monitor</div>
    <div class="wallet-profile-list">${rows}</div>
    <p class="wallet-profile-hint">点击钱包加载 7d 胜率 / PnL / 交易风格（GMGN portfolio stats，懒加载防限流）。</p>`;
}

async function loadWalletProfileStats(btn) {
  const row = btn.closest('.wallet-profile-row');
  if (!row) return;
  const wallet = row.dataset.wallet;
  const chain = row.dataset.chain || 'solana';
  const role = row.dataset.role || '';
  const twitter = row.dataset.twitter || '';
  const name = row.dataset.name || '';
  const statsId = row.dataset.statsId;
  const panel = statsId ? document.getElementById(statsId) : row.querySelector('.wallet-profile-stats');
  if (!wallet || !panel) return;

  // Toggle if already loaded
  if (panel.dataset.loaded === '1') {
    panel.hidden = !panel.hidden;
    return;
  }
  if (panel.dataset.loading === '1') return;
  panel.dataset.loading = '1';
  panel.hidden = false;
  panel.innerHTML = `<span class="wallet-stats-loading">加载 GMGN stats…</span>`;

  try {
    const qs = new URLSearchParams({
      chain,
      wallet,
      period: '7d',
      role,
      twitter,
      name,
    });
    const res = await fetch(getApiUrl(`/api/wallet-profile?${qs}`), {
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (!json.success || !json.data) {
      const err = json.error || `HTTP ${res.status}`;
      panel.innerHTML = `<span class="wallet-stats-error">${err}${json.rateLimited ? '（限流冷却中）' : ''}</span>`;
      panel.dataset.loaded = '0';
      return;
    }
    const p = json.data;
    const wr = p.winratePct != null ? `${p.winratePct}%` : '—';
    const realized = p.realizedProfit != null ? formatUsdShort(p.realizedProfit) : '—';
    const pnl = p.pnlRatio != null ? `${p.pnlRatio >= 0 ? '+' : ''}${(p.pnlRatio * 100).toFixed(0)}%` : '—';
    const style = p.style || {};
    const gradeClass = getLevelClass(style.grade || 'C');
    const tags = (p.tags || []).slice(0, 4).join(' · ') || '—';
    const gmgn = p.gmgnUrl || '#';
    panel.innerHTML = `
      <div class="wallet-stats-grid">
        <span class="wallet-stat"><em>胜率</em><strong class="${p.winrate != null && p.winrate >= 0.5 ? 'good' : ''}">${wr}</strong></span>
        <span class="wallet-stat"><em>已实现</em><strong>${realized}</strong></span>
        <span class="wallet-stat"><em>PnL</em><strong>${pnl}</strong></span>
        <span class="wallet-stat"><em>买卖</em><strong>${p.buyCount || 0}/${p.sellCount || 0}</strong></span>
        <span class="wallet-stat wide"><em>风格</em><strong class="${gradeClass}">${style.grade || '—'} · ${style.label || '—'}</strong></span>
        <span class="wallet-stat wide"><em>标签</em><strong>${tags}</strong></span>
      </div>
      <a class="wallet-gmgn-link" href="${gmgn}" target="_blank" rel="noopener">在 GMGN 打开 ${p.short || shortWalletAddr(wallet)}</a>`;
    panel.dataset.loaded = '1';
  } catch (e) {
    panel.innerHTML = `<span class="wallet-stats-error">${e.message || '加载失败'}</span>`;
    panel.dataset.loaded = '0';
  } finally {
    panel.dataset.loading = '0';
  }
}

function shortAiLine(text, max = 96) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function renderAiDetailPanel(tracked, analysis, key, isOpen) {
  if (!isOpen) return '';
  const canTradePreview = !['禁止交易', '禁止追高', '信号失效'].includes(analysis.action) && analysis.entryGrade !== 'D';
  const sec = analysis.security || {};
  const res = analysis.resonance || {};
  const securityBadge = analysis.securityChecked
    ? '已校验'
    : (sec.source === 'rank-flags' ? 'Rank' : '未抽检');
  const securityBody = analysis.securitySummary
    || (analysis.riskFlags?.length ? analysis.riskFlags.join(' / ') : '未发现明显硬风险');
  const resonanceBody = analysis.resonanceSummary
    || '缺少 Monitor Smart/KOL 富化数据';
  const resonanceSource = res.source === 'gmgn-monitor'
    ? 'Monitor'
    : res.source === 'gmgn-rank'
      ? 'rank'
      : res.source === 'unavailable'
        ? '无数据'
        : '—';
  const reasons = (analysis.modelReasons || []).slice(0, 4);
  const reasonChips = reasons.length
    ? reasons.map((r) => `<span class="ai-reason-chip">${shortAiLine(r, 36)}</span>`).join('')
    : '<span class="ai-reason-chip muted">等待 GMGN 富化</span>';
  const walletCount = getTrackedTopWallets(tracked).length;

  return `
    <div class="ai-detail-panel ai-detail-compact">
      <!-- 摘要一行：默认只看这个，细节按需展开 -->
      <div class="ai-summary-strip">
        <span class="ai-summary-item ${getLevelClass(analysis.signalLevel)}"><em>AI</em><strong>${analysis.signalLevel} ${analysis.aiScore}</strong></span>
        <span class="ai-summary-item ${getLevelClass(analysis.riskLevel)}"><em>风险</em><strong>${analysis.riskLevel}</strong></span>
        <span class="ai-summary-item ${getLevelClass(analysis.resonanceLevel)}"><em>共振</em><strong>${analysis.resonanceLevel} ${analysis.resonanceScore}</strong></span>
        <span class="ai-summary-item ${getLevelClass(analysis.entryGrade)}"><em>买点</em><strong>${analysis.entryGrade}</strong></span>
        <span class="ai-summary-item ${getLevelClass(analysis.historyStatus)}"><em>追踪</em><strong>${shortAiLine(analysis.historyStatus, 8)}</strong></span>
      </div>
      <p class="ai-summary-one-liner">${shortAiLine(analysis.suggestion || analysis.summary, 110)}</p>
      <div class="ai-reason-row">${reasonChips}</div>

      <div class="ai-detail-grid ai-metric-grid">
        <div class="ai-mini-card">
          <div class="ai-mini-title">安全 <span class="ai-source-tag">${securityBadge}</span></div>
          <div class="ai-mini-main ${getLevelClass(analysis.riskLevel)}">${analysis.riskLevel} · ${100 - analysis.riskScore}</div>
          <p class="ai-line-clamp">${shortAiLine(securityBody, 72)}</p>
        </div>
        <div class="ai-mini-card">
          <div class="ai-mini-title">共振 <span class="ai-source-tag">${resonanceSource}</span></div>
          <div class="ai-mini-main ${getLevelClass(analysis.resonanceLevel)}">${analysis.resonanceLevel} · ${analysis.resonanceScore}</div>
          <p class="ai-line-clamp">${shortAiLine(resonanceBody, 72)}</p>
        </div>
        <div class="ai-mini-card">
          <div class="ai-mini-title">买点</div>
          <div class="ai-mini-main ${getLevelClass(analysis.entryGrade)}">${analysis.entryGrade} · ${analysis.entryAction}</div>
          <p class="ai-line-clamp">报警≠买入 · 相对标注 ${formatChange(analysis.currentChange)}</p>
        </div>
        <div class="ai-mini-card">
          <div class="ai-mini-title">表现</div>
          <div class="ai-mini-main ${getLevelClass(analysis.historyStatus)}">${analysis.historyStatus}</div>
          <p class="ai-line-clamp">峰 ${formatChange(analysis.maxGain)} · 回撤 ${formatChange(analysis.maxDrawdown)}</p>
        </div>
      </div>

      <!-- 次级信息默认折叠，避免一屏塞满 -->
      <details class="ai-fold">
        <summary>钱包画像 <span class="ai-fold-meta">${walletCount ? `${walletCount} 个` : '无'} · 点击展开</span></summary>
        <div class="ai-fold-body">${renderWalletProfileCard(tracked, analysis)}</div>
      </details>
      <details class="ai-fold">
        <summary>完整说明 <span class="ai-fold-meta">摘要 / 风险明细</span></summary>
        <div class="ai-fold-body">
          <p>${analysis.summary || '—'}</p>
          <p class="ai-suggestion">${analysis.suggestion || ''}</p>
          <p><strong>安全</strong> ${securityBody}</p>
          <p><strong>共振</strong> ${resonanceBody}</p>
          ${tracked.moonshot?.selloffReason ? `<p class="ai-suggestion danger">${tracked.moonshot.selloffReason}</p>` : ''}
        </div>
      </details>

      <div class="strategy-preview-box strategy-preview-compact ${canTradePreview ? '' : 'blocked'}">
        <div>
          <strong>策略预览</strong>
          <span>${canTradePreview ? '点击生成报价 · 默认不展开' : '已拦截'}</span>
        </div>
        <button class="monitor-action-btn primary strategy-preview-btn" data-tracked-key="${key}" ${canTradePreview ? '' : 'disabled'}>报价</button>
      </div>
    </div>`;
}

function openStrategyModal(html) {
  // Only called after explicit user click on 策略预览/报价 — never auto-open
  const modal = document.getElementById('strategyModal');
  const body = document.getElementById('strategyModalBody');
  if (!modal || !body) {
    showToast(String(html).replace(/<[^>]+>/g, ' ').slice(0, 180), 'info');
    return;
  }
  body.innerHTML = html;
  modal.hidden = false;
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('strategy-modal-open');
}

function closeStrategyModal() {
  const modal = document.getElementById('strategyModal');
  if (modal) {
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('strategy-modal-open');
}

function renderStrategyQuoteHtml(quote, tracked) {
  if (!quote) {
    return `<p class="strategy-quote-error">无法生成预览</p>`;
  }
  if (quote.blocked) {
    return `
      <div class="strategy-quote-blocked">
        <div class="ai-mini-main danger">已拦截 · ${quote.blockReason || '风险过高'}</div>
        <p>${tracked?.symbol || quote.symbol} 买点 ${quote.entryGrade} · ${quote.entryAction}</p>
        <p class="strategy-disclaimer">${quote.disclaimer || '仅预览，不执行交易。'}</p>
      </div>`;
  }
  const m = quote.market || {};
  const s = quote.sizing || {};
  const r = quote.risk || {};
  const legs = Array.isArray(quote.legs) ? quote.legs : [];
  const legRows = legs.map((leg) => `
    <tr>
      <td><span class="strategy-leg-side ${leg.side}">${leg.label || leg.id}</span></td>
      <td>${formatPrice(leg.price)}</td>
      <td>$${Number(leg.sizeUsd || 0).toFixed(0)}</td>
      <td>${leg.pctOfPosition != null ? `${leg.pctOfPosition}%` : '—'}</td>
      <td class="muted">${leg.note || leg.type || ''}</td>
    </tr>`).join('');
  return `
    <div class="strategy-quote-head">
      <div>
        <strong>${quote.symbol || tracked?.symbol || 'TOKEN'}</strong>
        <span class="strategy-chain">${quote.chain || tracked?.chain || ''}</span>
      </div>
      <div class="ai-mini-main ${getLevelClass(quote.entryGrade)}">${quote.entryGrade} · ${quote.entryAction}</div>
    </div>
    <div class="strategy-quote-meta">
      <span>市价 <strong>${formatPrice(m.price)}</strong> <em>(${m.source || '—'})</em></span>
      <span>买入标注 <strong>${formatPrice(m.signalPrice || tracked?.priceAtSignal)}</strong></span>
      <span>建议仓位 <strong>$${s.sizeUsd ?? s.suggestedUsd ?? 0}</strong> <em>${s.label || ''}</em></span>
    </div>
    <p class="strategy-template">${quote.templateName || quote.templateId || '标准阶梯'}</p>
    <div class="strategy-table-wrap">
      <table class="strategy-legs-table">
        <thead>
          <tr><th>腿</th><th>价格</th><th>名义</th><th>仓位</th><th>说明</th></tr>
        </thead>
        <tbody>${legRows || '<tr><td colspan="5">无订单腿</td></tr>'}</tbody>
      </table>
    </div>
    <div class="strategy-risk-row">
      <span>最大亏损 <strong class="danger">$${Number(r.maxLossUsd || 0).toFixed(0)}</strong></span>
      <span>双止盈兑现 <strong class="good">+$${Number(r.fullSuccessPnl || 0).toFixed(0)}</strong></span>
      <span>R:R <strong>${r.riskReward != null ? r.riskReward : '—'}</strong></span>
    </div>
    <p class="strategy-disclaimer">${quote.disclaimer || '预览 only · 不执行真实交易。'}</p>
    <p class="strategy-no-exec">未开放执行 · 不会请求 GMGN 交易/签名接口 · 不存储私钥</p>`;
}

/** Client-side fallback quote (mirrors server template math). */
function buildLocalStrategyQuote(tracked, analysis) {
  const marketPrice = Number(analysis.current || tracked.currentPrice || 0);
  const signalPrice = Number(tracked.priceAtSignal || 0);
  const entryGrade = String(analysis.entryGrade || 'C').toUpperCase().slice(0, 1);
  const entryAction = analysis.entryAction || analysis.action || '继续观察';
  const sizeMap = { A: 100, B: 50, C: 25, D: 0 };
  const maxMap = { A: 300, B: 150, C: 75, D: 0 };
  const blocked = ['禁止交易', '禁止追高', '信号失效'].includes(entryAction) || entryGrade === 'D' || !(marketPrice >0 || signalPrice >0);
  let mult = 0.9;
  if (entryAction === '等待回踩' || entryAction === '禁止追高') mult = 0.85;
  else if (entryAction === '重点观察' || entryGrade === 'A') mult = 0.95;
  else if (entryGrade === 'B') mult = 0.92;
  else if (entryGrade === 'C') mult = 0.88;
  const ref = marketPrice >0 ? marketPrice : signalPrice;
  let entryPrice = ref * mult;
  if (signalPrice >0 && marketPrice >signalPrice * 1.15) entryPrice = Math.min(entryPrice, signalPrice * 1.02);
  const sizeUsd = sizeMap[entryGrade] || 25;
  const sizeTokens = entryPrice >0 ? sizeUsd / entryPrice : 0;
  const legs = blocked ? [] : [
    { id: 'entry', side: 'buy', type: 'limit', label: '限价买入', price: entryPrice, sizeUsd, sizeTokens, pctOfPosition: 100, note: '本地回退报价' },
    { id: 'tp1', side: 'sell', type: 'limit', label: '止盈1 · +100%', price: entryPrice * 2, sizeUsd: sizeUsd * 0.5, sizeTokens: sizeTokens * 0.5, pctOfPosition: 50, note: '卖出 50% 仓位' },
    { id: 'tp2', side: 'sell', type: 'limit', label: '止盈2 · +300%', price: entryPrice * 4, sizeUsd: sizeUsd * 0.5, sizeTokens: sizeTokens * 0.5, pctOfPosition: 50, note: '卖出剩余 50%' },
    { id: 'sl', side: 'sell', type: 'stop', label: '止损 · -50%', price: entryPrice * 0.5, sizeUsd, sizeTokens, pctOfPosition: 100, note: '跌破止损清仓' },
  ];
  return {
    templateId: 'standard-ladder-v1',
    templateName: '标准阶梯 · 限价买入 + 双止盈 + 止损',
    executionEnabled: false,
    previewOnly: true,
    blocked,
    blockReason: blocked ? (entryGrade === 'D' ? '买点评级 D / 禁止交易' : entryAction) : '',
    symbol: tracked.symbol,
    chain: tracked.chain,
    address: tracked.address,
    entryGrade,
    entryAction,
    sizing: { grade: entryGrade, label: sizeMap[entryGrade] ? '建议仓' : '—', suggestedUsd: sizeUsd, maxUsd: maxMap[entryGrade] || 0, sizeUsd: blocked ? 0 : sizeUsd },
    market: { price: marketPrice, signalPrice, source: 'client-local' },
    legs,
    risk: {
      maxLossUsd: blocked ? 0 : sizeUsd * 0.5,
      fullSuccessUsd: blocked ? 0 : sizeUsd * 0.5 * 2 + sizeUsd * 0.5 * 4,
      fullSuccessPnl: blocked ? 0 : (sizeUsd * 0.5 * 2 + sizeUsd * 0.5 * 4) - sizeUsd,
      riskReward: blocked ? null : 5,
    },
    disclaimer: '此为策略订单预览，不创建链上/交易所订单，不连接钱包私钥。真实下单必须单独二次确认（当前版本未开放执行）。',
  };
}

async function showStrategyPreview(tracked, analysis) {
  if (['禁止交易', '禁止追高', '信号失效'].includes(analysis.action) || analysis.entryGrade === 'D') {
    const blocked = buildLocalStrategyQuote(tracked, analysis);
    openStrategyModal(renderStrategyQuoteHtml(blocked, tracked));
    showToast(`买点评级 ${analysis.entryGrade}：${analysis.action}，交易预览已拦截`, 'error');
    return;
  }

  openStrategyModal(`<p class="wallet-stats-loading">正在生成策略报价…</p>`);

  const qs = new URLSearchParams({
    chain: tracked.chain || state.currentChain || 'solana',
    address: tracked.address || '',
    symbol: tracked.symbol || '',
    price: String(analysis.current || tracked.currentPrice || 0),
    signalPrice: String(tracked.priceAtSignal || 0),
    entryGrade: analysis.entryGrade || 'C',
    entryAction: analysis.entryAction || analysis.action || '继续观察',
  });

  let quote = null;
  try {
    const res = await fetch(getApiUrl(`/api/strategy-preview?${qs}`), {
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (json.success && json.data) {
      quote = json.data;
      // Hard safety: never trust a server that claims execution
      if (json.executionEnabled === true || quote.executionEnabled === true) {
        quote = { ...quote, executionEnabled: false, previewOnly: true };
      }
    }
  } catch (e) {
    console.warn('strategy-preview API failed, local fallback', e);
  }

  if (!quote) quote = buildLocalStrategyQuote(tracked, analysis);
  openStrategyModal(renderStrategyQuoteHtml(quote, tracked));
  showToast(
    quote.blocked
      ? `策略预览已拦截：${quote.blockReason || quote.entryAction}`
      : `策略预览已生成 · ${quote.symbol} · 建议 $${quote.sizing?.sizeUsd ?? 0} · 仅预览不下单`,
    quote.blocked ? 'error' : 'info'
  );
}

// --- Monitoring ---

function formatWinRatePct(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  return `${(rate * 100).toFixed(0)}%`;
}

function renderSignalOutcomeStatsBar() {
  const el = document.getElementById('signalOutcomeStats');
  const hint = document.getElementById('trackingHint');
  const stats = getOutcomeStatsCached();
  const live = Object.keys(state.trackedTokens).length;
  const removed = state.sessionRemovedInvalid || 0;
  const wr = formatWinRatePct(stats.winRate);
  const strongWr = formatWinRatePct(stats.strongWinRate);
  const avgPeak = stats.total ? formatChange(stats.avgMaxGain) : '—';
  // Best pattern tip for selection
  let bestTip = '样本积累中 · 胜率将反馈选标';
  const patterns = Object.values(stats.byPattern || {}).filter((p) =>p.total >= 3);
  if (patterns.length) {
    patterns.sort((a, b) =>b.winRate - a.winRate || b.total - a.total);
    const top = patterns[0];
    bestTip = `优选模式 ${(top.winRate * 100).toFixed(0)}% · ${top.key}（${top.wins}/${top.total}）`;
  }
  if (hint) {
    hint.textContent = `买入点=信号发出 · 刷新清失效 · 胜率反馈选标 · ${bestTip}`;
  }
  if (!el) return;
  el.innerHTML = `
    <div class="outcome-stat"><span class="outcome-stat-label">胜率</span><strong class="outcome-stat-value ${stats.winRate >= 0.45 ? 'good' : stats.winRate >0 && stats.winRate < 0.3 ? 'danger' : ''}">${wr}</strong><em>${stats.wins || 0}胜/${stats.losses || 0}负</em></div>
    <div class="outcome-stat"><span class="outcome-stat-label">强胜≥35%</span><strong class="outcome-stat-value">${strongWr}</strong><em>${stats.strongWins || 0}次</em></div>
    <div class="outcome-stat"><span class="outcome-stat-label">均峰值</span><strong class="outcome-stat-value ${getChangeClass(stats.avgMaxGain || 0)}">${avgPeak}</strong><em>自买入点</em></div>
    <div class="outcome-stat"><span class="outcome-stat-label">追踪中</span><strong class="outcome-stat-value">${live}</strong><em>24H</em></div>
    <div class="outcome-stat"><span class="outcome-stat-label">本轮清失效</span><strong class="outcome-stat-value ${removed ? 'danger' : ''}">${removed}</strong><em>样本 ${stats.total || 0}</em></div>
  `;
}

function renderMemecoinMonitoring() {
  pruneSignalTracking();
  const activeAddresses = new Set(state.signals.filter((s) =>s.active).map((s) =>getTrackingKey(s.tokenAddress, s.tokenChain)));
  const now = Date.now();
  const remainingKeys = Object.keys(state.trackedTokens);
  dom.trackedCount.textContent = remainingKeys.length;
  renderSignalOutcomeStatsBar();
  if (remainingKeys.length === 0) {
    dom.monitorCards.innerHTML = '';
    dom.monitorEmpty.style.display = 'flex';
    return;
  }
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
  const badgeLabels = {
    'ai-score': 'AI',
    'rules-score': '规则',
    'monitor-inflow': 'Monitor',
    'monitor-hot-5m': '5m热',
    'monitor-hot-15m': '15m热',
    'monitor-hot-1h': '1h热',
    'price-surge': '飙升',
    'volume-spike': '放量',
    'buy-pressure': '买压',
    'moonshot-selloff': '回撤',
  };
  for (const key of visibleKeys) {
    const tracked = state.trackedTokens[key];
    const elapsed = now - tracked.signalAt;
    const isActive = activeAddresses.has(key);
    const analysis = analyzeTrackedToken(tracked, isActive, now);
    const liveOutcome = window.SignalEngine?.evaluateSignalOutcome?.(tracked, { now }) || {};
    const priceChange = analysis.currentChange;
    const statusLabel = isActive ? '5分钟信号中' : '历史追踪';
    const statusClass = isActive ? 'active' : 'history';
    const outcomeLabel = tracked.outcomeTier || liveOutcome.tier || analysis.historyStatus || '观察中';
    const outcomeClass = liveOutcome.isWin || tracked.outcomeStatus === 'win' || tracked.outcomeStatus === 'soft_win'
      ? 'good'
      : liveOutcome.isLoss || tracked.outcomeStatus === 'loss'
        ? 'danger'
        : getLevelClass(outcomeLabel);
    const isExpanded = !!state.aiExpanded[key];
    const card = document.createElement('div');
    card.className = `monitor-card ${tracked.moonshot?.active ? 'moonshot-card' : ''} ${tracked.moonshot?.selloffAlertedAt ? 'moonshot-alert-card' : ''}`.trim();
    card.style.animationDelay = `${cardIndex * 0.05}s`;
    cardIndex++;
    const dotClass = getChainDotClass(tracked.chain);
    const trackedChain = normalizeMarketChain(tracked.chain || state.currentChain) || tracked.chain;
    const explorerUrl = getExplorerUrl(trackedChain, tracked.address);
    const marketUrl = getTokenMarketDetailUrl({
      chain: trackedChain,
      address: tracked.address,
      pairAddress: tracked.pairAddress,
      symbol: tracked.symbol,
      url: tracked.url,
      dexscreenerUrl: tracked.dexscreenerUrl,
    });
    const marketLabel = getMarketDetailLabel(trackedChain);
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
        ${tracked.moonshot?.active ? `<span class="ai-chip moonshot">500%+ · 保留1个月</span>` : ''}
        ${tracked.moonshot?.selloffAlertedAt ? `<span class="ai-chip danger">${tracked.moonshot.selloffReason || '高收益回撤'}</span>` : ''}
        <span class="ai-chip ${outcomeClass}">结果：${outcomeLabel}</span>
        <span class="ai-chip ${getLevelClass(analysis.signalLevel)}">AI：${analysis.signalLevel} ${analysis.aiScore}/100</span>
        <span class="ai-chip ${getLevelClass(analysis.riskLevel)}">风险：${analysis.riskLevel}</span>
        <span class="ai-chip ${getLevelClass(analysis.resonanceLevel)}">共振：${analysis.resonanceLevel}</span>
        <span class="ai-chip ${getLevelClass(analysis.entryGrade)}">买点：${analysis.entryGrade} · ${analysis.entryAction}</span>
      </div>
      <div class="monitor-chart-area"><canvas data-tracked-key="${key}"></canvas></div>
      <div class="monitor-stats">
        <div class="monitor-stat"><span class="monitor-stat-label">买入标注点</span><span class="monitor-stat-value" style="font-size:11px;color:var(--accent-green)">${formatPrice(tracked.priceAtSignal)}</span></div>
        <div class="monitor-stat"><span class="monitor-stat-label">当前价格</span><span class="monitor-stat-value" style="font-size:11px">${formatPrice(tracked.currentPrice)}</span></div>
        <div class="monitor-stat"><span class="monitor-stat-label">相对买入</span><span class="monitor-stat-value ${getChangeClass(priceChange)}">${formatChange(priceChange)}</span></div>
        <div class="monitor-stat"><span class="monitor-stat-label">峰值</span><span class="monitor-stat-value ${getChangeClass(analysis.maxGain)}">${formatChange(analysis.maxGain)}</span></div>
        <div class="monitor-stat" style="margin-left:auto"><span class="monitor-stat-label">已追踪</span><span class="monitor-stat-value" style="font-size:11px;color:var(--text-muted)">${formatDuration(elapsed)}</span></div>
      </div>
      <div class="monitor-actions">
        <button class="monitor-action-btn primary ai-detail-toggle" data-tracked-key="${key}">${isExpanded ? '收起' : 'AI'}</button>
        <button class="monitor-action-btn strategy-preview-btn" data-tracked-key="${key}">策略预览</button>
        <a href="${marketUrl}" target="_blank" rel="noopener" class="monitor-action-btn" title="行情详情">${marketLabel}</a>
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
    const isDuplicateName = nameCounts[displayName.toLowerCase()] >1;
    const fingerprint = uniqueTokenFingerprint(tracked.address || '');
    const moonshot = !!tracked.moonshot?.active || analysis.maxGain >= 500 || analysis.currentChange >= 500;
    const alertReason = tracked.moonshot?.selloffReason || '';
    return `
      <div class="archive-token-row ${moonshot ? 'moonshot-row' : ''} ${alertReason ? 'moonshot-alert-row' : ''}" title="${tracked.address || ''}">
        <span class="archive-token-id">
          <strong>${displayName}</strong>
          <button class="archive-address-copy" type="button" data-copy-address="${tracked.address || ''}" title="左键点击复制完整合约地址">
            ${isDuplicateName ? '同名·' : ''}${fingerprint}${moonshot ? ' · 500%+保留1月' : ''}
            <span class="archive-copy-hint">复制</span>
          </button>
          ${alertReason ? `<small>提醒原因：${alertReason}</small>` : ''}
        </span>
        <span class="archive-return ${moonshot ? 'moonshot' : getChangeClass(analysis.currentChange)}">买入→现 ${formatChange(analysis.currentChange)} · 峰 ${formatChange(analysis.maxGain)}</span>
      </div>`;
  }).join('');
  // Recent settled outcomes (win/loss ledger) under archive
  const recentOutcomes = (state.signalOutcomes || []).slice(0, 12);
  const outcomeRows = recentOutcomes.map((o) => {
    const cls = o.isWin ? 'positive' : o.isLoss ? 'negative' : 'neutral';
    const tag = o.isWin ? '胜' : o.isLoss ? '负' : o.status === 'flat' ? '平' : o.status;
    return `<div class="archive-token-row outcome-row">
      <span class="archive-token-id"><strong>${o.symbol || '?'}</strong> <em>${o.tier || tag}</em> <small>${o.patternKey || ''}</small></span>
      <span class="archive-return ${cls}">${tag} · 峰${formatChange(o.maxGain)} · 终${formatChange(o.currentChange)}</span>
    </div>`;
  }).join('');
  const emptyArchive = '<div class="archive-empty-row">当前只追踪了最新 8 个以内，暂无额外历史记录</div>';
  archiveCard.innerHTML = `
    <button class="archive-toggle" type="button">
      <span>已追踪历史 + 胜负台账</span>
      <strong>${archivedKeys.length + recentOutcomes.length}</strong>
      <em>${state.archiveExpanded ? '收起' : '点击查看'}</em>
    </button>
    ${state.archiveExpanded ? `<div class="archive-token-list simple-history-list">
      ${archivedRows || emptyArchive}
      ${outcomeRows ? `<div class="archive-empty-row" style="margin-top:8px">—— 已结算买入点（近12条）——</div>${outcomeRows}` : ''}
    </div>` : ''}`;
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
    btn.addEventListener('click', (e) =>copyAddress(e.currentTarget.dataset.copyAddress, e));
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
      const isActive = state.signals.some((s) =>s.active && getTrackingKey(s.tokenAddress, s.tokenChain) === key);
      showStrategyPreview(tracked, analyzeTrackedToken(tracked, isActive));
    });
  });
  dom.monitorCards.querySelectorAll('.wallet-profile-load').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      loadWalletProfileStats(e.currentTarget);
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

  const validPricePoints = priceHistory.filter((p) =>p.price != null);
  if (validPricePoints.length === 0) return;
  const buyPoint = tracked?.buyMarker || { time: tracked?.signalAt, price: tracked?.priceAtSignal, label: '信号买入点' };
  const allPrices = validPricePoints.map((p) =>p.price);
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
  const yFor = (price) =>hasPriceRange ? padding.top + (1 - (price - min) / range) * chartHeight : padding.top + chartHeight / 2;
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
// ALTCOIN PAGE — 合约环境 + 永续规则 v2 + 可选 Clawby（独立于 Memecoin）
// ====================================================================================

async function fetchOthercoinApi() {
  // Altcoin page: CEX multi only (not memecoin chain boards)
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

function formatFundingPct(rateOrPct, { isPct = false } = {}) {
  if (rateOrPct == null || !Number.isFinite(Number(rateOrPct))) return '—';
  const pct = isPct ? Number(rateOrPct) : Number(rateOrPct) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(4)}%`;
}

function renderAltcoinEnvironment(env, meta = {}) {
  const panel = document.getElementById('altcoinEnvPanel');
  const badge = document.getElementById('altcoinEnvRegimeBadge');
  const hint = document.getElementById('altcoinEnvHint');
  if (!panel) return;

  if (!env) {
    panel.innerHTML = '<div class="altcoin-env-loading">暂无合约环境数据</div>';
    if (badge) {
      badge.textContent = '—';
      badge.className = 'section-badge';
    }
    return;
  }

  const regime = env.regime || 'neutral';
  const regimeClass = regime === 'risk-on' ? 'env-on' : regime === 'risk-off' ? 'env-off' : 'env-neutral';
  if (badge) {
    badge.textContent = env.regimeLabel || regime;
    badge.className = `section-badge altcoin-regime-badge ${regimeClass}`;
  }

  const m = env.metrics || {};
  const clawbyOk = !!env.clawby?.available || meta?.clawby?.ok;
  const secondaryLabel = clawbyOk ? 'Clawby 已接入' : (meta?.clawby?.reason === 'no-clawby-key' ? 'Clawby 未配置 key' : 'Clawby 不可用');
  if (hint) {
    const primaryHint = '主源 Binance+Bybit（无需付费 key）';
    const llama = meta?.defillama || env.defillama;
    const llamaHint = llama?.ok
      ? ` · Llama DEX ${llama.change_7d != null ? (llama.change_7d >= 0 ? '+' : '') + Number(llama.change_7d).toFixed(1) + '%/7d' : '热度'}`
      : '';
    const gateHint = meta?.gate === 'two-week-volume-up-ex-btc' || meta?.rulesVersion?.includes('weekly')
      ? '门：周量连涨2周·除BTC·Top20'
      : `规则 ${meta?.rulesVersion || 'v3'}`;
    hint.textContent = `${primaryHint}${llamaHint} · ${secondaryLabel} · ${gateHint}`;
  }

  const agree = m.fundingAgreement || 'n/a';
  const agreeLabel =
    agree === 'agree' ? '费率一致' : agree === 'soft' ? '费率近似' : agree === 'conflict' ? '费率冲突' : '单源';
  const agreeClass =
    agree === 'agree' ? 'good' : agree === 'conflict' ? 'danger' : 'muted';

  const notes = (env.notes || []).slice(0, 5);
  const notesHtml = notes.length
    ? `<ul class="altcoin-env-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ul>`
    : '<p class="altcoin-env-notes-empty">暂无环境备注</p>';

  const liqTotal = m.liqTotal24h != null ? formatCompact(m.liqTotal24h) : '—';
  const liqSplit =
    m.liqLong24h != null || m.liqShort24h != null
      ? `多 ${formatCompact(m.liqLong24h || 0)} / 空 ${formatCompact(m.liqShort24h || 0)}`
      : clawbyOk
        ? '—'
        : '需 Clawby';

  const depthN = meta?.clawby?.depthCount;
  const depthSub = clawbyOk
    ? (depthN != null ? `加深 ${depthN} 币` : 'Clawby 在线')
    : secondaryLabel;

  panel.innerHTML = `
    <div class="altcoin-env-grid">
      <div class="altcoin-env-card ${regimeClass}">
        <div class="altcoin-env-card-label">环境制度</div>
        <div class="altcoin-env-card-main">${env.regimeLabel || regime}</div>
        <div class="altcoin-env-card-sub">环境分 ${env.envScore ?? '—'}/100</div>
      </div>
      <div class="altcoin-env-card">
        <div class="altcoin-env-card-label">BTC 费率</div>
        <div class="altcoin-env-card-main ${getChangeClass(m.fundingBtcPct != null ? m.fundingBtcPct : (m.fundingBtc || 0) * 100)}">${formatFundingPct(m.fundingBtcPct != null ? m.fundingBtcPct : m.fundingBtc, { isPct: m.fundingBtcPct != null })}</div>
        <div class="altcoin-env-card-sub">24h ${formatChange(m.priceChangeBtc)}</div>
      </div>
      <div class="altcoin-env-card">
        <div class="altcoin-env-card-label">ETH 费率</div>
        <div class="altcoin-env-card-main ${getChangeClass(m.fundingEthPct != null ? m.fundingEthPct : (m.fundingEth || 0) * 100)}">${formatFundingPct(m.fundingEthPct != null ? m.fundingEthPct : m.fundingEth, { isPct: m.fundingEthPct != null })}</div>
        <div class="altcoin-env-card-sub">24h ${formatChange(m.priceChangeEth)}</div>
      </div>
      <div class="altcoin-env-card">
        <div class="altcoin-env-card-label">OI（名义）</div>
        <div class="altcoin-env-card-main" style="font-size:14px">BTC ${formatCompact(m.oiBtcUsd || 0)}</div>
        <div class="altcoin-env-card-sub">ETH ${formatCompact(m.oiEthUsd || 0)}</div>
      </div>
      <div class="altcoin-env-card">
        <div class="altcoin-env-card-label">24h 爆仓</div>
        <div class="altcoin-env-card-main" style="font-size:14px">${liqTotal}</div>
        <div class="altcoin-env-card-sub">${liqSplit}</div>
      </div>
      <div class="altcoin-env-card">
        <div class="altcoin-env-card-label">双源校验</div>
        <div class="altcoin-env-card-main ${agreeClass}" style="font-size:14px">${agreeLabel}</div>
        <div class="altcoin-env-card-sub">${depthSub}</div>
      </div>
    </div>
    ${notesHtml}
  `;

  const guideEl = document.getElementById('altcoinListGuidance');
  const guide = env.listGuidance || meta?.listGuidance;
  if (guideEl && guide?.text) {
    guideEl.hidden = false;
    guideEl.className = `altcoin-list-guidance tone-${guide.tone || 'neutral'}`;
    const counts = meta?.actionCounts;
    const countTip = counts
      ? ` · 优先 ${counts.prefer || 0} / 观察 ${counts.watch || 0} / 降权 ${counts.fade || 0}`
      : '';
    guideEl.textContent = guide.text + countTip;
  } else if (guideEl) {
    guideEl.hidden = true;
  }
}

async function loadOthercoinData() {
  if (state.otherLoading) return;
  state.otherLoading = true;
  state.otherError = null;
  dom.otherErrorState.style.display = 'none';
  dom.otherLoadingState.style.display = 'flex';
  dom.otherTokenList.innerHTML = '';
  const envPanel = document.getElementById('altcoinEnvPanel');
  if (envPanel) envPanel.innerHTML = '<div class="altcoin-env-loading">加载合约环境…</div>';
  setStatus('loading');
  try {
    const data = await fetchOthercoinApi();
    if (!data.success || !Array.isArray(data.data)) throw new Error('API返回数据格式异常');
    state.otherTokens = data.data;
    state.altcoinEnvironment = data.environment || null;
    state.altcoinMeta = data.meta || null;
    renderAltcoinEnvironment(data.environment, data.meta);
    renderOthercoinSortedTokens(data.data);
    updateOthercoinStats(data.data, data.timestamp);
    setStatus('');
    dom.otherLoadingState.style.display = 'none';
  } catch (err) {
    console.error('Altcoin load error:', err);
    state.otherError = err.message;
    showToast(`Altcoin 扫描失败: ${err.message}`, 'error');
    dom.otherLoadingState.style.display = 'none';
    dom.otherTokenList.innerHTML = '';
    dom.otherErrorState.style.display = 'flex';
    dom.otherErrorMessage.textContent = err.message;
    if (envPanel) envPanel.innerHTML = `<div class="altcoin-env-loading">环境加载失败: ${err.message}</div>`;
    setStatus('error');
  } finally {
    state.otherLoading = false;
  }
}

function renderOthercoinSortedTokens(tokens) {
  const actionFilter = state.altcoinActionFilter || 'all';
  let list = Array.isArray(tokens) ? [...tokens] : [];
  if (actionFilter !== 'all') {
    list = list.filter((t) => (t.action || 'watch') === actionFilter);
  }
  const sorted = list.sort((a, b) => {
    switch (state.otherSortBy) {
      case 'signalScore': {
        // Default: action priority then score (matches API ranking)
        const ap = (b.actionPriority || 0) - (a.actionPriority || 0);
        if (ap !== 0) return ap;
        return (b.signalScore ?? b.score ?? 0) - (a.signalScore ?? a.score ?? 0);
      }
      case 'volume': return (b.volume24h || 0) - (a.volume24h || 0);
      case 'priceChange': return Math.abs(b.priceChange24h || 0) - Math.abs(a.priceChange24h || 0);
      default: return 0;
    }
  });
  if (dom.otherCount) dom.otherCount.textContent = sorted.length;
  renderOthercoinTokenRows(sorted);
}

const SIGNAL_BADGE_LABELS = {
  funding: '费率异常',
  price: '价格',
  volume: '量能2周',
  volume_week: '周额',
  oi: '合约OI',
  structure: '结构',
};

function altcoinActionClass(action) {
  if (action === 'prefer') return 'action-prefer';
  if (action === 'fade') return 'action-fade';
  return 'action-watch';
}

function renderOthercoinTokenRows(tokens) {
  if (!tokens || tokens.length === 0) {
    const emptyTip =
      state.altcoinActionFilter && state.altcoinActionFilter !== 'all'
        ? '当前筛选下无信号，试试「全部」'
        : '暂无达标：需周成交量环比连续2周上涨（已排除 BTC）';
    dom.otherTokenList.innerHTML = `<div class="empty-state"><div class="empty-icon"></div><p>${emptyTip}</p></div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  tokens.forEach((token, index) => {
    const row = document.createElement('div');
    const act = token.action || 'watch';
    row.className = `token-row othercoin-token-row ${altcoinActionClass(act)}`;
    row.style.animationDelay = `${index * 0.03}s`;
    const rankEmoji = index + 1;
    const iconHtml = getTokenIcon(token);
    const chainBadge = getChainBadgeHtml(token.chain || 'multi');
    const otherChain = normalizeMarketChain(token.chain || 'multi') || token.chain;
    const marketUrl = getTokenMarketDetailUrl({ ...token, chain: otherChain });
    const marketLabel = getMarketDetailLabel(otherChain);
    const pairHint =
      otherChain === 'solana'
        ? 'GMGN Solana 合约行情'
        : token.pairLabel || token.dexId
          ? `${token.dexId || 'DEX'}${token.pairLabel ? ' · ' + token.pairLabel : ''}`
          : 'DexScreener 合约行情';
    const mcapHint = token.marketCap
      ? `市值 ${formatCompact(token.marketCap)}`
      : (token.fdv ? `FDV ${formatCompact(token.fdv)}` : '');
    const frHint = token.fundingRate != null
      ? `费率 ${(Number(token.fundingRate) * 100).toFixed(4)}%`
      : '';
    const nameLine = [token.name || '', mcapHint, frHint, pairHint].filter(Boolean).join(' · ');

    let badgesHtml = '';
    const signals = token.signals || [];
    if (signals.length > 0) {
      badgesHtml = '<div class="signal-badge-row">';
      for (const sig of signals.slice(0, 3)) {
        badgesHtml += `<span class="signal-badge ${sig.type}">${SIGNAL_BADGE_LABELS[sig.type] || sig.label || sig.type}</span>`;
      }
      if (signals.length > 3) {
        badgesHtml += `<span class="signal-badge multi">+${signals.length - 3}</span>`;
      }
      badgesHtml += '</div>';
    }

    const volSig = signals.find((s) => s.type === 'volume' || s.type === 'volume_week');
    const structure = signals.find((s) => s.type === 'structure');
    let detailText = '';
    if (token.weeklyVolume?.pass) {
      const g1 = ((token.weeklyVolume.growth1 || 0) * 100).toFixed(0);
      const g2 = ((token.weeklyVolume.growth2 || 0) * 100).toFixed(0);
      detailText = `2周量 +${g1}%/+${g2}%`;
      if (structure) detailText += ` · ${structure.label}`;
      else if (volSig?.detail) detailText += ` · ${volSig.detail}`;
    } else {
      detailText = structure
        ? `${structure.label} · ${structure.detail || ''}`
        : (signals[0]?.detail || signals[0]?.label || token.strongestDetail || '');
    }
    if (token.actionReason) {
      detailText = detailText
        ? `${detailText} · ${token.actionReason}`
        : token.actionReason;
    }
    const depth = token.clawbyDepth;
    const depthLine =
      token.clawbyDepthOk && depth?.summary
        ? `<div class="altcoin-depth-line" title="Clawby 第二源加深">Clawby ${depth.fundingAgreement === 'conflict' ? '⚠费率冲突 · ' : depth.fundingAgreement === 'agree' ? '✓一致 · ' : ''}${depth.summary}</div>`
        : '';
    const venues = Array.isArray(token.venues) ? token.venues.join('+') : '';
    const venueLine = token.multiVenue || venues
      ? `<div class="altcoin-depth-line" title="多所确认">${token.multiVenue ? '多所确认' : '来源'} ${venues || token.weeklySource || token.source || ''}</div>`
      : '';
    const cg = token.coinglass;
    const cgLine = cg
      ? `<div class="altcoin-depth-line" title="CoinGlass 可选">CG OI ${formatCompact(cg.openInterestUsd || 0)}</div>`
      : '';

    const score = token.signalScore ?? token.score ?? 0;
    const scoreBarWidth = Math.min(score, 100);
    const scoreClass = score >= 60 ? 'high' : score >= 30 ? 'med' : 'low';
    const actionChip = `<span class="altcoin-action-chip ${altcoinActionClass(act)}" title="${token.actionReason || ''}">${token.actionLabel || '观察'}</span>`;

    row.innerHTML = `
      <div class="td ${index < 3 ? 'rank-cell top-3' : 'rank-cell'}">${rankEmoji}</div>
      <div class="td token-cell">
        <div class="token-icon">${iconHtml}</div>
        <div class="token-info">
          <span class="token-symbol" title="${token.name || ''}">${token.symbol || 'Unknown'}${chainBadge}</span>
          <span class="token-name" title="${nameLine}">${token.name || token.pairLabel || ''}</span>
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
        ${actionChip}
        ${badgesHtml}
      </div>
      <div class="td signal-detail">
        <span class="signal-detail-text" title="${detailText}">${detailText || '--'}</span>
        ${venueLine}
        ${cgLine}
        ${depthLine}
      </div>
      <div class="td actions-cell">
        <a href="${marketUrl}" target="_blank" rel="noopener" class="action-btn primary" title="${pairHint}">${marketLabel === 'GMGN' ? '行情' : '详情'}</a>
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

async function fetchBitcoinApi(source = 'auto', period = '1d', seriesUnit = 'day') {
  const qs = new URLSearchParams();
  if (source && source !== 'auto') qs.set('source', source);
  if (period) qs.set('period', period);
  if (seriesUnit) qs.set('seriesUnit', seriesUnit);
  const q = qs.toString();
  const path = q ? `/api/bitcoin?${q}` : '/api/bitcoin';
  const response = await fetch(getApiUrl(path), { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `API错误: ${response.status}`);
  }
  return response.json();
}

async function loadBitcoinData() {
  state.btcLoading = true;
  state.btcError = null;
  const hasCache = !!state.btcData;
  // Soft refresh: keep last snapshot visible (no full-page flash)
  if (!hasCache) {
    dom.btcHeroLoading.style.display = 'flex';
    dom.btcHeroContent.style.display = 'none';
    setStatus('loading');
    updateSourceStatus('loading', '连接中...');
  } else {
    updateSourceStatus('loading', '刷新中...');
    if (dom.btcUpdated) dom.btcUpdated.textContent = '刷新…';
  }
  try {
    const result = await fetchBitcoinApi(
      state.btcPreferredSource,
      state.btcPeriod || '1h',
      state.btcSeriesUnit || 'day'
    );
    if (!result.success || !result.data) throw new Error('BTC API返回数据异常');
    state.btcData = result.data;
    state.btcSourceMeta = result.source || { active: 'auto', label: '自动', autoFallback: false };
    state.btcSourceHealth = result.sourceHealth || {};
    // Keep period selector in sync with server-resolved key
    if (result.data.periodBoard?.period) {
      state.btcPeriod = result.data.periodBoard.period;
    }
    if (result.data.selfTriSeries?.unit) {
      state.btcSeriesUnit = result.data.selfTriSeries.unit;
    }
    // Add to price history for sparkline
    const price = result.data.price?.index || result.data.price?.spot || 0;
    if (price >0) {
      const last = state.btcPriceHistory[state.btcPriceHistory.length - 1];
      // Avoid duplicate flat points within 8s
      if (!last || Date.now() - last.time >8000 || Math.abs(last.price - price) >0.01) {
        state.btcPriceHistory.push({ time: Date.now(), price });
      }
      if (state.btcPriceHistory.length >80) state.btcPriceHistory = state.btcPriceHistory.slice(-80);
    }
    renderBitcoinData();
    setStatus('');
    dom.btcHeroLoading.style.display = 'none';
    dom.btcHeroContent.style.display = 'block';
    state.btcSourceRetryCount = 0;
    updateSourceStatus(state.btcSourceMeta, state.btcSourceHealth);
  } catch (err) {
    console.error('BTC load error:', err);
    state.btcError = err.message;
    state.btcSourceRetryCount++;
    // Attempt auto-fallback: if we have a specific source selected, try auto mode
    if (state.btcPreferredSource !== 'auto' && state.btcSourceRetryCount <= state.btcSourceMaxRetries) {
      const sourceName = state.btcPreferredSource.charAt(0).toUpperCase() + state.btcPreferredSource.slice(1);
      showToast(`${sourceName} 无响应，自动回退到其他数据源...`, 'warning');
      state.btcPreferredSource = 'auto';
      dom.btcSourceBtns.forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.source === 'auto');
      });
      setTimeout(() =>loadBitcoinData(), 1000);
      return;
    }
    if (!hasCache) {
      showToast(`BTC数据加载失败: ${err.message}`, 'error');
      dom.btcHeroLoading.innerHTML = `<div class="error-icon"></div><p style="color:var(--accent-red)">BTC 数据加载失败</p><button class="retry-btn" onclick="loadBitcoinData()" style="margin-top:12px">重试</button>`;
      updateSourceStatus('error', '所有数据源不可用');
      setStatus('error');
    } else {
      showToast(`BTC 刷新失败，保留上次数据: ${err.message}`, 'warning');
      updateSourceStatus('error', '刷新失败 · 显示缓存');
      if (dom.btcUpdated) dom.btcUpdated.textContent = '缓存';
    }
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
    // 统一自信号源文案，不展示 Binance/Bybit 等单所名
    const ok = health && typeof health === 'object'
      ? Object.values(health).filter((h) =>h && h.available && h.healthy && !h.stale).length
      : 0;
    const total = health && typeof health === 'object'
      ? Object.values(health).filter((h) =>h && h.available).length
      : 0;
    dom.sourceStatusDot.className = 'source-status-dot healthy';
    if (total >0 && ok < total) {
      dom.sourceStatusDot.className = 'source-status-dot warning';
      dom.sourceStatusText.textContent = `自信号源 · ${ok}/${total} 有效`;
    } else {
      dom.sourceStatusText.textContent = total >0 ? `自信号源 · 全量` : `自信号源 · ${label || '就绪'}`;
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
    dom.sourceStatusText.textContent = detail || '错误';
  } else {
    dom.sourceStatusDot.classList.add('healthy');
    dom.sourceStatusText.textContent = detail || '正常';
  }
}

function formatFundingChip(rate) {
  if (rate == null || !Number.isFinite(Number(rate))) return '--';
  const r = Number(rate);
  const sign = r >0 ? '+' : '';
  return `${sign}${(r * 100).toFixed(4)}%`;
}

function renderBtcMarketBias(bias) {
  if (!dom.btcBiasStrip) return;
  if (!bias || bias.score == null) {
    dom.btcBiasStrip.hidden = true;
    return;
  }
  dom.btcBiasStrip.hidden = false;
  const score = Math.max(0, Math.min(100, Number(bias.score) || 50));
  // 无中性：仅 bull / bear
  const tone = bias.tone === 'bull' || bias.label === '看多' ? 'bull' : 'bear';
  if (dom.btcBiasLabel) {
    dom.btcBiasLabel.textContent = bias.label === '看多' || tone === 'bull' ? '看多' : '看空';
    dom.btcBiasLabel.className = `btc-bias-value tone-${tone}`;
  }
  if (dom.btcBiasScore) dom.btcBiasScore.textContent = `${score}`;
  if (dom.btcBiasBar) {
    dom.btcBiasBar.style.width = `${score}%`;
    dom.btcBiasBar.className = `btc-bias-bar-fill tone-${tone}`;
  }
  if (dom.btcBiasSummary) {
    const drivers = Array.isArray(bias.drivers) ? bias.drivers.slice(0, 2).join(' · ') : '';
    dom.btcBiasSummary.textContent =
      drivers || bias.summary || (tone === 'bull' ? '资金费率正数 · 看多' : '资金费率非正 · 看空');
  }
}

function renderBtcFundingVenues(futures = {}, periodAgg = null) {
  // 页面只展示自信号源均费率，不列出单所
  const fromAgg = periodAgg?.fundingCurrentAvg ?? periodAgg?.fundingAvg;
  const v = futures.fundingVenues || {};
  const samples = [v.binance, v.bybit, v.okx, v.bitget, v.hyperLiquid]
    .map(Number)
    .filter((n) =>Number.isFinite(n));
  const mean =
    fromAgg != null && Number.isFinite(Number(fromAgg))
      ? Number(fromAgg)
      : samples.length
        ? samples.reduce((a, b) =>a + b, 0) / samples.length
        : null;
  const hasAny = mean != null;
  if (dom.btcFundingVenues) dom.btcFundingVenues.hidden = !hasAny;
  if (dom.fundSelfAvg) {
    dom.fundSelfAvg.textContent = `均费率 ${formatFundingChip(mean)}`;
    dom.fundSelfAvg.className = 'btc-fund-chip';
    if (mean != null) {
      dom.fundSelfAvg.classList.add(mean >0 ? 'pos' : mean < 0 ? 'neg' : 'flat');
    }
  }
}

function formatOiChange(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return '—';
  const n = Number(pct);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

function formatUsdPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderStageAverages(stages = []) {
  if (!dom.btcStageGrid) return;
  const byKey = Object.fromEntries((stages || []).map((s) => [s.period, s]));
  dom.btcStageGrid.querySelectorAll('.btc-stage-card').forEach((card) => {
    const key = card.dataset.stage;
    const s = byKey[key];
    const agg = s?.aggregate || {};
    const set = (sel, text, cls) => {
      const el = card.querySelector(sel);
      if (!el) return;
      el.textContent = text;
      el.className = sel.replace('.', '') + (cls ? ` ${cls}` : '');
    };
    set('.st-price', formatUsdPrice(agg.priceAvg));
    // 必须用窗口内结算均值，禁止用现价 current 冒充各周期
    const fund = agg.fundingAvg;
    const fundN = agg.sample?.fundingInlierN ?? agg.sample?.fundingN ?? s?.fundingSampleN;
    set(
      '.st-fund',
      fund != null && Number.isFinite(Number(fund)) ? formatFundingChip(fund) : '—',
      Number(fund) > 0 ? 'pos' : Number(fund) < 0 ? 'neg' : ''
    );
    set('.st-fund-n', fundN != null ? String(fundN) : '—');
    set('.st-vol', agg.volumeQuoteAvg != null ? formatCompact(agg.volumeQuoteAvg) : '—');
    card.classList.toggle('active-stage', key === (state.btcPeriod || '1h'));
    card.classList.toggle('empty-stage', !s?.available);
  });
}

function renderPeriodVenueBoard(board) {
  const status = dom.periodVenueStatus;
  const body = dom.btcVenueTableBody;
  if (!body) return;

  // Sync TF buttons
  const period = board?.period || state.btcPeriod || '1h';
  if (dom.btcTfBtns?.length) {
    dom.btcTfBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.period === period);
    });
  }

  if (!board || !board.venues || !Object.keys(board.venues).length) {
    if (status) {
      status.textContent = board?.error ? '自信号源异常' : '自信号源暂无';
      status.style.background = 'rgba(255,193,7,0.1)';
      status.style.color = '#fbbf24';
    }
    body.innerHTML = `<tr><td colspan="8" class="btc-venue-empty">${board?.error || '自信号源暂不可用'}</td></tr>`;
    renderStageAverages(board?.stageAverages || []);
    return;
  }

  // 自信号源均值（某节点延误/丢失时仅用有效节点）
  const agg = board.fiveVenueAvg || board.aggregate || {};
  const n = agg.venueCount || Object.keys(board.venues).length;
  const expected = agg.expectedVenues || 5;
  const quality = agg.qualityLabel || (n >= expected ? '自信号源 · 全量' : `自信号源 · ${n}/${expected} 有效`);

  if (status) {
    status.textContent = quality;
    status.style.background = agg.degraded ? 'rgba(234,179,8,0.12)' : 'rgba(34,197,94,0.1)';
    status.style.color = agg.degraded ? '#fbbf24' : '#22c55e';
  }
  if (dom.btcAvgPeriodLabel) dom.btcAvgPeriodLabel.textContent = board.label || period;
  if (dom.btcSelfSourceMeta) {
    dom.btcSelfSourceMeta.textContent = agg.degraded
      ? `${quality} · 延误节点已剔除`
      : `${quality} · 多节点聚合均值`;
  }

  if (dom.aggPrice) dom.aggPrice.textContent = formatUsdPrice(agg.priceAvg);
  if (dom.aggFunding) {
    // 计费窗均费率 = 窗口内结算样本稳健均值（fundingAvg），绝不用现价顶替
    const f = agg.fundingAvg;
    const n = agg.sample?.fundingInlierN ?? agg.sample?.fundingN;
    if (f != null && Number.isFinite(Number(f))) {
      dom.aggFunding.textContent = formatFundingChip(f);
      dom.aggFunding.className = Number(f) > 0 ? 'pos' : Number(f) < 0 ? 'neg' : '';
      const raw = agg.fundingAvgRaw;
      dom.aggFunding.title =
        raw != null && Math.abs(Number(raw) - Number(f)) > 1e-12
          ? `计费窗结算样本稳健均值（n=${n ?? '?'}）；未剔除前 ${formatFundingChip(raw)}`
          : `计费窗内资金费结算样本均值（n=${n ?? '?'}）；负值=空头付多`;
    } else {
      dom.aggFunding.textContent = '—';
      dom.aggFunding.className = '';
      dom.aggFunding.title = '本计费窗内无足够结算样本，不显示伪造均值';
    }
  }
  if (dom.aggOiEnd) {
    dom.aggOiEnd.textContent = agg.oiEndAvg != null ? formatCompact(agg.oiEndAvg) : '—';
  }
  if (dom.aggOi) {
    dom.aggOi.textContent = formatOiChange(agg.oiChangePctAvg);
    dom.aggOi.className = Number(agg.oiChangePctAvg) > 0 ? 'pos' : Number(agg.oiChangePctAvg) < 0 ? 'neg' : '';
  }
  if (dom.aggVol) {
    dom.aggVol.textContent = agg.volumeQuoteAvg != null ? formatCompact(agg.volumeQuoteAvg) : '—';
  }
  if (dom.aggVenues) {
    const fIn = agg.sample?.fundingInlierN;
    const fAll = agg.sample?.fundingN;
    dom.aggVenues.textContent =
      fIn != null && fAll != null ? `${n}/${expected} · 费率${fIn}/${fAll}` : `${n}/${expected}`;
    dom.aggVenues.title = '有效节点 / 期望节点；费率入均数 / 费率样本数';
  }

  // 特别提醒：偏离全样本均值 ±10% 的资金费率节点
  renderFundingOutlierAlert(agg);

  // 1h / 1d / 1w 阶段平均
  renderStageAverages(board.stageAverages || []);

  // 汇总行：均费率=计费窗样本；现费率=最新快照（可与窗均不同）
  const fAvg = agg.fundingAvg;
  const fCur = agg.fundingCurrentAvg;
  const outliers = Array.isArray(agg.fundingOutliers) ? agg.fundingOutliers : [];
  const fAvgTxt =
    fAvg != null && Number.isFinite(Number(fAvg)) ? formatFundingChip(fAvg) : '—';
  const fCurTxt =
    fCur != null && Number.isFinite(Number(fCur)) ? formatFundingChip(fCur) : '—';
  let rows = `
    <tr class="btc-venue-avg-row">
      <td class="venue-name">自信号源（计费窗）</td>
      <td>${formatUsdPrice(agg.priceAvg)}</td>
      <td class="${Number(fAvg) > 0 ? 'pos' : Number(fAvg) < 0 ? 'neg' : ''}">${fAvgTxt}</td>
      <td class="${Number(fCur) > 0 ? 'pos' : Number(fCur) < 0 ? 'neg' : ''}">${fCurTxt}</td>
      <td class="${Number(agg.oiChangePctAvg) > 0 ? 'pos' : Number(agg.oiChangePctAvg) < 0 ? 'neg' : ''}">${formatOiChange(agg.oiChangePctAvg)}</td>
      <td>${agg.oiEndAvg != null ? formatCompact(agg.oiEndAvg) : '—'}</td>
      <td>${agg.volumeQuoteAvg != null ? formatCompact(agg.volumeQuoteAvg) : '—'}</td>
      <td class="${Number(agg.priceChangePctAvg) > 0 ? 'pos' : Number(agg.priceChangePctAvg) < 0 ? 'neg' : ''}">${agg.priceChangePctAvg != null ? `${agg.priceChangePctAvg >= 0 ? '+' : ''}${Number(agg.priceChangePctAvg).toFixed(2)}%` : '—'}</td>
    </tr>`;
  for (const o of outliers) {
    const cls = Number(o.rate8h) > 0 ? 'pos' : Number(o.rate8h) < 0 ? 'neg' : '';
    const side = Number(o.deviation) > 0 ? '偏高' : '偏低';
    rows += `
    <tr class="btc-fund-outlier-row">
      <td class="venue-name">异常 · ${o.label || o.key}</td>
      <td colspan="1">—</td>
      <td class="${cls}" colspan="2">${formatFundingChip(o.rate8h)} <span class="outlier-tag">偏离${side} ${Math.abs(o.deviationPct || 0).toFixed(0)}%</span></td>
      <td colspan="4" class="outlier-explain">未计入计费窗均值 · 原生 ${formatFundingChip(o.raw)}</td>
    </tr>`;
  }
  body.innerHTML = rows;

  if (dom.btcPeriodHint) {
    const n = agg.sample?.fundingN ?? 0;
    const fundNote =
      fAvg == null
        ? '本计费窗无足够资金费结算样本，均费率不显示'
        : outliers.length > 0
          ? `计费窗均费率：${n} 源样本，剔除 ${outliers.length} 异常后重均`
          : `计费窗均费率：${n} 源结算样本相加取平均`;
    dom.btcPeriodHint.textContent = `计费窗 ${board.label || period} · ${quality} · ${fundNote} · 1h/2h/4h 各自独立计算`;
  }
}

function renderFundingOutlierAlert(agg = {}) {
  const box = dom.btcFundOutlierAlert;
  const list = dom.btcFundOutlierList;
  const note = dom.btcFundOutlierNote;
  if (!box || !list) return;
  const outliers = Array.isArray(agg.fundingOutliers) ? agg.fundingOutliers : [];
  if (!outliers.length) {
    box.hidden = true;
    list.innerHTML = '';
    if (note) note.textContent = '';
    return;
  }
  box.hidden = false;
  list.innerHTML = outliers
    .map((o) => {
      const cls = Number(o.rate8h) > 0 ? 'pos' : Number(o.rate8h) < 0 ? 'neg' : '';
      const side = Number(o.deviation) > 0 ? '高于' : '低于';
      return `<span class="btc-fund-outlier-chip ${cls}" title="8h等价 ${formatFundingChip(o.rate8h)} · 原生 ${formatFundingChip(o.raw)}">
        <b>${o.label || o.key}</b>
        ${formatFundingChip(o.rate8h)}
        <em>${side}均值 ${Math.abs(o.deviationPct || 0).toFixed(0)}%</em>
      </span>`;
    })
    .join('');
  if (note) {
    const raw = agg.fundingAvgRaw ?? agg.fundingCurrentAvgRaw;
    const clean = agg.fundingAvg ?? agg.fundingCurrentAvg;
    note.textContent =
      agg.fundingRobust?.windowAvg?.note ||
      agg.fundingRobust?.current?.note ||
      `计费窗：未剔除前 ${formatFundingChip(raw)} → 剔除后 ${formatFundingChip(clean)}`;
  }
}

function setBtcPeriod(period) {
  const next = String(period || '1h');
  if (state.btcPeriod === next && state.btcData?.periodBoard) return;
  state.btcPeriod = next;
  if (dom.btcTfBtns?.length) {
    dom.btcTfBtns.forEach((btn) =>btn.classList.toggle('active', btn.dataset.period === next));
  }
  // Soft reload with new timeframe
  loadBitcoinData();
}

function renderBitcoinData() {
  if (!state.btcData) return;
  const d = state.btcData;

  // Sync source buttons with preferred mode (not only API active)
  const preferred = state.btcPreferredSource || state.btcSourceMeta?.preferred || 'auto';
  if (dom.btcSourceBtns?.length) {
    dom.btcSourceBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.source === preferred);
    });
  }

  // Price hero：优先自信号源均价；缺源时回退合成价
  const selfAvg = d.periodBoard?.fiveVenueAvg || d.periodBoard?.aggregate || {};
  const price =
    (selfAvg.priceAvg >0 ? selfAvg.priceAvg : 0) ||
    d.price?.index ||
    d.price?.spot ||
    0;
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

  // Composite bias + 自信号源费率/周期看板
  renderBtcMarketBias(d.marketBias);
  renderBtcFundingVenues(d.futures, selfAvg);
  renderPeriodVenueBoard(d.periodBoard);

  // Sparkline
  if (dom.btcSparkline && state.btcPriceHistory.length >= 2) {
    drawSparkline(dom.btcSparkline, state.btcPriceHistory);
  }

  // 合约数据卡：优先自信号源多节点均值（CEX + DEX Perps）
  // 合约卡费率：优先计费窗样本均值，其次现价稳健均
  const fundMean =
    selfAvg.fundingAvg != null
      ? Number(selfAvg.fundingAvg)
      : selfAvg.fundingCurrentAvg != null
        ? Number(selfAvg.fundingCurrentAvg)
        : Number(d.futures?.avgFundingRate ?? d.futures?.fundingRate) || 0;
  const annualMean =
    fundMean !== 0
      ? fundMean * 3 * 365 * 100
      : Number(d.futures?.annualFundingRate) || 0;
  if (dom.btcFundingRate) {
    const frText = fundMean !== 0 ? `${(fundMean * 100).toFixed(4)}%` : '--';
    dom.btcFundingRate.textContent = frText;
    dom.btcFundingRate.className = `btc-metric-value ${getChangeClass(fundMean)}`;
  }
  if (dom.btcAnnualFunding) {
    const afText = annualMean !== 0 ? `${annualMean.toFixed(2)}%` : '--';
    dom.btcAnnualFunding.textContent = afText;
    dom.btcAnnualFunding.className = `btc-metric-value ${getChangeClass(annualMean)}`;
  }
  const oiMean =
    selfAvg.oiEndAvg != null
      ? Number(selfAvg.oiEndAvg)
      : Number(d.futures?.openInterestUsd || d.futures?.openInterest || 0);
  if (dom.btcOpenInterest) {
    dom.btcOpenInterest.textContent =
      oiMean > 0 ? formatCompact(oiMean) : '--';
  }
  const markPx =
    selfAvg.priceAvg != null
      ? Number(selfAvg.priceAvg)
      : Number(d.price?.mark || d.price?.index || 0);
  if (dom.btcMarkPrice) {
    dom.btcMarkPrice.textContent = markPx
      ? `$${markPx.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '$--';
  }
  if (dom.btcNextFundingTime) {
    if (d.futures?.nextFundingTime) {
      let nextTs = Number(d.futures.nextFundingTime);
      if (nextTs > 0 && nextTs < 1e12) nextTs *= 1000;
      const remaining = nextTs - Date.now();
      dom.btcNextFundingTime.textContent = remaining > 0 ? formatDuration(remaining) : '即将';
    } else {
      dom.btcNextFundingTime.textContent = '--';
    }
  }
  // 有效节点 / 均量 / 稳定性（含 nodeCollection 诊断）
  const nodeCol = d.nodeCollection || d.periodBoard?.nodeCollection || null;
  const nOk =
    nodeCol?.venueCount != null
      ? Number(nodeCol.venueCount)
      : selfAvg.venueCount != null
        ? Number(selfAvg.venueCount)
        : null;
  const nExp = nodeCol?.expectedVenues || selfAvg.expectedVenues || 6;
  const onlineKeys = nodeCol?.online || selfAvg.venueKeys || selfAvg.stability?.online || [];
  const offlineKeys = nodeCol?.offline || selfAvg.offlineKeys || selfAvg.stability?.offline || [];
  if (dom.btcContractNodes) {
    dom.btcContractNodes.textContent = nOk != null ? `${nOk}/${nExp}` : '--';
    const detail = nodeCol?.detail || selfAvg.stability?.venues || {};
    const lines = (nodeCol?.expected || Object.keys(detail) || []).map((k) => {
      const row = detail[k] || {};
      const st = row.ok ? '✓' : '✗';
      const err = row.lastError ? ` (${row.lastError})` : '';
      return `${st} ${k}${err}`;
    });
    dom.btcContractNodes.title = lines.length
      ? lines.join('\n')
      : offlineKeys.length
        ? `离线: ${offlineKeys.join(', ')}`
        : '节点收集';
  }
  if (dom.btcContractVol) {
    const v =
      selfAvg.volumeQuoteAvg != null ? Number(selfAvg.volumeQuoteAvg) : null;
    dom.btcContractVol.textContent = v != null && v > 0 ? formatCompact(v) : '--';
  }
  const stab = selfAvg.stability || d.periodBoard?.venueStability || null;
  if (dom.btcContractStability) {
    if (stab || offlineKeys.length || onlineKeys.length) {
      const on = onlineKeys.length || (stab?.online || []).length;
      const off = offlineKeys.length || (stab?.offline || []).length;
      const offNames = (offlineKeys.length ? offlineKeys : stab?.offline || [])
        .map((k) => k)
        .join('/');
      dom.btcContractStability.textContent =
        off === 0
          ? `全量在线 ${on}`
          : `在线 ${on} · 离线 ${off}${offNames ? ` (${offNames})` : ''}`;
      dom.btcContractStability.title = offlineKeys
        .map((k) => {
          const err = nodeCol?.detail?.[k]?.lastError || 'offline';
          return `${k}: ${err}`;
        })
        .join('\n');
    } else {
      dom.btcContractStability.textContent =
        nOk != null ? (nOk >= nExp ? '全量' : `降级 ${nOk}/${nExp}`) : '检测中';
    }
  }
  if (dom.contractDataStatus) {
    const q = nodeCol?.qualityLabel || selfAvg.qualityLabel || '自信号源';
    dom.contractDataStatus.textContent = q;
    dom.contractDataStatus.style.background =
      nOk != null && nOk >= nExp - 1
        ? 'rgba(34,197,94,0.1)'
        : 'rgba(255,193,7,0.1)';
    dom.contractDataStatus.style.color =
      nOk != null && nOk >= nExp - 1 ? '#22c55e' : '#fbbf24';
  }
  if (dom.contractDataHint) {
    const stages = (d.periodBoard?.stageAverages || nodeCol?.stages || [])
      .map((s) => `${s.period}:${s.venueCount ?? 0}`)
      .join(' ');
    const base =
      stab?.policy ||
      'CEX + DEX Perps 有效节点报价/费率/OI/成交量 · 相加取平均 · 缺源剔除 · 恢复后重新纳入';
    dom.contractDataHint.textContent = stages
      ? `${base} · 窗节点 ${stages}`
      : base;
  }

  // 市场情绪卡（与合约数据栏对齐：指标 + 状态徽标 + ETF 流）
  const sent = d.sentiment || {};
  const domPct = Number(sent.btcDominance) || 0;
  const mcap = Number(sent.totalMarketCap) || 0;
  const tvol = Number(sent.totalVolume24h) || 0;
  const mcChange = Number(sent.marketCapChange24h) || 0;
  const sentOk = domPct > 0 || mcap > 0 || tvol > 0;

  if (dom.btcDominance) {
    dom.btcDominance.textContent = domPct > 0 ? `${domPct.toFixed(1)}%` : '--';
  }
  if (dom.btcTotalMarketCap) {
    dom.btcTotalMarketCap.textContent = mcap > 0 ? formatCompact(mcap) : '--';
  }
  if (dom.btcTotalVolume) {
    dom.btcTotalVolume.textContent = tvol > 0 ? formatCompact(tvol) : '--';
  }
  if (dom.btcMarketCapChange) {
    if (sentOk || mcChange !== 0) {
      dom.btcMarketCapChange.textContent = formatChange(mcChange);
      dom.btcMarketCapChange.className = `btc-metric-value ${getChangeClass(mcChange)}`;
    } else {
      dom.btcMarketCapChange.textContent = '--';
      dom.btcMarketCapChange.className = 'btc-metric-value';
    }
  }

  // 恐惧贪婪
  if (dom.btcFearGreed) {
    const fg = sent.fearGreed;
    const fgl = sent.fearGreedLabel;
    if (fg != null && Number.isFinite(Number(fg))) {
      dom.btcFearGreed.textContent = fgl ? `${fg} · ${fgl}` : `${fg}`;
      const n = Number(fg);
      dom.btcFearGreed.className = `btc-metric-value ${
        n >= 55 ? 'positive' : n <= 45 ? 'negative' : ''
      }`.trim();
    } else {
      dom.btcFearGreed.textContent = '--';
      dom.btcFearGreed.className = 'btc-metric-value';
    }
  }

  // 彩虹图 / 减半 / 200DMA
  const cycle = sent.cycle || {};
  const rainbow = cycle.rainbow || null;
  const halving = cycle.halving || null;
  const ma200 = cycle.ma200 || null;

  if (dom.btcRainbowBand) {
    if (rainbow?.bandLabel) {
      const dist =
        rainbow.distancePct != null
          ? ` ${rainbow.distancePct >= 0 ? '+' : ''}${rainbow.distancePct}%`
          : '';
      dom.btcRainbowBand.textContent = `${rainbow.bandLabel}${dist}`;
      dom.btcRainbowBand.style.color = rainbow.bandColor || '';
      dom.btcRainbowBand.title = `色带 ${rainbow.bandIndex + 1}/9 · 创世+${rainbow.daysSinceGenesis}d`;
    } else {
      dom.btcRainbowBand.textContent = '--';
      dom.btcRainbowBand.style.color = '';
    }
  }

  if (dom.btcHalvingCycle) {
    if (halving && (halving.progressPct != null || halving.cycleLabel)) {
      const label = halving.cycleLabel || (halving.cycleNumber != null ? `第 ${halving.cycleNumber} 周期` : '');
      const prog = halving.progressPct != null ? `${halving.progressPct}%` : '--';
      const sinceDays =
        halving.daysSinceLast ?? halving.daysSinceHalving ?? halving.cycleElapsedDays;
      const toNext = halving.daysToNext ?? halving.daysLeft;
      const since =
        sinceDays != null ? ` · 已过${Math.floor(sinceDays)}天` : '';
      const left =
        toNext != null
          ? ` · 距下次${Number(toNext) % 1 === 0 ? Math.floor(toNext) : Number(toNext).toFixed(0)}天`
          : '';
      dom.btcHalvingCycle.textContent = `${label} ${prog}${since}${left}`.trim();
      // tooltip：确认日期 + 高度
      const tip = [
        halving.lastHalvingDateUtc
          ? `上次减半 ${halving.lastHalvingDateUtc} UTC`
          : null,
        halving.lastHalvingHeight != null
          ? `块高 #${halving.lastHalvingHeight}`
          : null,
        sinceDays != null ? `距上次 ${Math.floor(sinceDays)} 天` : null,
        halving.nextHalvingDateUtc
          ? `下次约 ${halving.nextHalvingDateUtc} UTC`
          : null,
        halving.nextHalvingHeight != null
          ? `目标块 #${halving.nextHalvingHeight}`
          : null,
        toNext != null ? `距下次约 ${toNext} 天` : null,
        halving.blocksLeft != null ? `剩余 ${halving.blocksLeft} 块` : null,
        halving.height != null ? `当前高度 ${halving.height}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      dom.btcHalvingCycle.title = tip;
    } else {
      dom.btcHalvingCycle.textContent = '--';
      if (dom.btcHalvingCycle) dom.btcHalvingCycle.title = '';
    }
  }

  if (dom.btcMa200) {
    const maPrice = ma200?.ma200 ?? ma200?.priceMa200;
    if (ma200?.available && maPrice != null && Number(maPrice) > 0) {
      const ma = Number(maPrice);
      // 主显示：直接给出 200 日均线今日报价
      dom.btcMa200.textContent = `$${ma.toLocaleString('en-US', {
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      })}`;
      const vs = ma200.vsPct;
      const side =
        ma200.side === 'above' ? '现价在均线上方' : ma200.side === 'below' ? '现价在均线下方' : '';
      const vsTxt = vs != null ? `${vs >= 0 ? '+' : ''}${vs}%` : '';
      dom.btcMa200.title = [
        `BTC 200 日均线 $${ma.toLocaleString('en-US', { maximumFractionDigits: 2 })}`,
        ma200.asOfUtc ? `截至 ${ma200.asOfUtc} UTC` : null,
        ma200.period ? `样本 ${ma200.period} 日` : null,
        side || null,
        vsTxt ? `偏离 ${vsTxt}` : null,
        ma200.source ? `源 ${ma200.source}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      dom.btcMa200.className = `btc-metric-value ${
        ma200.side === 'above' ? 'positive' : ma200.side === 'below' ? 'negative' : ''
      }`.trim();
    } else {
      dom.btcMa200.textContent = '--';
      dom.btcMa200.title = ma200?.error ? `MA200 暂不可用: ${ma200.error}` : '';
      dom.btcMa200.className = 'btc-metric-value';
    }
  }

  // 信号源：简洁一行（全局 + 周期模型）
  if (dom.btcSources) {
    const mkt = sent.source || 'global';
    const cycOk = !!(rainbow || (ma200 && ma200.available) || (halving && halving.progressPct != null));
    dom.btcSources.textContent = cycOk
      ? `${mkt} · 彩虹/减半/MA200`
      : `${mkt} · 周期计算中`;
  }

  if (dom.sentimentDataStatus) {
    const cycOk = !!(rainbow && ma200?.available);
    if (sentOk && cycOk) {
      dom.sentimentDataStatus.textContent = '周期就绪';
      dom.sentimentDataStatus.style.background = 'rgba(34,197,94,0.1)';
      dom.sentimentDataStatus.style.color = '#22c55e';
    } else if (sentOk) {
      dom.sentimentDataStatus.textContent = '全局就绪';
      dom.sentimentDataStatus.style.background = 'rgba(34,197,94,0.1)';
      dom.sentimentDataStatus.style.color = '#22c55e';
    } else {
      dom.sentimentDataStatus.textContent = '加载中';
      dom.sentimentDataStatus.style.background = 'rgba(255,193,7,0.1)';
      dom.sentimentDataStatus.style.color = '#fbbf24';
    }
  }
  if (dom.sentimentDataHint) {
    const mkt = sent.source || 'multi';
    const band = rainbow?.bandLabel || '--';
    const since =
      halving?.daysSinceLast ?? halving?.daysSinceHalving;
    const toNext = halving?.daysToNext ?? halving?.daysLeft;
    const half =
      since != null && toNext != null
        ? `已过${Math.floor(since)}d/剩${Math.round(toNext)}d`
        : halving?.progressPct != null
          ? `${halving.progressPct}%`
          : '--';
    const maRaw = ma200?.ma200 ?? ma200?.priceMa200;
    const ma = maRaw != null ? `$${Number(maRaw).toFixed(0)}` : '--';
    dom.sentimentDataHint.textContent = `${mkt} · 彩虹 ${band} · 减半 ${half} · MA200 ${ma}`;
  }

  // ---- 田字框架：多空 + 清算（自信号源综合）----
  renderTianFrame(d);

  // ---- 自信号源三量直角坐标图 ----
  renderSelfTriSeries(d.selfTriSeries);
}

/**
 * 田字清算图（坐标系硬规则）
 * ┌────────────────────────────────────┐
 * │  上 = 空头 OI 区（暗红+纹理）        │
 * │············ 横线 OI 情绪 ··········│  ← 1h/4h OI 开仓情绪上下移动
 * │  下 = 多头 OI 区（暗绿+纹理）        │
 * │  左=多爆仓  │现价竖线│  右=空爆仓   │  ← 竖线随市价左右移
 * └────────────────────────────────────┘
 * - 多头清算柱：只画在现价竖线左侧（价 ≤ 市价）
 * - 空头清算柱：只画在现价竖线右侧（价 ≥ 市价）
 * - 柱高 = 该价位清算金额
 */
const tianMapState = {
  bound: false,
  clickBound: false,
  dpr: 1,
  layout: null,
  lastPayload: null,
  tipTimer: null,
  hatchCanvas: null,
};

/** 按侧别聚合清算价位（不做混色合并，避免绿柱跑到竖线右边） */
function buildTianSideBuckets(rows, side) {
  const map = new Map();
  for (const r of rows || []) {
    const price = Number(r.price);
    const usd = Number(r.usd) || 0;
    if (!(price > 0) || !(usd > 0)) continue;
    // 价位桶：相对精度（BTC 约 0.05% 或 $5）
    const step = Math.max(5, price * 0.0004);
    const key = Math.round(price / step) * step;
    const prev = map.get(key) || { price: key, usd: 0, n: 0, side };
    prev.usd += usd;
    prev.n += 1;
    map.set(key, prev);
  }
  return [...map.values()]
    .map((b) => ({
      price: b.price,
      usd: b.usd,
      side,
      longUsd: side === 'long' ? b.usd : 0,
      shortUsd: side === 'short' ? b.usd : 0,
    }))
    .filter((c) => c.usd > 0)
    .sort((a, b) => a.price - b.price);
}

/**
 * 强制空间语义：
 *  long  → 只能在现价左侧（≤ price）
 *  short → 只能在现价右侧（≥ price）
 *  错侧噪声：丢弃（交易所历史回执偶发错边）
 */
function placeCandlesByMarketSide(longBuckets, shortBuckets, marketPrice) {
  const px = Number(marketPrice) || 0;
  const longs = [];
  const shorts = [];
  for (const c of longBuckets || []) {
    if (px > 0 && c.price > px * 1.0002) continue; // 多爆仓不应远高于现价
    longs.push({ ...c, side: 'long', price: px > 0 ? Math.min(c.price, px) : c.price });
  }
  for (const c of shortBuckets || []) {
    if (px > 0 && c.price < px * 0.9998) continue; // 空爆仓不应远低于现价
    shorts.push({ ...c, side: 'short', price: px > 0 ? Math.max(c.price, px) : c.price });
  }
  return { longs, shorts, candles: [...longs, ...shorts].sort((a, b) => a.price - b.price) };
}

/**
 * 1h + 4h OI 开仓情绪 → 空头占比 0–1（驱动横线 Y）
 * 基线：账户多空比；叠加 1h/4h OI 变动（涨=偏多压低横线，跌=偏空抬高横线）
 */
function computeOiSentiment(d, stages, longPct, shortPct) {
  let longShare = Math.max(0.05, Math.min(0.95, (Number(longPct) || 50) / 100));
  let shortShare = Math.max(0.05, Math.min(0.95, 1 - longShare));

  const stage1h = stages.find((s) => s.period === '1h') || null;
  const stage4h = stages.find((s) => s.period === '4h') || null;
  const agg1h = stage1h?.aggregate || stage1h?.fiveVenueAvg || {};
  const agg4h = stage4h?.aggregate || stage4h?.fiveVenueAvg || {};
  // 当前 period 板也可能是 1h
  const boardAgg =
    d.periodBoard?.period === '1h' || d.periodBoard?.period === '4h'
      ? d.periodBoard?.fiveVenueAvg || d.periodBoard?.aggregate || {}
      : {};

  const oiCh1h = Number(agg1h.oiChangePctAvg ?? boardAgg.oiChangePctAvg);
  const oiCh4h = Number(agg4h.oiChangePctAvg);
  // 加权：1h 60% · 4h 40%（4h 缺失则全用 1h）
  let oiChBlend = null;
  if (Number.isFinite(oiCh1h) && Number.isFinite(oiCh4h)) {
    oiChBlend = oiCh1h * 0.6 + oiCh4h * 0.4;
  } else if (Number.isFinite(oiCh1h)) {
    oiChBlend = oiCh1h;
  } else if (Number.isFinite(oiCh4h)) {
    oiChBlend = oiCh4h;
  }

  // OI 增 → 偏多：longShare ↑；OI 减 → 偏空
  if (oiChBlend != null) {
    // ±3% 变动映射到 ±12pp 情绪
    const delta = Math.max(-0.12, Math.min(0.12, (oiChBlend / 3) * 0.12));
    longShare = Math.max(0.08, Math.min(0.92, longShare + delta));
    shortShare = 1 - longShare;
  }

  const oiUsd =
    Number(agg4h.oiEndAvg) ||
    Number(agg1h.oiEndAvg) ||
    Number(boardAgg.oiEndAvg) ||
    Number(d.futures?.openInterestUsd) ||
    Number(d.openInterest?.totalOiUsd) ||
    0;

  return {
    longShare,
    shortShare,
    longPct: longShare * 100,
    shortPct: shortShare * 100,
    oiUsd,
    oiCh1h: Number.isFinite(oiCh1h) ? oiCh1h : null,
    oiCh4h: Number.isFinite(oiCh4h) ? oiCh4h : null,
    oiChBlend,
  };
}

function renderTianFrame(d) {
  if (!dom.tianFrame && !dom.tianStatus) return;

  const stages = Array.isArray(d.periodBoard?.stageAverages) ? d.periodBoard.stageAverages : [];
  const lsr = d.longShortRatio;
  const liq = d.liquidations;
  const w4 = liq?.summary?.window4h || null;
  const sum = liq?.summary || {};
  const venues = Array.isArray(liq?.venues) ? liq.venues : Object.keys(liq?.sources || {});

  if (dom.tianStatus) {
    if (!venues.length && !sum.available) {
      dom.tianStatus.textContent = '…';
      dom.tianStatus.style.background = 'rgba(255,193,7,0.1)';
      dom.tianStatus.style.color = '#fbbf24';
    } else {
      dom.tianStatus.textContent = venues.length ? venues.join('+') : '4h';
      dom.tianStatus.style.background = 'rgba(34,197,94,0.1)';
      dom.tianStatus.style.color = '#22c55e';
    }
  }

  const price =
    Number(d.price?.mark) ||
    Number(d.price?.index) ||
    Number(d.price?.spot) ||
    Number(d.futures?.priceAvg) ||
    0;

  const sources = Object.values(lsr?.sources || {}).filter((s) => s && Number(s.ratio) > 0);
  let ratio = Number(lsr?.summary?.avgRatio) || 0;
  if ((!Number.isFinite(ratio) || ratio <= 0) && sources.length) {
    ratio = sources.reduce((a, s) => a + Number(s.ratio), 0) / sources.length;
  }
  let longPct = 0;
  let shortPct = 0;
  if (sources.length) {
    longPct = sources.reduce((a, s) => a + (parseFloat(s.longPct) || 0), 0) / sources.length;
    shortPct = sources.reduce((a, s) => a + (parseFloat(s.shortPct) || 0), 0) / sources.length;
  }
  if (longPct + shortPct < 1 && ratio > 0) {
    longPct = (ratio / (1 + ratio)) * 100;
    shortPct = (1 / (1 + ratio)) * 100;
  }
  if (longPct + shortPct < 1) {
    longPct = 50;
    shortPct = 50;
  }

  const oiSent = computeOiSentiment(d, stages, longPct, shortPct);
  longPct = oiSent.longPct;
  shortPct = oiSent.shortPct;
  const oiUsd = oiSent.oiUsd;

  const longList = Array.isArray(sum.longPrices) ? sum.longPrices : [];
  const shortList = Array.isArray(sum.shortPrices) ? sum.shortPrices : [];
  const longBuckets = buildTianSideBuckets(longList, 'long');
  const shortBuckets = buildTianSideBuckets(shortList, 'short');
  const placed = placeCandlesByMarketSide(longBuckets, shortBuckets, price);

  const hasWindowTotals =
    w4 &&
    (w4.source === 'exchange_force_orders_4h' || w4.source === 'oi_ls_report_4h') &&
    (Number(w4.totalLong) > 0 || Number(w4.totalShort) > 0);
  const longTotal = hasWindowTotals
    ? Number(w4.totalLong) || 0
    : placed.longs.reduce((a, c) => a + (c.usd || 0), 0);
  const shortTotal = hasWindowTotals
    ? Number(w4.totalShort) || 0
    : placed.shorts.reduce((a, c) => a + (c.usd || 0), 0);

  const priceTxt = price
    ? `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '--';
  if (dom.tianPriceTag) dom.tianPriceTag.textContent = priceTxt;
  if (dom.tianPriceTag2) dom.tianPriceTag2.textContent = priceTxt;
  if (dom.tianOiTag) dom.tianOiTag.textContent = oiUsd > 0 ? formatCompact(oiUsd) : '--';
  if (dom.tianLongLiqUsd) {
    dom.tianLongLiqUsd.textContent = longTotal > 0 ? formatCompact(longTotal) : '--';
  }
  if (dom.tianShortLiqUsd) {
    dom.tianShortLiqUsd.textContent = shortTotal > 0 ? formatCompact(shortTotal) : '--';
  }

  const biasLabel =
    d.marketBias?.label === '看多' || d.marketBias?.label === '看空'
      ? d.marketBias.label
      : longPct >= shortPct
        ? '看多'
        : '看空';

  const payload = {
    price,
    oiUsd,
    longPct,
    shortPct,
    longShare: oiSent.longShare,
    shortShare: oiSent.shortShare,
    oiCh1h: oiSent.oiCh1h,
    oiCh4h: oiSent.oiCh4h,
    oiChBlend: oiSent.oiChBlend,
    longOpen: oiUsd > 0 ? oiUsd * (longPct / 100) : 0,
    shortOpen: oiUsd > 0 ? oiUsd * (shortPct / 100) : 0,
    longs: placed.longs,
    shorts: placed.shorts,
    candles: placed.candles,
    longTotal,
    shortTotal,
    liqTotal: longTotal + shortTotal,
    biasLabel,
  };
  tianMapState.lastPayload = payload;
  drawTianLiquidationMap(payload);
  bindTianCanvasInteractions();
}

function bindTianCanvasInteractions() {
  if (tianMapState.bound) return;
  tianMapState.bound = true;
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (tianMapState.lastPayload) drawTianLiquidationMap(tianMapState.lastPayload);
    }, 80);
  });

  const canvas = dom.tianCanvas;
  if (!canvas || tianMapState.clickBound) return;
  tianMapState.clickBound = true;
  canvas.addEventListener('click', (ev) => {
    const p = tianMapState.lastPayload;
    const layout = tianMapState.layout;
    if (!p || !layout) return;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    showTianLiqTip(x, y, p);
  });
}

/** 点击短暂显示清算金额总量 */
function showTianLiqTip(x, y, p) {
  const tip = dom.tianClickTip;
  if (!tip) return;
  const total = Number(p.liqTotal) || Number(p.longTotal) + Number(p.shortTotal) || 0;
  const longT = Number(p.longTotal) || 0;
  const shortT = Number(p.shortTotal) || 0;
  const oiCh =
    p.oiChBlend != null
      ? ` · OI Δ ${p.oiChBlend >= 0 ? '+' : ''}${Number(p.oiChBlend).toFixed(2)}%`
      : '';
  tip.innerHTML = `清算总量 <b>${total > 0 ? formatCompact(total) : '--'}</b>
    <span style="color:#4ade80;margin-left:8px">多 ${longT > 0 ? formatCompact(longT) : '--'}</span>
    <span style="color:#f87171;margin-left:6px">空 ${shortT > 0 ? formatCompact(shortT) : '--'}</span>
    <span style="color:#94a3b8;margin-left:6px;font-weight:600">${oiCh}</span>`;
  tip.hidden = false;
  tip.style.left = `${Math.max(40, Math.min((dom.tianCanvas?.clientWidth || 300) - 40, x))}px`;
  tip.style.top = `${Math.max(24, y)}px`;
  tip.classList.add('show');
  clearTimeout(tianMapState.tipTimer);
  tianMapState.tipTimer = setTimeout(() => {
    tip.classList.remove('show');
    setTimeout(() => {
      tip.hidden = true;
    }, 160);
  }, 2200);
}

/** 对角斜线纹理 */
function getTianHatchPattern(ctx, color, angleDeg = 45) {
  const hc = document.createElement('canvas');
  hc.width = 10;
  hc.height = 10;
  const hctx = hc.getContext('2d');
  hctx.strokeStyle = color;
  hctx.lineWidth = 1.1;
  hctx.beginPath();
  if (angleDeg >= 0) {
    // ╱
    hctx.moveTo(-1, 11);
    hctx.lineTo(11, -1);
    hctx.moveTo(-1, 5);
    hctx.lineTo(5, -1);
    hctx.moveTo(5, 11);
    hctx.lineTo(11, 5);
  } else {
    // ╲
    hctx.moveTo(-1, -1);
    hctx.lineTo(11, 11);
    hctx.moveTo(5, -1);
    hctx.lineTo(11, 5);
    hctx.moveTo(-1, 5);
    hctx.lineTo(5, 11);
  }
  hctx.stroke();
  return ctx.createPattern(hc, 'repeat');
}

/**
 * 绘制清算柱（从底边向上，高度∝金额）
 * long: 仅 x ≤ xPrice；short: 仅 x ≥ xPrice
 */
function drawTianLiqBars(ctx, bars, opts) {
  const { pad, plotH, xOfPrice, yOfUsd, xPrice, bodyW, side } = opts;
  const isLong = side === 'long';
  const yBot = pad.t + plotH;

  for (const c of bars || []) {
    let x = xOfPrice(c.price);
    // 硬夹紧：多不越中线右，空不越中线左
    if (isLong) x = Math.min(x, xPrice - 1);
    else x = Math.max(x, xPrice + 1);

    const usd = Number(c.usd) || 0;
    if (!(usd > 0)) continue;
    const yTop = yOfUsd(usd);
    const h = Math.max(4, yBot - yTop);
    const half = bodyW / 2;

    // 影线
    ctx.strokeStyle = isLong ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yTop);
    ctx.lineTo(x, yBot);
    ctx.stroke();

    // 实体
    const g = ctx.createLinearGradient(0, yTop, 0, yBot);
    if (isLong) {
      g.addColorStop(0, 'rgba(74,222,128,0.95)');
      g.addColorStop(0.55, 'rgba(34,197,94,0.88)');
      g.addColorStop(1, 'rgba(21,128,61,0.75)');
    } else {
      g.addColorStop(0, 'rgba(248,113,113,0.95)');
      g.addColorStop(0.55, 'rgba(239,68,68,0.88)');
      g.addColorStop(1, 'rgba(185,28,28,0.75)');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    const r = Math.min(2.5, half);
    const left = x - half;
    const top = yTop;
    const w = bodyW;
    // 圆角顶
    ctx.moveTo(left + r, top);
    ctx.lineTo(left + w - r, top);
    ctx.quadraticCurveTo(left + w, top, left + w, top + r);
    ctx.lineTo(left + w, yBot);
    ctx.lineTo(left, yBot);
    ctx.lineTo(left, top + r);
    ctx.quadraticCurveTo(left, top, left + r, top);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = isLong ? 'rgba(134,239,172,0.7)' : 'rgba(252,165,165,0.7)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/**
 * 竖线 = 现价 · 左多清算 / 右空清算 · 横线 = 1h/4h OI 情绪 · 暗色分区+纹理
 */
function drawTianLiquidationMap(p) {
  const canvas = dom.tianCanvas;
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const parent = canvas.parentElement || canvas;
  const cssW = Math.max(320, parent.clientWidth || 960);
  const cssH = Math.max(280, parseInt(getComputedStyle(canvas).height, 10) || 400);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  tianMapState.dpr = dpr;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = cssW;
  const H = cssH;
  const pad = { t: 22, r: 16, b: 30, l: 50 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  // 深色底
  ctx.fillStyle = '#070b12';
  ctx.fillRect(0, 0, W, H);

  const price = Number(p.price) || 0;
  let longs = Array.isArray(p.longs) ? p.longs.slice() : [];
  let shorts = Array.isArray(p.shorts) ? p.shorts.slice() : [];
  if (!longs.length && !shorts.length && price > 0) {
    longs = [{ price: price * 0.992, usd: 1, side: 'long' }];
    shorts = [{ price: price * 1.008, usd: 1, side: 'short' }];
  }

  // 价格域：两侧清算价 + 现价，左右对称留白让竖线可移动
  let pMin = price || 0;
  let pMax = price || 1;
  for (const c of [...longs, ...shorts]) {
    if (c.price > 0) {
      pMin = Math.min(pMin, c.price);
      pMax = Math.max(pMax, c.price);
    }
  }
  if (!(pMax > pMin)) {
    pMin = (price || 1) * 0.99;
    pMax = (price || 1) * 1.01;
  }
  // 保证现价两侧至少各 0.15% 可视区，竖线不会贴边
  if (price > 0) {
    const minSpan = price * 0.003;
    pMin = Math.min(pMin, price - minSpan);
    pMax = Math.max(pMax, price + minSpan);
    // 相对现价略对称
    const leftSpan = price - pMin;
    const rightSpan = pMax - price;
    const span = Math.max(leftSpan, rightSpan) * 1.06;
    pMin = price - span;
    pMax = price + span;
  }
  const pPad = (pMax - pMin) * 0.03 || 1;
  pMin -= pPad;
  pMax += pPad;

  const maxUsd = Math.max(
    1,
    ...longs.map((c) => c.usd || 0),
    ...shorts.map((c) => c.usd || 0)
  );
  const xOfPrice = (px) => pad.l + ((px - pMin) / (pMax - pMin)) * plotW;
  const yOfUsd = (usd) =>
    pad.t + plotH - Math.pow(Math.max(0, usd) / maxUsd, 0.55) * plotH * 0.82;

  // —— OI 横线：上=空 下=多；shortShare 越大横线越靠下（上空区越大）——
  const shortShare = Math.max(
    0.08,
    Math.min(0.92, Number(p.shortShare) || (Number(p.shortPct) || 50) / 100)
  );
  const longShare = Math.max(0.08, Math.min(0.92, 1 - shortShare));
  const yOi = pad.t + shortShare * plotH;
  const xPrice = price > 0 ? xOfPrice(price) : pad.l + plotW / 2;

  // —— 上下暗色填充 + 斜线纹理 ——
  // 上空（看空 / 空头 OI）
  {
    const h = Math.max(0, yOi - pad.t);
    if (h > 0) {
      const g = ctx.createLinearGradient(0, pad.t, 0, yOi);
      g.addColorStop(0, 'rgba(127, 29, 29, 0.38)');
      g.addColorStop(0.55, 'rgba(185, 28, 28, 0.18)');
      g.addColorStop(1, 'rgba(239, 68, 68, 0.08)');
      ctx.fillStyle = g;
      ctx.fillRect(pad.l, pad.t, plotW, h);
      const pat = getTianHatchPattern(ctx, 'rgba(248,113,113,0.12)', 45);
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(pad.l, pad.t, plotW, h);
      }
    }
  }
  // 下多（看多 / 多头 OI）
  {
    const h = Math.max(0, pad.t + plotH - yOi);
    if (h > 0) {
      const g = ctx.createLinearGradient(0, yOi, 0, pad.t + plotH);
      g.addColorStop(0, 'rgba(34, 197, 94, 0.07)');
      g.addColorStop(0.45, 'rgba(22, 101, 52, 0.16)');
      g.addColorStop(1, 'rgba(20, 83, 45, 0.32)');
      ctx.fillStyle = g;
      ctx.fillRect(pad.l, yOi, plotW, h);
      const pat = getTianHatchPattern(ctx, 'rgba(74,222,128,0.11)', -45);
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(pad.l, yOi, plotW, h);
      }
    }
  }

  // 左右半区极淡分隔（多爆仓 | 空爆仓）
  {
    const gL = ctx.createLinearGradient(pad.l, 0, xPrice, 0);
    gL.addColorStop(0, 'rgba(34,197,94,0.04)');
    gL.addColorStop(1, 'rgba(34,197,94,0)');
    ctx.fillStyle = gL;
    ctx.fillRect(pad.l, pad.t, Math.max(0, xPrice - pad.l), plotH);

    const gR = ctx.createLinearGradient(xPrice, 0, pad.l + plotW, 0);
    gR.addColorStop(0, 'rgba(239,68,68,0)');
    gR.addColorStop(1, 'rgba(239,68,68,0.05)');
    ctx.fillStyle = gR;
    ctx.fillRect(xPrice, pad.t, Math.max(0, pad.l + plotW - xPrice), plotH);
  }

  // 网格
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.055)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
  }

  // 角标：左下「多爆」右上「空爆」
  ctx.font = 'bold 10px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(74,222,128,0.45)';
  ctx.textAlign = 'left';
  ctx.fillText('多头清算', pad.l + 6, pad.t + plotH - 8);
  ctx.fillStyle = 'rgba(248,113,113,0.45)';
  ctx.textAlign = 'right';
  ctx.fillText('空头清算', pad.l + plotW - 6, pad.t + 14);

  // 清算柱：左多 / 右空
  const nBars = Math.max(1, longs.length + shorts.length);
  const bodyW = Math.max(3.5, Math.min(14, (plotW / Math.max(nBars, 8)) * 0.55));
  drawTianLiqBars(ctx, longs, {
    pad,
    plotH,
    xOfPrice,
    yOfUsd,
    xPrice,
    bodyW,
    side: 'long',
  });
  drawTianLiqBars(ctx, shorts, {
    pad,
    plotH,
    xOfPrice,
    yOfUsd,
    xPrice,
    bodyW,
    side: 'short',
  });

  // —— 现价竖线（左右移动）——
  ctx.save();
  // 辉光
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.18)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(xPrice, pad.t);
  ctx.lineTo(xPrice, pad.t + plotH);
  ctx.stroke();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.92)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(xPrice, pad.t);
  ctx.lineTo(xPrice, pad.t + plotH);
  ctx.stroke();
  ctx.restore();

  // 竖线顶标：现价
  const pxLabel =
    price > 0
      ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
      : 'price';
  ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  const pxW = ctx.measureText(pxLabel).width + 12;
  const pxTagX = Math.max(pad.l, Math.min(pad.l + plotW - pxW, xPrice - pxW / 2));
  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  ctx.fillRect(pxTagX, pad.t - 16, pxW, 15);
  ctx.strokeStyle = 'rgba(226,232,240,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(pxTagX + 0.5, pad.t - 15.5, pxW - 1, 14);
  ctx.fillStyle = '#f1f5f9';
  ctx.textAlign = 'center';
  ctx.fillText(pxLabel, pxTagX + pxW / 2, pad.t - 5);

  // 三角指向
  ctx.fillStyle = '#e2e8f0';
  ctx.beginPath();
  ctx.moveTo(xPrice, pad.t + 2);
  ctx.lineTo(xPrice - 5, pad.t + 10);
  ctx.lineTo(xPrice + 5, pad.t + 10);
  ctx.closePath();
  ctx.fill();

  // —— OI 横线（上下移动）——
  ctx.save();
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.16)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(pad.l, yOi);
  ctx.lineTo(pad.l + plotW, yOi);
  ctx.stroke();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.95)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(pad.l, yOi);
  ctx.lineTo(pad.l + plotW, yOi);
  ctx.stroke();
  ctx.restore();

  // 横线标签
  const bias =
    p.biasLabel === '看多'
      ? '看多'
      : p.biasLabel === '看空'
        ? '看空'
        : longShare >= shortShare
          ? '看多'
          : '看空';
  const oiTxt = p.oiUsd > 0 ? formatCompact(p.oiUsd) : '--';
  const ch1 =
    p.oiCh1h != null ? `1h ${p.oiCh1h >= 0 ? '+' : ''}${Number(p.oiCh1h).toFixed(2)}%` : '';
  const ch4 =
    p.oiCh4h != null ? `4h ${p.oiCh4h >= 0 ? '+' : ''}${Number(p.oiCh4h).toFixed(2)}%` : '';
  const chPart = [ch1, ch4].filter(Boolean).join(' · ');
  const ratioTxt = `空 ${(shortShare * 100).toFixed(0)}% · 多 ${(longShare * 100).toFixed(0)}% · OI ${oiTxt}${
    chPart ? ` · ${chPart}` : ''
  } · ${bias}`;
  ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  const tagW = Math.min(plotW - 10, ctx.measureText(ratioTxt).width + 14);
  const tagX = pad.l + 6;
  const tagY = Math.max(pad.t + 14, Math.min(pad.t + plotH - 10, yOi - 4));
  ctx.fillStyle = 'rgba(8, 12, 20, 0.86)';
  ctx.fillRect(tagX, tagY - 12, tagW, 16);
  ctx.fillStyle = bias === '看多' ? '#86efac' : '#fca5a5';
  ctx.fillText(ratioTxt, tagX + 6, tagY);

  // 十字交点
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(xPrice, yOi, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // 外环
  ctx.strokeStyle = 'rgba(248,250,252,0.35)';
  ctx.beginPath();
  ctx.arc(xPrice, yOi, 6, 0, Math.PI * 2);
  ctx.stroke();

  // X 价格刻度
  ctx.fillStyle = '#64748b';
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const px = pMin + ((pMax - pMin) * i) / 4;
    ctx.fillText(px.toLocaleString('en-US', { maximumFractionDigits: 0 }), xOfPrice(px), H - 8);
  }

  // Y 清算量刻度
  ctx.textAlign = 'right';
  for (let i = 0; i <= 3; i++) {
    const usd = maxUsd * Math.pow(i / 3, 1 / 0.55);
    const y = yOfUsd(i === 0 ? 0 : usd);
    ctx.fillText(i === 0 ? '0' : formatCompact(maxUsd * (i / 3)), pad.l - 6, y + 3);
  }

  // 边框
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  ctx.strokeRect(pad.l + 0.5, pad.t + 0.5, plotW - 1, plotH - 1);

  tianMapState.layout = {
    pad,
    plotW,
    plotH,
    pMin,
    pMax,
    xPrice,
    yOi,
    W,
    H,
    maxUsd,
  };
}

// ===== 自信号源三量图：TradingView 式主图 + 十字准星 =====
// Design read: crypto terminal chart · clean hierarchy · price-primary · low clutter
const selfTriChartState = {
  series: [],
  unit: 'day',
  hoverIdx: null,
  pinIdx: null,
  bound: false,
  layout: null,
  visible: { price: true, volume: true, funding: true, oi: false },
};

function formatTriAxisPrice(v) {
  if (!Number.isFinite(v)) return '--';
  const abs = Math.abs(v);
  if (abs >= 100000) return `$${(v / 1000).toFixed(0)}k`;
  if (abs >= 10000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (abs >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (abs >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

function formatTriExactPrice(v) {
  if (v == null || !Number.isFinite(Number(v))) return '--';
  const n = Number(v);
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: n >= 1000 ? 2 : 2,
    maximumFractionDigits: n >= 1000 ? 2 : 4,
  })}`;
}

function formatFundingDelta(curr, prev) {
  if (curr == null || prev == null || !Number.isFinite(Number(curr)) || !Number.isFinite(Number(prev))) {
    return { text: '—', cls: '', dir: 0 };
  }
  const d = Number(curr) - Number(prev);
  if (Math.abs(d) < 1e-12) return { text: '0', cls: '', dir: 0 };
  const sign = d >0 ? '+' : '';
  return {
    text: `${sign}${(d * 100).toFixed(4)}%`,
    cls: d >0 ? 'pos' : 'neg',
    dir: d >0 ? 1 : -1,
  };
}

function applySelfTriReadout(point, labelFallback = '', prevPoint = null) {
  if (!point) {
    if (dom.triHudPrice) dom.triHudPrice.textContent = '--';
    if (dom.triHudDate) dom.triHudDate.textContent = '样本不足';
    return;
  }
  const priceTxt = formatTriExactPrice(point.price);
  const fundTxt = formatFundingChip(point.funding);
  const delta = formatFundingDelta(point.funding, prevPoint?.funding);
  const fundWithDelta =
    delta.text !== '—' ? `${fundTxt} (${delta.dir >0 ? '↑' : delta.dir < 0 ? '↓' : '→'}${delta.text})` : fundTxt;
  const volTxt = point.volume != null ? formatCompact(point.volume) : '—';
  const oiTxt = point.oi != null ? formatCompact(point.oi) : '—';
  const dateTxt = point.label || labelFallback || '';
  const fundSign = Number(point.funding);
  const fundPolar = fundSign >0 ? '多付空' : fundSign < 0 ? '空付多' : '中性';

  if (dom.triHudPrice) dom.triHudPrice.textContent = priceTxt;
  if (dom.triHudDate) {
    const pinned = selfTriChartState.pinIdx != null;
    const hover = selfTriChartState.hoverIdx != null;
    const tag = pinned ? '已锁定' : hover ? '悬停' : '最新';
    dom.triHudDate.textContent = dateTxt
      ? `${tag} · ${dateTxt} · 费率${fundPolar}`
      : `${tag} · 费率${fundPolar}`;
  }
  if (dom.triHudFund) {
    dom.triHudFund.textContent = fundWithDelta;
    dom.triHudFund.className =
      fundSign >0 ? 'pos' : fundSign < 0 ? 'neg' : delta.cls || '';
  }
  if (dom.triHudVol) dom.triHudVol.textContent = volTxt;
  if (dom.triHudOi) dom.triHudOi.textContent = oiTxt;

  if (dom.triPrice) dom.triPrice.textContent = priceTxt;
  if (dom.triFund) {
    dom.triFund.textContent = fundWithDelta;
    dom.triFund.className =
      fundSign >0 ? 'pos' : fundSign < 0 ? 'neg' : delta.cls || '';
  }
  if (dom.triVol) dom.triVol.textContent = volTxt;
  if (dom.triOi) dom.triOi.textContent = oiTxt;
}

function activeSelfTriIndex() {
  const n = selfTriChartState.series.length;
  if (!n) return null;
  if (selfTriChartState.pinIdx != null) {
    return Math.max(0, Math.min(n - 1, selfTriChartState.pinIdx));
  }
  if (selfTriChartState.hoverIdx != null) {
    return Math.max(0, Math.min(n - 1, selfTriChartState.hoverIdx));
  }
  return n - 1;
}

function renderSelfTriSeries(tri) {
  if (dom.btcSeriesUnitBtns?.length) {
    const u = tri?.unit || state.btcSeriesUnit || 'day';
    dom.btcSeriesUnitBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.unit === u);
    });
  }

  // sync legend buttons
  if (dom.triLegBtns?.length) {
    dom.triLegBtns.forEach((btn) => {
      const key = btn.dataset.series;
      const on = !!selfTriChartState.visible[key];
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  if (!tri || !Array.isArray(tri.series) || tri.series.length < 2) {
    if (dom.selfTriStatus) {
      dom.selfTriStatus.textContent = tri?.error ? '拉取失败' : '样本不足';
      dom.selfTriStatus.style.background = 'rgba(255,193,7,0.1)';
      dom.selfTriStatus.style.color = '#fbbf24';
    }
    if (dom.selfTriHint) {
      const err =
        tri?.error ||
        (Array.isArray(tri?.seriesMeta?.errors) && tri.seriesMeta.errors[0]) ||
        '暂无历史序列';
      dom.selfTriHint.textContent = `自信号源三量暂无数据 · ${err}`;
    }
    selfTriChartState.series = [];
    selfTriChartState.hoverIdx = null;
    selfTriChartState.pinIdx = null;
    applySelfTriReadout(null);
    if (dom.selfTriTooltip) dom.selfTriTooltip.hidden = true;
    paintSelfTriChart();
    return;
  }

  if (dom.selfTriStatus) {
    dom.selfTriStatus.textContent = `自信号源 · ${tri.unitLabel || tri.unit || '日'}`;
    dom.selfTriStatus.style.background = 'rgba(34,197,94,0.1)';
    dom.selfTriStatus.style.color = '#22c55e';
  }

  selfTriChartState.series = tri.series;
  selfTriChartState.unit = tri.unit || 'day';
  // keep pin if still in range
  if (selfTriChartState.pinIdx != null && selfTriChartState.pinIdx >= tri.series.length) {
    selfTriChartState.pinIdx = null;
  }

  const latest = tri.latest
    ? { ...tri.series[tri.series.length - 1], ...tri.latest }
    : tri.series[tri.series.length - 1];
  if (dom.triSource) dom.triSource.textContent = tri.signalSource || '自信号源';
  if (dom.selfTriHint) {
    dom.selfTriHint.textContent =
      '上图单价 · 中图费率零轴正绿负红(↑增↓减) · 下图成交量 · 十字准星对照价格与费率周期';
  }

  const idx = activeSelfTriIndex();
  const cur = idx != null ? selfTriChartState.series[idx] : latest;
  const prev = idx != null && idx >0 ? selfTriChartState.series[idx - 1] : null;
  applySelfTriReadout(cur, '', prev);
  ensureSelfTriChartBound();
  paintSelfTriChart();
}

function ensureSelfTriChartBound() {
  const canvas = dom.selfTriChart;
  if (!canvas || selfTriChartState.bound) return;
  selfTriChartState.bound = true;

  const pickIndexFromEvent = (e) => {
    const layout = selfTriChartState.layout;
    const series = selfTriChartState.series;
    if (!layout || !series.length) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const x = clientX - rect.left;
    const { pad, plotW } = layout;
    const rel = (x - pad.left) / Math.max(1, plotW);
    const idx = Math.round(rel * (series.length - 1));
    return Math.max(0, Math.min(series.length - 1, idx));
  };

  const onMove = (e) => {
    if (selfTriChartState.pinIdx != null) return; // locked: only click to move
    const idx = pickIndexFromEvent(e);
    if (idx == null) return;
    if (selfTriChartState.hoverIdx === idx) {
      positionSelfTriTooltip(e);
      return;
    }
    selfTriChartState.hoverIdx = idx;
    const prev = idx >0 ? selfTriChartState.series[idx - 1] : null;
    applySelfTriReadout(selfTriChartState.series[idx], '', prev);
    paintSelfTriChart();
    positionSelfTriTooltip(e);
  };

  const onLeave = () => {
    if (selfTriChartState.pinIdx != null) {
      if (dom.selfTriTooltip) dom.selfTriTooltip.hidden = true;
      return;
    }
    selfTriChartState.hoverIdx = null;
    const n = selfTriChartState.series.length;
    const last = selfTriChartState.series[n - 1];
    const prev = n >1 ? selfTriChartState.series[n - 2] : null;
    applySelfTriReadout(last, '', prev);
    if (dom.selfTriTooltip) dom.selfTriTooltip.hidden = true;
    paintSelfTriChart();
  };

  const onClick = (e) => {
    const idx = pickIndexFromEvent(e);
    if (idx == null) return;
    // toggle unlock if same point, else pin new
    if (selfTriChartState.pinIdx === idx) {
      selfTriChartState.pinIdx = null;
      selfTriChartState.hoverIdx = idx;
    } else {
      selfTriChartState.pinIdx = idx;
      selfTriChartState.hoverIdx = idx;
    }
    const prev = idx >0 ? selfTriChartState.series[idx - 1] : null;
    applySelfTriReadout(selfTriChartState.series[idx], '', prev);
    paintSelfTriChart();
    positionSelfTriTooltip(e);
  };

  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);
  canvas.addEventListener(
    'touchstart',
    (e) => {
      onClick(e);
      e.preventDefault();
    },
    { passive: false }
  );
  canvas.addEventListener(
    'touchmove',
    (e) => {
      selfTriChartState.pinIdx = pickIndexFromEvent(e);
      selfTriChartState.hoverIdx = selfTriChartState.pinIdx;
      if (selfTriChartState.pinIdx != null) {
        const i = selfTriChartState.pinIdx;
        const prev = i >0 ? selfTriChartState.series[i - 1] : null;
        applySelfTriReadout(selfTriChartState.series[i], '', prev);
        paintSelfTriChart();
        positionSelfTriTooltip(e);
      }
      e.preventDefault();
    },
    { passive: false }
  );

  window.addEventListener('resize', () => {
    if (selfTriChartState.series.length) paintSelfTriChart();
  });
}

function positionSelfTriTooltip(e) {
  const tip = dom.selfTriTooltip;
  const wrap = dom.selfTriChart?.parentElement;
  const series = selfTriChartState.series;
  const idx = activeSelfTriIndex();
  if (!tip || !wrap || idx == null || !series[idx]) {
    if (tip) tip.hidden = true;
    return;
  }
  const p = series[idx];
  const prev = idx >0 ? series[idx - 1] : null;
  const fund = Number(p.funding);
  const fundCls = fund >0 ? 'pos' : fund < 0 ? 'neg' : '';
  const polar = fund >0 ? '正 · 多付空' : fund < 0 ? '负 · 空付多' : '零轴';
  const delta = formatFundingDelta(p.funding, prev?.funding);
  tip.innerHTML = `
    <div class="tt-date">${p.label || ''}${selfTriChartState.pinIdx != null ? ' · 锁定' : ''}</div>
    <div class="tt-row price"><span>单价</span><b>${formatTriExactPrice(p.price)}</b></div>
    <div class="tt-row"><span>费率</span><b class="${fundCls}">${formatFundingChip(p.funding)}</b></div>
    <div class="tt-row"><span>正负</span><b class="${fundCls}">${polar}</b></div>
    <div class="tt-row"><span>较上点</span><b class="${delta.cls}">${delta.dir >0 ? '↑ 增 ' : delta.dir < 0 ? '↓ 减 ' : '→ '}${delta.text}</b></div>
    <div class="tt-row"><span>成交量</span><b>${p.volume != null ? formatCompact(p.volume) : '—'}</b></div>
    <div class="tt-row"><span>开仓量</span><b>${p.oi != null ? formatCompact(p.oi) : '—'}</b></div>
  `;
  tip.hidden = false;

  const wrapRect = wrap.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  let left = clientX - wrapRect.left + 14;
  let top = clientY - wrapRect.top + 14;
  const tw = tip.offsetWidth || 180;
  const th = tip.offsetHeight || 140;
  if (left + tw >wrapRect.width - 8) left = clientX - wrapRect.left - tw - 14;
  if (top + th >wrapRect.height - 8) top = clientY - wrapRect.top - th - 10;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}

function formatFundAxisPct(rate) {
  if (!Number.isFinite(rate)) return '--';
  const pct = rate * 100;
  const abs = Math.abs(pct);
  const digits = abs >= 0.1 ? 3 : 4;
  const sign = pct >0 ? '+' : '';
  return `${sign}${pct.toFixed(digits)}%`;
}

/**
 * 三窗格：上=单价 · 中=资金费率(零轴正绿负红+增减) · 下=成交量
 * 十字准星贯穿，便于费率周期与价格对照。
 */
function paintSelfTriChart() {
  const canvas = dom.selfTriChart;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(rect.width || 900, 320);
  const height = Math.max(rect.height || 420, 280);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(6, 10, 18, 0.35)';
  ctx.fillRect(0, 0, width, height);

  const series = selfTriChartState.series;
  const vis = selfTriChartState.visible;
  const unit = selfTriChartState.unit || 'day';

  const pad = { top: 12, right: 14, bottom: 28, left: 64 };
  const gap = 6;
  const totalPlotH = height - pad.top - pad.bottom;

  // layout weights: price / funding / volume
  let wPrice = 1;
  let wFund = vis.funding ? 0.55 : 0;
  let wVol = vis.volume ? 0.32 : 0;
  const wSum = wPrice + wFund + wVol || 1;
  const nGaps = (wFund >0 ? 1 : 0) + (wVol >0 ? 1 : 0);
  const usable = totalPlotH - nGaps * gap;
  const priceH = Math.round((usable * wPrice) / wSum);
  const fundH = wFund >0 ? Math.round((usable * wFund) / wSum) : 0;
  const volH = wVol >0 ? totalPlotH - priceH - fundH - nGaps * gap : 0;
  const plotW = width - pad.left - pad.right;
  const priceTop = pad.top;
  const fundTop = priceTop + priceH + (fundH ? gap : 0);
  const volTop = fundTop + fundH + (volH ? gap : 0);

  selfTriChartState.layout = {
    pad,
    plotW,
    priceH,
    fundH,
    volH,
    priceTop,
    fundTop,
    volTop,
    width,
    height,
  };

  if (!series || series.length < 2) {
    ctx.fillStyle = '#64748b';
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('自信号源样本不足', pad.left, height / 2);
    return;
  }

  const prices = series.map((p) =>Number(p.price)).filter((n) =>Number.isFinite(n) && n >0);
  const funds = series.map((p) =>Number(p.funding)).filter((n) =>Number.isFinite(n));
  const vols = series.map((p) =>Number(p.volume)).filter((n) =>Number.isFinite(n) && n >0);
  const ois = series.map((p) =>Number(p.oi)).filter((n) =>Number.isFinite(n) && n >0);

  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 1;
  const pPad = (maxP - minP) * 0.1 || maxP * 0.02 || 1;
  let yMin = minP - pPad;
  let yMax = maxP + pPad;
  if (yMax <= yMin) yMax = yMin + 1;

  // funding scale: always include 0, slight pad, prefer symmetric if both sides
  let fMin = funds.length ? Math.min(...funds) : -0.0001;
  let fMax = funds.length ? Math.max(...funds) : 0.0001;
  if (fMin >0) fMin = 0;
  if (fMax < 0) fMax = 0;
  if (fMin === fMax) {
    fMin = -0.0001;
    fMax = 0.0001;
  }
  // soft symmetry for readable zero midline
  const fAbs = Math.max(Math.abs(fMin), Math.abs(fMax));
  if (fMin < 0 && fMax >0) {
    fMin = -fAbs;
    fMax = fAbs;
  }
  const fPad = (fMax - fMin) * 0.12 || 0.00005;
  fMin -= fPad;
  fMax += fPad;

  const maxVol = vols.length ? Math.max(...vols) : 1;

  const normRange = (arr, v) => {
    if (v == null || !Number.isFinite(Number(v)) || !arr.length) return null;
    const lo = Math.min(...arr);
    const hi = Math.max(...arr);
    if (hi === lo) return 0.5;
    return (Number(v) - lo) / (hi - lo);
  };

  const xAt = (i) =>pad.left + (i / Math.max(1, series.length - 1)) * plotW;
  const yPrice = (p) =>priceTop + (1 - (p - yMin) / (yMax - yMin)) * priceH;
  const yFund = (r) =>fundTop + (1 - (r - fMin) / (fMax - fMin)) * fundH;
  const yZero = yFund(0);

  // —— Price pane ——
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = yMin + ((yMax - yMin) * i) / ticks;
    const y = yPrice(v);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatTriAxisPrice(v), pad.left - 8, y);
  }
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.beginPath();
  ctx.moveTo(pad.left, priceTop);
  ctx.lineTo(pad.left, priceTop + priceH);
  ctx.stroke();

  // pane separator
  if (fundH >0 || volH >0) {
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.beginPath();
    ctx.moveTo(pad.left, priceTop + priceH + gap / 2);
    ctx.lineTo(pad.left + plotW, priceTop + priceH + gap / 2);
    ctx.stroke();
  }

  // price area + line
  if (vis.price) {
    const pts = [];
    for (let i = 0; i < series.length; i++) {
      const pr = Number(series[i].price);
      if (!Number.isFinite(pr) || pr <= 0) continue;
      pts.push({ x: xAt(i), y: yPrice(pr) });
    }
    if (pts.length >= 2) {
      const baseY = priceTop + priceH;
      const grad = ctx.createLinearGradient(0, priceTop, 0, baseY);
      grad.addColorStop(0, 'rgba(148, 163, 184, 0.2)');
      grad.addColorStop(1, 'rgba(148, 163, 184, 0.01)');
      ctx.beginPath();
      ctx.moveTo(pts[0].x, baseY);
      ctx.lineTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[pts.length - 1].x, baseY);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.strokeStyle = 'rgba(241, 245, 249, 0.95)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  // OI thin overlay on price (optional)
  if (vis.oi && ois.length) {
    const oiPts = [];
    for (let i = 0; i < series.length; i++) {
      const n = normRange(ois, series[i].oi);
      if (n == null) continue;
      oiPts.push({
        x: xAt(i),
        y: priceTop + (1 - n) * priceH * 0.9 + priceH * 0.05,
      });
    }
    if (oiPts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(oiPts[0].x, oiPts[0].y);
      for (let i = 1; i < oiPts.length; i++) ctx.lineTo(oiPts[i].x, oiPts[i].y);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // —— Funding pane: zero-axis histogram + cycle line ——
  if (vis.funding && fundH >0) {
    // tint bands: above zero green wash, below red wash
    if (yZero >fundTop && yZero < fundTop + fundH) {
      ctx.fillStyle = 'rgba(52, 211, 153, 0.04)';
      ctx.fillRect(pad.left, fundTop, plotW, Math.max(0, yZero - fundTop));
      ctx.fillStyle = 'rgba(248, 113, 113, 0.05)';
      ctx.fillRect(pad.left, yZero, plotW, Math.max(0, fundTop + fundH - yZero));
    }

    // funding ticks (include 0)
    const fTicks = [fMin, fMin * 0.5, 0, fMax * 0.5, fMax];
    const uniqF = [];
    for (const t of fTicks) {
      if (!Number.isFinite(t)) continue;
      if (uniqF.every((u) =>Math.abs(u - t) > (fMax - fMin) * 0.08)) uniqF.push(t);
    }
    if (!uniqF.includes(0) && fMin < 0 && fMax >0) uniqF.push(0);
    uniqF.sort((a, b) =>a - b);
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (const t of uniqF) {
      const y = yFund(t);
      if (y < fundTop - 1 || y >fundTop + fundH + 1) continue;
      ctx.strokeStyle =
        Math.abs(t) < 1e-12 ? 'rgba(226, 232, 240, 0.35)' : 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = Math.abs(t) < 1e-12 ? 1.25 : 1;
      ctx.setLineDash(Math.abs(t) < 1e-12 ? [3, 3] : []);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = Math.abs(t) < 1e-12 ? '#e2e8f0' : '#64748b';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatFundAxisPct(t), pad.left - 8, y);
    }

    // zero label badge
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('资金费率  绿正/红负  ↑增↓减', pad.left + 2, fundTop + 2);

    const barW = Math.max(2, Math.min(14, (plotW / series.length) * 0.7));
    const linePts = [];

    for (let i = 0; i < series.length; i++) {
      const r = Number(series[i].funding);
      if (!Number.isFinite(r)) continue;
      const x = xAt(i);
      const y = yFund(r);
      linePts.push({ x, y, r, i });

      // bar from zero
      const top = Math.min(y, yZero);
      const h = Math.max(1.5, Math.abs(y - yZero));
      const prev = i >0 ? Number(series[i - 1].funding) : null;
      const rising = prev != null && Number.isFinite(prev) && r >prev + 1e-12;
      const falling = prev != null && Number.isFinite(prev) && r < prev - 1e-12;

      if (r >= 0) {
        ctx.fillStyle = rising
          ? 'rgba(16, 185, 129, 0.78)'
          : falling
            ? 'rgba(52, 211, 153, 0.38)'
            : 'rgba(52, 211, 153, 0.55)';
      } else {
        ctx.fillStyle = falling
          ? 'rgba(239, 68, 68, 0.78)'
          : rising
            ? 'rgba(248, 113, 113, 0.38)'
            : 'rgba(248, 113, 113, 0.55)';
      }
      ctx.fillRect(x - barW / 2, top, barW, h);

      // delta tip mark: small triangle above/below bar end
      if (rising || falling) {
        ctx.beginPath();
        if (rising) {
          ctx.moveTo(x, y - 5);
          ctx.lineTo(x - 3.5, y - 1);
          ctx.lineTo(x + 3.5, y - 1);
          ctx.fillStyle = r >= 0 ? '#6ee7b7' : '#fca5a5';
        } else {
          ctx.moveTo(x, y + 5);
          ctx.lineTo(x - 3.5, y + 1);
          ctx.lineTo(x + 3.5, y + 1);
          ctx.fillStyle = r >= 0 ? '#34d399' : '#f87171';
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    // cycle polyline (step-friendly)
    if (linePts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(linePts[0].x, linePts[0].y);
      for (let i = 1; i < linePts.length; i++) {
        // horizontal-then-vertical step to emphasize funding settle cycles
        const midX = (linePts[i - 1].x + linePts[i].x) / 2;
        ctx.lineTo(midX, linePts[i - 1].y);
        ctx.lineTo(midX, linePts[i].y);
        ctx.lineTo(linePts[i].x, linePts[i].y);
      }
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.72)';
      ctx.lineWidth = 1.4;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // spine
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.beginPath();
    ctx.moveTo(pad.left, fundTop);
    ctx.lineTo(pad.left, fundTop + fundH);
    ctx.stroke();
  }

  // —— Volume pane ——
  if (vis.volume && volH >0) {
    if (fundH >0) {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
      ctx.beginPath();
      ctx.moveTo(pad.left, fundTop + fundH + gap / 2);
      ctx.lineTo(pad.left + plotW, fundTop + fundH + gap / 2);
      ctx.stroke();
    }
    const barW = Math.max(1.5, (plotW / series.length) * 0.62);
    for (let i = 0; i < series.length; i++) {
      const vol = Number(series[i].volume);
      if (!Number.isFinite(vol) || vol <= 0) continue;
      const h = Math.max(1, (vol / maxVol) * (volH - 2));
      const x = xAt(i);
      const y = volTop + volH - h;
      // tint volume by funding polarity of same bar for correlation glance
      const fr = Number(series[i].funding);
      if (Number.isFinite(fr) && fr < 0) {
        ctx.fillStyle = 'rgba(248, 113, 113, 0.22)';
      } else if (Number.isFinite(fr) && fr >0) {
        ctx.fillStyle = 'rgba(52, 211, 153, 0.26)';
      } else {
        ctx.fillStyle = 'rgba(100, 116, 139, 0.28)';
      }
      ctx.fillRect(x - barW / 2, y, barW, h);
    }
    ctx.fillStyle = '#64748b';
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('成交量（色随费率正负）', pad.left + 2, volTop + 1);
  }

  // X labels
  const maxLabels = unit === 'hour' ? 7 : 6;
  const labelStep = Math.max(1, Math.floor(series.length / maxLabels));
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i < series.length; i += labelStep) {
    ctx.fillText(String(series[i].label || ''), xAt(i), height - 18);
  }
  if ((series.length - 1) % labelStep !== 0) {
    ctx.fillText(String(series[series.length - 1].label || ''), xAt(series.length - 1), height - 18);
  }

  // —— Crosshair through all panes ——
  const focus = activeSelfTriIndex();
  if (focus != null && series[focus]) {
    const px = xAt(focus);
    const pr = Number(series[focus].price);
    const fr = Number(series[focus].funding);
    const py = Number.isFinite(pr) && pr >0 ? yPrice(pr) : priceTop + priceH / 2;
    const chartBottom =
      volH >0 ? volTop + volH : fundH >0 ? fundTop + fundH : priceTop + priceH;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, priceTop);
    ctx.lineTo(px, chartBottom);
    ctx.stroke();

    if (vis.price && Number.isFinite(pr) && pr >0) {
      ctx.beginPath();
      ctx.moveTo(pad.left, py);
      ctx.lineTo(pad.left + plotW, py);
      ctx.stroke();
    }
    // funding horizontal at selected rate
    if (vis.funding && fundH >0 && Number.isFinite(fr)) {
      const fy = yFund(fr);
      ctx.strokeStyle =
        fr >0 ? 'rgba(52, 211, 153, 0.45)' : fr < 0 ? 'rgba(248, 113, 113, 0.45)' : 'rgba(226,232,240,0.4)';
      ctx.beginPath();
      ctx.moveTo(pad.left, fy);
      ctx.lineTo(pad.left + plotW, fy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // price focus dot
    if (vis.price && Number.isFinite(pr) && pr >0) {
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#f8fafc';
      ctx.stroke();
    }

    // funding focus dot on zero-axis pane
    if (vis.funding && fundH >0 && Number.isFinite(fr)) {
      const fy = yFund(fr);
      ctx.beginPath();
      ctx.arc(px, fy, 4, 0, Math.PI * 2);
      ctx.fillStyle = fr >= 0 ? '#10b981' : '#ef4444';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#f8fafc';
      ctx.stroke();
    }

    // price tag
    if (vis.price && Number.isFinite(pr) && pr >0) {
      const tag = formatTriExactPrice(pr);
      ctx.font = 'bold 11px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = ctx.measureText(tag).width;
      const tagW = tw + 12;
      const tagH = 20;
      let tagY = py - tagH / 2;
      tagY = Math.max(priceTop, Math.min(priceTop + priceH - tagH, tagY));
      const tagX = pad.left - tagW - 4;
      ctx.fillStyle = 'rgba(241, 245, 249, 0.96)';
      const r = 4;
      ctx.beginPath();
      ctx.moveTo(tagX + r, tagY);
      ctx.arcTo(tagX + tagW, tagY, tagX + tagW, tagY + tagH, r);
      ctx.arcTo(tagX + tagW, tagY + tagH, tagX, tagY + tagH, r);
      ctx.arcTo(tagX, tagY + tagH, tagX, tagY, r);
      ctx.arcTo(tagX, tagY, tagX + tagW, tagY, r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, tagX + tagW / 2, tagY + tagH / 2);
    }

    // funding rate tag on left of fund pane
    if (vis.funding && fundH >0 && Number.isFinite(fr)) {
      const tag = formatFundAxisPct(fr);
      ctx.font = 'bold 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      const tw = ctx.measureText(tag).width;
      const tagW = tw + 10;
      const tagH = 18;
      const fy = yFund(fr);
      let tagY = fy - tagH / 2;
      tagY = Math.max(fundTop, Math.min(fundTop + fundH - tagH, tagY));
      const tagX = pad.left - tagW - 4;
      ctx.fillStyle = fr >= 0 ? 'rgba(16, 185, 129, 0.95)' : 'rgba(239, 68, 68, 0.95)';
      const r = 4;
      ctx.beginPath();
      ctx.moveTo(tagX + r, tagY);
      ctx.arcTo(tagX + tagW, tagY, tagX + tagW, tagY + tagH, r);
      ctx.arcTo(tagX + tagW, tagY + tagH, tagX, tagY + tagH, r);
      ctx.arcTo(tagX, tagY + tagH, tagX, tagY, r);
      ctx.arcTo(tagX, tagY, tagX + tagW, tagY, r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, tagX + tagW / 2, tagY + tagH / 2);
    }
  }
}

// legacy name used by older call sites
function drawSelfTriChart(canvas, series, unit = 'day') {
  if (Array.isArray(series)) {
    selfTriChartState.series = series;
    selfTriChartState.unit = unit;
  }
  ensureSelfTriChartBound();
  paintSelfTriChart();
}

function setBtcSeriesUnit(unit) {
  const next = String(unit || 'day');
  if (state.btcSeriesUnit === next && state.btcData?.selfTriSeries) return;
  state.btcSeriesUnit = next;
  if (dom.btcSeriesUnitBtns?.length) {
    dom.btcSeriesUnitBtns.forEach((btn) =>btn.classList.toggle('active', btn.dataset.unit === next));
  }
  loadBitcoinData();
}

function drawFundingSparkline(canvas, history) {
  // legacy no-op kept if any old calls remain
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

  const rates = history.map(h =>h.rate).filter(r =>r != null);
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
  if (chain === state.currentChain && state.tokens.length >0 && !state.isLoading) return;
  state.currentChain = chain;
  dom.chainTabs.forEach((tab) =>tab.classList.toggle('active', tab.dataset.chain === chain));
  // Show only this network's 实时信号 immediately (before fetch completes)
  renderMemecoinSignals();
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
    } else if ((state.currentPage === 'altcoin' || state.currentPage === 'othercoin') && !state.otherLoading) {
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
  tab.addEventListener('click', () =>switchPage(tab.dataset.page));
});

// Chain tabs
dom.chainTabs.forEach((tab) => {
  tab.addEventListener('click', () =>switchChain(tab.dataset.chain));
});

// Refresh
dom.refreshBtn.addEventListener('click', () => {
  dom.refreshBtn.classList.add('spinning');
  if (state.currentPage === 'memecoin') loadMemecoinData(state.currentChain);
  else if (state.currentPage === 'altcoin' || state.currentPage === 'othercoin') loadOthercoinData();
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
    else if ((state.currentPage === 'altcoin' || state.currentPage === 'othercoin') && !state.otherLoading) loadOthercoinData();
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
    const ids = (data.data || data.chains || []).map((c) =>c.id || c).filter(Boolean);
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
    dom.sortBtns.forEach((b) =>b.classList.remove('active'));
    btn.classList.add('active');
    state.sortBy = btn.dataset.sort;
    if (state.tokens.length >0) renderMemecoinSortedTokens(state.tokens);
  });
});

// Altcoin sort
dom.otherSortBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    dom.otherSortBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.otherSortBy = btn.dataset.sort;
    if (state.otherTokens.length > 0) renderOthercoinSortedTokens(state.otherTokens);
  });
});

// Altcoin action filter (prefer / watch / fade) — independent of Memecoin
document.querySelectorAll('#altcoinActionFilter .filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#altcoinActionFilter .filter-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    state.altcoinActionFilter = btn.dataset.action || 'all';
    if (state.otherTokens.length > 0) renderOthercoinSortedTokens(state.otherTokens);
  });
});

// Altcoin retry
dom.otherRetryBtn.addEventListener('click', () => {
  dom.otherErrorState.style.display = 'none';
  loadOthercoinData();
});

// Clear signals
function clearAllMemecoinSignals() {
  state.signals.forEach((s) => (s.active = false));
  saveSignalTracking();
  stopSignalTicker();
  clearSignalTickerHideTimer();
  state.signalTickerHovering = false;
  if (dom.signalTicker) {
    dom.signalTicker.hidden = true;
    dom.signalTicker.classList.remove('is-hiding');
  }
  renderMemecoinSignals();
  renderMemecoinMonitoring();
  showToast('所有信号已清除', 'info');
}
if (dom.clearSignalsBtn) {
  dom.clearSignalsBtn.addEventListener('click', clearAllMemecoinSignals);
}
if (dom.signalTickerClear) {
  dom.signalTickerClear.addEventListener('click', (e) => {
    e.stopPropagation();
    clearAllMemecoinSignals();
  });
}
// Hover keeps frame open; leave restarts 3s idle hide
if (dom.signalTicker) {
  dom.signalTicker.addEventListener('mouseenter', () => {
    state.signalTickerHovering = true;
    clearSignalTickerHideTimer();
  });
  dom.signalTicker.addEventListener('mouseleave', () => {
    state.signalTickerHovering = false;
    resetSignalTickerIdleTimer();
  });
  // Any click inside resets idle countdown
  dom.signalTicker.addEventListener('click', () => {
    resetSignalTickerIdleTimer();
  });
}
if (dom.signalTickerBody) {
  dom.signalTickerBody.addEventListener('click', () => {
    const meta = {
      address: dom.signalTickerBody.dataset.address,
      chain: dom.signalTickerBody.dataset.chain,
      symbol: dom.signalTickerBody.dataset.symbol,
      tokenAddress: dom.signalTickerBody.dataset.address,
      tokenChain: dom.signalTickerBody.dataset.chain,
      tokenSymbol: dom.signalTickerBody.dataset.symbol,
    };
    if (!meta.address && !meta.symbol) return;
    resetSignalTickerIdleTimer();
    focusTokenFromSignal(meta);
  });
}

// BTC Source Selector
dom.btcSourceBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const source = btn.dataset.source;
    if (source === state.btcPreferredSource) return;
    // Update button states
    dom.btcSourceBtns.forEach((b) =>b.classList.remove('active'));
    btn.classList.add('active');
    // Update state
    state.btcPreferredSource = source;
    state.btcSourceRetryCount = 0;
    // Reload with new source
    showToast(`切换到 ${btn.querySelector('.source-btn-label')?.textContent || source} 数据源`, 'info');
    loadBitcoinData();
  });
});

// BTC timeframe: 1h / 4h / 1d / 3d / 1w / 3w
if (dom.btcTfBtns?.length) {
  dom.btcTfBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const period = btn.dataset.period;
      if (!period || period === state.btcPeriod) return;
      showToast(`切换周期 ${btn.textContent.trim()} · 加载自信号源均值`, 'info');
      setBtcPeriod(period);
    });
  });
}

// 三量图时间单位：时 / 日 / 月 / 年
if (dom.btcSeriesUnitBtns?.length) {
  dom.btcSeriesUnitBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const unit = btn.dataset.unit;
      if (!unit || unit === state.btcSeriesUnit) return;
      showToast(`横轴单位：${btn.textContent.trim()} · 重绘自信号源三量图`, 'info');
      setBtcSeriesUnit(unit);
    });
  });
}

// 三量图图例：开关系列（单价不可关，避免空图）
if (dom.triLegBtns?.length) {
  dom.triLegBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.series;
      if (!key || !(key in selfTriChartState.visible)) return;
      if (key === 'price') {
        // 单价始终显示
        selfTriChartState.visible.price = true;
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        return;
      }
      selfTriChartState.visible[key] = !selfTriChartState.visible[key];
      btn.classList.toggle('active', selfTriChartState.visible[key]);
      btn.setAttribute('aria-pressed', selfTriChartState.visible[key] ? 'true' : 'false');
      paintSelfTriChart();
    });
  });
}

// ====================================================================================
// INITIALIZE
// ====================================================================================

function initStrategyModal() {
  const modal = document.getElementById('strategyModal');
  if (!modal || modal.dataset.bound === '1') return;
  modal.dataset.bound = '1';
  modal.querySelectorAll('[data-strategy-close]').forEach((el) => {
    el.addEventListener('click', () =>closeStrategyModal());
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeStrategyModal();
  });
}

/**
 * Local design preview: inject sample tracked cards so AI / wallet / strategy UI
 * can be reviewed without waiting for live Monitor heat signals.
 * Does NOT place trades. Marked with signalMeta.designDemo = true.
 */
function seedDesignDemoTracking() {
  const now = Date.now();
  const samples = [
    {
      key: 'demo:solana:DemoAlpha1111111111111111111111111',
      address: 'DemoAlpha1111111111111111111111111',
      symbol: 'ALPHA',
      name: 'Alpha Heat Demo',
      chain: 'solana',
      signalAt: now - 18 * 60 * 1000,
      priceAtSignal: 0.0012,
      currentPrice: 0.00156,
      signalReason: 'monitor-hot-5m',
      signalReasonText: 'Monitor 5m 火热 · 分78/100 · Smart Net Inflow',
      entryGrade: 'B',
      priceHistory: [
        { time: now - 18 * 60 * 1000, price: 0.0012, marker: 'buy' },
        { time: now - 12 * 60 * 1000, price: 0.00138 },
        { time: now - 6 * 60 * 1000, price: 0.00162 },
        { time: now, price: 0.00156 },
      ],
      signalMeta: {
        designDemo: true,
        heatWindow: '5m',
        priceChange1h: 28,
        volume1h: 420000,
        liquidity: 92000,
        buyPercent: 68,
        hasSmartMoneyData: true,
        dataQuality: 'gmgn-enriched',
        securityChecked: true,
        security: { renounced: true, canSell: true, rawFlags: { isHoneypot: false, isRug: false, isBan: false } },
        isHoneypot: false,
        isRug: false,
        isBan: false,
        top10Holders: 0.22,
        smartNetInflow5m: 18500,
        smartNetInflow15m: 42000,
        smartNetInflow1h: 61000,
        kolNetInflow5m: 6200,
        kolNetInflow15m: 14000,
        smartWallets5m: 4,
        smartWallets15m: 7,
        kolWallets5m: 2,
        kolWallets15m: 3,
        smartCount: 5,
        topWallets: [
          { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', role: 'smart', buyUsd: 8200, sellUsd: 0, netUsd: 8200, tradeCount: 2, side: 'buy', twitter: '', name: 'SmartDegen', tags: ['smart_money'] },
          { address: 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK', role: 'kol', buyUsd: 4100, sellUsd: 900, netUsd: 3200, tradeCount: 3, side: 'mixed', twitter: 'ansem', name: 'Ansem', tags: ['kol'] },
          { address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', role: 'smart', buyUsd: 2500, sellUsd: 0, netUsd: 2500, tradeCount: 1, side: 'buy', twitter: '', name: '', tags: ['smart_degen'] },
        ],
      },
      signalScoreSnapshot: null,
    },
    {
      key: 'demo:base:0xdemo00000000000000000000000000000000cafe',
      address: '0xdemo00000000000000000000000000000000cafe',
      symbol: 'RISK',
      name: 'Risk Block Demo',
      chain: 'base',
      signalAt: now - 40 * 60 * 1000,
      priceAtSignal: 0.04,
      currentPrice: 0.031,
      signalReason: 'monitor-hot-15m',
      signalReasonText: 'Monitor 15m 火热 · 分61/100',
      entryGrade: 'D',
      priceHistory: [
        { time: now - 40 * 60 * 1000, price: 0.04, marker: 'buy' },
        { time: now - 20 * 60 * 1000, price: 0.036 },
        { time: now, price: 0.031 },
      ],
      signalMeta: {
        designDemo: true,
        heatWindow: '15m',
        priceChange1h: -12,
        volume1h: 90000,
        liquidity: 18000,
        buyPercent: 42,
        hasSmartMoneyData: true,
        dataQuality: 'gmgn-enriched',
        securityChecked: true,
        security: { renounced: false, canSell: true, rawFlags: { isHoneypot: false, isRug: false, isBan: false } },
        isHoneypot: false,
        isRug: false,
        isBan: false,
        top10Holders: 0.58,
        smartNetInflow5m: 1200,
        smartNetInflow15m: 3500,
        kolNetInflow5m: 0,
        smartWallets5m: 1,
        smartWallets15m: 2,
        topWallets: [
          { address: '0xabc000000000000000000000000000000000beef', role: 'smart', buyUsd: 900, sellUsd: 1400, netUsd: -500, tradeCount: 2, side: 'sell', twitter: '', name: 'ExitWallet', tags: ['smart_money'] },
        ],
      },
      signalScoreSnapshot: null,
    },
  ];

  for (const s of samples) {
    // Build score snapshot so AI panel uses real security/resonance reports
    const tokenLike = {
      symbol: s.symbol,
      address: s.address,
      chain: s.chain,
      priceChange1h: s.signalMeta.priceChange1h,
      volume1h: s.signalMeta.volume1h,
      volume24h: s.signalMeta.volume1h * 3,
      liquidity: s.signalMeta.liquidity,
      hasSmartMoneyData: true,
      dataQuality: 'gmgn-enriched',
      securityChecked: s.signalMeta.securityChecked,
      security: s.signalMeta.security,
      isHoneypot: s.signalMeta.isHoneypot,
      isRug: s.signalMeta.isRug,
      isBan: s.signalMeta.isBan,
      top10Holders: s.signalMeta.top10Holders,
      smartCount: s.signalMeta.smartCount || 3,
      smartNetInflow5m: s.signalMeta.smartNetInflow5m,
      smartNetInflow15m: s.signalMeta.smartNetInflow15m,
      smartNetInflow1h: s.signalMeta.smartNetInflow1h,
      kolNetInflow5m: s.signalMeta.kolNetInflow5m,
      kolNetInflow15m: s.signalMeta.kolNetInflow15m,
      smartWallets5m: s.signalMeta.smartWallets5m,
      smartWallets15m: s.signalMeta.smartWallets15m,
      kolWallets5m: s.signalMeta.kolWallets5m,
      kolWallets15m: s.signalMeta.kolWallets15m,
      txns1h: { buys: 200, sells: 90, total: 290 },
    };
    const snapshot = window.SignalEngine?.scoreTokenSignal?.(tokenLike) || null;
    if (snapshot && s.entryGrade === 'D') {
      snapshot.entryGrade = 'D';
      snapshot.suggestedAction = '禁止交易';
      snapshot.riskLevel = '高';
    }
    state.trackedTokens[s.key] = {
      address: s.address,
      symbol: s.symbol,
      name: s.name,
      icon: '',
      chain: s.chain,
      signalAt: s.signalAt,
      signalReason: s.signalReason,
      signalReasonText: s.signalReasonText,
      priceAtSignal: s.priceAtSignal,
      buyMarker: { time: s.signalAt, price: s.priceAtSignal, label: '信号买入点' },
      priceHistory: s.priceHistory,
      currentPrice: s.currentPrice,
      lastCapitalInflowAt: now,
      signalMeta: { ...s.signalMeta, signalScoreSnapshot: snapshot },
      signalScoreSnapshot: snapshot,
      aiNotes: null,
      historyStatus: 'active',
      outcomeStatus: 'pending',
      outcomeTier: '观察中',
      outcomeRecorded: false,
      designDemo: true,
    };
    // AI 面板与策略模态默认均不展开，需用户主动点开
    state.aiExpanded[s.key] = false;
  }

  // Seed a couple of outcome stats for the bar
  if (!Array.isArray(state.signalOutcomes)) state.signalOutcomes = [];
  state.signalOutcomes = [
    {
      id: 'demo-win-1',
      key: samples[0].key,
      symbol: 'ALPHA',
      status: 'win',
      isWin: true,
      isLoss: false,
      tier: '有效信号',
      maxGain: 42,
      currentChange: 30,
      patternKey: 'monitor-hot-5m|a',
      settledAt: now,
    },
    {
      id: 'demo-loss-1',
      key: samples[1].key,
      symbol: 'RISK',
      status: 'loss',
      isWin: false,
      isLoss: true,
      tier: '失败/跌破',
      maxGain: 5,
      currentChange: -22,
      patternKey: 'monitor-hot-15m|d',
      settledAt: now,
    },
    ...(state.signalOutcomes.filter((o) => !String(o.id || '').startsWith('demo-'))),
  ].slice(0, 40);

  closeStrategyModal();
  renderMemecoinMonitoring();
  showToast('设计预览已加载 · AI/策略默认收起，点「AI」或「策略预览」查看', 'info');
}

function initDesignDemoButtons() {
  const run = () =>seedDesignDemoTracking();
  document.getElementById('designDemoBtn')?.addEventListener('click', run);
  document.getElementById('designDemoBtnEmpty')?.addEventListener('click', run);
  // Auto-seed once on local host when URL has ?demo=1
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('demo') === '1' || q.get('design') === '1') {
      setTimeout(run, 400);
    }
  } catch (_) { /* ignore */ }
}

function init() {
  setStatus('loading');
  initStrategyModal();
  initDesignDemoButtons();
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

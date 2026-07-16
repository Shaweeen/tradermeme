/**
 * Memecoin signal X reference pool — unique usernames only (max 500).
 * No duplicate accounts. Matching is case-insensitive.
 * Used when Memecoin emits a signal: search/check against this pool only.
 */

const MAX_HANDLES = 500;

/** Canonical usernames (one per account, no @ prefix). */
const HANDLES = [
  "fish081320792",
  "slowisfast_",
  "0xmrdq",
  "Cryptoyiyi",
  "Heyibinance",
  "marionawfal",
  "cointelegraph",
  "insydercrypto",
  "PepeBoost888",
  "WatcherGuru",
  "stoolpresidente",
  "useXXYYio",
  "realDonaldTrump",
  "elonmusk",
  "VitalikButerin",
  "brian_armstrong",
  "cz_binance",
  "SatoshiLite",
  "aantonop",
  "naval",
  "ErikVoorhees",
  "saylor",
  "SBF_FTX",
  "barrysilbert",
  "lopp",
  "winklevoss",
  "tyler",
  "APompliano",
  "CobraBitcoin",
  "TuurDemeester",
  "PeterSchiff",
  "gavinandresen",
  "rogerkver",
  "JihanWu",
  "TraceMayer",
  "ToneVays",
  "JimmySong",
  "Excellion",
  "jimmymcshane",
  "bypascal",
  "MustacheElmo",
  "woonomic",
  "glassnode",
  "skewdotcom",
  "crypto_rand",
  "CryptoYoda1338",
  "CryptoCobain",
  "Ansem",
  "TheCryptoDog",
  "MacnBTC",
  "CryptoTony__",
  "GCRClassic",
  "HsakaTrades",
  "ledger_support",
  "Trezor",
  "Metamask",
  "TrustWallet",
  "Phantom",
  "Uniswap",
  "Sushiswap",
  "PancakeSwap",
  "dYdX",
  "AaveAave",
  "CompoundFinance",
  "MakerDAO",
  "LidoFinance",
  "Rocket_Pool",
  "arbitrum",
  "optimism",
  "base",
  "solana",
  "ethereum",
  "Bitcoin",
  "dogecoin",
  "pepe",
  "shibtoken",
  "bonk_inu",
  "FlokiAnu",
  "pudgypenguins",
  "BoredApeYC",
  "cryptopunksnfts",
  "yugalabs",
  "Azuki",
  "Doodles",
  "clonex",
  "Moonbirds",
  "opensea",
  "blur_io",
  "MagicEden",
  "tensor_hq",
  "JupiterExchange",
  "RaydiumProtocol",
  "Orca_so",
  "DriftProtocol",
  "KaminoFinance",
  "MeteoraAG",
  "jito_sol",
  "pythnetwork",
  "wormhole",
  "LayerZero_Core",
  "eigenlayer",
  "ether_fi",
  "KelpDAO",
  "RenzoProtocol",
  "puffer_finance",
  "bounce_bit",
  "babylon_chain",
  "berachain",
  "monad_xyz",
  "Farcaster_xyz",
  "warpcast_",
  "lensprotocol",
  "hey_xyz_",
  "friendtech",
  "fantasy_top",
  "districtone_io",
  "cyberconnecthq",
  "galxe",
  "Layer3xyz",
  "zealy_io",
  "questn_official",
  "taskonxyz",
  "CoinMarketCap",
  "coingecko",
  "DefiLlama",
  "TokenTerminal",
  "DuneAnalytics",
  "Nansen_ai",
  "ArkhamIntel",
  "bubbles_maps",
  "debank360",
  "zapper_fi",
  "zerion",
  "rabby_io",
  "rainbowdotme",
  "okxweb3",
  "bitgetwallet",
  "gate_io",
  "kucoincom",
  "Bybit_Official",
  "HTX_Global",
  "MEXC_Official",
  "krakenfx",
  "coinbase",
  "binance",
  "cz_gemini",
  "cameron",
  "tyler_winklevoss",
  "paoloardoino",
  "Tether_to",
  "circle",
  "jerallaire",
  "USDCOfficial",
  "Paxos",
  "maker_dai",
  "fraxfinance",
  "samkazemian",
  "Arthur_0x",
  "DeFianceCapital",
  "AndrewKangLT",
  "MechanismCap",
  "KyleSamani",
  "MulticoinCap",
  "zhusu",
  "ThreeArrowsCap",
  "Suzyq3abc",
  "CozomoMedici",
  "punk6529",
  "gmoneyNFT",
  "shillrxyz",
  "beeple",
  "XCOPYART",
  "pak",
  "fewocious",
  "TylerHobbs",
  "dmitricherniak",
  "archillect",
  "NFT_VALLEY",
  "nftnow",
  "decentland",
  "superrare",
  "foundation",
  "makersplace",
  "knownorigin",
  "rarible",
  "looksrare",
  "x2y2_io",
  "Zora",
  "manifoldxyz",
  "highlight_xyz",
  "decaart",
  "gallery",
  "oncyber_io",
  "spatialxr",
  "sandboxgame",
  "decentraland",
  "somniumspace",
  "cryptovoxels",
  "illuviumio",
  "AxieInfinity",
  "yogg_games",
  "GuildFiGlobal",
  "YieldGuild",
  "MeritCircle",
  "AAG_Global",
  "Ronin_Network",
  "Immutable",
  "Polygon731",
  "Optimism_FND",
  "Arbitrum_FND",
  "Base_FND",
  "ZkSync",
  "Starknet",
  "LineaBuild",
  "Scroll_ZKP",
  "TaikoXa",
  "MantleOG",
  "MetisL2",
  "Loopringorg",
  "dydx_user",
  "GMX_IO",
  "GainsNetwork_io",
  "HMXorg",
  "VertexProtocol",
  "HyperliquidX",
  "Aevo_xyz",
  "RageTrade",
  "LyraFinance",
  "PremiaFinance",
  "DeribitExchange",
  "RibbonFinance",
  "Dopex_io",
  "Opyn_",
  "HegicOptions",
  "Panoptic_xyz",
  "SqueethByOpyn",
  "GammaStrategies",
  "ArrakisFinance",
  "DefiEdge",
  "AuraFinance",
  "ConvexFinance",
  "CurveFinance",
  "Balancer",
  "Beethoven_x",
  "VelodromeFi",
  "AerodromeFi",
  "ThenaFi_",
  "SolidlyExchange",
  "Equalizer0x",
  "RamsesExchange",
  "ChronosFi_",
  "Pearl_Fi",
  "SterlingFinance",
  "Retro_finance",
  "MerlinSwap",
  "PancakeSwap_L2",
  "TraderJoe_xyz",
  "BenqiFinance",
  "GMX_AVAX",
  "Platypusdefi",
  "YetiFinance",
  "VectorFinance",
  "TraderJoe_NFT",
  "JoepegNFT",
  "SynapseProtocol",
  "StargateFinance",
];

/** @returns {string[]} unique lowercase handles */
function getWatchlistHandles() {
  const out = [];
  const seen = new Set();
  for (const raw of HANDLES.slice(0, MAX_HANDLES)) {
    const h = String(raw || '')
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

function normalizeHandle(raw) {
  return String(raw || '')
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, '')
    .split(/[/?#]/)[0]
    .trim()
    .toLowerCase();
}

/**
 * Match candidates against the unique reference pool.
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
    version: 3,
    name: 'memecoin-signal-x-reference-pool',
    count: getWatchlistHandles().length,
    maxHandles: MAX_HANDLES,
    role: 'memecoin-signal-reference-pool',
    updatedAt: '2026-07-16',
  };
}

// Back-compat alias: HANDLES as objects if something expected rank rows
const HANDLE_ROWS = HANDLES.map((handle, i) => ({ rank: i + 1, handle }));

export {
  HANDLES,
  HANDLE_ROWS,
  MAX_HANDLES,
  getWatchlistHandles,
  getWatchlistSet,
  matchWatchlist,
  normalizeHandle,
  getWatchlistMeta,
};

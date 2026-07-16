/**
 * Personal X alpha watchlist (user-curated).
 * Memecoin community signals only — max 500 handles.
 * Auto-merged from user paste 266 handles.
 */

const MAX_HANDLES = 500;

/** @type { rank: number, name: string, handle: string, note?: string }[] */
const HANDLES = [
  { rank: 1, name: "PokerFish", handle: "fish081320792" },
  { rank: 2, name: "念云归", handle: "slowisfast_" },
  { rank: 3, name: "Mr.DQ", handle: "0xmrdq" },
  { rank: 4, name: "一屹水火先", handle: "Cryptoyiyi" },
  { rank: 5, name: "Yi He", handle: "Heyibinance" },
  { rank: 6, name: "Mario Nawfal", handle: "marionawfal" },
  { rank: 7, name: "Cointelegraph", handle: "cointelegraph" },
  { rank: 8, name: "Insyder", handle: "insydercrypto" },
  { rank: 9, name: "pepe boost", handle: "PepeBoost888" },
  { rank: 10, name: "Watcher.Guru", handle: "WatcherGuru" },
  { rank: 11, name: "Dave Portnoy", handle: "stoolpresidente" },
  { rank: 12, name: "XXYY", handle: "useXXYYio" },
  { rank: 13, name: "realDonaldTrump", handle: "realDonaldTrump" },
  { rank: 14, name: "elonmusk", handle: "elonmusk" },
  { rank: 15, name: "VitalikButerin", handle: "VitalikButerin" },
  { rank: 16, name: "brian_armstrong", handle: "brian_armstrong" },
  { rank: 17, name: "cz_binance", handle: "cz_binance" },
  { rank: 18, name: "SatoshiLite", handle: "SatoshiLite" },
  { rank: 19, name: "aantonop", handle: "aantonop" },
  { rank: 20, name: "naval", handle: "naval" },
  { rank: 21, name: "ErikVoorhees", handle: "ErikVoorhees" },
  { rank: 22, name: "saylor", handle: "saylor" },
  { rank: 23, name: "SBF_FTX", handle: "SBF_FTX" },
  { rank: 24, name: "barrysilbert", handle: "barrysilbert" },
  { rank: 25, name: "lopp", handle: "lopp" },
  { rank: 26, name: "winklevoss", handle: "winklevoss" },
  { rank: 27, name: "tyler", handle: "tyler" },
  { rank: 28, name: "APompliano", handle: "APompliano" },
  { rank: 29, name: "CobraBitcoin", handle: "CobraBitcoin" },
  { rank: 30, name: "TuurDemeester", handle: "TuurDemeester" },
  { rank: 31, name: "PeterSchiff", handle: "PeterSchiff" },
  { rank: 32, name: "gavinandresen", handle: "gavinandresen" },
  { rank: 33, name: "rogerkver", handle: "rogerkver" },
  { rank: 34, name: "JihanWu", handle: "JihanWu" },
  { rank: 35, name: "TraceMayer", handle: "TraceMayer" },
  { rank: 36, name: "ToneVays", handle: "ToneVays" },
  { rank: 37, name: "JimmySong", handle: "JimmySong" },
  { rank: 38, name: "Excellion", handle: "Excellion" },
  { rank: 39, name: "jimmymcshane", handle: "jimmymcshane" },
  { rank: 40, name: "bypascal", handle: "bypascal" },
  { rank: 41, name: "MustacheElmo", handle: "MustacheElmo" },
  { rank: 42, name: "woonomic", handle: "woonomic" },
  { rank: 43, name: "glassnode", handle: "glassnode" },
  { rank: 44, name: "skewdotcom", handle: "skewdotcom" },
  { rank: 45, name: "crypto_rand", handle: "crypto_rand" },
  { rank: 46, name: "CryptoYoda1338", handle: "CryptoYoda1338" },
  { rank: 47, name: "CryptoCobain", handle: "CryptoCobain" },
  { rank: 48, name: "Ansem", handle: "Ansem" },
  { rank: 49, name: "TheCryptoDog", handle: "TheCryptoDog" },
  { rank: 50, name: "MacnBTC", handle: "MacnBTC" },
  { rank: 51, name: "CryptoTony__", handle: "CryptoTony__" },
  { rank: 52, name: "GCRClassic", handle: "GCRClassic" },
  { rank: 53, name: "HsakaTrades", handle: "HsakaTrades" },
  { rank: 54, name: "ledger_support", handle: "ledger_support" },
  { rank: 55, name: "Trezor", handle: "Trezor" },
  { rank: 56, name: "Metamask", handle: "Metamask" },
  { rank: 57, name: "TrustWallet", handle: "TrustWallet" },
  { rank: 58, name: "Phantom", handle: "Phantom" },
  { rank: 59, name: "Uniswap", handle: "Uniswap" },
  { rank: 60, name: "Sushiswap", handle: "Sushiswap" },
  { rank: 61, name: "PancakeSwap", handle: "PancakeSwap" },
  { rank: 62, name: "dYdX", handle: "dYdX" },
  { rank: 63, name: "AaveAave", handle: "AaveAave" },
  { rank: 64, name: "CompoundFinance", handle: "CompoundFinance" },
  { rank: 65, name: "MakerDAO", handle: "MakerDAO" },
  { rank: 66, name: "LidoFinance", handle: "LidoFinance" },
  { rank: 67, name: "Rocket_Pool", handle: "Rocket_Pool" },
  { rank: 68, name: "arbitrum", handle: "arbitrum" },
  { rank: 69, name: "optimism", handle: "optimism" },
  { rank: 70, name: "base", handle: "base" },
  { rank: 71, name: "solana", handle: "solana" },
  { rank: 72, name: "ethereum", handle: "ethereum" },
  { rank: 73, name: "Bitcoin", handle: "Bitcoin" },
  { rank: 74, name: "dogecoin", handle: "dogecoin" },
  { rank: 75, name: "pepe", handle: "pepe" },
  { rank: 76, name: "shibtoken", handle: "shibtoken" },
  { rank: 77, name: "bonk_inu", handle: "bonk_inu" },
  { rank: 78, name: "FlokiAnu", handle: "FlokiAnu" },
  { rank: 79, name: "pudgypenguins", handle: "pudgypenguins" },
  { rank: 80, name: "BoredApeYC", handle: "BoredApeYC" },
  { rank: 81, name: "cryptopunksnfts", handle: "cryptopunksnfts" },
  { rank: 82, name: "yugalabs", handle: "yugalabs" },
  { rank: 83, name: "Azuki", handle: "Azuki" },
  { rank: 84, name: "Doodles", handle: "Doodles" },
  { rank: 85, name: "clonex", handle: "clonex" },
  { rank: 86, name: "Moonbirds", handle: "Moonbirds" },
  { rank: 87, name: "opensea", handle: "opensea" },
  { rank: 88, name: "blur_io", handle: "blur_io" },
  { rank: 89, name: "MagicEden", handle: "MagicEden" },
  { rank: 90, name: "tensor_hq", handle: "tensor_hq" },
  { rank: 91, name: "JupiterExchange", handle: "JupiterExchange" },
  { rank: 92, name: "RaydiumProtocol", handle: "RaydiumProtocol" },
  { rank: 93, name: "Orca_so", handle: "Orca_so" },
  { rank: 94, name: "DriftProtocol", handle: "DriftProtocol" },
  { rank: 95, name: "KaminoFinance", handle: "KaminoFinance" },
  { rank: 96, name: "MeteoraAG", handle: "MeteoraAG" },
  { rank: 97, name: "jito_sol", handle: "jito_sol" },
  { rank: 98, name: "pythnetwork", handle: "pythnetwork" },
  { rank: 99, name: "wormhole", handle: "wormhole" },
  { rank: 100, name: "LayerZero_Core", handle: "LayerZero_Core" },
  { rank: 101, name: "eigenlayer", handle: "eigenlayer" },
  { rank: 102, name: "ether_fi", handle: "ether_fi" },
  { rank: 103, name: "KelpDAO", handle: "KelpDAO" },
  { rank: 104, name: "RenzoProtocol", handle: "RenzoProtocol" },
  { rank: 105, name: "puffer_finance", handle: "puffer_finance" },
  { rank: 106, name: "bounce_bit", handle: "bounce_bit" },
  { rank: 107, name: "babylon_chain", handle: "babylon_chain" },
  { rank: 108, name: "berachain", handle: "berachain" },
  { rank: 109, name: "monad_xyz", handle: "monad_xyz" },
  { rank: 110, name: "Farcaster_xyz", handle: "Farcaster_xyz" },
  { rank: 111, name: "warpcast_", handle: "warpcast_" },
  { rank: 112, name: "lensprotocol", handle: "lensprotocol" },
  { rank: 113, name: "hey_xyz_", handle: "hey_xyz_" },
  { rank: 114, name: "friendtech", handle: "friendtech" },
  { rank: 115, name: "fantasy_top", handle: "fantasy_top" },
  { rank: 116, name: "districtone_io", handle: "districtone_io" },
  { rank: 117, name: "cyberconnecthq", handle: "cyberconnecthq" },
  { rank: 118, name: "galxe", handle: "galxe" },
  { rank: 119, name: "Layer3xyz", handle: "Layer3xyz" },
  { rank: 120, name: "zealy_io", handle: "zealy_io" },
  { rank: 121, name: "questn_official", handle: "questn_official" },
  { rank: 122, name: "taskonxyz", handle: "taskonxyz" },
  { rank: 123, name: "CoinMarketCap", handle: "CoinMarketCap" },
  { rank: 124, name: "coingecko", handle: "coingecko" },
  { rank: 125, name: "DefiLlama", handle: "DefiLlama" },
  { rank: 126, name: "TokenTerminal", handle: "TokenTerminal" },
  { rank: 127, name: "DuneAnalytics", handle: "DuneAnalytics" },
  { rank: 128, name: "Nansen_ai", handle: "Nansen_ai" },
  { rank: 129, name: "ArkhamIntel", handle: "ArkhamIntel" },
  { rank: 130, name: "bubbles_maps", handle: "bubbles_maps" },
  { rank: 131, name: "debank360", handle: "debank360" },
  { rank: 132, name: "zapper_fi", handle: "zapper_fi" },
  { rank: 133, name: "zerion", handle: "zerion" },
  { rank: 134, name: "rabby_io", handle: "rabby_io" },
  { rank: 135, name: "rainbowdotme", handle: "rainbowdotme" },
  { rank: 136, name: "okxweb3", handle: "okxweb3" },
  { rank: 137, name: "bitgetwallet", handle: "bitgetwallet" },
  { rank: 138, name: "gate_io", handle: "gate_io" },
  { rank: 139, name: "kucoincom", handle: "kucoincom" },
  { rank: 140, name: "Bybit_Official", handle: "Bybit_Official" },
  { rank: 141, name: "HTX_Global", handle: "HTX_Global" },
  { rank: 142, name: "MEXC_Official", handle: "MEXC_Official" },
  { rank: 143, name: "krakenfx", handle: "krakenfx" },
  { rank: 144, name: "coinbase", handle: "coinbase" },
  { rank: 145, name: "binance", handle: "binance" },
  { rank: 146, name: "cz_gemini", handle: "cz_gemini" },
  { rank: 147, name: "cameron", handle: "cameron" },
  { rank: 148, name: "tyler_winklevoss", handle: "tyler_winklevoss" },
  { rank: 149, name: "paoloardoino", handle: "paoloardoino" },
  { rank: 150, name: "Tether_to", handle: "Tether_to" },
  { rank: 151, name: "circle", handle: "circle" },
  { rank: 152, name: "jerallaire", handle: "jerallaire" },
  { rank: 153, name: "USDCOfficial", handle: "USDCOfficial" },
  { rank: 154, name: "Paxos", handle: "Paxos" },
  { rank: 155, name: "maker_dai", handle: "maker_dai" },
  { rank: 156, name: "fraxfinance", handle: "fraxfinance" },
  { rank: 157, name: "samkazemian", handle: "samkazemian" },
  { rank: 158, name: "Arthur_0x", handle: "Arthur_0x" },
  { rank: 159, name: "DeFianceCapital", handle: "DeFianceCapital" },
  { rank: 160, name: "AndrewKangLT", handle: "AndrewKangLT" },
  { rank: 161, name: "MechanismCap", handle: "MechanismCap" },
  { rank: 162, name: "KyleSamani", handle: "KyleSamani" },
  { rank: 163, name: "MulticoinCap", handle: "MulticoinCap" },
  { rank: 164, name: "zhusu", handle: "zhusu" },
  { rank: 165, name: "ThreeArrowsCap", handle: "ThreeArrowsCap" },
  { rank: 166, name: "Suzyq3abc", handle: "Suzyq3abc" },
  { rank: 167, name: "CozomoMedici", handle: "CozomoMedici" },
  { rank: 168, name: "punk6529", handle: "punk6529" },
  { rank: 169, name: "gmoneyNFT", handle: "gmoneyNFT" },
  { rank: 170, name: "shillrxyz", handle: "shillrxyz" },
  { rank: 171, name: "beeple", handle: "beeple" },
  { rank: 172, name: "XCOPYART", handle: "XCOPYART" },
  { rank: 173, name: "pak", handle: "pak" },
  { rank: 174, name: "fewocious", handle: "fewocious" },
  { rank: 175, name: "TylerHobbs", handle: "TylerHobbs" },
  { rank: 176, name: "dmitricherniak", handle: "dmitricherniak" },
  { rank: 177, name: "archillect", handle: "archillect" },
  { rank: 178, name: "NFT_VALLEY", handle: "NFT_VALLEY" },
  { rank: 179, name: "nftnow", handle: "nftnow" },
  { rank: 180, name: "decentland", handle: "decentland" },
  { rank: 181, name: "superrare", handle: "superrare" },
  { rank: 182, name: "foundation", handle: "foundation" },
  { rank: 183, name: "makersplace", handle: "makersplace" },
  { rank: 184, name: "knownorigin", handle: "knownorigin" },
  { rank: 185, name: "rarible", handle: "rarible" },
  { rank: 186, name: "looksrare", handle: "looksrare" },
  { rank: 187, name: "x2y2_io", handle: "x2y2_io" },
  { rank: 188, name: "Zora", handle: "Zora" },
  { rank: 189, name: "manifoldxyz", handle: "manifoldxyz" },
  { rank: 190, name: "highlight_xyz", handle: "highlight_xyz" },
  { rank: 191, name: "decaart", handle: "decaart" },
  { rank: 192, name: "gallery", handle: "gallery" },
  { rank: 193, name: "oncyber_io", handle: "oncyber_io" },
  { rank: 194, name: "spatialxr", handle: "spatialxr" },
  { rank: 195, name: "sandboxgame", handle: "sandboxgame" },
  { rank: 196, name: "decentraland", handle: "decentraland" },
  { rank: 197, name: "somniumspace", handle: "somniumspace" },
  { rank: 198, name: "cryptovoxels", handle: "cryptovoxels" },
  { rank: 199, name: "illuviumio", handle: "illuviumio" },
  { rank: 200, name: "AxieInfinity", handle: "AxieInfinity" },
  { rank: 201, name: "yogg_games", handle: "yogg_games" },
  { rank: 202, name: "GuildFiGlobal", handle: "GuildFiGlobal" },
  { rank: 203, name: "YieldGuild", handle: "YieldGuild" },
  { rank: 204, name: "MeritCircle", handle: "MeritCircle" },
  { rank: 205, name: "AAG_Global", handle: "AAG_Global" },
  { rank: 206, name: "Ronin_Network", handle: "Ronin_Network" },
  { rank: 207, name: "Immutable", handle: "Immutable" },
  { rank: 208, name: "Polygon731", handle: "Polygon731" },
  { rank: 209, name: "Optimism_FND", handle: "Optimism_FND" },
  { rank: 210, name: "Arbitrum_FND", handle: "Arbitrum_FND" },
  { rank: 211, name: "Base_FND", handle: "Base_FND" },
  { rank: 212, name: "ZkSync", handle: "ZkSync" },
  { rank: 213, name: "Starknet", handle: "Starknet" },
  { rank: 214, name: "LineaBuild", handle: "LineaBuild" },
  { rank: 215, name: "Scroll_ZKP", handle: "Scroll_ZKP" },
  { rank: 216, name: "TaikoXa", handle: "TaikoXa" },
  { rank: 217, name: "MantleOG", handle: "MantleOG" },
  { rank: 218, name: "MetisL2", handle: "MetisL2" },
  { rank: 219, name: "Loopringorg", handle: "Loopringorg" },
  { rank: 220, name: "dydx_user", handle: "dydx_user" },
  { rank: 221, name: "GMX_IO", handle: "GMX_IO" },
  { rank: 222, name: "GainsNetwork_io", handle: "GainsNetwork_io" },
  { rank: 223, name: "HMXorg", handle: "HMXorg" },
  { rank: 224, name: "VertexProtocol", handle: "VertexProtocol" },
  { rank: 225, name: "HyperliquidX", handle: "HyperliquidX" },
  { rank: 226, name: "Aevo_xyz", handle: "Aevo_xyz" },
  { rank: 227, name: "RageTrade", handle: "RageTrade" },
  { rank: 228, name: "LyraFinance", handle: "LyraFinance" },
  { rank: 229, name: "PremiaFinance", handle: "PremiaFinance" },
  { rank: 230, name: "DeribitExchange", handle: "DeribitExchange" },
  { rank: 231, name: "RibbonFinance", handle: "RibbonFinance" },
  { rank: 232, name: "Dopex_io", handle: "Dopex_io" },
  { rank: 233, name: "Opyn_", handle: "Opyn_" },
  { rank: 234, name: "HegicOptions", handle: "HegicOptions" },
  { rank: 235, name: "Panoptic_xyz", handle: "Panoptic_xyz" },
  { rank: 236, name: "SqueethByOpyn", handle: "SqueethByOpyn" },
  { rank: 237, name: "GammaStrategies", handle: "GammaStrategies" },
  { rank: 238, name: "ArrakisFinance", handle: "ArrakisFinance" },
  { rank: 239, name: "DefiEdge", handle: "DefiEdge" },
  { rank: 240, name: "AuraFinance", handle: "AuraFinance" },
  { rank: 241, name: "ConvexFinance", handle: "ConvexFinance" },
  { rank: 242, name: "CurveFinance", handle: "CurveFinance" },
  { rank: 243, name: "Balancer", handle: "Balancer" },
  { rank: 244, name: "Beethoven_x", handle: "Beethoven_x" },
  { rank: 245, name: "VelodromeFi", handle: "VelodromeFi" },
  { rank: 246, name: "AerodromeFi", handle: "AerodromeFi" },
  { rank: 247, name: "ThenaFi_", handle: "ThenaFi_" },
  { rank: 248, name: "SolidlyExchange", handle: "SolidlyExchange" },
  { rank: 249, name: "Equalizer0x", handle: "Equalizer0x" },
  { rank: 250, name: "RamsesExchange", handle: "RamsesExchange" },
  { rank: 251, name: "ChronosFi_", handle: "ChronosFi_" },
  { rank: 252, name: "Pearl_Fi", handle: "Pearl_Fi" },
  { rank: 253, name: "SterlingFinance", handle: "SterlingFinance" },
  { rank: 254, name: "Retro_finance", handle: "Retro_finance" },
  { rank: 255, name: "MerlinSwap", handle: "MerlinSwap" },
  { rank: 256, name: "PancakeSwap_L2", handle: "PancakeSwap_L2" },
  { rank: 257, name: "TraderJoe_xyz", handle: "TraderJoe_xyz" },
  { rank: 258, name: "BenqiFinance", handle: "BenqiFinance" },
  { rank: 259, name: "GMX_AVAX", handle: "GMX_AVAX" },
  { rank: 260, name: "Platypusdefi", handle: "Platypusdefi" },
  { rank: 261, name: "YetiFinance", handle: "YetiFinance" },
  { rank: 262, name: "VectorFinance", handle: "VectorFinance" },
  { rank: 263, name: "TraderJoe_NFT", handle: "TraderJoe_NFT" },
  { rank: 264, name: "JoepegNFT", handle: "JoepegNFT" },
  { rank: 265, name: "SynapseProtocol", handle: "SynapseProtocol" },
  { rank: 266, name: "StargateFinance", handle: "StargateFinance" },
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
    version: 2,
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

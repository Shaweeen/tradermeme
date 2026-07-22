# Work Progress

Date: 2026-07-21

## Current deployed / pushed state
- Repository: https://github.com/Shaweeen/tradermeme.git
- Branch: main
- Live site: https://tradermeme.pages.dev/
- Latest local work (this session): AI panel wired to real GMGN security + Monitor Smart/KOL Net Inflow (not yet pushed/deployed).

## Completed previously (through 2026-07-17)
- Multi-chain Memecoin boards + backup sources (BSC Pancake / DexScreener fallback).
- Signal ticker UI, chain-isolated realtime alerts, detail links (Sol→GMGN, EVM→DexScreener).
- X watchlist + GMGN KOL Net Inflow dedupe.
- Monitor heat gate: only 5m / 15m / 1h Smart Net Inflow style signals enter AI tracking.
- 24H AI: buy-point win rate, purge invalids, selection feedback from pattern outcomes.
- Signal tracking count-based archive (newest 8 cards + compact history).

## Completed 2026-07-21
- **AI 面板接真数据** (local, not deployed yet):
  - `SignalEngine.buildSecurityReport` — GMGN security 抽检状态、honeypot/rug/ban、可卖、权限、Top10、风险摘要
  - `SignalEngine.buildResonanceReport` — Smart Net + KOL Net Inflow、钱包数、Monitor 共振分（替换买压/放量 MVP 估算）
  - `scoreTokenSignal` 输出 `security` / `resonance` 对象
  - `createSignal` meta 持久化 security + full Monitor 字段
  - `analyzeTrackedToken` / `renderAiDetailPanel` 展示真实来源标签与指标文案
  - `npm test` 纳入 `signal-outcome.test.mjs` + security/resonance 断言
- **GMGN 429 限流缓解** (local, not deployed yet):
  - `_gmgn.js`: response cache + in-flight coalesce + max 3 concurrent + 429 circuit breaker + stale serve
  - multi-rank: fewer intervals, no orderby stampede, sequential under pressure
  - enrichment: smart/kol limits cut, security top-4 batched (2), skip discovery when circuit open
  - multi-chain: max 2 parallel (1 under circuit)
  - quality.gmgnRateLimit surfaced in trending response
  - tests: `tests/gmgn-rate-limit.test.mjs`
- **钱包画像** (local, not deployed yet):
  - Monitor enrichment builds `topWallets` (top 6 SM/KOL by |net| on token in 1h)
  - `GET /api/wallet-profile` → GMGN `wallet_stats` (lazy, 5min cache)
  - AI panel lists wallets; click loads 7d 胜率 / PnL / 买卖 / 风格评级 + GMGN link
  - tests: `tests/wallet-profile.test.mjs`
- **策略预览 API** (local, not deployed yet):
  - `GET /api/strategy-preview` + pure `buildStrategyQuote` (standard ladder TP/SL)
  - Modal UI with legs table, risk R:R, grade-based sizing; always `executionEnabled: false`
  - Local fallback quote if API fails; D/禁止交易 hard block
  - tests: `tests/strategy-preview.test.mjs`

## Verification 2026-07-21
- `npm test` (signal-engine, outcome, rate-limit, wallet-profile, strategy-preview, enrichment, static)

## Live site notes
- All of the above is local-only until deploy.
- Local Wrangler was unauthenticated last check; deploy needs `wrangler login` or `CLOUDFLARE_API_TOKEN`.

## Next recommended work
1. Commit + push entire session stack; deploy after Cloudflare auth.
2. Optional: Top100 traders table (beyond top-6 related wallets).
3. Real execution only after explicit product decision + wallet connect + confirm UX (not started).

## Important safety
- Trading execution is not enabled. Strategy module is preview-only.
- Do not store private keys in frontend.
- Any real order creation must require explicit user confirmation.

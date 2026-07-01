# MemeWatch - 多链 Memecoin 实时监控仪表盘

基于 Cloudflare Pages + Functions 构建的多链 Memecoin 实时监控工具。

监控 **Solana**、**Base**、**BSC** 三条链上的热门 Memecoin 动态，数据来源包括 **GMGN OpenAPI**（认证）和 **DexScreener**。

## 功能特性

- **GMGN OpenAPI 认证集成** — 使用你的 GMGN API Key 获取更丰富、准确的数据
- **Smart Money 追踪** — 监控高盈利钱包的实时活动
- **KOL 追踪** — 追踪关键意见领袖的持仓变化
- **多链支持** — 一键切换 Solana / Base / BSC / 全部链
- **实时数据** — 价格、涨跌幅、交易量、交易笔数、买卖比、流动性、FDV
- **自动刷新** — 每 30 秒自动更新，可手动关闭
- **暗色主题** — 专业级暗色 UI，适配 Crypto 交易风格
- **响应式设计** — 桌面端、平板、手机均可流畅使用
- **一键跳转** — 直达 GMGN 交易页面和区块链浏览器

## 项目结构

```
memecoin-monitor/
├── package.json              # 项目配置
├── wrangler.toml             # Cloudflare Pages 配置 + 密钥提示
├── README.md                 # 本文件
├── public/                   # 前端静态文件
│   ├── index.html            # 仪表盘 HTML
│   ├── style.css             # 样式表（暗色主题）
│   └── app.js                # 前端逻辑
└── functions/
    └── api/
        ├── _gmgn.js          # GMGN OpenAPI 客户端（认证）
        ├── trending.js       # 热门 memecoin API（GMGN 认证）
        ├── othercoin.js      # 信号扫描 API
        └── bitcoin.js        # BTC 市场数据 API
```

## GMGN OpenAPI 集成（认证）

本项目支持使用 **GMGN OpenAPI** 获取更丰富的数据。需要你的 GMGN API Key。

### 获取 GMGN API Key

1. 登录你的 [GMGN](https://gmgn.ai) 账号
2. 进入 API 设置页面获取 API Key
3. 在 Cloudflare Pages / Wrangler 中设置

### 设置环境变量

```bash
# 使用 wrangler CLI 设置密钥（推荐，不会泄露在代码中）
npx wrangler pages secret put GMGN_API_KEY
# 然后输入你的 API Key
```

### 认证端点

| 端点 | 说明 |
|------|------|
| `GET /api/trending?chain=solana` | 获取热门 Memecoin（GMGN 认证） |
| `GET /api/smartmoney?chain=sol` | Smart Money 钱包活动 |
| `GET /api/kol?chain=sol` | KOL 钱包活动 |
| `GET /api/token-info?chain=sol&address=` | 代币详细信息 |

## 部署到 Cloudflare Pages

### 前置条件

1. 拥有 [Cloudflare](https://cloudflare.com) 账号
2. 安装 [Node.js](https://nodejs.org/) v18+
3. 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

```bash
npm install -g wrangler
```

### 本地开发

```bash
cd memecoin-monitor

# 安装依赖
npm install

# 本地启动开发服务器
npx wrangler pages dev public --binding --port 8788
```

访问 `http://localhost:8788` 即可查看仪表盘。

### 配置 GMGN API Key（开发环境）

```bash
# 创建 .dev.vars 文件（不要提交到 Git）
echo "GMGN_API_KEY=your_api_key_here" > .dev.vars
```

### 部署到 Cloudflare Pages

**方式一：通过 Wrangler CLI 部署**

```bash
# 登录 Cloudflare（如未登录）
npx wrangler login

# 部署（包含 Functions）
npx wrangler pages deploy public --project-name memecoin-monitor

# 设置生产环境密钥
npx wrangler pages secret put GMGN_API_KEY
```

**方式二：通过 Cloudflare Dashboard 部署**

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** > **Pages**
3. 点击 **Create a project** > **Direct Upload**
4. 上传整个 `memecoin-monitor` 项目
5. 构建配置：
   - **构建命令**: `echo 'Static site'`
   - **构建输出目录**: `public`
6. 在 **Settings** > **Environment variables** 中添加 `GMGN_API_KEY`
7. 部署完成后即可通过 `https://memecoin-monitor.pages.dev` 访问

### 自定义域名（可选）

在 Cloudflare Pages 项目设置中，可以绑定自己的域名：
- 进入项目 > **Custom domains** > **Set up a custom domain**
- 输入你的域名，按照指引完成 DNS 配置

## API 端点汇总

### GMGN 认证端点

| 端点 | 说明 |
|------|------|
| `GET /api/trending?chain=solana` | 获取 Solana 链热门 Memecoin（GMGN 认证） |
| `GET /api/trending?chain=base` | 获取 Base 链热门 Memecoin |
| `GET /api/trending?chain=bsc` | 获取 BSC 链热门 Memecoin |
| `GET /api/trending?chain=all` | 获取全部链热门 Memecoin |
| `GET /api/smartmoney?chain=sol` | Smart Money 近期交易活动 |
| `GET /api/kol?chain=sol` | KOL 近期交易活动 |
| `GET /api/token-info?chain=sol&address=...` | 代币详细信息 |
| `GET /api/chains` | 查看支持链列表 |

### 其他端点

| 端点 | 说明 |
|------|------|
| `GET /api/othercoin` | Coinglass 信号扫描 |
| `GET /api/bitcoin` | BTC 市场数据 |

## 数据来源

- **[GMGN.AI OpenAPI](https://gmgn.ai/)** — 主要数据源（认证 API，数据更丰富）
- **[DexScreener](https://dexscreener.com/)** — DEX 数据聚合器（补充数据源）
- **[CoinGecko](https://www.coingecko.com/)** — 价格数据
- **[Binance](https://www.binance.com/)** / **[Bybit](https://www.bybit.com/)** — BTC 期货数据
- **[HyperLiquid](https://hyperliquid.xyz/)** — DEX 永续合约数据

## 免责声明

> 本工具仅供信息参考和学习研究，不构成任何投资建议。
> 加密货币交易具有高风险，请自行承担投资风险。
> 数据来源于第三方 API，不保证数据实时性和准确性。

## License

MIT

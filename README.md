# DreamStudio

Multi-chain **multi trader** dashboard — Memecoin · Altcoin · Bitcoin contracts.

Built with **Cloudflare Pages + Functions**. Brand: dream studio · [@shaweeenx](https://x.com/shaweeenx).

## Features

- **Memecoin monitor** — multi-chain trending, smart money / KOL heat, value rank
- **Altcoin signals** — multi-venue futures / spot signal scan
- **Bitcoin** — self-signal period board, funding/OI means, L/S liquidations map, rainbow / halving / MA200 cycles
- **Local dev** — `node scripts/local-dev.mjs` (proxy-friendly for restricted networks)
- **Dark terminal UI** — crypto-native layout

## Quick start

```bash
npm install
# optional secrets in .dev.vars (never commit):
#   GMGN_API_KEY=...
#   COINGLASS_API_KEY=...
npm run dev
# open http://127.0.0.1:8788
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Local static + `/api/*` functions |
| `npm test` | Unit / static checks |
| `npm run deploy` | Cloudflare Pages deploy (`dreamstudio`) |

## Project layout

```
DreamStudio/
├── package.json
├── wrangler.toml
├── public/                 # frontend
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── brand/              # DreamStudio / dream studio marks
│   └── signal-engine.js
├── functions/api/          # Pages Functions
│   ├── bitcoin.js
│   ├── trending.js
│   ├── othercoin.js
│   └── ...
├── scripts/local-dev.mjs
└── tests/
```

## Secrets

Set via Wrangler (production) or `.dev.vars` (local only):

```bash
npx wrangler pages secret put GMGN_API_KEY
# optional
npx wrangler pages secret put COINGLASS_API_KEY
```

## License

MIT

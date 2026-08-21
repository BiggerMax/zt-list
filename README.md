# A股涨停梯队 (Stock Limit-Up Dashboard)

A real-time dashboard showing A-share daily limit-up stocks, categorized by board count (1st board, 2nd board, etc.).

## Features
- **Real-time Data**: Fetches data from East Money (东方财富).
- **Detailed Analysis**: Displays limit-up reasons and detailed concepts (e.g., "Software | AI, Cloud").
- **Auto-Refresh**: Updates every 5 seconds (today only).
- **Data Persistence**: Each day's snapshot is saved to Cloudflare KV; if the live sources fail, the latest snapshot is served as a fallback.
- **Historical Dates**: Pick any past date in the header to view that day's closing limit-up board (涨停梯队收盘数据).
- **Responsive UI**: Dark mode financial terminal aesthetic.

## Tech Stack
- Next.js 15 (App Router)
- Tailwind CSS v4
- TypeScript

## Deployment

### Cloudflare Pages
1. Push this repository to GitHub.
2. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/).
3. Go to **Workers & Pages** > **Create Application** > **Pages** > **Connect to Git**.
4. Select this repository.
5. **Build Settings**:
   - **Framework Preset**: Next.js
   - **Build Command**: `npx @cloudflare/next-on-pages@1`
   - **Output Directory**: `.vercel/output/static` (or let Cloudflare auto-detect)

6. **IMPORTANT: Compatibility Flags**
   If you see a `Node.JS Compatibility Error`, you need to enable the compatibility flag:
   - Go to your Pages project **Settings** > **Functions** > **Compatibility Flags**.
   - Add `nodejs_compat` to the Production and Preview compatibility flags.
   - Redeploy your project.

### Data Persistence & Historical Dates (Cloudflare KV)

To enable persistence across deployments (so past dates can be viewed), create a KV namespace and bind it:

```bash
npx wrangler kv namespace create zt-list
```

Copy the returned `id` into `wrangler.toml` under `[[kv_namespaces]]` (replace the placeholder `id`).

- **Today**: the API polls live sources every 5s and writes throttled snapshots to KV (`snapshot:YYYY-MM-DD`). If live fetching fails, the last saved snapshot is served with a `stale` flag.
- **Past dates**: the API first returns the persisted snapshot if present; otherwise it rebuilds the day's closing data from East Money historical endpoints and caches it in KV for next time.
- **Local dev** (no KV binding): falls back to in-memory storage, so history only lasts for the current process.

### Data Sources (同花顺官方 API 为主源)

主要数据已迁移至同花顺金融数据 API（官方、稳定，文档见 https://fuyao.aicubes.cn ）：

| 路由 | 主源 | 兜底 |
|---|---|---|
| `/api/pool` 涨停/跌停池 | 同花顺 `limit-up-pool` / `limit-down-pool`（含涨停原因） | 东财 push2ex |
| `/api/calendar` 交易日历 | 同花顺 `calendar/trading-days`（精确含节假日） | - |
| `/api/quote` 断板股涨幅 | 同花顺批量快照 / 历史日K | 开盘啦 → 东财 |
| `/api/xgb` 选股宝快照 | 选股宝（仅断板识别辅助，后续可下线） | - |
| `/api/stock-chart` 分时/K线 | 开盘啦 → 东财 → 腾讯（同花顺无分钟级数据） | - |

API Key 通过环境变量注入，默认值仅用于本地开发：

```bash
npx wrangler pages secret put FUYAO_API_KEY   # 生产环境
# 本地：在 .dev.vars 中写入 FUYAO_API_KEY=sk-fuyao-xxx
```

### Local Development
```bash
npm install
npm run dev
```

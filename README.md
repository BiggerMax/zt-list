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

### Local Development
```bash
npm install
npm run dev
```

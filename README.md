# A股涨停梯队 (Stock Limit-Up Dashboard)

A real-time dashboard showing A-share daily limit-up stocks, categorized by board count (1st board, 2nd board, etc.).

## Features
- **Real-time Data**: Fetches data from East Money (东方财富).
- **Detailed Analysis**: Displays limit-up reasons and detailed concepts (e.g., "Software | AI, Cloud").
- **Auto-Refresh**: Updates every 5 seconds.
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
   - *Note*: You may need to add `nodejs_compat` compatibility flag if using specific Node APIs, but this project is optimized for Edge Runtime.

### Local Development
```bash
npm install
npm run dev
```

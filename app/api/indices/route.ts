import { NextResponse } from 'next/server';

// OpenNext 部署到 Cloudflare Workers（nodejs_compat），无需 edge runtime
export const dynamic = 'force-dynamic'; // Disable caching

const EM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15';

interface IndexQuote {
  code: string;
  name: string;
  price: number; // 最新点位
  pct: number; // 涨跌幅 %
}

const INDEXES: { code: string; name: string; secid: string; txCode: string }[] = [
  { code: '000001', name: '上证指数', secid: '1.000001', txCode: 'sh000001' },
  { code: '399001', name: '深证成指', secid: '0.399001', txCode: 'sz399001' },
  { code: '399006', name: '创业板指', secid: '0.399006', txCode: 'sz399006' },
];

// 10 秒结果缓存：前端 5s 轮询与多客户端共享，上游约每 10s 拉一次（与改动前持平），但客户端数据更新一倍
const CACHE_TTL_MS = 10_000;
let cache: { ts: number; data: IndexQuote[] } | null = null;

/** 解析腾讯行情文本：v_sh000001="1~上证指数~...~价格~...~涨跌~涨跌幅%~..." */
function parseTencent(text: string): Record<string, { price: number; pct: number }> {
  const out: Record<string, { price: number; pct: number }> = {};
  for (const line of text.split(';')) {
    const m = /^v_(sh|sz)(\d{6})="(.*)"\s*$/.exec(line.trim());
    if (!m) continue;
    const code = m[2];
    const parts = m[3].split('~');
    const price = Number(parts[3]) || 0;
    const pct = Number(parts[32]) || 0;
    if (price > 0) out[code] = { price, pct };
  }
  return out;
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ indices: cache.data });
  }

  let data: IndexQuote[] | null = null;

  // 首选：东财批量接口（一次请求取全部指数）
  try {
    const secids = INDEXES.map((i) => i.secid).join(',');
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f12,f14,f2,f3`;
    const res = await fetch(url, {
      headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': EM_UA },
      signal: AbortSignal.timeout(6000),
    });
    const json = await res.json();
    const diff: { f12?: string; f2?: number; f3?: number }[] = json?.data?.diff ?? [];
    data = INDEXES.map((idx) => {
      const item = diff.find((d) => String(d.f12) === idx.code);
      return { code: idx.code, name: idx.name, price: Number(item?.f2) || 0, pct: Number(item?.f3) || 0 };
    });
    if (data.every((d) => d.price > 0)) {
      cache = { ts: now, data };
      return NextResponse.json({ indices: data });
    }
    data = null;
  } catch {
    /* 东财失败 → 腾讯兜底 */
  }

  // 兜底：腾讯行情
  try {
    const txCodes = INDEXES.map((i) => i.txCode).join(',');
    const res = await fetch(`https://qt.gtimg.cn/q=${txCodes}`, {
      headers: { 'User-Agent': EM_UA },
      signal: AbortSignal.timeout(6000),
    });
    const map = parseTencent(await res.text());
    data = INDEXES.map((idx) => ({
      code: idx.code,
      name: idx.name,
      price: map[idx.code]?.price ?? 0,
      pct: map[idx.code]?.pct ?? 0,
    }));
    if (data.every((d) => d.price > 0)) {
      cache = { ts: now, data };
      return NextResponse.json({ indices: data });
    }
    data = null;
  } catch {
    /* ignore */
  }

  return NextResponse.json({ error: 'Failed to fetch indices' }, { status: 502 });
}

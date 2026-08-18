import { NextResponse } from 'next/server';

// 轻量代理：仅转发东财涨停/跌停池数据，不做任何聚合处理
// 单个请求只调用 1 次外部 API，CPU 耗时 < 2ms，适合 Cloudflare Workers 10ms 限制

export const dynamic = 'force-dynamic';

const EM_UT = '7eea3edcaed734bea9cbfc24409ed989';

// 15 秒结果缓存：前端 5s 轮询与多客户端共享，避免每次轮询都打东财
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { ts: number; body: unknown }>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? '';
  const topic = url.searchParams.get('topic') ?? 'zt'; // 'zt' | 'dt'

  if (!date) {
    return NextResponse.json({ error: 'Missing date param' }, { status: 400 });
  }

  const key = `${date}|${topic}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.body);
  }

  const apiTopic = topic === 'dt' ? 'getTopicDTPool' : 'getTopicZTPool';
  const apiUrl = `https://push2ex.eastmoney.com/${apiTopic}?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=1000&sort=fbt:asc&date=${date}`;

  try {
    const res = await fetch(apiUrl, {
      headers: {
        'Referer': 'http://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `East Money API error: ${res.statusText}` }, { status: 502 });
    }

    const data = await res.json();
    const pool = data.data?.pool || [];
    const body = { pool, date, topic };
    cache.set(key, { ts: now, body });
    return NextResponse.json(body);
  } catch (error) {
    console.error('Pool proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch pool data' }, { status: 502 });
  }
}
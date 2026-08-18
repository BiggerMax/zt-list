import { NextResponse } from 'next/server';

// 轻量代理：转发选股宝涨停快照数据
// 单个请求只调用 1 次外部 API

export const dynamic = 'force-dynamic';

// 15 秒结果缓存：前端 5s 轮询与多客户端共享，避免每次轮询都打选股宝
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { ts: number; body: unknown }>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? '';

  if (!date) {
    return NextResponse.json({ error: 'Missing date param' }, { status: 400 });
  }

  const now = Date.now();
  const hit = cache.get(date);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.body);
  }

  try {
    const res = await fetch(`https://flash-api.xuangubao.cn/api/pool/detail?date=${date}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15'
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return NextResponse.json({ data: [], date });
    }

    const json = await res.json();
    const body = { data: json?.data ?? [], date };
    cache.set(date, { ts: now, body });
    return NextResponse.json(body);
  } catch (error) {
    console.error('XGB proxy error:', error);
    return NextResponse.json({ data: [], date });
  }
}
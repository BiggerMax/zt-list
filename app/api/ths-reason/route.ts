import { NextResponse } from 'next/server';
import { fuyaoGet, toThsCode } from '@/lib/fuyao';

// 轻量代理：同花顺个股异动解读（详细涨停原因）
// 数据源：同花顺 /api/a-share/special-data/anomaly-analysis-stock（analysis_content 详细解读 + keyword_list）
// 说明：该接口仅提供当日的异动解读；历史日期无数据。涨停股详细原因由聚合器以同花顺 limit_up_reason 兜底。
// 输出：{ reasons: { 6位代码: analysis_content }, date, source: 'fuyao' }

export const dynamic = 'force-dynamic';

// 15 秒结果缓存：前端 5s 轮询与多客户端共享
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { ts: number; body: unknown }>();

interface AnomalyItem {
  thscode: string;
  stock_name?: string;
  analysis_content?: string;
  keyword_list?: string[];
  tag_name?: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const codesParam = url.searchParams.get('codes') ?? '';
  const date = url.searchParams.get('date') ?? '';

  if (!codesParam) {
    return NextResponse.json({ reasons: {}, date });
  }
  const codes = codesParam.split(',').filter(Boolean);
  const key = `thsr|${date}|${codes.join(',')}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.body);
  }

  // 异动解读仅支持当日；历史日期直接返回空（由聚合器用同花顺涨停原因兜底）
  const isToday = date === shanghaiToday();
  const reasons: Record<string, string> = {};

  if (isToday) {
    const BATCH = 50; // 接口单次最多 50 个 thscode
    const batches: string[][] = [];
    for (let i = 0; i < codes.length; i += BATCH) {
      batches.push(codes.slice(i, i + BATCH));
    }
    const results = await Promise.allSettled(
      batches.map((chunk) =>
        fuyaoGet<{ item?: AnomalyItem[] }>(
          '/api/a-share/special-data/anomaly-analysis-stock',
          { thscodes: chunk.map(toThsCode).join(',') },
        ),
      ),
    );
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const it of r.value.item ?? []) {
        const code = it.thscode.split('.')[0];
        if (code && it.analysis_content) reasons[code] = it.analysis_content;
      }
    }
  }

  const body = { reasons, date, source: 'fuyao' };
  cache.set(key, { ts: now, body });
  return NextResponse.json(body);
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
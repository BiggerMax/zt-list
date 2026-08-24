import { NextResponse } from 'next/server';
import {
  fuyaoGet,
  shanghaiMidnightMs,
  type FuyaoLimitUpItem,
} from '@/lib/fuyao';

// 轻量代理：热门板块 · 个股涨停家数排名
// 主源：同花顺真实板块（行业/概念）成分股 ∩ 当日涨停池，按涨停家数降序
// 说明：同花顺 API 无现成“板块涨停排名”聚合，这里用板块成分股接口 + 涨停池做交集统计
// 输出：{ date, source, sectors: [{ thscode, name, memberCount, limitUpCount, limitUpCodes }] }

export const dynamic = 'force-dynamic';

// 15 秒结果缓存：前端 5s 轮询与多客户端共享
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { ts: number; body: unknown }>();

// 固定监控的同花顺真实板块（thscode + 展示名），源自同花顺行业/概念指数目录
interface Sector {
  thscode: string;
  name: string;
}

const WATCHLIST: Sector[] = [
  { thscode: '881278.TI', name: '电网设备' },
  { thscode: '886015.TI', name: '创新药' },
  { thscode: '886084.TI', name: '光纤概念' },
  { thscode: '886033.TI', name: '共封装光学(CPO)' },
  { thscode: '881129.TI', name: '通信设备' },
  { thscode: '885856.TI', name: '仿制药一致性评价' },
  { thscode: '885539.TI', name: '医疗器械概念' },
  { thscode: '885661.TI', name: '医药电商' },
  { thscode: '885402.TI', name: '智能医疗' },
  { thscode: '881143.TI', name: '医药商业' },
  { thscode: '884199.TI', name: '医药流通' },
  { thscode: '881145.TI', name: '电力' },
  { thscode: '885531.TI', name: '光伏概念' },
  { thscode: '886054.TI', name: '光刻机' },
  { thscode: '881162.TI', name: '通信服务' },
  { thscode: '884262.TI', name: '通信网络设备及器件' },
];

interface Constituent {
  thscode: string;
  ticker: string;
  name: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateRaw = url.searchParams.get('date') ?? '';
  const date = dateRaw.includes('-')
    ? dateRaw
    : `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Missing or invalid date param' }, { status: 400 });
  }

  const key = `hot|${date}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.body);
  }

  const isToday = date === shanghaiToday();
  const dateMs = isToday ? undefined : shanghaiMidnightMs(date);

  try {
    // 1. 拉取当日涨停池（翻页取全）
    const pool = await fetchLimitUpPool(dateMs);
    const limitCodes = new Set(pool.map((i) => i.ticker));
    if (limitCodes.size === 0) {
      const emptyBody = { date, source: 'fuyao', sectors: [] };
      cache.set(key, { ts: now, body: emptyBody });
      return NextResponse.json(emptyBody);
    }

    // 2. 并发拉取各板块成分股，统计板块内涨停家数
    const settled = await Promise.allSettled(
      WATCHLIST.map((s) =>
        fuyaoGet<{ item?: Constituent[] }>('/api/a-share-index/constituents/ths-stock-list', {
          thscode: s.thscode,
        }),
      ),
    );

    const sectors = WATCHLIST.map((s, i) => {
      const r = settled[i];
      const members = r.status === 'fulfilled' ? (r.value.item ?? []) : [];
      const limitUp = members.filter((m) => limitCodes.has(m.ticker));
      return {
        thscode: s.thscode,
        name: s.name,
        memberCount: members.length,
        limitUpCount: limitUp.length,
        limitUpCodes: limitUp.map((m) => m.ticker),
      };
    })
      .filter((s) => s.limitUpCount > 0)
      .sort((a, b) => b.limitUpCount - a.limitUpCount);

    const body = { date, source: 'fuyao', sectors };
    cache.set(key, { ts: now, body });
    return NextResponse.json(body);
  } catch (error) {
    console.error('hot-sectors proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch hot sectors' }, { status: 502 });
  }
}

/** 拉取同花顺涨停池全量（最多翻 3 页，每页 200） */
async function fetchLimitUpPool(dateMs?: number): Promise<FuyaoLimitUpItem[]> {
  const items: FuyaoLimitUpItem[] = [];
  for (let page = 1; page <= 3; page++) {
    const data = await fuyaoGet<{ item?: FuyaoLimitUpItem[] }>(
      '/api/a-share/special-data/limit-up-pool',
      {
        page,
        size: 200,
        sort_field: 'limit_up_time',
        sort_dir: 'asc',
        date_ms: dateMs,
      },
    );
    const batch = data.item ?? [];
    items.push(...batch);
    if (batch.length < 200) break;
  }
  return items;
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}
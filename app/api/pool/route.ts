import { NextResponse } from 'next/server';
import {
  fuyaoGet,
  shanghaiMidnightMs,
  type FuyaoLimitUpItem,
  type FuyaoLimitDownItem,
  type FuyaoSnapshotItem,
} from '@/lib/fuyao';

// 轻量代理：涨停/跌停池
// 主源：同花顺金融数据 API（官方、含连板数/封单额/涨停时间/涨停原因）
// 兜底：东财 push2ex（主源失败时保数据可用性）
// 输出保持与旧东财结构一致（pool[].c/n/p/zdp/lbc/fbt/fund/hybk...），前端聚合器无需改动

export const dynamic = 'force-dynamic';

const EM_UT = '7eea3edcaed734bea9cbfc24409ed989';

// 15 秒结果缓存：前端 5s 轮询与多客户端共享
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { ts: number; body: unknown }>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dateRaw = url.searchParams.get('date') ?? '';
  const topic = url.searchParams.get('topic') ?? 'zt'; // 'zt' | 'dt'

  // 入参兼容两种格式：YYYY-MM-DD 与 YYYYMMDD
  const date = dateRaw.includes('-')
    ? dateRaw
    : `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Missing or invalid date param' }, { status: 400 });
  }

  const key = `${date}|${topic}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.body);
  }

  // 主源：同花顺（今天不传日期取实时；历史传 date_ms）
  const isToday = date === shanghaiToday();
  const dateMs = isToday ? undefined : shanghaiMidnightMs(date);

  let pool: Record<string, unknown>[] | null = null;
  try {
    if (topic === 'dt') {
      const data = await fuyaoGet<{ item?: FuyaoLimitDownItem[] }>(
        '/api/a-share/special-data/limit-down-pool',
        { page: 1, size: 200, date_ms: dateMs },
      );
      pool = (data.item ?? []).map(mapLimitDown);
    } else {
      const items: FuyaoLimitUpItem[] = [];
      // size 上限 200，涨停极端行情可能超过一页：最多翻 3 页
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
      const snapMap = isToday ? await fetchTurnoverMap(items.map((i) => i.thscode)) : {};
      pool = items.map((it) => mapLimitUp(it, snapMap[it.ticker]));
    }
  } catch {
    pool = null;
  }

  if (pool && pool.length > 0) {
    const body = { pool, date, topic, source: 'fuyao' };
    cache.set(key, { ts: now, body });
    return NextResponse.json(body);
  }

  // 兜底：东财（同花顺失败或当日无数据时）
  try {
    const emPool = await fetchEMPool(date.replace(/-/g, ''), topic);
    const body = { pool: emPool, date, topic, source: 'em' };
    cache.set(key, { ts: now, body });
    return NextResponse.json(body);
  } catch (error) {
    console.error('Pool proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch pool data' }, { status: 502 });
  }
}

/** 同花顺快照批量补充成交额（涨停池接口不含该字段；仅今日实时有效） */
async function fetchTurnoverMap(
  thscodes: string[],
): Promise<Record<string, { turnover?: number; volume?: number }>> {
  const out: Record<string, { turnover?: number; volume?: number }> = {};
  if (thscodes.length === 0) return out;
  const BATCH_SIZE = 80;
  const batches: string[][] = [];
  for (let i = 0; i < thscodes.length; i += BATCH_SIZE) {
    batches.push(thscodes.slice(i, i + BATCH_SIZE));
  }
  const results = await Promise.allSettled(
    batches.map((chunk) =>
      fuyaoGet<{ item?: FuyaoSnapshotItem[] }>('/api/a-share/prices/snapshot', {
        thscodes: chunk.join(','),
      }),
    ),
  );
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const it of r.value.item ?? []) {
      out[it.ticker] = { turnover: it.turnover, volume: it.volume };
    }
  }
  return out;
}

function mapLimitUp(
  it: FuyaoLimitUpItem,
  extra?: { turnover?: number; volume?: number },
): Record<string, unknown> {
  return {
    c: it.ticker,
    m: it.thscode.endsWith('.SH') ? 1 : 0,
    n: it.name,
    p: Math.round((it.last_price ?? 0) * 1000), // 东财口径：价格 * 1000
    zdp: it.price_change_ratio_pct ?? 0,
    lbc: it.continue_day_cnt ?? 1,
    fbt: timeToNum(it.limit_up_time),
    fund: it.seal_money ?? 0, // 封单金额
    amount: extra?.turnover ?? 0, // 成交额（元），来自行情快照
    ltsz: 0, // 同花顺池接口不含流通市值，置 0（UI 显示为空）
    hs: undefined,
    hybk: it.limit_up_reason ?? '', // 涨停原因（替代选股宝）
    _reason_src: 'fuyao',
  };
}

function mapLimitDown(it: FuyaoLimitDownItem): Record<string, unknown> {
  return {
    c: it.ticker,
    m: it.thscode.endsWith('.SH') ? 1 : 0,
    n: it.name,
    p: Math.round((it.last_price ?? 0) * 1000),
    zdp: it.price_change_ratio_pct ?? 0,
    fbt: timeToNum(it.first_limit_time || it.last_limit_time),
    hybk: '',
  };
}

/** "14:37" → 143700 */
function timeToNum(hm?: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hm ?? '');
  if (!m) return 0;
  return Number(m[1]) * 10000 + Number(m[2]) * 100;
}

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

// ---- 东财兜底 ----

async function fetchEMPool(compactDate: string, topic: string): Promise<Record<string, unknown>[]> {
  const apiTopic = topic === 'dt' ? 'getTopicDTPool' : 'getTopicZTPool';
  const apiUrl = `https://push2ex.eastmoney.com/${apiTopic}?ut=${EM_UT}&dpt=wz.ztzt&Pageindex=0&pagesize=1000&sort=fbt:asc&date=${compactDate}`;
  const res = await fetch(apiUrl, {
    headers: {
      Referer: 'http://quote.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`East Money API error: ${res.statusText}`);
  const json = await res.json();
  return json.data?.pool ?? [];
}

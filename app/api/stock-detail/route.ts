import { NextResponse } from 'next/server';

// 轻量批量接口：查询多只股票的概念标签、超大单净流入、前250日最高价
// 使用东财批量接口（ulist.np/get + stock/get），单次请求约 2-4 次外部调用
// 适用于 Cloudflare Workers：CPU 耗时 < 5ms

export const dynamic = 'force-dynamic';

const EM_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15';

interface StockDetail {
  concept: string;       // 概念标签（如 "黄金概念,移动支付"）
  bigOrderNet: number;   // 超大单净流入（元）
  overHigh250: boolean;  // 是否突破前250日最高价
}

// 15 秒结果缓存：涨停池轮询时 codes 集合在池缓存窗口内基本不变，命中即可省掉全部上游调用
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { ts: number; body: unknown }>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const codesParam = url.searchParams.get('codes') ?? '';
  const date = url.searchParams.get('date') ?? ''; // YYYY-MM-DD
  const isToday = url.searchParams.get('isToday') !== 'false';

  if (!codesParam) {
    return NextResponse.json({ details: {} });
  }

  const codes = codesParam.split(',').filter(Boolean);
  const key = `${date}|${codes.join(',')}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.body);
  }

  const secids = codes.map((c) => secidOf(c));

  // 并行获取：概念标签 + 超大单净流入（批量接口）
  const [conceptMap, bigOrderMap] = await Promise.all([
    fetchConceptsBatch(secids),
    fetchBigOrderBatch(secids),
  ]);

  // 前250日最高价 + 当日最高价（失败不影响主数据）
  let high250Map: Record<string, { high250: number; todayHigh: number | null }> = {};
  try {
    high250Map = await fetchHigh250Batch(codes, date);
  } catch {
    // high250 失败不影响主数据
  }

  const details: Record<string, StockDetail> = {};
  for (const code of codes) {
    const secid = secidOf(code);
    const hi = high250Map[code];
    // 创新高：当日最高价 > 前250日最高价（当日数据缺失时按非新高处理）
    const overHigh250 =
      hi != null && hi.todayHigh != null ? hi.todayHigh > hi.high250 : false;
    details[code] = {
      concept: conceptMap[secid] ?? '',
      bigOrderNet: bigOrderMap[secid] ?? 0,
      overHigh250,
    };
  }

  const body = { details, date };
  cache.set(key, { ts: now, body });
  return NextResponse.json(body);
}

/** 东财批量概念标签：ulist.np/get f129 字段 */
async function fetchConceptsBatch(secids: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const BATCH_SIZE = 60;
  for (let i = 0; i < secids.length; i += BATCH_SIZE) {
    const chunk = secids.slice(i, i + BATCH_SIZE);
    try {
      const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${chunk.join(',')}&fields=f12,f129`;
      const res = await fetch(url, {
        headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': EM_UA },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const diff = json?.data?.diff ?? [];
      for (const item of diff) {
        const secid = `${item.f12}`;
        if (secid) map[secid] = String(item?.f129 ?? '');
      }
    } catch {
      // 某一批失败不影响其他
    }
  }
  return map;
}

/** 东财批量超大单净流入：ulist.np/get f66（今日超大单净流入） */
async function fetchBigOrderBatch(secids: string[]): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  const BATCH_SIZE = 60;
  for (let i = 0; i < secids.length; i += BATCH_SIZE) {
    const chunk = secids.slice(i, i + BATCH_SIZE);
    try {
      const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${chunk.join(',')}&fields=f12,f66`;
      const res = await fetch(url, {
        headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': EM_UA },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const json = await res.json();
      const diff = json?.data?.diff ?? [];
      for (const item of diff) {
        const secid = `${item.f12}`;
        const net = Number(item?.f66);
        if (secid && !Number.isNaN(net)) map[secid] = net;
      }
    } catch {
      // 某一批失败，尝试逐只回退
      try {
        const perStock = await fetchBigOrderPerStock(chunk);
        for (const [secid, net] of Object.entries(perStock)) {
          map[secid] = net;
        }
      } catch {
        // 失败则跳过
      }
    }
  }
  return map;
}

/** 逐只回退：东财 stock/get f135-f136 */
async function fetchBigOrderPerStock(secids: string[]): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  const CONCURRENCY = 10;
  for (let i = 0; i < secids.length; i += CONCURRENCY) {
    const chunk = secids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async (secid) => {
      try {
        const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f135,f136`;
        const res = await fetch(url, {
          headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': EM_UA },
          signal: AbortSignal.timeout(5000),
        });
        const json = await res.json();
        const d = json?.data;
        if (d && (d.f135 != null || d.f136 != null)) {
          return [secid, (Number(d.f135) || 0) - (Number(d.f136) || 0)] as const;
        }
      } catch {
        // ignore
      }
      return [secid, 0] as const;
    }));
    for (const [secid, net] of results) map[secid] = net;
  }
  return map;
}

// 前250日最高价缓存：按 (code, date) 记忆，盘中多轮轮询命中即跳过上游请求
// 250日高（已排除当日实时K线）在单个交易日内是稳定值，跨日由 date 键自动区分；
// 失败值短时间缓存（防抖），避免偶发失败在每轮轮询中反复请求、导致标志抖动
// 成功值缓存 { high250, todayHigh }（见 fetchHigh250Batch 的 Result 类型）
const HIGH250_CACHE_TTL_MS = 30 * 60_000; // 成功值：30 分钟
const HIGH250_NEGATIVE_TTL_MS = 30_000;   // 失败值：30 秒防抖
const high250Cache = new Map<
  string,
  { ts: number; value: { high250: number; todayHigh: number | null } | null }
>();

/** 写入前250日高缓存；超容量时顺带清理过期键，防止长期使用后无限增长 */
function setHigh250Cache(key: string, value: { high250: number; todayHigh: number | null } | null) {
  high250Cache.set(key, { ts: Date.now(), value });
  if (high250Cache.size > 5000) {
    const cutoff = Date.now() - HIGH250_CACHE_TTL_MS;
    for (const [k, v] of high250Cache) {
      if (v.ts < cutoff) high250Cache.delete(k);
    }
  }
}

/** 前250日最高价 + 当日最高价：优先命中记忆缓存，未命中再请求上游（3 次尝试 + 递增退避）
 *  返回值：{ high250, todayHigh } —— todayHigh 为 null 表示当日数据缺失（如停牌），
 *  此时判定阶段按「非新高」处理 */
async function fetchHigh250Batch(codes: string[], dateStr: string) {
  type Result = { high250: number; todayHigh: number | null };
  const map: Record<string, Result> = {};
  if (!dateStr || codes.length === 0) return map;

  const compactDate = dateStr.replace(/-/g, '');
  const now = Date.now();

  // 命中记忆缓存：成功值直接返回；失败值在防抖窗口内本轮跳过
  const todo: string[] = [];
  for (const code of codes) {
    const hit = high250Cache.get(`${code}|${dateStr}`);
    if (!hit) {
      todo.push(code);
    } else if (hit.value != null) {
      map[code] = hit.value;
    } else if (now - hit.ts >= HIGH250_NEGATIVE_TTL_MS) {
      todo.push(code); // 已过防抖窗口，允许重试
    }
  }
  if (todo.length === 0) return map;

  const CONCURRENCY = 12;
  const backoff = [400, 900]; // 每两次尝试间的退避（毫秒），末次尝试失败后不再等待

  const fetchOne = async (code: string): Promise<[string, Result | null]> => {
    // 东财前复权日K（lmt=251，end=目标日期）
    const key = `${code}|${dateStr}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const secid = secidOf(code);
        const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=251&end=${compactDate}&fields1=f1,f2,f3&fields2=f51,f54`;
        const res = await fetch(url, {
          headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': EM_UA },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
        const json = await res.json();
        const klines: string[] = json?.data?.klines ?? [];
        if (klines.length < 2) throw new Error('empty klines');
        // 去掉当日（最后一行），取前250日最高
        const slice = klines.slice(Math.max(0, klines.length - 251), klines.length - 1);
        let mx = -Infinity;
        for (const k of slice) {
          const h = Number(k.split(',')[1]);
          if (h > mx) mx = h;
        }
        if (mx <= -Infinity) throw new Error('empty slice');
        // 当日最高价：最后一行（当日实时/收盘K线）的 f51 字段
        const last = klines[klines.length - 1].split(',');
        const todayHighRaw = Number(last[1]);
        const result: Result = {
          high250: mx,
          todayHigh: !Number.isNaN(todayHighRaw) && todayHighRaw > 0 ? todayHighRaw : null,
        };
        setHigh250Cache(key, result);
        return [code, result];
      } catch {
        // 进入下一轮尝试
      }
      if (attempt < backoff.length) {
        await new Promise((r) => setTimeout(r, backoff[attempt] + Math.floor(Math.random() * 150)));
      }
    }
    // 全部尝试失败：短暂记录失败，避免下轮轮询立刻重试同一批
    setHigh250Cache(key, null);
    return [code, null];
  };

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const chunk = todo.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(fetchOne));
    for (const [code, h] of results) {
      if (h != null) map[code] = h;
    }
  }
  return map;
}

function secidOf(code: string): string {
  return /^(60|68)/.test(code) ? `1.${code}` : `0.${code}`;
}
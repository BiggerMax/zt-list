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

  // 前250日最高价（仅对非当日有效，或使用缓存策略）
  let high250Map: Record<string, number> = {};
  try {
    high250Map = await fetchHigh250Batch(codes, date);
  } catch {
    // high250 失败不影响主数据
  }

  const details: Record<string, StockDetail> = {};
  for (const code of codes) {
    const secid = secidOf(code);
    details[code] = {
      concept: conceptMap[secid] ?? '',
      bigOrderNet: bigOrderMap[secid] ?? 0,
      overHigh250: high250Map[code] != null ? true : false,
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

/** 前250日最高价：仅返回已缓存或可快速获取的数据 */
async function fetchHigh250Batch(codes: string[], dateStr: string): Promise<Record<string, number>> {
  const map: Record<string, number> = {};
  if (!dateStr || codes.length === 0) return map;

  const compactDate = dateStr.replace(/-/g, '');
  const CONCURRENCY = 12;

  const fetchOne = async (code: string): Promise<[string, number | null]> => {
    // 东财前复权日K（lmt=251，end=目标日期）
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const secid = secidOf(code);
        const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=251&end=${compactDate}&fields1=f1,f2,f3&fields2=f51,f54`;
        const res = await fetch(url, {
          headers: { Referer: 'https://quote.eastmoney.com/', 'User-Agent': EM_UA },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) continue;
        const json = await res.json();
        const klines: string[] = json?.data?.klines ?? [];
        if (klines.length < 2) continue;
        // 去掉当日，取前250日最高
        const slice = klines.slice(Math.max(0, klines.length - 251), klines.length - 1);
        if (slice.length === 0) continue;
        let mx = -Infinity;
        for (const k of slice) {
          const h = Number(k.split(',')[1]);
          if (h > mx) mx = h;
        }
        if (mx > -Infinity) return [code, mx];
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
      }
    }
    return [code, null];
  };

  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const chunk = codes.slice(i, i + CONCURRENCY);
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
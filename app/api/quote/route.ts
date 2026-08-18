import { NextResponse } from 'next/server';

// 轻量代理：转发开盘啦/腾讯实时行情
// 用于获取断板股当日实时涨幅

export const dynamic = 'force-dynamic';

const KPL_COMMON =
  'DeviceID=29a7602a14606c2577c246c577c6c83cee163dab&PhoneOSNew=2' +
  '&Token=34eba58a769e04ca9df75b85557a76d6&UserID=4565300' +
  '&VerSion=5.23.0.1&apiv=w44';
const KPL_UA = 'lhb/5.23.1 (com.kaipanla.www; build:1; iOS 26.2.0)';

// 15 秒结果缓存：断板股列表在池缓存窗口内基本不变，命中即可省掉上游行情调用
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { ts: number; body: unknown }>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const codesParam = url.searchParams.get('codes') ?? '';
  const date = url.searchParams.get('date') ?? ''; // YYYY-MM-DD, 用于历史数据

  if (!codesParam) {
    return NextResponse.json({ quotes: {} });
  }

  const key = `${date || 'rt'}|${codesParam}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) {
    return NextResponse.json(hit.body);
  }

  const codes = codesParam.split(',').filter(Boolean);

  // 历史日期：使用开盘啦日K计算涨幅
  if (date) {
    try {
      const quotes = await fetchKPLHistorical(codes, date);
      const body = { quotes, source: 'kpl' };
      cache.set(key, { ts: now, body });
      return NextResponse.json(body);
    } catch {
      // fall through to realtime
    }
  }

  // 实时：开盘啦批量行情
  try {
    const quotes = await fetchKPLRealtime(codes);
    if (Object.keys(quotes).length > 0) {
      const body = { quotes, source: 'kpl' };
      cache.set(key, { ts: now, body });
      return NextResponse.json(body);
    }
  } catch {
    // fall through
  }

  // 兜底：东财实时行情
  try {
    const quotes = await fetchEMRealtime(codes);
    const body = { quotes, source: 'em' };
    cache.set(key, { ts: now, body });
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ quotes: {}, source: 'none' });
  }
}

/** 开盘啦实时批量行情（increase_rate） */
async function fetchKPLRealtime(codes: string[]): Promise<Record<string, number>> {
  const url = 'https://apphwshhq.longhuvip.com/w1/api/index.php';
  const body = `${KPL_COMMON}&c=UserSelectStock&a=RefreshStockList&StockIDList=${codes.join(',')}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      'User-Agent': KPL_UA,
    },
    signal: AbortSignal.timeout(8000),
    body,
  });
  const json = await res.json();
  const out: Record<string, number> = {};
  for (const s of json.StockList || []) {
    const v = parseFloat(s.increase_rate);
    if (Number.isFinite(v)) out[s.StockID] = v;
  }
  return out;
}

/** 东财实时行情批量查询（f3 = 涨跌幅%） */
async function fetchEMRealtime(codes: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const BATCH_SIZE = 60;
  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const chunk = codes.slice(i, i + BATCH_SIZE);
    const secids = chunk.map((c) => secidOf(c)).join(',');
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f12,f3`;
    const res = await fetch(url, {
      headers: {
        'Referer': 'https://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
      },
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    const diff = json?.data?.diff ?? [];
    for (const item of diff) {
      const code = String(item?.f12 ?? '').padStart(6, '0');
      const v = Number(item?.f3);
      if (code && Number.isFinite(v)) out[code] = v;
    }
  }
  return out;
}

/** 历史某日收盘涨跌幅：开盘啦日K计算 */
async function fetchKPLHistorical(codes: string[], dateStr: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const CONCURRENCY = 10;
  const compactDate = dateStr.replace(/-/g, '');
  const target = new Date(`${dateStr}T12:00:00`);
  const days = Math.ceil((Date.now() - target.getTime()) / 86_400_000);
  const st = Math.min(1000, Math.max(60, days + 40));

  const fetchOne = async (code: string): Promise<[string, number]> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = 'https://applhb.longhuvip.com/w1/api/index.php';
        const body = `${KPL_COMMON}&c=Stock&a=GetStockChart&Index=0&StockID=${code}&st=${st}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
            'User-Agent': KPL_UA,
          },
          signal: AbortSignal.timeout(8000),
          body,
        });
        if (!res.ok) continue;
        const json = await res.json();
        const xs: string[] = json?.x ?? [];
        const ys: number[][] = json?.y ?? [];
        if (xs.length < 2 || ys.length !== xs.length) continue;
        let idx = -1;
        for (let i = 0; i < xs.length; i++) {
          if (xs[i] === compactDate) { idx = i; break; }
        }
        if (idx <= 0) continue;
        const close = Number(ys[idx]?.[1]);
        const prevClose = Number(ys[idx - 1]?.[1]);
        if (!Number.isFinite(close) || !Number.isFinite(prevClose) || prevClose === 0) continue;
        return [code, ((close - prevClose) / prevClose) * 100];
      } catch {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
      }
    }
    return [code, NaN];
  };

  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const chunk = codes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(fetchOne));
    for (const [code, v] of results) if (!Number.isNaN(v)) out[code] = v;
  }
  return out;
}

function secidOf(code: string): string {
  return /^(60|68)/.test(code) ? `1.${code}` : `0.${code}`;
}
import { NextResponse } from 'next/server';

export const runtime = 'edge'; // Use Edge Runtime for Cloudflare
export const dynamic = 'force-dynamic'; // Disable caching

// 东财涨停池数据结构
interface StockData {
  c: string; // Code
  m: number; // Market
  n: string; // Name
  p: number; // Price * 1000
  zdp: number; // Change percent
  lbc?: number; // Limit board count (limit-up pool)
  fbt: number; // First board time (HHMMSS)
  fund?: number; // Sealed fund
  hybk: string; // Industry/Reason
}

interface DetailedStock extends StockData {
  detailedReason?: string;
  bigOrderNet: number; // 超大单净流入（元），东财 f135 - f136
}

// 选股宝（上一交易日涨停队列快照）
interface XGBStock {
  symbol: string; // 如 600500.SS / 002792.SZ
  stock_chi_name: string;
  change_percent: number; // 0.0998 = 9.98%
  first_limit_up: number; // 首次涨停时间戳
  limit_up_days: number; // 连板数
  surge_reason?: {
    stock_reason?: string;
    related_plates?: { plate_name: string }[];
  };
}

interface ResultItem {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  time: string;
  reason: string;
  detailedReason?: string;
  amount: string;
  fund: number;
  limitCount: number;
  isZhaBan: boolean; // 断板：上一交易日涨停、今日未涨停
  bigOrderNet: number; // 超大单净流入（元）
  bigOrderNetText: string; // 格式化后的超大单净流入
  currentChange?: number; // 断板股当前实时涨幅（%）
}

interface LimitUpResult {
  board1: ResultItem[];
  board2: ResultItem[];
  board3: ResultItem[];
  board4: ResultItem[];
  boardHigher: ResultItem[];
}

// 开盘啦通用认证参数
const KPL_COMMON =
  'DeviceID=29a7602a14606c2577c246c577c6c83cee163dab&PhoneOSNew=2' +
  '&Token=34eba58a769e04ca9df75b85557a76d6&UserID=4565300' +
  '&VerSion=5.23.0.1&apiv=w44';
const KPL_UA = 'lhb/5.23.1 (com.kaipanla.www; build:1; iOS 26.2.0)';

// Cloudflare 边缘运行时环境是 UTC，A 股交易日须按 Asia/Shanghai 计算
function cnNow(): Date {
  const s = new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' });
  return new Date(s);
}

export async function GET() {
  try {
    const today = cnNow();
    const eastDateStr = compactDateStr(today);               // 东财用 YYYYMMDD

    // 1. 今日涨停池（东财，实时）—— 涨停梯队数据源
    const pool = await fetchPool('getTopicZTPool', eastDateStr);
    const todayCodes = new Set(pool.map((s) => s.c));
    const detailedStocks = await fetchDetailedConcepts(pool);

    // 2. 上一交易日涨停队列（选股宝快照）—— 用于找出今日未涨停（断板）个股
    const prevDate = await findPrevSnapshotDate();
    const prevPool = prevDate ? await fetchXGBDetail(prevDate) : [];

    // 3. 断板股 = 上一交易日涨停、今日不在涨停池
    const broken = prevPool.filter((s) => {
      const code = s.symbol.split('.')[0];
      return !todayCodes.has(code);
    });

    // 4. 断板股当前实时涨幅（开盘啦批量行情）
    const quotes = broken.length
      ? await fetchKPLQuotes(broken.map((s) => s.symbol.split('.')[0]))
      : {};

    // 5. 归类
    const result: LimitUpResult = {
      board1: [],
      board2: [],
      board3: [],
      board4: [],
      boardHigher: [],
    };

    detailedStocks.forEach((stock) => addToResult(result, stock));
    broken.forEach((stock) => addBrokenToResult(result, stock, quotes));

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching limit up data:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}

function addToResult(result: LimitUpResult, stock: DetailedStock) {
  const limitCount = stock.lbc ?? 0;
  if (limitCount <= 0) return;

  const item: ResultItem = {
    code: stock.c,
    name: stock.n,
    price: stock.p / 1000,
    changePercent: stock.zdp,
    time: formatTime(stock.fbt),
    reason: stock.hybk,
    detailedReason: stock.detailedReason,
    amount: formatAmount(stock.fund ?? 0),
    fund: stock.fund ?? 0,
    limitCount,
    isZhaBan: false,
    bigOrderNet: stock.bigOrderNet,
    bigOrderNetText: formatAmount(stock.bigOrderNet),
  };

  pushByLevel(result, item, limitCount);
}

function addBrokenToResult(
  result: LimitUpResult,
  stock: XGBStock,
  quotes: Record<string, number>
) {
  const code = stock.symbol.split('.')[0];
  // 昨日 N 连板今日未涨停（断板）→ 放在其冲击失败的 N+1 板梯队
  const limitCount = (stock.limit_up_days ?? 0) + 1;
  if (limitCount <= 1) return;

  const plates = (stock.surge_reason?.related_plates ?? [])
    .map((p) => p.plate_name)
    .filter(Boolean);
  const reason = plates.length ? plates.join(';') : '昨日涨停';
  // 实时涨幅：无效值（缺失/NaN）不设置，前端降级为“未涨停”
  const q = quotes[code];
  const currentChange: number | undefined =
    typeof q === 'number' && !Number.isNaN(q) ? q : undefined;

  const item: ResultItem = {
    code,
    name: stock.stock_chi_name,
    price: 0,
    changePercent: stock.change_percent * 100,
    time: formatTs(stock.first_limit_up),
    reason,
    detailedReason: stock.surge_reason?.stock_reason || '',
    amount: '',
    fund: 0,
    limitCount,
    isZhaBan: true,
    bigOrderNet: 0,
    bigOrderNetText: '',
    currentChange,
  };

  pushByLevel(result, item, limitCount);
}

function pushByLevel(result: LimitUpResult, item: ResultItem, level: number) {
  if (level === 1) result.board1.push(item);
  else if (level === 2) result.board2.push(item);
  else if (level === 3) result.board3.push(item);
  else if (level === 4) result.board4.push(item);
  else if (level >= 5) result.boardHigher.push(item);
}

// ---------- 东财接口 ----------

async function fetchPool(
  topic: 'getTopicZTPool',
  dateStr: string
): Promise<StockData[]> {
  const apiUrl = `https://push2ex.eastmoney.com/${topic}?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=1000&sort=fbt:asc&date=${dateStr}`;

  const response = await fetch(apiUrl, {
    headers: {
      'Referer': 'http://quote.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 0 }
  });

  if (!response.ok) {
    throw new Error(`East Money ${topic} API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data?.pool || [];
}

// 超大单净流入缓存：前一次请求结果在 TTL 内复用，避免每 5 秒轮询反复打东财接口
const BIG_ORDER_CACHE_TTL_MS = 30_000;
let bigOrderCache: { key: string; map: Record<string, number>; ts: number } | null = null;

async function fetchDetailedConcepts(pool: StockData[]): Promise<DetailedStock[]> {
  if (pool.length === 0) return [];

  // 缓存键 = 全部代码（按市场+代码排序）。涨停池有新票时键变化，触发重新拉取
  const cacheKey = pool.map((s) => `${s.m}.${s.c}`).sort().join(',');
  const now = Date.now();
  if (
    bigOrderCache &&
    bigOrderCache.key === cacheKey &&
    now - bigOrderCache.ts < BIG_ORDER_CACHE_TTL_MS
  ) {
    const map = bigOrderCache.map;
    return pool.map((stock) => ({ ...stock, bigOrderNet: map[stock.c] ?? 0 }));
  }

  const flowMap = await fetchBigOrderFlow(pool);
  bigOrderCache = { key: cacheKey, map: flowMap, ts: now };
  return pool.map((stock) => ({ ...stock, bigOrderNet: flowMap[stock.c] ?? 0 }));
}

async function fetchBigOrderFlow(pool: StockData[]): Promise<Record<string, number>> {
  // 首选：批量接口 ulist.np/get 一次取全部股票的今日超大单净流入（f66）
  const batchMap = await fetchBigOrderBatch(pool);
  if (Object.keys(batchMap).length > 0) return batchMap;

  // 兜底：逐只查实时接口 push2 stock/get f135(超大单流入) - f136(超大单流出)
  const CONCURRENCY = 10;
  const fetchOne = async (stock: StockData): Promise<[string, number]> => {
    const secid = `${stock.m}.${stock.c}`;
    try {
      const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f135,f136`;
      const res = await fetch(url, {
        headers: {
          'Referer': 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const d = json?.data;
      if (d && (d.f135 != null || d.f136 != null)) {
        return [stock.c, (Number(d.f135) || 0) - (Number(d.f136) || 0)];
      }
    } catch {
      /* 实时接口失败，走日线兜底 */
    }
    // 兜底：历史日线超大单净流入（f56），盘后返回当日数据
    try {
      const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=1&klt=101&secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f56`;
      const res = await fetch(url, {
        headers: {
          'Referer': 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
        },
        signal: AbortSignal.timeout(5000),
      });
      const json = await res.json();
      const last = json.data?.klines?.slice(-1)?.[0] ?? '';
      const parts = last.split(',');
      return [stock.c, Number(parts[2]) || 0];
    } catch {
      return [stock.c, 0];
    }
  };

  const flowMap: Record<string, number> = {};
  for (let i = 0; i < pool.length; i += CONCURRENCY) {
    const chunk = pool.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(fetchOne));
    for (const [code, net] of results) flowMap[code] = net;
  }
  return flowMap;
}

/** 批量查询今日超大单净流入：ulist.np/get 一次请求多个 secid，f66 = 今日超大单净流入 */
async function fetchBigOrderBatch(pool: StockData[]): Promise<Record<string, number>> {
  const flowMap: Record<string, number> = {};
  const BATCH_SIZE = 60; // 每次最多 60 只，避免 URL 过长
  for (let i = 0; i < pool.length; i += BATCH_SIZE) {
    const chunk = pool.slice(i, i + BATCH_SIZE);
    const secids = chunk.map((s) => `${s.m}.${s.c}`).join(',');
    try {
      const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f12,f66`;
      const res = await fetch(url, {
        headers: {
          'Referer': 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const diff = json?.data?.diff ?? [];
      for (const item of diff) {
        const code = String(item?.f12 ?? '').padStart(6, '0');
        const net = Number(item?.f66);
        if (code && !Number.isNaN(net)) flowMap[code] = net;
      }
    } catch (e) {
      console.error('Batch fund flow failed, falling back to per-stock:', e);
      return {}; // 任何一批失败即整体退回逐只查询
    }
  }
  return flowMap;
}

// ---------- 选股宝接口（上一交易日涨停队列快照） ----------

async function fetchXGBDetail(dateStr: string): Promise<XGBStock[]> {
  const url = `https://flash-api.xuangubao.cn/api/pool/detail?date=${dateStr}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data ?? [];
}

/** 找到最近一个已生成快照的交易日（从昨天起往前，最多 12 天） */
async function findPrevSnapshotDate(): Promise<string | null> {
  const d = cnNow();
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 12; i++) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      const ds = toDateStr(d);
      try {
        const pool = await fetchXGBDetail(ds);
        if (pool && pool.length > 0) return ds;
      } catch {
        /* 继续往前找 */
      }
    }
    d.setDate(d.getDate() - 1);
  }
  return null;
}

// ---------- 开盘啦接口（实时行情） ----------

async function fetchKPLQuotes(codes: string[]): Promise<Record<string, number>> {
  if (codes.length === 0) return {};
  const url = 'https://apphwshhq.longhuvip.com/w1/api/index.php';
  const body = `${KPL_COMMON}&c=UserSelectStock&a=RefreshStockList&StockIDList=${codes.join(',')}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'User-Agent': KPL_UA
      },
      signal: AbortSignal.timeout(8000),
      body
    });
    const json = await res.json();
    const out: Record<string, number> = {};
    for (const s of json.StockList || []) {
      out[s.StockID] = parseFloat(s.increase_rate);
    }
    return out;
  } catch (e) {
    console.error('Failed to fetch KPL quotes', e);
    return {};
  }
}

// ---------- 工具函数 ----------

function toDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function compactDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

function formatTime(timeNum: number): string {
  const str = String(timeNum).padStart(6, '0');
  return `${str.slice(0, 2)}:${str.slice(2, 4)}:${str.slice(4, 6)}`;
}

function formatTs(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatAmount(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs >= 100000000) {
    return sign + (abs / 100000000).toFixed(2) + '亿';
  } else if (abs >= 10000) {
    return sign + (abs / 10000).toFixed(0) + '万';
  }
  return sign + String(abs);
}

import { NextResponse } from 'next/server';

// OpenNext 部署到 Cloudflare Workers（nodejs_compat），无需 edge runtime
export const dynamic = 'force-dynamic'; // Disable caching

// ---------- 持久化存储 ----------
// 生产环境（OpenNext/Cloudflare）使用 KV 绑定 LIMIT_UP_KV 按日期保存快照；
// 本地 next dev 或绑定缺失时降级为进程内内存存储（重启后丢失，仅用于开发调试）。

type KVStore = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
};

const memKV = new Map<string, string>();
let kvPromise: Promise<KVStore | null> | null = null;

async function getKV(): Promise<KVStore | null> {
  if (!kvPromise) {
    kvPromise = (async () => {
      try {
        // @opennextjs/cloudflare 在 Workers 运行时注入 getCloudflareContext，
        // 绑定可通过 context.env 访问；部分版本也会拷贝到 process.env，双保险都试
        const mod = await import('@opennextjs/cloudflare');
        const ctx = mod.getCloudflareContext();
        const candidate =
          (ctx?.env as Record<string, unknown> | undefined)?.LIMIT_UP_KV ??
          (process.env as Record<string, unknown>).LIMIT_UP_KV;
        const kv = candidate as KVStore | undefined;
        if (kv && typeof kv.get === 'function' && typeof kv.put === 'function') {
          return kv;
        }
      } catch {
        /* 未运行在 OpenNext/Cloudflare 运行时（如 next dev） */
      }
      // 降级：内存存储
      return {
        get: async (k) => memKV.get(k) ?? null,
        put: async (k, v) => {
          memKV.set(k, v);
        },
      };
    })();
  }
  return kvPromise;
}

const SNAPSHOT_PREFIX = 'snapshot:';

// 写入节流：仅当“核心数据”（梯队构成/时间/题材/封单）变化，或距上次写入 ≥ 5 分钟时写入，
// 避免每 5 秒轮询把云上 KV 免费写入额度打满。超大单净流入等实时字段不参与哈希。
let lastPersist: { date: string; hash: string; ts: number } | null = null;

function quickHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

function stableProjection(result: LimitUpResult): string {
  // 仅取相对稳定的字段做哈希（不含实时变动的封单金额/超大单净流入），
  // 避免盘中每 5 秒轮询都触发写入，超出 KV 免费写入配额
  const pick = (arr: ResultItem[]) =>
    arr.map((s) => `${s.code}:${s.limitCount}:${s.time}:${s.reason}`).join('|');
  return [result.board1, result.board2, result.board3, result.board4, result.boardHigher]
    .map(pick)
    .join('#');
}

function shouldPersist(dateStr: string, result: LimitUpResult): boolean {
  const now = Date.now();
  const hash = quickHash(stableProjection(result));
  if (
    !lastPersist ||
    lastPersist.date !== dateStr ||
    lastPersist.hash !== hash ||
    now - lastPersist.ts >= 5 * 60_000
  ) {
    lastPersist = { date: dateStr, hash, ts: now };
    return true;
  }
  return false;
}

// ---------- 数据模型 ----------

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
  currentChange?: number; // 断板股当日涨幅（%）：实时模式为实时涨幅，历史模式为收盘涨幅
}

interface LimitUpResult {
  board1: ResultItem[];
  board2: ResultItem[];
  board3: ResultItem[];
  board4: ResultItem[];
  boardHigher: ResultItem[];
  summary: Summary;
}

// 页面顶部汇总：涨停数 / 跌停数 / 最高连板
interface Summary {
  limitUpCount: number;
  limitDownCount: number | null; // 跌停池接口失败时为 null，前端显示 —
  maxBoardCount: number;
}

// 开盘啦通用认证参数
const KPL_COMMON =
  'DeviceID=29a7602a14606c2577c246c577c6c83cee163dab&PhoneOSNew=2' +
  '&Token=34eba58a769e04ca9df75b85557a76d6&UserID=4565300' +
  '&VerSion=5.23.0.1&apiv=w44';
const KPL_UA = 'lhb/5.23.1 (com.kaipanla.www; build:1; iOS 26.2.0)';

// ---------- 主入口 ----------

export async function GET(request: Request) {
  const todayStr = cnTodayStr(); // Asia/Shanghai 今日
  const url = new URL(request.url);
  const rawDate = url.searchParams.get('date')?.trim() ?? '';
  const dateStr = rawDate || todayStr;
  const isToday = dateStr === todayStr;
  const key = SNAPSHOT_PREFIX + dateStr;

  // 非法日期格式 → 400
  if (rawDate && !parseCnDate(rawDate)) {
    return NextResponse.json({ error: `Invalid date: ${rawDate}` }, { status: 400 });
  }
  // 未来日期 → 400（防止把空快照写入 KV）
  if (rawDate && dateStr > todayStr) {
    return NextResponse.json({ error: `Date ${rawDate} is in the future` }, { status: 400 });
  }

  try {
    const kv = await getKV();

    // 历史日期：优先返回持久化快照（当日收盘数据），未命中再现场拉取
    if (!isToday) {
      const cached = await kv?.get(key);
      if (cached) {
        try {
          return NextResponse.json({ ...JSON.parse(cached), cached: true, today: todayStr });
        } catch {
          /* 快照损坏则忽略，重新拉取 */
        }
      }
    }

    const body = isToday ? await buildTodayResult() : await buildHistoricalResult(dateStr);

    // 持久化快照（今日实时数据也会按节流规则落盘，收盘后即为当日最终数据）
    if (body && kv) {
      try {
        if (shouldPersist(dateStr, body)) {
          await kv.put(key, JSON.stringify(body));
        }
      } catch (e) {
        console.error('Failed to persist snapshot', e);
      }
    }

    return NextResponse.json({ ...body, date: dateStr, today: todayStr });
  } catch (error) {
    console.error('Error fetching limit up data:', error);

    // 实时数据拉取失败时，回退到当日已持久化的快照，保证页面可用
    if (isToday) {
      try {
        const kv = await getKV();
        const cached = await kv?.get(key);
        if (cached) {
          return NextResponse.json({ ...JSON.parse(cached), stale: true, today: todayStr });
        }
      } catch {
        /* ignore */
      }
    }
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}

// 今日实时数据（涨停池 + 断板股实时涨幅）
async function buildTodayResult(): Promise<LimitUpResult> {
  const today = cnNow();
  const eastDateStr = compactDateStr(today); // 东财用 YYYYMMDD

  // 1. 今日涨停池（东财，实时）—— 涨停梯队数据源
  const pool = await fetchPool('getTopicZTPool', eastDateStr);
  const todayCodes = new Set(pool.map((s) => s.c));
  const detailedStocks = await fetchDetailedConcepts(pool);

  // 2. 上一交易日涨停队列（选股宝快照）—— 用于找出今日未涨停（断板）个股
  const prevDate = await findPrevSnapshotDate(today);
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

  // 5. 汇总（断板股不计入）
  const summary = await buildSummary(eastDateStr, detailedStocks);

  return assembleResult(detailedStocks, broken, quotes, summary);
}

// 历史某日收盘数据
async function buildHistoricalResult(dateStr: string): Promise<LimitUpResult> {
  const target = parseCnDate(dateStr)!; // 调用方已校验
  const eastDateStr = compactDateStr(target);

  // 1. 当日涨停池（东财历史数据 = 当日收盘状态）
  const pool = await fetchPool('getTopicZTPool', eastDateStr);
  const todayCodes = new Set(pool.map((s) => s.c));

  // 2. 当日超大单净流入（历史日线，匹配到目标日期）
  const flowMap = await fetchHistoricalBigOrder(pool, dateStr);
  const detailedStocks = pool.map((stock) => ({
    ...stock,
    bigOrderNet: flowMap[stock.c] ?? 0,
  }));

  // 3. 上一交易日涨停队列（选股宝快照）—— 断板股 = 昨涨停、当日未涨停
  const prevDate = await findPrevSnapshotDate(target);
  const prevPool = prevDate ? await fetchXGBDetail(prevDate) : [];
  const broken = prevPool.filter((s) => !todayCodes.has(s.symbol.split('.')[0]));

  // 4. 断板股当日收盘涨幅（历史日线，匹配到目标日期）
  const quotes = broken.length
    ? await fetchHistoricalChangePct(broken.map((s) => s.symbol.split('.')[0]), dateStr)
    : {};

  // 5. 汇总
  const summary = await buildSummary(eastDateStr, detailedStocks);

  return assembleResult(detailedStocks, broken, quotes, summary);
}

async function buildSummary(
  eastDateStr: string,
  detailedStocks: DetailedStock[]
): Promise<Summary> {
  const limitUpCount = detailedStocks.length;

  let limitDownCount: number | null = null;
  try {
    const dtPool = await fetchPool('getTopicDTPool', eastDateStr);
    limitDownCount = dtPool.length;
  } catch (e) {
    console.error('Failed to fetch limit-down pool', e);
  }

  // 最高连板（断板股不计入）
  const maxBoardCount = detailedStocks.reduce((m, s) => Math.max(m, s.lbc ?? 0), 0);

  return { limitUpCount, limitDownCount, maxBoardCount };
}

function assembleResult(
  detailedStocks: DetailedStock[],
  broken: XGBStock[],
  quotes: Record<string, number>,
  summary: Summary
): LimitUpResult {
  const result: LimitUpResult = {
    board1: [],
    board2: [],
    board3: [],
    board4: [],
    boardHigher: [],
    summary,
  };

  detailedStocks.forEach((stock) => addToResult(result, stock));
  broken.forEach((stock) => addBrokenToResult(result, stock, quotes));
  return result;
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
  // 当日涨幅：无效值（缺失/NaN）不设置，前端降级为“未涨停”
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
  topic: 'getTopicZTPool' | 'getTopicDTPool',
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

// ---------- 选股宝接口（历史/上一交易日涨停队列快照） ----------

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

/** 找到指定日期之前最近一个已生成快照的交易日（从 from-1 天起往前，最多 12 天） */
async function findPrevSnapshotDate(from: Date): Promise<string | null> {
  const d = new Date(from);
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

// ---------- 历史数据接口（东财日线，匹配到指定日期） ----------

/** 历史某日超大单净流入：逐只查资金流向日线（fflow daykline），匹配目标日期行 */
async function fetchHistoricalBigOrder(
  pool: StockData[],
  dateStr: string
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const CONCURRENCY = 10;
  const lmt = historicalLmt(dateStr);
  const fetchOne = async (stock: StockData): Promise<[string, number]> => {
    const secid = `${stock.m}.${stock.c}`;
    try {
      const url = `https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=${lmt}&klt=101&secid=${secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f56`;
      const res = await fetch(url, {
        headers: {
          'Referer': 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
        },
        signal: AbortSignal.timeout(6000),
      });
      const json = await res.json();
      const klines: string[] = json?.data?.klines ?? [];
      for (const k of klines) {
        const parts = k.split(',');
        if (parts[0] === dateStr) return [stock.c, Number(parts[2]) || 0]; // f56 超大单净流入
      }
    } catch {
      /* 单只失败记为 0 */
    }
    return [stock.c, 0];
  };

  for (let i = 0; i < pool.length; i += CONCURRENCY) {
    const chunk = pool.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(fetchOne));
    for (const [code, net] of results) out[code] = net;
  }
  return out;
}

/** 历史某日收盘涨跌幅：逐只查日K（kline/get f53 = 涨跌幅），匹配目标日期行 */
async function fetchHistoricalChangePct(
  codes: string[],
  dateStr: string
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const CONCURRENCY = 10;
  const lmt = historicalLmt(dateStr);
  const fetchOne = async (code: string): Promise<[string, number]> => {
    try {
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secidOf(code)}&klt=101&fqt=0&lmt=${lmt}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53`;
      const res = await fetch(url, {
        headers: {
          'Referer': 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
        },
        signal: AbortSignal.timeout(6000),
      });
      const json = await res.json();
      const klines: string[] = json?.data?.klines ?? [];
      for (const k of klines) {
        const parts = k.split(',');
        if (parts[0] === dateStr) return [code, Number(parts[1]) || 0]; // f53 涨跌幅
      }
    } catch {
      /* 单只失败跳过 */
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

/** 由 6 位代码推断东财 secid 市场前缀（60/68 开头 → 上交所，其余 → 深交所） */
function secidOf(code: string): string {
  if (/^(60|68)/.test(code)) return `1.${code}`;
  return `0.${code}`;
}

/** 历史日线接口的 lmt 参数：按日期距今的天数放大，保证能取到目标日（上限 2000 根） */
function historicalLmt(dateStr: string): number {
  const t = parseCnDate(dateStr);
  if (!t) return 250;
  const days = Math.ceil((Date.now() - t.getTime()) / 86_400_000);
  return Math.min(2000, Math.max(250, days + 30));
}

// ---------- 工具函数 ----------

/** Asia/Shanghai 当前日期 YYYY-MM-DD */
function cnTodayStr(): string {
  return toDateStr(cnNow());
}

// Cloudflare 边缘运行时环境是 UTC，A 股交易日须按 Asia/Shanghai 计算
function cnNow(): Date {
  const s = new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' });
  return new Date(s);
}

/** 解析 YYYY-MM-DD → 正午 Date（规避时区导致的前后一天偏移）；非法输入返回 null */
function parseCnDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d, 12, 0, 0);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

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

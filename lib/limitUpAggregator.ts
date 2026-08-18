/**
 * 浏览器端涨停数据聚合器
 *
 * 职责：并行调用多个轻量代理 API，在浏览器端组装涨停梯队数据
 * 优势：避开 Cloudflare Workers 10ms CPU 时间限制，利用浏览器无限计算资源
 *
 * 使用方式：
 *   const data = await fetchLimitUpData({ date: '2024-01-01' });
 *   const data = await fetchLimitUpData({ latest: true }); // 最近交易日收盘
 *   const data = await fetchLimitUpData({}); // 今日实时
 */

// ---- 数据模型 ----

export interface ResultItem {
  code: string;
  name: string;
  price: number;
  changePercent: number;
  time: string;
  reason: string;
  detailedReason?: string;
  amount: string;
  fund: number;
  turnoverText: string;
  ltszText: string;
  turnoverRate?: number;
  limitCount: number;
  isZhaBan: boolean;
  bigOrderNet: number;
  bigOrderNetText: string;
  currentChange?: number;
  overHigh250?: boolean;
}

export interface BoardData {
  board1: ResultItem[];
  board2: ResultItem[];
  board3: ResultItem[];
  board4: ResultItem[];
  boardHigher: ResultItem[];
  summary: Summary;
  date: string;
  today: string;
  stale?: boolean;
  cached?: boolean;
}

export interface Summary {
  limitUpCount: number;
  limitDownCount: number | null;
  maxBoardCount: number;
}

// ---- 东财原始数据结构 ----

interface StockData {
  c: string;  // Code
  m: number;  // Market
  n: string;  // Name
  p: number;  // Price * 1000
  zdp: number; // Change percent
  lbc?: number; // Limit board count
  fbt: number;  // First board time (HHMMSS)
  fund?: number; // Sealed fund
  amount?: number; // 成交额（元）
  ltsz?: number;  // 流通市值（元）
  hs?: number;    // 换手率（%）
  hybk: string;   // Industry/Reason
}

interface XGBStock {
  symbol: string;
  stock_chi_name: string;
  change_percent: number;
  first_limit_up: number;
  limit_up_days: number;
  surge_reason?: {
    stock_reason?: string;
    related_plates?: { plate_name: string }[];
  };
}

// ---- 聚合器 ----

export interface FetchOptions {
  date?: string;       // YYYY-MM-DD，指定日期
  latest?: boolean;    // 非交易时间取最近交易日收盘
}

/**
 * 主入口：获取涨停梯队数据
 * 浏览器端并行调用多个轻量代理，组装后返回与旧 API 一致的结构
 */
export async function fetchLimitUpData(options: FetchOptions = {}): Promise<BoardData> {
  const todayStr = shanghaiToday();
  let dateStr: string;
  let isToday: boolean;

  if (options.date) {
    dateStr = options.date;
    isToday = dateStr === todayStr;
  } else if (options.latest) {
    dateStr = await resolveLatestTradingDate(todayStr);
    isToday = dateStr === todayStr;
  } else {
    dateStr = todayStr;
    isToday = true;
  }

  // 1. 并行获取基础数据
  const [poolRes, xgbRes, dtPoolRes] = await Promise.all([
    fetch(`/api/pool?date=${dateStr.replace(/-/g, '')}&topic=zt`),
    fetch(`/api/xgb?date=${dateStr}`),
    fetch(`/api/pool?date=${dateStr.replace(/-/g, '')}&topic=dt`).catch(() => null),
  ]);

  const poolData = await poolRes.json();
  const pool: StockData[] = poolData.pool ?? [];
  const xgbData = await xgbRes.json();
  const xgbRows: XGBStock[] = xgbData.data ?? [];

  // 跌停池
  let dtPool: StockData[] = [];
  if (dtPoolRes && dtPoolRes.ok) {
    const dtJson = await dtPoolRes.json();
    dtPool = dtJson.pool ?? [];
  }

  // 2. 获取今日涨停池详情（概念 + 超大单 + 250日高）
  const codes = pool.map((s) => s.c);
  let detailMap: Record<string, { concept: string; bigOrderNet: number; overHigh250: boolean }> = {};

  if (codes.length > 0) {
    try {
      const detailRes = await fetch(
        `/api/stock-detail?codes=${codes.join(',')}&date=${dateStr}&isToday=${isToday}`
      );
      if (detailRes.ok) {
        const detailJson = await detailRes.json();
        detailMap = detailJson.details ?? {};
      }
    } catch {
      // stock-detail 失败不影响主数据
    }
  }

  // 3. 获取上一交易日涨停队列（用于断板股识别）
  let prevPool: XGBStock[] = [];
  let prevDate: string | null = null;
  if (isToday) {
    prevDate = await findPrevXGBDate(dateStr);
  } else {
    prevDate = await findPrevXGBDate(dateStr);
  }
  if (prevDate) {
    try {
      const prevRes = await fetch(`/api/xgb?date=${prevDate}`);
      if (prevRes.ok) {
        const prevJson = await prevRes.json();
        prevPool = prevJson.data ?? [];
      }
    } catch {
      // 失败则无断板股
    }
  }

  // 4. 获取涨停原因：选股宝富文本优先
  const reasonMap = buildReasonMap(xgbRows);
  const prevReasonMap = buildReasonMap(prevPool);

  // 5. 组装涨停股
  const todayCodes = new Set(pool.map((s) => s.c));
  const detailedStocks = pool.map((stock) => {
    const detail = detailMap[stock.c];
    return {
      ...stock,
      bigOrderNet: detail?.bigOrderNet ?? 0,
      detailedReason: reasonMap[stock.c] ?? prevReasonMap[stock.c] ?? detail?.concept ?? '',
      overHigh250: detail?.overHigh250 === true,
    };
  });

  // 6. 断板股 = 上一交易日涨停、今日不在涨停池
  const broken = prevPool.filter((s) => !todayCodes.has(s.symbol.split('.')[0]));

  // 7. 断板股涨幅
  let quotes: Record<string, number> = {};
  if (broken.length > 0) {
    const brokenCodes = broken.map((s) => s.symbol.split('.')[0]);
    try {
      const qs = isToday
        ? `codes=${brokenCodes.join(',')}`
        : `codes=${brokenCodes.join(',')}&date=${dateStr}`;
      const quoteRes = await fetch(`/api/quote?${qs}`);
      if (quoteRes.ok) {
        const quoteJson = await quoteRes.json();
        quotes = quoteJson.quotes ?? {};
      }
    } catch {
      // 失败则断板股无涨幅
    }
  }

  // 8. 组装结果
  const result = assembleResult(detailedStocks, broken, quotes, pool.length, dtPool.length);

  return {
    ...result,
    date: dateStr,
    today: todayStr,
  };
}

// ---- 辅助函数 ----

function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/** 从今天往前找最近一个有数据的交易日 */
async function resolveLatestTradingDate(todayStr: string): Promise<string> {
  const d = new Date(`${todayStr}T12:00:00`);
  for (let i = 0; i < 12; i++) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      const cand = toDateStr(d);
      // 尝试获取池数据
      try {
        const res = await fetch(`/api/pool?date=${cand.replace(/-/g, '')}&topic=zt`);
        const json = await res.json();
        if (json.pool && json.pool.length > 0) return cand;
      } catch {
        // 继续往前
      }
    }
    d.setDate(d.getDate() - 1);
  }
  return todayStr;
}

/** 找到指定日期之前最近一个有选股宝数据的交易日 */
async function findPrevXGBDate(dateStr: string): Promise<string | null> {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() - 1);
  for (let i = 0; i < 12; i++) {
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      const ds = toDateStr(d);
      try {
        const res = await fetch(`/api/xgb?date=${ds}`);
        const json = await res.json();
        if (json.data && json.data.length > 0) return ds;
      } catch {
        // 继续
      }
    }
    d.setDate(d.getDate() - 1);
  }
  return null;
}

function toDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 选股宝涨停原因映射 */
function buildReasonMap(rows: XGBStock[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const code = r.symbol.split('.')[0];
    if (!code) continue;
    const sr = r.surge_reason;
    const reason =
      sr?.stock_reason?.trim() ||
      (sr?.related_plates ?? []).map((p) => p.plate_name).filter(Boolean).join(';');
    if (reason) out[code] = reason;
  }
  return out;
}

function assembleResult(
  detailedStocks: (StockData & { bigOrderNet: number; detailedReason: string; overHigh250: boolean })[],
  broken: XGBStock[],
  quotes: Record<string, number>,
  limitUpCount: number,
  dtPoolLength: number,
) {
  const result: BoardData = {
    board1: [],
    board2: [],
    board3: [],
    board4: [],
    boardHigher: [],
    summary: {
      limitUpCount,
      limitDownCount: dtPoolLength,
      maxBoardCount: detailedStocks.reduce((m, s) => Math.max(m, s.lbc ?? 0), 0),
    },
    date: '',
    today: '',
  };

  for (const stock of detailedStocks) {
    addToResult(result, stock);
  }
  for (const stock of broken) {
    addBrokenToResult(result, stock, quotes);
  }

  return result;
}

function addToResult(
  result: BoardData,
  stock: StockData & { bigOrderNet: number; detailedReason: string; overHigh250: boolean }
) {
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
    turnoverText: formatAmount(stock.amount ?? 0),
    ltszText: formatAmount(stock.ltsz ?? 0),
    turnoverRate: stock.hs ?? undefined,
    limitCount,
    isZhaBan: false,
    bigOrderNet: stock.bigOrderNet,
    bigOrderNetText: formatAmount(stock.bigOrderNet),
    overHigh250: stock.overHigh250 === true ? true : undefined,
  };

  pushByLevel(result, item, limitCount);
}

function addBrokenToResult(result: BoardData, stock: XGBStock, quotes: Record<string, number>) {
  const code = stock.symbol.split('.')[0];
  const limitCount = (stock.limit_up_days ?? 0) + 1;
  if (limitCount <= 1) return;

  const plates = (stock.surge_reason?.related_plates ?? [])
    .map((p) => p.plate_name)
    .filter(Boolean);
  const reason = plates.length ? plates.join(';') : '昨日涨停';
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
    turnoverText: '',
    ltszText: '',
    turnoverRate: undefined,
    limitCount,
    isZhaBan: true,
    bigOrderNet: 0,
    bigOrderNetText: '',
    currentChange,
  };

  pushByLevel(result, item, limitCount);
}

function pushByLevel(result: BoardData, item: ResultItem, level: number) {
  if (level === 1) result.board1.push(item);
  else if (level === 2) result.board2.push(item);
  else if (level === 3) result.board3.push(item);
  else if (level === 4) result.board4.push(item);
  else if (level >= 5) result.boardHigher.push(item);
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
  if (abs >= 100000000) return sign + (abs / 100000000).toFixed(2) + '亿';
  if (abs >= 10000) return sign + (abs / 10000).toFixed(0) + '万';
  return sign + String(abs);
}
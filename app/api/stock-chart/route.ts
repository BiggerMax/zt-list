import { NextResponse } from 'next/server';

// OpenNext 部署到 Cloudflare Workers（nodejs_compat），无需 edge runtime
export const dynamic = 'force-dynamic'; // Disable caching

const EM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
// 东财行情接口所需 token（与 limit-up 路由同一来源）
const EM_UT = '7eea3edcaed734bea9cbfc24409ed989';

// 开盘啦认证参数（Token 会过期，仅作最后兜底）
const KPL_COMMON =
  'DeviceID=29a7602a14606c2577c246c577c6c83cee163dab&PhoneOSNew=2' +
  '&Token=34eba58a769e04ca9df75b85557a76d6&UserID=4565300' +
  '&VerSion=5.23.0.1&apiv=w44';
const KPL_UA = 'lhb/5.23.1 (com.kaipanla.www; build:1; iOS 26.2.0)';

// K线周期 → 东财 klt 参数
const KLINE_PERIODS: Record<string, number> = {
  day: 101,
  week: 102,
  month: 103,
  '60m': 60,
  '30m': 30,
  '15m': 15,
  '5m': 5,
};

interface TrendPoint {
  time: string; // "2026-08-11 09:30"
  date: string; // "2026-08-11"
  price: number; // 最新价
  avg: number; // 均价（累计成交额/累计成交量）
  volume: number; // 成交量（手）
  amount: number; // 成交额（元）
}

interface KlineRow {
  date: string; // 日K 为日期，分钟K 为 "YYYY-MM-DD HH:mm"
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number; // 手
  amount: number; // 元
  pct: number; // 涨跌幅 %
  turnover: number; // 换手率 %
}

/** 由 6 位代码推断东财 secid 市场前缀（60/68 开头 → 上交所，其余 → 深交所/北交所） */
function secidOf(code: string): string {
  if (/^(60|68)/.test(code)) return `1.${code}`;
  return `0.${code}`;
}

/** 由 6 位代码生成腾讯行情代码（sh/sz/bj 前缀） */
function txCodeOf(code: string): string {
  if (/^(60|68)/.test(code)) return `sh${code}`;
  if (/^(4|8|92)/.test(code)) return `bj${code}`;
  return `sz${code}`;
}

// ---------- 上海时区日期工具 ----------

/** Asia/Shanghai 当前日期 YYYY-MM-DD */
function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

/** 最近交易日（跳过周末；节假日无法精确判断，近似处理） */
function latestTradingDay(today: string): string {
  const d = new Date(`${today}T12:00:00`);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- 通用请求（失败自动重试，应对东财/腾讯偶发抖动） ----------

async function fetchRetry(url: string, headers: Record<string, string>, attempts = 2): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(7000),
        next: { revalidate: 0 },
      });
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250));
  }
  throw lastErr;
}

// ---------- 东财数据源 ----------

/** 东财分时；historyDate（YYYY-MM-DD）非空时尝试取历史日（trends2 实际忽略 end，会回退最近交易日） */
async function fetchEmTrend(code: string, historyDate: string): Promise<{ name: string; preClose: number; trends: TrendPoint[] } | null> {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(historyDate);
  const endParam = m ? `&end=${m[1]}${m[2]}${m[3]}` : '';
  const base = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secidOf(code)}&ut=${EM_UT}&fields1=f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=1&iscr=0`;
  const headers = { Referer: 'http://quote.eastmoney.com/', 'User-Agent': EM_UA };

  const fetchOnce = async (withEnd: boolean) => {
    const res = await fetchRetry(base + (withEnd ? endParam : ''), headers);
    return res.json();
  };

  let json = await fetchOnce(!!endParam);
  let trends = parseEmTrends(json?.data?.trends ?? []);
  let preClose = Number(json?.data?.preClose ?? json?.data?.prePrice ?? 0);

  // 请求了历史日期但返回的不是该日 → 回退最近交易日
  const requestedDate = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  if (requestedDate && (trends.length === 0 || trends[0].date !== requestedDate)) {
    json = await fetchOnce(false);
    trends = parseEmTrends(json?.data?.trends ?? []);
    preClose = Number(json?.data?.preClose ?? json?.data?.prePrice ?? 0);
  }
  return { name: json?.data?.name ?? '', preClose, trends };
}

/** 解析东财分时行：time,价格,开?,高?,低?,成交量,成交额,均价 */
function parseEmTrends(lines: string[]): TrendPoint[] {
  return lines.map((line) => {
    const p = line.split(',');
    const time = p[0] ?? '';
    return {
      time,
      date: time.slice(0, 10),
      price: Number(p[1]),
      avg: Number(p[7]),
      volume: Number(p[5]),
      amount: Number(p[6]),
    };
  });
}

/** 东财K线（日K 400 根；周/月K 250 根；分钟K 320 根） */
async function fetchEmKline(code: string, klt: number, lmt: number): Promise<{ name: string; klines: KlineRow[] } | null> {
  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secidOf(code)}&ut=${EM_UT}&klt=${klt}&fqt=1&lmt=${lmt}&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
  const res = await fetchRetry(url, { Referer: 'http://quote.eastmoney.com/', 'User-Agent': EM_UA });
  const json = await res.json();
  const data = json?.data;
  const klines: KlineRow[] = (data?.klines ?? []).map((line: string) => {
    const p = line.split(',');
    return {
      date: p[0],
      open: Number(p[1]),
      close: Number(p[2]),
      high: Number(p[3]),
      low: Number(p[4]),
      volume: Number(p[5]),
      amount: Number(p[6]),
      pct: Number(p[8]),
      turnover: Number(p[10]),
    };
  });
  return { name: data?.name ?? '', klines };
}

// ---------- 腾讯备用数据源 ----------

/** 腾讯分时：data[code].data.data = "HHMM 价格 累计量(手) 累计额(元)"，均价 = 累计额/(累计量*100) */
async function fetchTxTrend(code: string): Promise<{ name: string; preClose: number; trends: TrendPoint[] } | null> {
  const tx = txCodeOf(code);
  try {
    const res = await fetchRetry(`https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=${tx}`, {
      Referer: 'https://gu.qq.com/',
      'User-Agent': EM_UA,
    });
    const json = await res.json();
    if (Number(json?.code) !== 0) return null;
    const stock = json?.data?.[tx];
    const dd = stock?.data;
    const rows: string[] = dd?.data ?? [];
    if (!rows || rows.length === 0) return null;
    const dateStr = String(dd?.date ?? '');
    const date = dateStr
      ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
      : '';
    const qt = stock?.qt?.[tx] ?? [];
    const preClose = Number(qt[4]) || 0;
    // 腾讯分时量/额是当日累计值，换算为每分钟增量，保证与东财分时（分钟量）语义一致、量柱形状正常
    let prevVol = 0;
    let prevAmt = 0;
    const trends = rows.map((line, i) => {
      const parts = line.split(' ');
      const price = Number(parts[1]);
      const cumVol = Number(parts[2]) || 0; // 累计手
      const cumAmt = Number(parts[3]) || 0; // 累计元
      const volume = i === 0 ? cumVol : Math.max(0, cumVol - prevVol);
      const amount = i === 0 ? cumAmt : Math.max(0, cumAmt - prevAmt);
      prevVol = cumVol;
      prevAmt = cumAmt;
      const hm = parts[0] ?? '';
      const time = date ? `${date} ${hm.slice(0, 2)}:${hm.slice(2, 4)}` : '';
      return {
        time,
        date,
        price,
        avg: cumVol > 0 ? cumAmt / (cumVol * 100) : price, // 均价必须用累计值
        volume,
        amount,
      };
    });
    return { name: String(qt[1] ?? ''), preClose, trends };
  } catch {
    return null;
  }
}

/** 腾讯日/周/月K：qfqday|qfqweek|qfqmonth = [date, open, close, high, low, volume(手)] */
async function fetchTxFqKline(code: string, period: string, lmt: number): Promise<KlineRow[] | null> {
  const tx = txCodeOf(code);
  try {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tx},${period},,,${lmt},qfq`;
    const res = await fetchRetry(url, { Referer: 'https://gu.qq.com/', 'User-Agent': EM_UA });
    const json = await res.json();
    if (Number(json?.code) !== 0) return null;
    const rows: string[][] = json?.data?.[tx]?.[`qfq${period}`] ?? [];
    if (!rows || rows.length === 0) return null;
    let prevClose = 0;
    return rows.map((r) => {
      const close = Number(r[2]);
      const pct = prevClose > 0 ? (close / prevClose - 1) * 100 : 0;
      prevClose = close;
      return {
        date: r[0],
        open: Number(r[1]),
        close,
        high: Number(r[3]),
        low: Number(r[4]),
        volume: Number(r[5]),
        amount: 0, // 腾讯 fqkline 不返回成交额
        pct,
        turnover: 0, // 腾讯 fqkline 不返回换手率
      };
    });
  } catch {
    return null;
  }
}

/** 腾讯分钟K：m5|m15|m30|m60 = ["YYYYMMDDHHMM", open, close, high, low, volume(手), {}, amount(万元)] */
async function fetchTxMinuteKline(code: string, minute: string, lmt: number): Promise<KlineRow[] | null> {
  const tx = txCodeOf(code);
  try {
    const url = `https://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${tx},m${minute},,${lmt}`;
    const res = await fetchRetry(url, { Referer: 'https://gu.qq.com/', 'User-Agent': EM_UA });
    const json = await res.json();
    if (Number(json?.code) !== 0) return null;
    const rows: (string | number)[][] = json?.data?.[tx]?.[`m${minute}`] ?? [];
    if (!rows || rows.length === 0) return null;
    let prevClose = 0;
    return rows.map((r) => {
      const dt = String(r[0]);
      const close = Number(r[2]);
      const pct = prevClose > 0 ? (close / prevClose - 1) * 100 : 0;
      prevClose = close;
      return {
        date: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)} ${dt.slice(8, 10)}:${dt.slice(10, 12)}`,
        open: Number(r[1]),
        close,
        high: Number(r[3]),
        low: Number(r[4]),
        volume: Number(r[5]),
        amount: Number(r[7]) * 10000, // 万元 → 元
        pct,
        turnover: 0,
      };
    });
  } catch {
    return null;
  }
}

// ---------- 开盘啦数据源（Token 会过期） ----------

/** 开盘啦历史分时：GetStockTrend，trend=["HH:MM", 价格, 均价, 量(手), flag]；仅已结束交易日可用 */
async function fetchKplTrend(code: string, day: string): Promise<{ preClose: number; trends: TrendPoint[] } | null> {
  try {
    const url = 'https://apphis.longhuvip.com/w1/api/index.php';
    const body = `${KPL_COMMON}&c=StockL2History&a=GetStockTrend&StockID=${code}&Day=${day.replace(/-/g, '')}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'User-Agent': KPL_UA,
      },
      body,
      signal: AbortSignal.timeout(7000),
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (Number(json?.errcode) !== 0) return null; // 注意：apphis 的 errcode 是字符串 "0"
    const rows: (string | number)[][] = json?.trend ?? [];
    if (!rows || rows.length === 0) return null;
    const preClose = Number(json?.preclose_px) || 0;
    const trends = rows.map((r) => {
      const hm = String(r[0] ?? '');
      const price = Number(r[1]);
      return {
        time: `${day} ${hm}`, // 开盘啦时间为 "09:30"
        date: day,
        price,
        avg: Number(r[2]) || price,
        volume: Number(r[3]) || 0, // 分钟量（非累计）
        amount: 0, // 开盘啦分时不返回成交额
      };
    });
    return { preClose, trends };
  } catch {
    return null;
  }
}

/** 开盘啦日K：x=日期, y=[open, close, high, low], vol=成交量(股→手) */
async function fetchKplDayKline(code: string, lmt: number): Promise<KlineRow[] | null> {
  try {
    const url = 'https://applhb.longhuvip.com/w1/api/index.php';
    const body = `${KPL_COMMON}&c=Stock&a=GetStockChart&StockID=${code}&Index=0&st=${Math.min(lmt, 500)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
        'User-Agent': KPL_UA,
      },
      body,
      signal: AbortSignal.timeout(7000),
      next: { revalidate: 0 },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (Number(json?.errcode) !== 0) return null;
    const x: string[] = json?.x ?? [];
    const y: number[][] = json?.y ?? [];
    const vol: number[] = json?.vol ?? [];
    if (!x.length || !y.length) return null;
    // 开盘啦日K 为 T+1 更新（盘中缺当日）。若最后日期早于最近交易日（数据不完整），弃用本源交给东财
    const lastDate = `${x[x.length - 1].slice(0, 4)}-${x[x.length - 1].slice(4, 6)}-${x[x.length - 1].slice(6, 8)}`;
    if (lastDate < latestTradingDay(shanghaiToday())) return null;
    let prevClose = 0;
    return x.map((date, i) => {
      const ohlc = y[i] ?? [0, 0, 0, 0];
      const close = Number(ohlc[1]);
      const pct = prevClose > 0 ? (close / prevClose - 1) * 100 : 0;
      prevClose = close;
      return {
        date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
        open: Number(ohlc[0]),
        close,
        high: Number(ohlc[2]),
        low: Number(ohlc[3]),
        volume: (Number(vol[i]) || 0) / 100, // 股 → 手
        amount: 0,
        pct,
        turnover: 0,
      };
    });
  } catch {
    return null;
  }
}

// ---------- 主入口 ----------

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') ?? '').trim();
  const type = (url.searchParams.get('type') ?? 'trend').trim();
  const period = (url.searchParams.get('period') ?? 'day').trim();
  const date = (url.searchParams.get('date') ?? '').trim(); // YYYY-MM-DD（仅分时使用）

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid stock code' }, { status: 400 });
  }
  if (type !== 'trend' && type !== 'kline') {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  try {
    // ---------- K线 ----------
    if (type === 'kline') {
      const klt = KLINE_PERIODS[period] ?? 101;
      // 日K 需 350 根以上，用于计算 120/250/350 日最高价指标；周/月K 250 根；分钟K 320 根
      const lmt = period === 'day' ? 400 : klt >= 101 ? 250 : 320;
      let klines: KlineRow[] | null = null;
      let name = '';

      // 默认数据源：开盘啦（仅日K，且数据完整时）；缺当日或失败时回退东财 → 腾讯
      if (period === 'day') {
        try {
          klines = await fetchKplDayKline(code, lmt);
        } catch {
          klines = null;
        }
      }

      // 备用：东财
      if (!klines) {
        try {
          const em = await fetchEmKline(code, klt, lmt);
          if (em && em.klines.length > 0) {
            klines = em.klines;
            name = em.name;
          }
        } catch {
          /* 东财失败 → 腾讯 */
        }
      }

      // 兜底：腾讯
      if (!klines) {
        try {
          if (klt >= 101) {
            const txPeriod = period === 'week' ? 'week' : period === 'month' ? 'month' : 'day';
            klines = await fetchTxFqKline(code, txPeriod, lmt);
          } else {
            klines = await fetchTxMinuteKline(code, period.replace('m', ''), lmt);
          }
        } catch {
          klines = null;
        }
      }

      if (!klines) {
        return NextResponse.json({ error: 'Failed to fetch kline data' }, { status: 502 });
      }
      return NextResponse.json({ code, name, type: 'kline', period, klines });
    }

    // ---------- 分时 ----------
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const requestedDate = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    let trend: { name: string; preClose: number; trends: TrendPoint[] } | null = null;

    // 历史日期：默认开盘啦（GetStockTrend 可返回真实历史当日分时）；当日盘中开盘啦无数据
    if (requestedDate && requestedDate !== shanghaiToday()) {
      const kpl = await fetchKplTrend(code, requestedDate);
      if (kpl && kpl.trends.length > 0) {
        trend = { name: '', preClose: kpl.preClose, trends: kpl.trends };
      }
    }

    // 备用：东财
    if (!trend || trend.trends.length === 0) {
      try {
        trend = await fetchEmTrend(code, date);
      } catch {
        /* 东财失败 → 腾讯 */
      }
    }

    // 兜底：腾讯
    if (!trend || trend.trends.length === 0) {
      const tx = await fetchTxTrend(code);
      if (tx && tx.trends.length > 0) {
        trend = { name: tx.name, preClose: tx.preClose, trends: tx.trends };
      }
    }

    if (!trend || trend.trends.length === 0) {
      return NextResponse.json({ error: 'Failed to fetch trend data' }, { status: 502 });
    }

    return NextResponse.json({
      code,
      name: trend.name,
      type: 'trend',
      date: requestedDate,
      trendDate: trend.trends[0]?.date ?? '',
      preClose: trend.preClose,
      trends: trend.trends,
    });
  } catch (error) {
    console.error('Error fetching stock chart:', error);
    return NextResponse.json({ error: 'Failed to fetch chart data' }, { status: 500 });
  }
}

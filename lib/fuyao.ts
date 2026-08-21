/**
 * 同花顺金融数据 API（Fuyao）共享客户端
 *
 - 文档：https://fuyao.aicubes.cn/docs/api-reference/overview/
 - 所有 /api/** 接口：HTTP 恒为 200，业务码在 body.code（0 = 成功）
 - 鉴权：请求头 X-api-key；生产环境建议用 `npx wrangler pages secret put FUYAO_API_KEY` 注入
 */

const FUYAO_BASE = 'https://fuyao.aicubes.cn';
// 与项目内其他数据源一致：内置默认值保证开箱可用，环境变量可覆盖
const FUYAO_KEY =
  process.env.FUYAO_API_KEY ?? 'sk-fuyao-o1ABI7vQJd56WUbg03WKO2pJTjbbYHYv';

export interface FuyaoEnvelope<T = unknown> {
  code: number;
  message: string;
  request_id?: string;
  data: T | null;
}

/** 带鉴权的同花顺 API GET 请求；返回 data 字段，业务码非 0 时抛错 */
export async function fuyaoGet<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  timeoutMs = 8000,
): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  }
  const url = `${FUYAO_BASE}${path}${qs.size ? `?${qs.toString()}` : ''}`;
  const res = await fetch(url, {
    headers: { 'X-api-key': FUYAO_KEY },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Fuyao HTTP ${res.status}`);
  const json = (await res.json()) as FuyaoEnvelope<T>;
  if (json.code !== 0) throw new Error(`Fuyao code=${json.code} ${json.message}`);
  return json.data as T;
}

/** 6 位代码 → 完整 thscode（60/68 开头上交所，4/8/92 开头北交所，其余深交所） */
export function toThsCode(code: string): string {
  if (/^(60|68)/.test(code)) return `${code}.SH`;
  if (/^(4|8|92)/.test(code)) return `${code}.BJ`;
  return `${code}.SZ`;
}

/** thscode → 6 位代码 */
export function fromThsCode(thscode: string): string {
  return thscode.split('.')[0];
}

/** YYYY-MM-DD → Asia/Shanghai 零点毫秒戳（limit-up-pool 等接口的 date_ms 入参） */
export function shanghaiMidnightMs(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T00:00:00+08:00`).getTime());
}

// ---- 数据结构（按需声明） ----

export interface FuyaoLimitUpItem {
  thscode: string;
  ticker: string;
  name: string;
  is_st?: boolean;
  is_new?: boolean;
  last_price: number;
  price_change_ratio_pct: number;
  limit_up_time?: string; // "HH:MM"
  limit_up_reason?: string;
  continue_day_text?: string;
  continue_day_cnt: number;
  seal_money?: number;
  max_seal_money?: number;
}

export interface FuyaoLimitDownItem {
  thscode: string;
  ticker: string;
  name: string;
  last_price: number;
  price_change_ratio_pct: number;
  first_limit_time?: string; // "HH:mm"
  last_limit_time?: string;
  turnover_ratio_pct?: number;
}

/** 批量行情快照条目 */
export interface FuyaoSnapshotItem {
  thscode: string;
  ticker: string;
  last_price: number;
  price_change: number;
  price_change_ratio_pct: number;
  volume: number;
  turnover: number;
}

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import TrendChart from './TrendChart';
import KlineChart from './KlineChart';

interface TrendPoint {
  time: string;
  price: number;
  avg: number;
  volume: number;
  amount: number;
}

interface TrendResp {
  code: string;
  name: string;
  type: 'trend';
  date: string;
  trendDate: string;
  preClose: number;
  trends: TrendPoint[];
}

interface KlineRow {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  amount: number;
  pct: number;
  turnover: number;
}

interface KlineResp {
  code: string;
  name: string;
  type: 'kline';
  period: string;
  klines: KlineRow[];
}

interface StockChartModalProps {
  stock: { code: string; name: string } | null;
  /** 主看板当前选择的日期（'' = 今日实时），用于历史日期的分时图 */
  date?: string;
  onClose: () => void;
  /** 双击K线 → 主看板跳转到该日期并高亮该股 */
  onJumpToDate?: (date: string, code: string) => void;
}

type ActiveView = { view: 'trend' } | { view: 'kline'; period: string };

const TABS: { key: string; label: string }[] = [
  { key: 'trend', label: '分时' },
  { key: 'day', label: '日K' },
  { key: 'week', label: '周K' },
  { key: 'month', label: '月K' },
  { key: '60m', label: '60分' },
  { key: '30m', label: '30分' },
  { key: '15m', label: '15分' },
  { key: '5m', label: '5分' },
];

function marketOf(code: string): string {
  if (/^(60|68)/.test(code)) return '沪';
  if (/^(4|8)/.test(code)) return '北';
  return '深';
}

const Spinner = () => (
  <div className="flex items-center justify-center py-24">
    <div className="w-7 h-7 rounded-full border-2 border-line2 border-t-up animate-spin" />
  </div>
);

const ErrorBlock: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="flex flex-col items-center gap-3 py-20">
    <span className="text-xs text-ink3">{message}</span>
    <button
      onClick={onRetry}
      className="px-3 py-1.5 rounded-md text-xs font-medium bg-inset border border-line text-ink hover:bg-inset-hover transition-colors"
    >
      重试
    </button>
  </div>
);

/**
 * 弹窗主体。外层用 key 包裹，个股/日期切换时整体重挂载，
 * 避免在 effect 里同步重置状态（react-hooks/set-state-in-effect）。
 */
const ModalBody: React.FC<StockChartModalProps & { stock: { code: string; name: string } }> = ({
  stock,
  date,
  onClose,
  onJumpToDate,
}) => {
  const [active, setActive] = useState<ActiveView>({ view: 'trend' });
  const [trend, setTrend] = useState<TrendResp | null>(null);
  const [trendError, setTrendError] = useState(false);
  const [klineCache, setKlineCache] = useState<Record<string, KlineResp>>({});
  const [klineError, setKlineError] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  // 关闭：点击遮罩 / Esc / 右上角
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // 分时数据
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const qs = new URLSearchParams({ code: stock.code, type: 'trend' });
    if (date) qs.set('date', date);
    fetch(`/api/stock-chart?${qs}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as TrendResp;
      })
      .then((json) => {
        if (!cancelled) setTrend(json);
      })
      .catch((e) => {
        if (e?.name !== 'AbortError' && !cancelled) setTrendError(true);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [stock, date, retryTick]);

  // K线数据（按周期缓存）
  useEffect(() => {
    if (active.view !== 'kline') return;
    const period = active.period;
    if (klineCache[period]) return;
    let cancelled = false;
    const ctrl = new AbortController();
    fetch(`/api/stock-chart?code=${stock.code}&type=kline&period=${period}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as KlineResp;
      })
      .then((json) => {
        if (!cancelled) setKlineCache((c) => ({ ...c, [period]: json }));
      })
      .catch((e) => {
        if (e?.name !== 'AbortError' && !cancelled) setKlineError(true);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [stock, active, klineCache, retryTick]);

  const retry = useCallback(() => {
    setTrendError(false);
    setKlineError(false);
    setTrend(null);
    setRetryTick((t) => t + 1);
  }, []);

  const isTrendLoading = trend === null && !trendError;
  const kline = active.view === 'kline' ? klineCache[active.period] ?? null : null;
  const isKlineLoading = active.view === 'kline' && kline === null && !klineError;

  const lastPrice = trend && trend.trends.length > 0 ? trend.trends[trend.trends.length - 1].price : null;
  const lastChange =
    lastPrice != null && trend && trend.preClose > 0
      ? ((lastPrice / trend.preClose - 1) * 100).toFixed(2)
      : null;
  const lastUp = lastPrice != null && trend && trend.preClose > 0 ? lastPrice >= trend.preClose : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${stock.name} 行情图`}
    >
      <div
        className="w-full max-w-[780px] max-h-[88vh] flex flex-col rounded-xl bg-surface border border-line shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部：名称 + 代码 + 最新价 */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-line bg-surface2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base font-bold text-ink truncate">{stock.name}</span>
            <span className="text-xs font-mono text-ink2 shrink-0">{stock.code}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-badge border border-line text-ink2 shrink-0">
              {marketOf(stock.code)}
            </span>
            {lastPrice != null && (
              <span
                className={`text-sm font-bold font-mono shrink-0 ${
                  lastUp ? 'text-up' : lastUp === false ? 'text-down' : 'text-ink2'
                }`}
              >
                {lastPrice.toFixed(2)}
                {lastChange != null && <span className="text-xs font-medium ml-1">{lastChange}%</span>}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-ink2 hover:text-ink hover:bg-inset-hover transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 图表类型 / 周期切换 */}
        <div className="flex items-center gap-1 px-3 pt-2.5 pb-2 border-b border-line overflow-x-auto no-scrollbar shrink-0">
          {TABS.map((t) => {
            const isActive =
              active.view === 'trend' ? t.key === 'trend' : active.view === 'kline' && active.period === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActive(t.key === 'trend' ? { view: 'trend' } : { view: 'kline', period: t.key })}
                className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                  isActive ? 'bg-up/15 text-up' : 'text-ink2 hover:text-ink hover:bg-inset-hover'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* 历史日期无分时数据提示 */}
        {trend && trend.date && trend.trendDate && trend.date !== trend.trendDate && (
          <div className="px-4 py-1.5 text-[11px] text-banner-warn-text bg-banner-warn border-b border-banner-warn-border shrink-0">
            {trend.date} 无分时数据，显示最近交易日 {trend.trendDate} 的分时
          </div>
        )}

        {/* 图表主体（日K 含 N日高位置面板，高度常超出可视区，允许上下滚动） */}
        <div className="flex-1 min-h-0 p-3 sm:p-4 overflow-y-auto overscroll-contain">
          {active.view === 'trend' ? (
            trend && trend.trends.length > 0 ? (
              <TrendChart trends={trend.trends} preClose={trend.preClose} />
            ) : isTrendLoading ? (
              <Spinner />
            ) : trendError ? (
              <ErrorBlock message="分时数据加载失败" onRetry={retry} />
            ) : (
              <div className="text-center text-ink3 text-xs py-20">暂无分时数据</div>
            )
          ) : kline && kline.klines.length > 0 ? (
            <>
              <KlineChart
                klines={kline.klines}
                period={kline.period}
                code={stock.code}
                onCandleClick={onJumpToDate ? (d) => onJumpToDate(d, stock.code) : undefined}
              />
              <div className="mt-1 text-right text-[10px] text-ink3 select-none">
                双击K线 · 看板跳转至该日期
              </div>
            </>
          ) : isKlineLoading ? (
            <Spinner />
          ) : klineError ? (
            <ErrorBlock message="K线数据加载失败" onRetry={retry} />
          ) : (
            <div className="text-center text-ink3 text-xs py-20">暂无K线数据</div>
          )}
        </div>
      </div>
    </div>
  );
};

const StockChartModal: React.FC<StockChartModalProps> = ({ stock, date, onClose, onJumpToDate }) => {
  if (!stock) return null;
  // 个股或日期变化时整体重挂载，保证各状态（分时/K线缓存、视图）重置
  return (
    <ModalBody
      key={`${stock.code}|${date ?? ''}`}
      stock={stock}
      date={date}
      onClose={onClose}
      onJumpToDate={onJumpToDate}
    />
  );
};

export default StockChartModal;

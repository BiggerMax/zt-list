'use client';

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface TrendPoint {
  time: string;
  price: number;
  avg: number;
  volume: number;
  amount: number;
}

interface TrendChartProps {
  trends: TrendPoint[];
  preClose: number;
}

const W = 640;
const H = 400;
const L = 56;
const R = 12;
const T = 10;
const B = 24;
const PRICE_H = 250;
const VOL_TOP = T + PRICE_H + 16;
const VOL_BOTTOM = H - B;
const INNER_W = W - L - R;

function fmtNum(v: number): string {
  if (!isFinite(v)) return '—';
  return v.toFixed(2);
}

/** 纵轴涨幅标签：相对昨收的涨跌幅，如 +10.0% / 0% / -5.0% */
function fmtPctAxis(v: number, pc: number): string {
  if (!isFinite(v) || pc <= 0) return '—';
  const pct = ((v - pc) / pc) * 100;
  if (Math.abs(pct) < 0.05) return '0%';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function fmtVol(v: number): string {
  if (v >= 10000) return (v / 10000).toFixed(1) + '万';
  return String(Math.round(v));
}

function fmtAmt(v: number): string {
  if (v >= 100000000) return (v / 100000000).toFixed(2) + '亿';
  if (v >= 10000) return (v / 10000).toFixed(1) + '万';
  return String(Math.round(v));
}

const TrendChart: React.FC<TrendChartProps> = ({ trends, preClose }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ idx: number; xCss: number } | null>(null);
  const [tipW, setTipW] = useState(0);
  const [wrapW, setWrapW] = useState(0);

  // 测量容器/悬浮框宽度（布局阶段同步完成，先于绘制），右侧放不下时翻转到光标左侧，避免溢出容器
  useLayoutEffect(() => {
    if (wrapRef.current) setWrapW(wrapRef.current.clientWidth);
    if (tipRef.current) setTipW(tipRef.current.offsetWidth);
  }, [hover]);
  // 昨收异常（0/NaN）时以首笔价格代替，避免除零
  const pc = preClose > 0 ? preClose : trends[0]?.price ?? 0;

  const model = useMemo(() => {
    if (trends.length === 0 || pc <= 0) return null;
    const prices = trends.map((t) => t.price);
    const avgs = trends.map((t) => t.avg);
    const all = [...prices, ...avgs];
    const min = Math.min(...all);
    const max = Math.max(...all);
    // 以昨收为轴心做对称缩放，保证 ±100% 网格线对称
    let maxAbs = Math.max(Math.abs(max - pc), Math.abs(pc - min));
    if (!isFinite(maxAbs) || maxAbs <= 0) maxAbs = pc * 0.01;
    const top = pc + maxAbs * 1.02;
    const bottom = pc - maxAbs * 1.02;
    const maxVol = Math.max(...trends.map((t) => t.volume), 1);
    const yOf = (v: number) => T + ((top - v) / (top - bottom)) * PRICE_H;
    const xOf = (i: number) => L + (i / Math.max(trends.length - 1, 1)) * INNER_W;
    const gridFracs = [-1, -0.5, 0, 0.5, 1];
    const grid = gridFracs.map((f) => {
      const v = pc + f * maxAbs;
      return { v, y: yOf(v) };
    });
    const barW = Math.max(1, (INNER_W / trends.length) * 0.6);

    // 价格线 / 均价线路径
    const linePath = (get: (t: TrendPoint) => number) =>
      trends.map((t, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(2)},${yOf(get(t)).toFixed(2)}`).join(' ');
    const pricePath = linePath((t) => t.price);
    const avgPath = linePath((t) => t.avg);

    // 底部时间刻度（约 6 个）
    const ticks: { x: number; label: string }[] = [];
    for (let k = 0; k <= 5; k++) {
      const i = Math.round((k * (trends.length - 1)) / 5);
      ticks.push({ x: xOf(i), label: trends[i].time.slice(11, 16) });
    }
    return { yOf, xOf, grid, maxVol, barW, pricePath, avgPath, ticks };
  }, [trends, pc]);

  if (!model) {
    return <div className="flex items-center justify-center h-full text-xs text-ink3">暂无分时数据</div>;
  }

  const { yOf, xOf, grid, maxVol, barW, pricePath, avgPath, ticks } = model;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xCss = e.clientX - rect.left;
    const vx = (xCss / rect.width) * W;
    const n = trends.length;
    const idx = Math.min(n - 1, Math.max(0, Math.round(((vx - L) / INNER_W) * (n - 1))));
    setHover({ idx, xCss });
  };

  const hx = hover ? xOf(hover.idx) : null;
  const hoverPt = hover ? trends[hover.idx] : null;
  // 自适应位置：浮窗默认在光标右侧；右侧放不下时翻转到左侧
  let tipLeft = hover ? hover.xCss + 14 : 0;
  if (hover && tipLeft + tipW > wrapW) tipLeft = hover.xCss - 14 - tipW;
  tipLeft = hover ? Math.max(8, tipLeft) : 0;
  const tipTop = 8;

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none"
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block">
        {/* 网格 + 涨幅轴（相对昨收，±100% 对称） */}
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={g.y} y2={g.y} stroke="var(--color-line)" strokeWidth="1" />
            <text x={L - 4} y={g.y + 3} textAnchor="end" fontSize="9" fill="var(--color-ink3)">
              {fmtPctAxis(g.v, pc)}
            </text>
          </g>
        ))}

        {/* 昨收线（±0 网格加粗虚线） */}
        <line x1={L} x2={W - R} y1={grid[2].y} y2={grid[2].y} stroke="var(--color-ink3)" strokeWidth="1" strokeDasharray="4 3" />

        {/* 均价线 */}
        <path d={avgPath} fill="none" stroke="var(--color-khaki)" strokeWidth="1.2" />

        {/* 价格线 */}
        <path d={pricePath} fill="none" stroke="var(--color-up)" strokeWidth="1.5" />

        {/* 成交量区域分隔线 */}
        <line x1={L} x2={W - R} y1={VOL_TOP - 6} y2={VOL_TOP - 6} stroke="var(--color-line)" strokeWidth="1" />
        <text x={L} y={VOL_TOP} fontSize="9" fill="var(--color-ink3)">成交量</text>

        {/* 成交量柱 */}
        {trends.map((t, i) => {
          const h = Math.max(1, (t.volume / maxVol) * (VOL_BOTTOM - VOL_TOP - 4));
          const x = xOf(i) - barW / 2;
          return (
            <rect
              key={i}
              x={x}
              y={VOL_BOTTOM - h}
              width={barW}
              height={h}
              fill={t.price >= pc ? 'var(--color-up)' : 'var(--color-down)'}
              opacity="0.55"
            />
          );
        })}

        {/* 时间刻度 */}
        {ticks.map((t, i) => (
          <text key={i} x={t.x} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--color-ink3)">
            {t.label}
          </text>
        ))}

        {/* 图例 */}
        <text x={L + 4} y={T + 10} fontSize="10" fill="var(--color-up)">价格</text>
        <text x={L + 40} y={T + 10} fontSize="10" fill="var(--color-khaki)">均价</text>

        {/* 十字光标 */}
        {hover && hoverPt && hx != null && (
          <g>
            <line x1={hx} x2={hx} y1={T} y2={VOL_BOTTOM} stroke="var(--color-ink3)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={hx} cy={yOf(hoverPt.price)} r="2.5" fill="var(--color-up)" />
            <circle cx={hx} cy={yOf(hoverPt.avg)} r="2.5" fill="var(--color-khaki)" />
          </g>
        )}
      </svg>

      {/* 悬浮提示 */}
      {hover && hoverPt && (
        <div
          ref={tipRef}
          className="absolute z-10 px-2.5 py-1.5 rounded-lg bg-tip border border-tip-border text-tip-text text-[11px] shadow-xl pointer-events-none whitespace-nowrap"
          style={{ left: tipLeft, top: tipTop }}
        >
          <div className="font-bold text-tip-title mb-0.5">
            {hoverPt.time.slice(5)} · {fmtNum(hoverPt.price)}{' '}
            <span className={hoverPt.price >= pc ? 'text-up' : 'text-down'}>
              {((hoverPt.price / pc - 1) * 100).toFixed(2)}%
            </span>
          </div>
          <div>均价 {fmtNum(hoverPt.avg)}</div>
          <div>
            量 {fmtVol(hoverPt.volume)}手
            {hoverPt.amount > 0 && <> · 额 {fmtAmt(hoverPt.amount)}</>}
          </div>
        </div>
      )}
    </div>
  );
};

export default TrendChart;

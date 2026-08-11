'use client';

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';

interface KlineRow {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number;
  pct: number;
  turnover: number;
}

interface KlineChartProps {
  klines: KlineRow[];
  /** K线周期（day/week/month/60m...），日K 时显示 120/250/350 日最高价水平参考线 */
  period?: string;
  /** 股票代码（用于按市场判断涨停幅度，日K N日高位置面板展示"需几个涨停"） */
  code?: string;
  /** 双击某根K线 → 回调该K线对应日期（YYYY-MM-DD） */
  onCandleClick?: (date: string) => void;
}

const W = 640; // 图表内容宽
const AXIS_R_W = 40; // 右侧百分比纵坐标带（相对当日价格的比例）
const SVG_W = W + AXIS_R_W; // SVG viewBox 总宽（含右侧纵坐标带）
const PX = W + AXIS_R_W - 4; // 右侧百分比标签右对齐 x
const L = 56;
const R = 12;
const BASE_T = 10; // 价格区顶部基础偏移（日K 额外让出顶部标题区）
const PRICE_H = 250;
const INNER_W = W - L - R;
const LEGEND_Y = 20; // 顶部图例行基线（日K 位于标题区顶部，其他周期即 T+10）

const MA_COLORS = ['#e8b64c', '#4f8ff7', '#b26be0'];
const MA_WINDOWS = [5, 10, 20];

/** 日K 最高价指标：取窗口内最高价（最高价 = 区间内 high 最大值），画平行于 x 轴的水平参考线 */
const HIGH_WINDOWS = [120, 250, 350];
const HIGH_COLORS = ['#e67e22', '#0fb9b1', '#e84393'];

function fmtNum(v: number): string {
  if (!isFinite(v)) return '—';
  return v.toFixed(2);
}

function fmtVol(v: number): string {
  if (v >= 10000) return (v / 10000).toFixed(1) + '万';
  return String(Math.round(v));
}

/** 计算移动平均序列：与 klines 等长，不足窗口的前缀为 null */
function maSeries(klines: KlineRow[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < klines.length; i++) {
    sum += klines[i].close;
    if (i >= window) sum -= klines[i - window].close;
    out.push(i >= window - 1 ? sum / window : null);
  }
  return out;
}

/** 涨停幅度：按股票所处市场判断——沪深主板 10%、创业板/科创板 20%、北交所 30% */
function limitUpPct(code: string): number {
  if (/^(8|4|92)/.test(code)) return 0.3;
  if (/^(30|68)/.test(code)) return 0.2;
  return 0.1;
}

/** 现价距目标价还需多少个涨停（连续涨停按复利估算；已到/超过目标为 0） */
function limitUpsNeeded(price: number, target: number, pct: number): number {
  if (price <= 0 || target <= price) return 0;
  return Math.ceil(Math.log(target / price) / Math.log(1 + pct));
}

/** N日最高价序列：第 i 根K线的 N 日最高价 = max(high[i-N+1..i])，不足 N 根的前缀为 null */
function nDayHighSeries(klines: KlineRow[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < klines.length; i++) {
    const start = i - window + 1;
    if (start < 0) {
      out.push(null);
      continue;
    }
    let mx = -Infinity;
    for (let j = start; j <= i; j++) {
      if (klines[j].high > mx) mx = klines[j].high;
    }
    out.push(mx);
  }
  return out;
}

const KlineChart: React.FC<KlineChartProps> = ({ klines, period, code, onCandleClick }) => {
  // 按股票所处市场自动判断涨停幅度（主板 10% / 创业·科创 20% / 北交所 30%）
  const limitPct = limitUpPct(code ?? '');
  // 日K：顶部让出标题区（图例 + 差距分行，约 46px），价格区/成交量/底部 N日高位置 面板整体下移；其他周期保持原布局
  const isDay = period === 'day';
  const T = BASE_T + (isDay ? 46 : 0);
  const VOL_TOP = T + PRICE_H + 16;
  const VOL_BOTTOM = VOL_TOP + 100;
  const POS_TOP = VOL_BOTTOM + 16;
  const POS_BOTTOM = POS_TOP + 108;
  const H = isDay ? POS_BOTTOM + 45 : 400;
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

  const model = useMemo(() => {
    if (klines.length === 0) return null;
    const mas = MA_WINDOWS.map((w) => maSeries(klines, w));
    const highs = klines.map((k) => k.high);
    // 仅日K 需要 120/250/350 日最高价（需要 350+ 根数据，接口日K 返回 400 根）
    const highSeriesList =
      period === 'day' ? HIGH_WINDOWS.map((w) => nDayHighSeries(klines, w)) : [];
    const lows = klines.map((k) => k.low);
    const maVals = mas.flat().filter((v): v is number => v != null);
    const lo = Math.min(...lows, ...maVals);
    const hi = Math.max(...highs, ...maVals);
    const pad = (hi - lo) * 0.03 || hi * 0.01 || 1;
    const top = hi + pad;
    const bottom = lo - pad;
    const maxVol = Math.max(...klines.map((k) => k.volume), 1);
    const n = klines.length;
    const barW = Math.max(1, (INNER_W / n) * 0.62);
    const yOf = (v: number) => T + ((top - v) / (top - bottom)) * PRICE_H;
    const xOf = (i: number) => L + (i / Math.max(n - 1, 1)) * INNER_W;
    const maPaths = mas.map((series) =>
      series
        .map((v, i) => (v == null ? '' : `${i === 0 || series[i - 1] == null ? 'M' : 'L'}${xOf(i).toFixed(2)},${yOf(v).toFixed(2)}`))
        .join(' ')
        .trim()
    );
    const ticks: { x: number; label: string }[] = [];
    for (let k = 0; k <= 5; k++) {
      const i = Math.round((k * (n - 1)) / 5);
      const d = klines[i].date;
      ticks.push({ x: xOf(i), label: d.includes(' ') ? d.slice(11, 16) : d.slice(5) });
    }
    return { top, bottom, yOf, xOf, barW, maxVol, mas, maPaths, ticks, last: klines[n - 1], lastIdx: n - 1, highSeriesList };
  }, [klines, period, T]);

  if (!model) {
    return <div className="flex items-center justify-center h-full text-xs text-ink3">暂无K线数据</div>;
  }

  const { top, bottom, yOf, xOf, barW, maxVol, mas, maPaths, ticks, last, highSeriesList } = model;

  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xCss = e.clientX - rect.left;
    const vx = (xCss / rect.width) * W;
    const n = klines.length;
    const idx = Math.min(n - 1, Math.max(0, Math.round(((vx - L) / INNER_W) * (n - 1))));
    setHover({ idx, xCss });
  };

  const hx = hover ? xOf(hover.idx) : null;
  const hoverK = hover ? klines[hover.idx] : null;
  // 自适应位置：浮窗默认在光标右侧；右侧放不下时翻转到左侧
  let tipLeft = hover ? hover.xCss + 14 : 0;
  if (hover && tipLeft + tipW > wrapW) tipLeft = hover.xCss - 14 - tipW;
  tipLeft = hover ? Math.max(8, tipLeft) : 0;
  const tipTop = 8;

  // 双击K线 → 换算最近一根K线的索引，回传日期（日K为当日，分钟K取日期部分）
  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onCandleClick) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const xCss = e.clientX - rect.left;
    const vx = (xCss / rect.width) * W;
    const n = klines.length;
    const idx = Math.min(n - 1, Math.max(0, Math.round(((vx - L) / INNER_W) * (n - 1))));
    onCandleClick(klines[idx].date.slice(0, 10));
  };

  return (
    <div
      ref={wrapRef}
      className="relative w-full select-none"
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
      onDoubleClick={handleDoubleClick}
      title={onCandleClick ? '双击K线 → 看板跳转至该日期' : undefined}
    >
      <svg viewBox={`0 0 ${SVG_W} ${H}`} className="w-full h-auto block">
        {/* 网格（4 条）+ 价格轴（左）+ 涨跌幅比例轴（右，以当日价格为 0 点） */}
        {[0, 1, 2, 3].map((i) => {
          const y = T + ((i + 0.5) / 4) * PRICE_H;
          const v = top - (y - T) / PRICE_H * (top - bottom);
          // 比例 = 相对最新收盘价的涨跌幅；当日价格为 0 点
          const pct = last.close > 0 ? (v / last.close - 1) * 100 : 0;
          const pctLabel = Math.abs(pct) < 0.05 ? '0.0%' : `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
          return (
            <g key={i}>
              <line x1={L} x2={W - R} y1={y} y2={y} stroke="var(--color-line)" strokeWidth="1" />
              <text x={L - 4} y={y + 3} textAnchor="end" fontSize="9" fill="var(--color-ink3)">
                {fmtNum(v)}
              </text>
              <text x={PX} y={y + 3} textAnchor="end" fontSize="9" fill="var(--color-ink3)">
                {pctLabel}
              </text>
            </g>
          );
        })}
        {/* 当日价格 0 点参考线（虚线，与网格线相距过近或贴近图表边缘时隐藏） */}
        {(() => {
          const y0 = yOf(last.close);
          if (y0 < T + 12 || y0 > T + PRICE_H - 4) return null;
          const nearGrid = [0, 1, 2, 3].some((i) => Math.abs(T + ((i + 0.5) / 4) * PRICE_H - y0) < 6);
          if (nearGrid) return null;
          return (
            <g>
              <line x1={L} x2={W - R} y1={y0} y2={y0} stroke="var(--color-ink3)" strokeWidth="1" strokeDasharray="2 3" opacity="0.65" />
              <text x={PX} y={y0 + 3} textAnchor="end" fontSize="9" fill="var(--color-ink3)">
                0.0%
              </text>
            </g>
          );
        })()}
        {/* N日最高价水平参考线（仅日K，平行于x轴，取最新一根K线的 N 日最高价；画在文字/蜡烛下方避免遮挡） */}
        {period === 'day' &&
          highSeriesList.map((series, i) => {
            const v = series[series.length - 1];
            if (v == null) return null;
            const w = HIGH_WINDOWS[i];
            const y = yOf(v);
            return (
              <g key={w}>
                <line x1={L} x2={W - R} y1={y} y2={y} stroke={HIGH_COLORS[i]} strokeWidth="1" strokeDasharray="4 3" />
                <text x={W - R - 2 - i * 46} y={Math.max(T + 8, y - 3)} textAnchor="end" fontSize="9" fill={HIGH_COLORS[i]}>
                  {fmtNum(v)}
                </text>
              </g>
            );
          })}

        {/* 顶部价格 + 涨跌幅 */}
        <text x={L + 4} y={LEGEND_Y} fontSize="10" fill={last.close >= last.open ? 'var(--color-up)' : 'var(--color-down)'}>
          {fmtNum(last.close)}{' '}
          <tspan fill="var(--color-ink3)">
            {last.pct >= 0 ? '+' : ''}{last.pct.toFixed(2)}%
          </tspan>
        </text>

        {/* MA 图例 */}
        {MA_WINDOWS.map((w, i) => (
          <text key={w} x={L + 100 + i * 52} y={LEGEND_Y} fontSize="10" fill={MA_COLORS[i]}>
            MA{w}
          </text>
        ))}

        {/* N日最高价图例（仅日K）：文字后直接跟现价距该高点的差距百分比，不再单独分行显示 */}
        {isDay &&
          (() => {
            const items = HIGH_WINDOWS.map((w, i) => ({
              w,
              color: HIGH_COLORS[i],
              v: highSeriesList[i]?.[highSeriesList[i].length - 1] ?? null,
            })).filter((it): it is { w: number; color: string; v: number } => it.v != null);
            // 顺序排布并留 10px 间隙：按字符估算宽度（汉字≈10px、数字/符号≈5.5px），
            // 即使窗口缺失（次新股）或差距百分比位数较多也不会互相重叠
            const textW = (s: string) => [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 127 ? 10 : 5.5), 0);
            let cx = L + 236;
            return items.map((it) => {
              const dist = last.close > 0 ? (it.v / last.close - 1) * 100 : 0;
              const label = `${it.w}日高 距${dist >= 0 ? '+' : ''}${dist.toFixed(1)}%`;
              const el = (
                <text key={it.w} x={cx} y={LEGEND_Y} fontSize="10" fill={it.color}>
                  {label}
                </text>
              );
              cx += textW(label) + 10;
              return el;
            });
          })()}


        {/* 均线 */}
        {maPaths.map((p, i) => p && <path key={i} d={p} fill="none" stroke={MA_COLORS[i]} strokeWidth="1" opacity="0.9" />)}

        {/* K线蜡烛 */}
        {klines.map((k, i) => {
          const up = k.close >= k.open;
          const color = up ? 'var(--color-up)' : 'var(--color-down)';
          const x = xOf(i) - barW / 2;
          const yHigh = yOf(k.high);
          const yLow = yOf(k.low);
          const yO = yOf(k.open);
          const yC = yOf(k.close);
          const bodyTop = Math.min(yO, yC);
          const bodyH = Math.max(1, Math.abs(yC - yO));
          return (
            <g key={i}>
              <line x1={xOf(i)} x2={xOf(i)} y1={yHigh} y2={yLow} stroke={color} strokeWidth="1" />
              <rect x={x} y={bodyTop} width={barW} height={bodyH} fill={color} opacity={up ? 0.95 : 0.85} />
            </g>
          );
        })}

        {/* 成交量区域分隔线 */}
        <line x1={L} x2={W - R} y1={VOL_TOP - 6} y2={VOL_TOP - 6} stroke="var(--color-line)" strokeWidth="1" />
        <text x={L} y={VOL_TOP} fontSize="9" fill="var(--color-ink3)">成交量</text>

        {/* 成交量柱 */}
        {klines.map((k, i) => {
          const up = k.close >= k.open;
          const h = Math.max(1, (k.volume / maxVol) * (VOL_BOTTOM - VOL_TOP - 4));
          return (
            <rect
              key={i}
              x={xOf(i) - barW / 2}
              y={VOL_BOTTOM - h}
              width={barW}
              height={h}
              fill={up ? 'var(--color-up)' : 'var(--color-down)'}
              opacity="0.55"
            />
          );
        })}

        {/* N日高位置面板（仅日K）：归一化显示现价与 120/250/350 日最高的相对位置 */}
        {period === 'day' && (
          <g>
            <line x1={L} x2={W - R} y1={POS_TOP - 12} y2={POS_TOP - 12} stroke="var(--color-line)" strokeWidth="1" />
            <text x={L} y={POS_TOP - 4} fontSize="9" fill="var(--color-ink3)">N日高位置</text>
            {/* 每个窗口标注"还需几个涨停"（按市场涨停幅度；已达为"已达"，数据不足为"—"） */}
            {HIGH_WINDOWS.map((w, i) => {
              const v = highSeriesList[i]?.[highSeriesList[i].length - 1] ?? null;
              const n = v != null ? limitUpsNeeded(last.close, v, limitPct) : null;
              return (
                <text key={w} x={L + 96 + i * 72} y={POS_TOP - 4} fontSize="9" fill={HIGH_COLORS[i]}>
                  {w}日高 {n == null ? '—' : n === 0 ? '已达' : `${n}板`}
                </text>
              );
            })}
            <text x={W - R} y={POS_TOP - 4} textAnchor="end" fontSize="9" fill="var(--color-ink3)">
              涨停幅度{Math.round(limitPct * 100)}%
            </text>
            {(() => {
              // 面板刻度覆盖整段收盘价历史 + 各 N 日高；现价用曲线反映价格与日期的关系（差距百分比统一在顶部图例显示）
              const highs = highSeriesList.map((s) => s[s.length - 1]).filter((v): v is number => v != null);
              const closes = klines.map((k) => k.close);
              const plo = Math.min(...closes, ...highs);
              const phi = Math.max(...closes, ...highs);
              const ppad = (phi - plo) * 0.08 || phi * 0.03 || 1;
              const pTop = phi + ppad;
              const pBottom = plo - ppad;
              const yPos = (v: number) => POS_TOP + ((pTop - v) / (pTop - pBottom)) * (POS_BOTTOM - POS_TOP);
              const pricePath = closes
                .map((v, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(2)},${yPos(v).toFixed(2)}`)
                .join(' ');
              const priceColor = last.close >= last.open ? 'var(--color-up)' : 'var(--color-down)';
              const lastY = yPos(last.close);
              return (
                <g key="pos-plot">
                  {/* 三条 N 日高虚线（无文字，窗口标注统一在顶部图例） */}
                  {highSeriesList.map((series, i) => {
                    const v = series[series.length - 1];
                    if (v == null) return null;
                    const y = yPos(v);
                    return (
                      <line
                        key={`ln-${HIGH_WINDOWS[i]}`}
                        x1={L}
                        x2={W - R}
                        y1={y}
                        y2={y}
                        stroke={HIGH_COLORS[i]}
                        strokeWidth="1"
                        strokeDasharray="4 3"
                      />
                    );
                  })}
                  {/* 现价曲线（收盘价随日期变化），末端圆点标记现价 */}
                  <path d={pricePath} fill="none" stroke={priceColor} strokeWidth="1.2" opacity="0.9" />
                  <circle cx={xOf(klines.length - 1)} cy={lastY} r="2.2" fill={priceColor} />
                  <text
                    x={W - R}
                    y={Math.max(POS_TOP + 8, lastY - 3)}
                    textAnchor="end"
                    fontSize="9"
                    fontWeight="bold"
                    fill={priceColor}
                  >
                    现价 {fmtNum(last.close)}
                  </text>
                </g>
              );
            })()}
          </g>
        )}

        {/* 时间刻度 */}
        {ticks.map((t, i) => (
          <text key={i} x={t.x} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--color-ink3)">
            {t.label}
          </text>
        ))}

        {/* 十字光标 */}
        {hover && hoverK && hx != null && (
          <g>
            <line x1={hx} x2={hx} y1={T} y2={isDay ? POS_BOTTOM : VOL_BOTTOM} stroke="var(--color-ink3)" strokeWidth="1" strokeDasharray="3 3" />
            <line x1={L} x2={W - R} y1={yOf(hoverK.close)} y2={yOf(hoverK.close)} stroke="var(--color-ink3)" strokeWidth="1" strokeDasharray="3 3" />
          </g>
        )}
      </svg>

      {/* 悬浮提示 */}
      {hover && hoverK && (
        <div
          ref={tipRef}
          className="absolute z-10 px-2.5 py-1.5 rounded-lg bg-tip border border-tip-border text-tip-text text-[11px] shadow-xl pointer-events-none whitespace-nowrap"
          style={{ left: tipLeft, top: tipTop }}
        >
          <div className="font-bold text-tip-title mb-0.5">
            {hoverK.date}{' '}
            <span className={hoverK.close >= hoverK.open ? 'text-up' : 'text-down'}>
              {hoverK.pct >= 0 ? '+' : ''}{hoverK.pct.toFixed(2)}%
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3">
            <span>开 {fmtNum(hoverK.open)}</span>
            <span>高 {fmtNum(hoverK.high)}</span>
            <span>低 {fmtNum(hoverK.low)}</span>
            <span>收 {fmtNum(hoverK.close)}</span>
          </div>
          <div>
            量 {fmtVol(hoverK.volume)}手
            {hoverK.turnover > 0 && <> · 换手 {hoverK.turnover.toFixed(2)}%</>}
          </div>
          <div className="flex gap-2">
            {MA_WINDOWS.map((w, i) => {
              const v = mas[i][hover.idx];
              return v != null && (
                <span key={w} style={{ color: MA_COLORS[i] }}>
                  MA{w} {fmtNum(v)}
                </span>
              );
            })}
          </div>
          {period === 'day' && (
            <div className="flex gap-2">
              {HIGH_WINDOWS.map((w, i) => {
                const v = highSeriesList[i]?.[hover.idx];
                return v != null && (
                  <span key={w} style={{ color: HIGH_COLORS[i] }}>
                    {w}日高 {fmtNum(v)}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default KlineChart;

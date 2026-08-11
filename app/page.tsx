'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BoardColumn from '@/components/BoardColumn';
import StockChartModal from '@/components/StockChartModal';

interface Stock {
  code: string;
  name: string;
  time: string;
  reason: string;
  detailedReason?: string;
  amount: string;
  fund: number; // Raw sealed fund amount in yuan, for sorting
  changePercent: number;
  limitCount: number;
  isZhaBan: boolean; // 断板（上一交易日涨停、今日未涨停）
  bigOrderNet: number; // 超大单净流入（元）
  bigOrderNetText: string; // 格式化超大单净流入
  turnoverText?: string; // 成交额（格式化，如 2.45亿）
  ltszText?: string; // 流通值（格式化，如 36.99亿）
  turnoverRate?: number; // 换手率（%）
  currentChange?: number; // 断板股当日涨幅（%）
  overHigh350?: boolean; // 当日价突破前 350 日最高价 → 卡片显示"新高"关注标记
}

interface BoardData {
  board1: Stock[];
  board2: Stock[];
  board3: Stock[];
  board4: Stock[];
  boardHigher: Stock[];
}

interface Summary {
  limitUpCount: number;
  limitDownCount: number | null;
  maxBoardCount: number;
}

interface IndexQuote {
  code: string;
  name: string;
  price: number;
  pct: number;
}

type Theme = 'light' | 'dark';

// Asia/Shanghai 今日（YYYY-MM-DD）
function shanghaiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

const BOARD_KEYS: (keyof BoardData)[] = ['board1', 'board2', 'board3', 'board4', 'boardHigher'];

export default function Home() {
  const [data, setData] = useState<BoardData>({
    board1: [],
    board2: [],
    board3: [],
    board4: [],
    boardHigher: [],
  });
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [sortBy, setSortBy] = useState<'time' | 'amount'>('time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedDate, setSelectedDate] = useState(''); // '' = 今日（实时）
  const [todayStr, setTodayStr] = useState('');
  const [dataDate, setDataDate] = useState(''); // 响应实际代表的日期
  const [isStale, setIsStale] = useState(false); // 实时拉取失败、返回缓存快照
  const [fetchError, setFetchError] = useState(false);
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [theme, setTheme] = useState<Theme>('dark');
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null);
  const [highlightCode, setHighlightCode] = useState<string | null>(null); // 从K线双击跳转后高亮的个股
  const fetchSeq = useRef(0); // 请求序号：丢弃过期响应，避免切换日期时旧数据覆盖新数据
  const [soundOn, setSoundOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem('zt-sound') !== 'off';
    } catch {
      return true;
    }
  });
  const alertedHigh350 = useRef<Set<string>>(new Set()); // 当日已登记“突破 350 日高”的个股（已登记的只登记不重复播报）
  const seededHigh350 = useRef(false); // 首次加载只静默登记、不播报，只提醒“新突破”
  const prevDataDay = useRef(''); // 上一个交易日，跨日时清空登记
  const lastBeepAt = useRef(0); // 防连发：同一轮多股突破时最小间隔
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    setTodayStr(shanghaiToday());
  }, []);

  // 主题初始化：优先用户显式选择；未选择时跟随系统偏好（并监听系统变化）
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem('zt-theme');
    } catch {
      /* 隐私模式等场景忽略 */
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (t: Theme) => {
      setTheme(t);
      document.documentElement.classList.toggle('dark', t === 'dark');
    };
    if (stored === 'light' || stored === 'dark') {
      apply(stored);
    } else {
      apply(media.matches ? 'dark' : 'light');
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light');
      media.addEventListener('change', handler);
      return () => media.removeEventListener('change', handler);
    }
  }, []);

  const toggleTheme = () => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      try {
        localStorage.setItem('zt-theme', next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // 突破提醒：Web Audio 提示音（双击上扬音 A5→D6）+ 语音合成播报股票名称；受自动播放策略限制时静默失败
  const playHighAlert = useCallback((stockName?: string) => {
    // 语音播报：读出突破的股票名称。队列播放，同一轮多股突破时依次播报，不受提示音连发限制
    if (stockName && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        const utterance = new SpeechSynthesisUtterance(`${stockName}，突破350日高点`);
        utterance.lang = 'zh-CN';
        utterance.rate = 1;
        utterance.pitch = 1.05;
        utterance.volume = 1;
        window.speechSynthesis.speak(utterance);
      } catch {
        /* 语音合成不可用时忽略 */
      }
    }
    // 提示音（连发限制：同一轮多股突破时至少间隔 350ms）
    try {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();
      const now = performance.now();
      if (now - lastBeepAt.current < 350) return; // 同一轮多股同时突破时避免连发
      lastBeepAt.current = now;
      const t0 = ctx.currentTime;
      [880, 1174.66].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const t = t0 + i * 0.18;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.45);
      });
    } catch {
      /* 自动播放策略等限制下静默失败，不打断看板 */
    }
  }, []);

  // 首次用户交互时解锁 AudioContext（浏览器自动播放策略要求）
  useEffect(() => {
    const unlock = () => {
      try {
        if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          void audioCtxRef.current.resume();
        }
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // 声音开关记忆到 localStorage
  useEffect(() => {
    try {
      localStorage.setItem('zt-sound', soundOn ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, [soundOn]);

  const fetchData = useCallback(async (date: string) => {
    const seq = ++fetchSeq.current;
    try {
      const qs = date ? `?date=${date}` : '';
      const res = await fetch(`/api/limit-up${qs}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const jsonData = await res.json();
      if (seq !== fetchSeq.current) return; // 已有更新的请求，丢弃本次响应
      setData(jsonData);
      setSummary(jsonData.summary ?? null);
      setDataDate(jsonData.date ?? '');
      setIsStale(!!jsonData.stale);
      setFetchError(false);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      if (seq !== fetchSeq.current) return;
      console.error(error);
      setFetchError(true);
    } finally {
      if (seq === fetchSeq.current) setLoading(false);
    }
  }, []);

  // 指数轮询：10s 自调度（与服务端 5s 结果缓存错峰），慢网络不堆叠
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const fetchIndices = async () => {
      try {
        const res = await fetch('/api/indices');
        if (res.ok) {
          const j = await res.json();
          if (Array.isArray(j.indices)) setIndices(j.indices);
        }
      } catch {
        /* 指数失败不影响看板 */
      }
    };
    const loop = async () => {
      if (stopped) return;
      await fetchIndices();
      if (stopped) return;
      timer = setTimeout(loop, 10_000);
    };
    void loop();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 仅“今日”为实时轮询；历史日期为收盘静态数据，只拉一次
  const isRealtime = selectedDate === '' || (todayStr !== '' && selectedDate === todayStr);

  useEffect(() => {
    if (!todayStr) return;
    setLoading(true);
    fetchData(selectedDate);
    if (isRealtime) {
      // 自调度轮询：上一次请求完成后再等 10s，慢网络下不会堆叠请求；配合服务端 15s 结果缓存
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      const loop = async () => {
        if (stopped) return;
        await fetchData(selectedDate);
        if (stopped) return;
        timer = setTimeout(loop, 10_000);
      };
      void loop();
      return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
      };
    }
  }, [selectedDate, todayStr, isRealtime, fetchData]);

  // 突破 350 日高声音提醒：仅实时轮询生效。个股首次出现 overHigh350 时播报，当日不重复；
  // 首次加载只静默登记（只提醒“新突破”）；切到历史日期或跨交易日时清空登记。
  useEffect(() => {
    if (!isRealtime) {
      alertedHigh350.current.clear();
      seededHigh350.current = false;
      return;
    }
    // 跨交易日（dataDate 变化）时清空登记，让新一天重新按“首次”语义计算
    if (prevDataDay.current && dataDate && prevDataDay.current !== dataDate) {
      alertedHigh350.current.clear();
      seededHigh350.current = false;
    }
    if (dataDate) prevDataDay.current = dataDate;
    // 挂载初始空数据（dataDate 尚未就绪）时静默返回：不要把“已登记”提前置位，
    // 保证首次真实数据到达时是静默登记，只提醒之后“新突破”的个股
    if (!dataDate) return;
    for (const bk of BOARD_KEYS) {
      for (const s of data[bk]) {
        if (!s.overHigh350 || alertedHigh350.current.has(s.code)) continue;
        alertedHigh350.current.add(s.code);
        if (seededHigh350.current && soundOn) playHighAlert(s.name);
      }
    }
    seededHigh350.current = true;
  }, [data, isRealtime, dataDate, soundOn, playHighAlert]);

  // 日期加减一天（不越过今天）
  const shiftDay = (delta: number) => {
    const base = selectedDate && selectedDate !== '' && selectedDate !== todayStr ? selectedDate : todayStr;
    const d = new Date(`${base}T12:00:00`);
    d.setDate(d.getDate() + delta);
    const next = d.toISOString().slice(0, 10);
    setSelectedDate(next > todayStr ? todayStr : next);
    setHighlightCode(null);
  };

  // 弹窗内双击K线：主看板跳转至该日期并高亮对应个股
  const handleJumpToDate = useCallback((date: string, code: string) => {
    setSelectedStock(null); // 关闭弹窗，让用户看到跳转后的看板
    setSelectedDate(date);
    setHighlightCode(code);
  }, []);

  // Switch sort field (default direction per field), toggle direction on repeat click
  const handleSort = (key: 'time' | 'amount') => {
    if (key === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'time' ? 'asc' : 'desc'); // 涨停时间: 越早越前; 封单金额: 越大越前
    }
  };

  const sortStocks = (stocks: Stock[]) => {
    const arr = [...stocks];
    const dir = sortDir === 'asc' ? 1 : -1;
    if (sortBy === 'time') {
      arr.sort((a, b) => a.time.localeCompare(b.time) * dir); // HH:MM:SS zero-padded, lexicographic works
    } else {
      arr.sort((a, b) => ((a.fund ?? 0) - (b.fund ?? 0)) * dir);
    }
    return arr;
  };

  // 拆分涨停股与断板股：涨停股按当前排序规则，断板股按当日涨幅从高到低（缺涨幅的排最后）
  const splitByStatus = (stocks: Stock[]) => {
    const limitUp = stocks.filter((s) => !s.isZhaBan);
    const zhaBan = stocks.filter((s) => s.isZhaBan);
    return {
      limitUp: sortStocks(limitUp),
      zhaBan: [...zhaBan].sort((a, b) => (b.currentChange ?? -Infinity) - (a.currentChange ?? -Infinity)),
    };
  };

  const allEmpty = BOARD_KEYS.every((k) => data[k].length === 0);

  // 涨停股按板块（reason）统计，取涨停家数前三的板块
  const topSectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const bk of BOARD_KEYS) {
      for (const s of data[bk]) {
        if (s.isZhaBan) continue; // 只统计涨停股
        const r = s.reason.trim();
        if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));
  }, [data]);

  // 跳转日期后，等数据渲染完成再滚动到高亮个股（重试几次，处理加载延迟）
  useEffect(() => {
    if (!highlightCode) return;
    let attempts = 0;
    const tryScroll = () => {
      attempts += 1;
      const el = document.getElementById(`stock-card-${highlightCode}`);
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
      } else if (attempts < 6) {
        window.setTimeout(tryScroll, 250);
      }
    };
    const t = window.setTimeout(tryScroll, 250);
    return () => window.clearTimeout(t);
  }, [highlightCode, data, loading]);

  return (
    <main className="flex flex-col h-dvh bg-canvas text-ink overflow-hidden">
      {/* Header：第一行标题 + 右上角更新时间，第二行控制区（窄窗口自动换行） */}
      <header className="border-b border-line bg-surface px-4 py-2 shrink-0">
        {/* 第一行：标题（左）+ 更新时间（右上角，与 A股涨停梯队 并排） */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`w-3 h-3 rounded-full shrink-0 ${isRealtime ? 'bg-up animate-pulse' : 'bg-ink3'}`}></div>
          <h1 className="text-lg font-bold tracking-tight whitespace-nowrap">A股涨停梯队</h1>
          {!isRealtime && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-badge border border-line text-ink2 font-mono whitespace-nowrap">
              收盘数据
            </span>
          )}
          {/* 涨停股板块前三：板块名 + 涨停家数 */}
          {topSectors.length > 0 && (
            <div className="flex items-center gap-1.5 min-w-0" title="涨停股按板块分类，前三板块及涨停数量">
              <span className="text-[10px] text-ink3 whitespace-nowrap">热门板块</span>
              {topSectors.map(({ name, count }) => (
                <span
                  key={name}
                  className="flex items-baseline gap-1 text-[11px] px-2 py-0.5 rounded-full bg-inset border border-line text-ink2 whitespace-nowrap"
                >
                  <span className="text-up font-bold font-mono leading-none">{count}</span>
                  <span className="max-w-[4.5rem] truncate">{name}</span>
                </span>
              ))}
            </div>
          )}
          </div>

          {/* 右上角：实时/收盘 + 更新时间 */}
          <div className="flex items-center gap-1.5 shrink-0 text-xs font-mono text-ink3 min-w-0">
            {loading ? (
              <span className="whitespace-nowrap">Loading...</span>
            ) : (
              <>
                <span className="px-1.5 py-0.5 rounded bg-inset border border-line text-[10px] text-ink2 whitespace-nowrap">
                  {isRealtime ? '实时' : '收盘'}
                </span>
                {!isRealtime && <span className="text-ink2 truncate">{dataDate || selectedDate}</span>}
                {isStale && <span className="text-amber-500/80 whitespace-nowrap">· 缓存</span>}
                {isRealtime && <span className="whitespace-nowrap">Last updated: {lastUpdated}</span>}
              </>
            )}
          </div>
        </div>

        {/* 第二行：日期 / 排序 / 统计 / 指数 / 主题 */}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {/* Date control */}
          <div className="flex items-center gap-1 rounded-lg bg-inset border border-line p-0.5 shrink-0">
            <button
              onClick={() => shiftDay(-1)}
              title="前一天"
              className="w-6 h-6 flex items-center justify-center rounded-md text-xs text-ink2 hover:text-ink hover:bg-inset-hover transition-colors"
            >
              ‹
            </button>
            <input
              type="date"
              value={selectedDate}
              min="2019-01-01"
              max={todayStr}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setHighlightCode(null);
              }}
              title="选择日期查看收盘数据"
              className="bg-transparent text-xs font-mono text-ink outline-none px-1 w-[7.5rem] text-center"
            />
            <button
              onClick={() => shiftDay(1)}
              title="后一天"
              className="w-6 h-6 flex items-center justify-center rounded-md text-xs text-ink2 hover:text-ink hover:bg-inset-hover transition-colors"
            >
              ›
            </button>
            {selectedDate !== '' && (
              <button
                onClick={() => {
                  setSelectedDate('');
                  setHighlightCode(null);
                }}
                className="px-2 h-6 rounded-md text-[11px] font-medium text-up bg-up/10 hover:bg-up/20 transition-colors whitespace-nowrap"
              >
                今日
              </button>
            )}
          </div>

          {/* Sort control（核心功能，小屏也保留，随 header 换行） */}
          <div className="flex items-center gap-1 rounded-lg bg-inset border border-line p-0.5 shrink-0">
            {(
              [
                { key: 'time', label: '涨停时间' },
                { key: 'amount', label: '封单金额' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handleSort(key)}
                title={sortBy === key ? `切换${label}排序方向` : `按${label}排序`}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  sortBy === key
                    ? 'bg-up/15 text-up'
                    : 'text-ink2 hover:text-ink hover:bg-inset-hover'
                }`}
              >
                {label}
                <span
                  className={`text-[9px] leading-none transition-opacity ${sortBy === key ? 'opacity-100' : 'opacity-0'}`}
                >
                  {sortDir === 'asc' ? '▲' : '▼'}
                </span>
              </button>
            ))}
          </div>

          {/* Summary stats */}
          <div className="hidden md:flex items-center gap-4 shrink-0">
            <span className="flex items-baseline gap-1.5">
              <span className="text-xs text-ink2">涨停</span>
              <span className="text-base font-bold text-up font-mono leading-none">
                {summary ? summary.limitUpCount : '—'}
              </span>
            </span>
            <span className="w-px h-4 bg-line2" />
            <span className="flex items-baseline gap-1.5">
              <span className="text-xs text-ink2">跌停</span>
              <span className="text-base font-bold text-down font-mono leading-none">
                {summary ? (summary.limitDownCount ?? '—') : '—'}
              </span>
            </span>
            <span className="w-px h-4 bg-line2" />
            <span className="flex items-baseline gap-1.5">
              <span className="text-xs text-ink2">最高连板</span>
              <span className="text-base font-bold text-gold font-mono leading-none">
                {summary ? `${summary.maxBoardCount}板` : '—'}
              </span>
            </span>
            {/* 三大指数：上证 / 深证成指 / 创业板指 */}
            {indices.length > 0 && (
              <>
                <span className="w-px h-4 bg-line2" />
                {indices.map((idx) => (
                  <span key={idx.code} className="flex items-baseline gap-1.5" title={`${idx.name} ${idx.price.toFixed(2)}`}>
                    <span className="text-xs text-ink2">{idx.name}</span>
                    <span className={`text-sm font-bold font-mono leading-none ${idx.pct >= 0 ? 'text-up' : 'text-down'}`}>
                      {idx.price > 0 ? idx.price.toFixed(2) : '—'}
                    </span>
                    <span className={`text-[11px] font-mono ${idx.pct >= 0 ? 'text-up' : 'text-down'}`}>
                      {idx.pct >= 0 ? '+' : ''}{idx.pct.toFixed(2)}%
                    </span>
                  </span>
                ))}
              </>
            )}
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            aria-label="切换深浅色主题"
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-inset border border-line text-ink2 hover:text-ink hover:bg-inset-hover transition-colors"
          >
            {theme === 'dark' ? (
              // 太阳：当前深色，点击切浅色
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              // 月亮：当前浅色，点击切深色
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {/* 声音提醒开关（突破 350 日高时播放提示音） */}
          <button
            onClick={() => setSoundOn((s) => !s)}
            title={soundOn ? '声音提醒已开启：个股突破 350 日高时播放提示音（点击关闭）' : '声音提醒已关闭（点击开启）'}
            aria-label="切换声音提醒"
            aria-pressed={soundOn}
            className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-inset border transition-colors ${
              soundOn
                ? 'border-line text-ink2 hover:text-ink hover:bg-inset-hover'
                : 'border-line text-ink3 opacity-60 hover:opacity-100'
            }`}
          >
            {soundOn ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 5 6 9H2v6h4l5 4V5z" />
                <path d="m22 9-6 6" />
                <path d="m16 9 6 6" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* 历史日期无数据提示（非交易日或数据缺失） */}
      {!isRealtime && !loading && !fetchError && allEmpty && (
        <div className="shrink-0 bg-banner-warn border-b border-banner-warn-border text-banner-warn-text text-xs px-4 py-1.5 text-center">
          该日期暂无涨停数据（可能为非交易日，或当日数据尚未收录）
        </div>
      )}
      {fetchError && (
        <div className="shrink-0 bg-banner-err border-b border-banner-err-border text-banner-err-text text-xs px-4 py-1.5 text-center">
          数据加载失败，请稍后重试
        </div>
      )}

      {/* Main boards：宽屏五列均分；窄屏保持最小列宽、横向滚动（看板式） */}
      <div className="flex-1 flex overflow-x-auto overscroll-x-contain min-h-0 snap-x snap-proximity">
        <BoardColumn className="flex-1 basis-0 min-w-[250px] snap-start" title="首板 (1板)" sortBy={sortBy} highlightCode={highlightCode} onSelect={(code, name) => { setSelectedStock({ code, name }); setHighlightCode(null); }} {...splitByStatus(data.board1)} />
        <BoardColumn className="flex-1 basis-0 min-w-[250px] snap-start" title="2板" sortBy={sortBy} highlightCode={highlightCode} onSelect={(code, name) => { setSelectedStock({ code, name }); setHighlightCode(null); }} {...splitByStatus(data.board2)} />
        <BoardColumn className="flex-1 basis-0 min-w-[250px] snap-start" title="3板" sortBy={sortBy} highlightCode={highlightCode} onSelect={(code, name) => { setSelectedStock({ code, name }); setHighlightCode(null); }} {...splitByStatus(data.board3)} />
        <BoardColumn className="flex-1 basis-0 min-w-[250px] snap-start" title="4板" sortBy={sortBy} highlightCode={highlightCode} onSelect={(code, name) => { setSelectedStock({ code, name }); setHighlightCode(null); }} {...splitByStatus(data.board4)} />
        <BoardColumn className="flex-1 basis-0 min-w-[250px] snap-start" title="5板及以上" sortBy={sortBy} highlightCode={highlightCode} onSelect={(code, name) => { setSelectedStock({ code, name }); setHighlightCode(null); }} {...splitByStatus(data.boardHigher)} />
      </div>

      {/* 个股分时/K线弹窗 */}
      <StockChartModal
        stock={selectedStock}
        date={selectedDate || undefined}
        onClose={() => setSelectedStock(null)}
        onJumpToDate={handleJumpToDate}
      />
    </main>
  );
}

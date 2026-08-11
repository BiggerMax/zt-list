'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import BoardColumn from '@/components/BoardColumn';

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
  currentChange?: number; // 断板股当日涨幅（%）
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
  const [theme, setTheme] = useState<Theme>('dark');
  const fetchSeq = useRef(0); // 请求序号：丢弃过期响应，避免切换日期时旧数据覆盖新数据

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

  // 仅“今日”为实时轮询；历史日期为收盘静态数据，只拉一次
  const isRealtime = selectedDate === '' || (todayStr !== '' && selectedDate === todayStr);

  useEffect(() => {
    if (!todayStr) return;
    setLoading(true);
    fetchData(selectedDate);
    if (isRealtime) {
      const interval = setInterval(() => fetchData(selectedDate), 5000); // Refresh every 5 seconds
      return () => clearInterval(interval);
    }
  }, [selectedDate, todayStr, isRealtime, fetchData]);

  // 日期加减一天（不越过今天）
  const shiftDay = (delta: number) => {
    const base = selectedDate && selectedDate !== '' && selectedDate !== todayStr ? selectedDate : todayStr;
    const d = new Date(`${base}T12:00:00`);
    d.setDate(d.getDate() + delta);
    const next = d.toISOString().slice(0, 10);
    setSelectedDate(next > todayStr ? todayStr : next);
  };

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

  return (
    <main className="flex flex-col h-dvh bg-canvas text-ink overflow-hidden">
      {/* Header（窄窗口自动换行） */}
      <header className="border-b border-line bg-surface flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-3 h-3 rounded-full shrink-0 ${isRealtime ? 'bg-up animate-pulse' : 'bg-ink3'}`}></div>
          <h1 className="text-lg font-bold tracking-tight whitespace-nowrap">A股涨停梯队</h1>
          {!isRealtime && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-badge border border-line text-ink2 font-mono whitespace-nowrap">
              收盘数据
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
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
              onChange={(e) => setSelectedDate(e.target.value)}
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
                onClick={() => setSelectedDate('')}
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
          </div>

          {/* Last updated */}
          <span className="hidden lg:block w-px h-5 bg-line shrink-0" />
          <div className="hidden lg:flex text-xs text-ink3 font-mono items-center gap-1.5 min-w-0">
            {loading ? (
              <span>Loading...</span>
            ) : (
              <>
                <span className="px-1.5 py-0.5 rounded bg-inset border border-line text-[10px] text-ink2">
                  {isRealtime ? '实时' : '收盘'}
                </span>
                {!isRealtime && <span className="text-ink2">{dataDate || selectedDate}</span>}
                {isStale && <span className="text-amber-500/80">· 缓存</span>}
                {isRealtime && <span>Last updated: {lastUpdated}</span>}
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
        <BoardColumn className="flex-1 basis-0 min-w-[250px] snap-start" title="首板 (1板)" sortBy={sortBy} {...splitByStatus(data.board1)} />
        <BoardColumn className="flex-1 basis-0 min-w-[250px] snap-start" title="2板" sortBy={sortBy} {...splitByStatus(data.board2)} />
        <BoardColumn className="flex-1 basis-0 min-w-[250px] snap-start" title="3板" sortBy={sortBy} {...splitByStatus(data.board3)} />
        <BoardColumn className="flex-1 basis-0 min-w-[250px] snap-start" title="4板" sortBy={sortBy} {...splitByStatus(data.board4)} />
        <BoardColumn className="flex-1 basis-0 min-w-[250px] snap-start" title="5板及以上" sortBy={sortBy} {...splitByStatus(data.boardHigher)} />
      </div>
    </main>
  );
}

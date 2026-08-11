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
  const fetchSeq = useRef(0); // 请求序号：丢弃过期响应，避免切换日期时旧数据覆盖新数据

  useEffect(() => {
    setTodayStr(shanghaiToday());
  }, []);

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
    <main className="flex flex-col h-screen bg-[#121212] text-white overflow-hidden">
      {/* Header */}
      <header className="h-12 border-b border-[#333] bg-[#1a1a1a] flex items-center justify-between px-4 gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-3 h-3 rounded-full shrink-0 ${isRealtime ? 'bg-red-500 animate-pulse' : 'bg-[#555]'}`}></div>
          <h1 className="text-lg font-bold tracking-tight whitespace-nowrap">A股涨停梯队</h1>
          {!isRealtime && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#2a2a2a] border border-[#444] text-[#aaa] font-mono whitespace-nowrap">
              收盘数据
            </span>
          )}
        </div>

        {/* Date control */}
        <div className="flex items-center gap-1 rounded-lg bg-[#252525] border border-[#333] p-0.5 shrink-0">
          <button
            onClick={() => shiftDay(-1)}
            title="前一天"
            className="w-6 h-6 flex items-center justify-center rounded-md text-xs text-[#888] hover:text-[#ccc] hover:bg-[#2e2e2e] transition-colors"
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
            className="bg-transparent text-xs font-mono text-[#ccc] outline-none px-1 [color-scheme:dark] w-[7.5rem] text-center"
          />
          <button
            onClick={() => shiftDay(1)}
            title="后一天"
            className="w-6 h-6 flex items-center justify-center rounded-md text-xs text-[#888] hover:text-[#ccc] hover:bg-[#2e2e2e] transition-colors"
          >
            ›
          </button>
          {selectedDate !== '' && (
            <button
              onClick={() => setSelectedDate('')}
              className="px-2 h-6 rounded-md text-[11px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 transition-colors whitespace-nowrap"
            >
              今日
            </button>
          )}
        </div>

        {/* Sort control */}
        <div className="flex items-center gap-1 rounded-lg bg-[#252525] border border-[#333] p-0.5 shrink-0">
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
                  ? 'bg-red-500/15 text-red-400'
                  : 'text-[#888] hover:text-[#ccc] hover:bg-[#2e2e2e]'
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

        {/* Summary stats (左侧) + Last updated (右侧) */}
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-4">
            <span className="flex items-baseline gap-1.5">
              <span className="text-xs text-[#888]">涨停</span>
              <span className="text-base font-bold text-[#ff4d4f] font-mono leading-none">
                {summary ? summary.limitUpCount : '—'}
              </span>
            </span>
            <span className="w-px h-4 bg-[#444]" />
            <span className="flex items-baseline gap-1.5">
              <span className="text-xs text-[#888]">跌停</span>
              <span className="text-base font-bold text-[#3ecf7a] font-mono leading-none">
                {summary ? (summary.limitDownCount ?? '—') : '—'}
              </span>
            </span>
            <span className="w-px h-4 bg-[#444]" />
            <span className="flex items-baseline gap-1.5">
              <span className="text-xs text-[#888]">最高连板</span>
              <span className="text-base font-bold text-[#e8b64c] font-mono leading-none">
                {summary ? `${summary.maxBoardCount}板` : '—'}
              </span>
            </span>
          </div>
          <span className="w-px h-5 bg-[#333]" />
          <div className="text-xs text-[#666] font-mono flex items-center gap-1.5 min-w-0">
            {loading ? (
              <span>Loading...</span>
            ) : (
              <>
                <span className="px-1.5 py-0.5 rounded bg-[#252525] border border-[#333] text-[10px] text-[#999]">
                  {isRealtime ? '实时' : '收盘'}
                </span>
                {!isRealtime && <span className="text-[#aaa]">{dataDate || selectedDate}</span>}
                {isStale && <span className="text-amber-500/80">· 缓存</span>}
                {isRealtime && <span>Last updated: {lastUpdated}</span>}
              </>
            )}
          </div>
        </div>
      </header>

      {/* 历史日期无数据提示（非交易日或数据缺失） */}
      {!isRealtime && !loading && !fetchError && allEmpty && (
        <div className="shrink-0 bg-[#2a2318] border-b border-[#4a3d1f] text-[#d8b45a] text-xs px-4 py-1.5 text-center">
          该日期暂无涨停数据（可能为非交易日，或当日数据尚未收录）
        </div>
      )}
      {fetchError && (
        <div className="shrink-0 bg-[#2a1a1a] border-b border-[#4a2a2a] text-[#e08585] text-xs px-4 py-1.5 text-center">
          数据加载失败，请稍后重试
        </div>
      )}

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-5 auto-rows-fr divide-x divide-[#333] min-h-0">
        <BoardColumn title="首板 (1板)" sortBy={sortBy} {...splitByStatus(data.board1)} />
        <BoardColumn title="2板" sortBy={sortBy} {...splitByStatus(data.board2)} />
        <BoardColumn title="3板" sortBy={sortBy} {...splitByStatus(data.board3)} />
        <BoardColumn title="4板" sortBy={sortBy} {...splitByStatus(data.board4)} />
        <BoardColumn title="5板及以上" sortBy={sortBy} {...splitByStatus(data.boardHigher)} />
      </div>
    </main>
  );
}

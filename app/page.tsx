'use client';

import React, { useEffect, useState } from 'react';
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
  currentChange?: number; // 断板股当前实时涨幅（%）
}

interface BoardData {
  board1: Stock[];
  board2: Stock[];
  board3: Stock[];
  board4: Stock[];
  boardHigher: Stock[];
}

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

  const fetchData = async () => {
    try {
      const res = await fetch('/api/limit-up');
      if (!res.ok) throw new Error('Failed to fetch');
      const jsonData = await res.json();
      setData(jsonData);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
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

  // 拆分涨停股与断板股：涨停股按当前排序规则，断板股按实时涨幅从高到低（缺涨幅的排最后）
  const splitByStatus = (stocks: Stock[]) => {
    const limitUp = stocks.filter((s) => !s.isZhaBan);
    const zhaBan = stocks.filter((s) => s.isZhaBan);
    return {
      limitUp: sortStocks(limitUp),
      zhaBan: [...zhaBan].sort((a, b) => (b.currentChange ?? -Infinity) - (a.currentChange ?? -Infinity)),
    };
  };

  return (
    <main className="flex flex-col h-screen bg-[#121212] text-white overflow-hidden">
      {/* Header */}
      <header className="h-12 border-b border-[#333] bg-[#1a1a1a] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>
          <h1 className="text-lg font-bold tracking-tight">A股涨停梯队</h1>
        </div>
        {/* Sort control */}
        <div className="flex items-center gap-1 rounded-lg bg-[#252525] border border-[#333] p-0.5">
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
        <div className="text-xs text-[#666] font-mono">
          {loading ? 'Loading...' : `Last updated: ${lastUpdated}`}
        </div>
      </header>

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

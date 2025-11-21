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
  changePercent: number;
  limitCount: number;
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

  return (
    <main className="flex flex-col h-screen bg-[#121212] text-white overflow-hidden">
      {/* Header */}
      <header className="h-12 border-b border-[#333] bg-[#1a1a1a] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"></div>
          <h1 className="text-lg font-bold tracking-tight">A股涨停梯队</h1>
        </div>
        <div className="text-xs text-[#666] font-mono">
          {loading ? 'Loading...' : `Last updated: ${lastUpdated}`}
        </div>
      </header>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-5 divide-x divide-[#333] min-h-0">
        <BoardColumn title="首板 (1板)" stocks={data.board1} />
        <BoardColumn title="2板" stocks={data.board2} />
        <BoardColumn title="3板" stocks={data.board3} />
        <BoardColumn title="4板" stocks={data.board4} />
        <BoardColumn title="5板及以上" stocks={data.boardHigher} />
      </div>
    </main>
  );
}

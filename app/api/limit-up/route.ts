import { NextResponse } from 'next/server';

export const runtime = 'edge'; // Use Edge Runtime for Cloudflare
export const dynamic = 'force-dynamic'; // Disable caching

interface StockData {
  c: string; // Code
  m: number; // Market
  n: string; // Name
  p: number; // Price * 1000
  zdp: number; // Change percent
  lbc: number; // Limit board count
  fbt: number; // First board time (HHMMSS)
  lbt: number; // Last board time
  fund: number; // Sealed fund
  hybk: string; // Industry/Reason
}

interface EastMoneyResponse {
  data: {
    pool: StockData[];
  };
}

export async function GET() {
  try {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;

    // East Money API URL
    // ut: User Token (common public token)
    // dpt: Data point type (wz.ztzt = limit up pool)
    const apiUrl = `http://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=1000&sort=fbt:asc&date=${dateStr}`;

    const response = await fetch(apiUrl, {
      headers: {
        'Referer': 'http://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      next: { revalidate: 0 }
    });

    if (!response.ok) {
      throw new Error(`East Money API error: ${response.statusText}`);
    }

    const data = await response.json();
    const pool: StockData[] = data.data?.pool || [];

    // Fetch detailed concepts for all stocks
    // We use a concurrency limit to avoid overwhelming the API
    const detailedStocks = await fetchDetailedConcepts(pool);

    // Categorize stocks
    const result = {
      board1: [] as any[],
      board2: [] as any[],
      board3: [] as any[],
      board4: [] as any[],
      boardHigher: [] as any[],
    };

    detailedStocks.forEach((stock) => {
      const item = {
        code: stock.c,
        name: stock.n,
        price: stock.p / 1000,
        changePercent: stock.zdp,
        time: formatTime(stock.fbt),
        reason: stock.hybk,
        detailedReason: stock.detailedReason, // New field
        amount: formatAmount(stock.fund),
        limitCount: stock.lbc,
      };

      if (stock.lbc === 1) {
        result.board1.push(item);
      } else if (stock.lbc === 2) {
        result.board2.push(item);
      } else if (stock.lbc === 3) {
        result.board3.push(item);
      } else if (stock.lbc === 4) {
        result.board4.push(item);
      } else if (stock.lbc >= 5) {
        result.boardHigher.push(item);
      }
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching limit up data:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}

async function fetchDetailedConcepts(pool: StockData[]): Promise<(StockData & { detailedReason?: string })[]> {
  const CONCURRENCY_LIMIT = 10;
  const results: (StockData & { detailedReason?: string })[] = [];

  // Helper to fetch single stock detail
  const fetchDetail = async (stock: StockData) => {
    try {
      const secid = `${stock.m}.${stock.c}`;
      const url = `http://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f129`;
      const res = await fetch(url, {
        headers: {
          'Referer': 'http://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        next: { revalidate: 60 } // Cache details for 1 minute as concepts don't change often
      });
      const json = await res.json();
      const concepts = json.data?.f129 || '';
      return { ...stock, detailedReason: concepts };
    } catch (e) {
      console.error(`Failed to fetch details for ${stock.c}`, e);
      return { ...stock, detailedReason: '' };
    }
  };

  // Process in chunks
  for (let i = 0; i < pool.length; i += CONCURRENCY_LIMIT) {
    const chunk = pool.slice(i, i + CONCURRENCY_LIMIT);
    const chunkResults = await Promise.all(chunk.map(fetchDetail));
    results.push(...chunkResults);
  }

  return results;
}

function formatTime(timeNum: number): string {
  // timeNum is like 92500 (09:25:00) or 142136 (14:21:36)
  const str = String(timeNum).padStart(6, '0');
  return `${str.slice(0, 2)}:${str.slice(2, 4)}:${str.slice(4, 6)}`;
}

function formatAmount(amount: number): string {
  // amount is in Yuan
  if (amount >= 100000000) {
    return (amount / 100000000).toFixed(2) + '亿';
  } else if (amount >= 10000) {
    return (amount / 10000).toFixed(0) + '万';
  }
  return String(amount);
}

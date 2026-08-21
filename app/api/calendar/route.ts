import { NextResponse } from 'next/server';
import { fuyaoGet } from '@/lib/fuyao';

// 交易日历代理：返回近一年 A 股交易日（升序，YYYY-MM-DD）
// 替代前端「跳周末暴力探测」——同花顺日历精确包含节假日信息

export const dynamic = 'force-dynamic';

// 日历一天最多变化一次：缓存到自然日结束
let cache: { day: string; dates: string[] } | null = null;

export async function GET() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  if (cache && cache.day === today) {
    return NextResponse.json({ dates: cache.dates, date: today });
  }

  try {
    const data = await fuyaoGet<{ item?: { date_ms: number; date: string }[] }>(
      '/api/a-share/calendar/trading-days',
      undefined,
      10_000,
    );
    const dates = (data.item ?? [])
      .map((it) => {
        const s = String(it.date ?? '');
        // 接口原始格式 yyyyMMdd → YYYY-MM-DD
        return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
      })
      .filter(Boolean);
    if (dates.length === 0) throw new Error('empty trading days');
    cache = { day: today, dates };
    return NextResponse.json({ dates, date: today });
  } catch (error) {
    console.error('Calendar proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch trading calendar' }, { status: 502 });
  }
}

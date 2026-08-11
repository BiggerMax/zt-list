import React from 'react';

interface StockCardProps {
    code?: string;
    name: string;
    time: string;
    reason: string;
    detailedReason?: string;
    amount: string;
    bigOrderNet: number;
    bigOrderNetText: string;
    turnoverText?: string;   // 成交额（格式化，如 2.45亿）
    ltszText?: string;       // 流通值（格式化，如 36.99亿）
    turnoverRate?: number;   // 换手率（%）
    isZhaBan?: boolean;       // 断板：上一交易日涨停、今日未涨停
    isFirstCard?: boolean;    // 是否为所在列的第一张卡片（其上方浮层会被滚动区裁剪，需改为显示在下方）
    currentChange?: number;   // 断板股当前实时涨幅（%）
    overHigh350?: boolean;    // 当日价突破前 350 日最高价 → 显示"新高"关注标记
    highlight?: 'time' | 'amount';
    /** 点击卡片（打开个股分时/K线弹窗） */
    onClick?: () => void;
    /** 看板跳转后高亮该股（金色描边） */
    isHighlighted?: boolean;
}

const StockCard: React.FC<StockCardProps> = ({
    code,
    name,
    time,
    reason,
    detailedReason,
    amount,
    bigOrderNet,
    bigOrderNetText,
    turnoverText,
    ltszText,
    turnoverRate,
    isZhaBan = false,
    isFirstCard = false,
    currentChange,
    overHigh350 = false,
    highlight,
    onClick,
    isHighlighted = false,
}) => {
    // 超大单净流入：正值（流入）红色、负值/零（流出）绿色
    return (
        <div
            id={code ? `stock-card-${code}` : undefined}
            onClick={onClick}
            title={onClick ? `查看 ${name} 分时/K线` : undefined}
            className={`p-3 rounded mb-2 group relative transition-all cursor-pointer hover:shadow-md active:scale-[0.99] ${
                isZhaBan
                    ? 'bg-card-zb border border-dashed border-card-zb-border hover:bg-card-zb-hover'
                    : 'bg-card-up border border-card-up-border hover:bg-card-up-hover'
            } ${isHighlighted ? 'ring-2 ring-gold shadow-[0_0_14px_rgba(232,182,76,0.45)]' : ''}`}
        >
            <div className="flex justify-between items-center mb-1">
                <div className="flex flex-col min-w-0">
                    {code && (
                        <span className="text-[10px] font-mono text-ink3 leading-tight">{code}</span>
                    )}
                    <span className={`text-base font-bold leading-tight ${isZhaBan ? 'text-ink2' : 'text-ink'}`}>{name}</span>
                    {/* 创新高贴纸：金色圆形符号，贴卡片左上角，不占卡片内布局 */}
                    {overHigh350 && (
                        <span
                            title="股价突破前 350 日最高价（前复权）"
                            aria-label="股价突破前 350 日最高价"
                            className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-gold text-white flex items-center justify-center border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.35)] rotate-12 transition-transform group-hover:rotate-6 z-[1]"
                        >
                            {/* 上升箭头：表示价格创新高 */}
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M12 19V5M5 12l7-7 7 7" />
                            </svg>
                        </span>
                    )}
                </div>
                <div className="flex items-baseline gap-1.5 shrink-0 ml-2">
                    {turnoverRate != null && (
                        <span className="text-[11px] font-mono text-ink3" title={`换手率 ${turnoverRate.toFixed(2)}%`}>
                            {turnoverRate.toFixed(2)}%
                        </span>
                    )}
                    <span className={`text-xs font-mono transition-colors ${highlight === 'time' ? 'text-up font-bold' : 'text-ink2'}`}>
                        {time}
                    </span>
                </div>
            </div>

            <div className="flex justify-between items-start text-xs">
                <div className="flex flex-col max-w-[62%] min-w-0">
                    <span className="text-ink font-medium truncate" title={reason}>
                        {reason}
                    </span>
                    {detailedReason && (
                        <span className="text-ink2 text-[11px] truncate mt-0.5" title={detailedReason}>
                            {detailedReason}
                        </span>
                    )}
                </div>

                {isZhaBan ? (
                    <div className="flex flex-col items-end ml-2 whitespace-nowrap shrink-0">
                        {currentChange != null ? (
                            <span className={`text-sm font-bold ${currentChange >= 0 ? 'text-up' : 'text-down'}`}>
                                {currentChange >= 0 ? '+' : ''}
                                {currentChange.toFixed(2)}%
                            </span>
                        ) : (
                            <span className="text-[10px] text-ink2">未涨停</span>
                        )}
                        <span className="text-[10px] text-khaki mt-0.5">昨涨停</span>
                    </div>
                ) : (
                    <div className="flex flex-col items-end ml-2 whitespace-nowrap shrink-0">
                        <div className="flex items-baseline gap-1.5">
                            <span className={`text-[11px] ${bigOrderNet > 0 ? 'text-up' : bigOrderNet < 0 ? 'text-down' : 'text-ink3'}`}>
                                特大单 {bigOrderNet > 0 ? `+${bigOrderNetText}` : bigOrderNet < 0 ? bigOrderNetText : '—'}
                            </span>
                            <span className="text-ink3 select-none">·</span>
                            <span className={`text-up transition-all ${highlight === 'amount' ? 'font-bold' : 'font-medium'}`}>
                                {amount}
                            </span>
                        </div>
                        {(turnoverText || ltszText) && (
                            <span className="text-[11px] mt-0.5 text-ink3" title={`成交额${turnoverText} 流通值${ltszText}`}>
                                {[turnoverText, ltszText].filter(Boolean).join('·')}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {/* 涨停原因详情浮层：默认显示在卡片上方；列内第一张卡片上方会被滚动区裁剪，故显示在下方 */}
            {detailedReason && (
                <div className={`absolute left-0 w-64 p-2 bg-tip border border-tip-border text-xs text-tip-text rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 hidden group-hover:block ${
                    isFirstCard ? 'top-full mt-2' : 'bottom-full mb-2'
                }`}>
                    <div className="font-bold mb-1 text-tip-title">{reason}</div>
                    <div>{detailedReason}</div>
                </div>
            )}
        </div>
    );
};

export default StockCard;

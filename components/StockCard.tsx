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
    isZhaBan?: boolean;       // 断板：上一交易日涨停、今日未涨停
    isFirstCard?: boolean;    // 是否为所在列的第一张卡片（其上方浮层会被滚动区裁剪，需改为显示在下方）
    currentChange?: number;   // 断板股当前实时涨幅（%）
    highlight?: 'time' | 'amount';
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
    isZhaBan = false,
    isFirstCard = false,
    currentChange,
    highlight,
}) => {
    // 超大单净流入：正值（流入）红色、负值/零（流出）绿色
    return (
        <div
            className={`p-3 rounded mb-2 group relative transition-all cursor-pointer hover:shadow-md active:scale-[0.99] ${
                isZhaBan
                    ? 'bg-card-zb border border-dashed border-card-zb-border hover:bg-card-zb-hover'
                    : 'bg-card-up border border-card-up-border hover:bg-card-up-hover'
            }`}
        >
            <div className="flex justify-between items-center mb-1">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-base font-bold truncate ${isZhaBan ? 'text-ink2' : 'text-ink'}`}>{name}</span>
                    {code && (
                        <span className="text-[11px] font-mono text-ink3 shrink-0">{code}</span>
                    )}
                </div>
                <span className={`text-xs font-mono transition-colors shrink-0 ml-2 ${highlight === 'time' ? 'text-up font-bold' : 'text-ink2'}`}>
                    {time}
                </span>
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
                        <span className={`text-up transition-all ${highlight === 'amount' ? 'font-bold' : 'font-medium'}`}>
                            {amount}
                        </span>
                        <span className={`text-[11px] mt-0.5 ${bigOrderNet > 0 ? 'text-up' : bigOrderNet < 0 ? 'text-down' : 'text-ink3'}`}>
                            特大单 {bigOrderNet > 0 ? `+${bigOrderNetText}` : bigOrderNet < 0 ? bigOrderNetText : '—'}
                        </span>
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

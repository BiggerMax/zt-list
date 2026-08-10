import React from 'react';

interface StockCardProps {
    name: string;
    time: string;
    reason: string;
    detailedReason?: string;
    amount: string;
    bigOrderNet: number;
    bigOrderNetText: string;
    isZhaBan?: boolean;       // 断板：上一交易日涨停、今日未涨停
    currentChange?: number;   // 断板股当前实时涨幅（%）
    highlight?: 'time' | 'amount';
}

const StockCard: React.FC<StockCardProps> = ({
    name,
    time,
    reason,
    detailedReason,
    amount,
    bigOrderNet,
    bigOrderNetText,
    isZhaBan = false,
    currentChange,
    highlight,
}) => {
    // 超大单净流入：正值（流入）红色、负值/零（流出）绿色
    const bigOrderPositive = bigOrderNet > 0;

    return (
        <div
            className={`p-3 rounded mb-2 group relative transition-colors cursor-pointer ${
                isZhaBan
                    ? 'bg-[#1f2a22] border border-dashed border-[#3d5a44] hover:bg-[#26352b]'
                    : 'bg-[#332222] border border-[#4d3030] hover:bg-[#3d2929]'
            }`}
        >
            <div className="flex justify-between items-center mb-1">
                <span className={`text-base font-bold ${isZhaBan ? 'text-[#9a9a9a]' : 'text-[#e0e0e0]'}`}>{name}</span>
                <span className={`text-xs font-mono transition-colors ${highlight === 'time' ? 'text-red-400 font-bold' : 'text-[#888]'}`}>
                    {time}
                </span>
            </div>

            <div className="flex justify-between items-start text-xs">
                <div className="flex flex-col max-w-[62%]">
                    <span className="text-[#e5e5e5] font-medium truncate" title={reason}>
                        {reason}
                    </span>
                    {detailedReason && (
                        <span className="text-[#a3a3a3] text-[11px] truncate mt-0.5" title={detailedReason}>
                            {detailedReason}
                        </span>
                    )}
                </div>

                {isZhaBan ? (
                    <div className="flex flex-col items-end ml-2 whitespace-nowrap shrink-0">
                        {currentChange != null ? (
                            <span className={`text-sm font-bold ${currentChange >= 0 ? 'text-[#ff4d4f]' : 'text-[#3ecf7a]'}`}>
                                {currentChange >= 0 ? '+' : ''}
                                {currentChange.toFixed(2)}%
                            </span>
                        ) : (
                            <span className="text-[10px] text-[#888]">未涨停</span>
                        )}
                        <span className="text-[10px] text-[#a08b3c] mt-0.5">昨涨停</span>
                    </div>
                ) : (
                    <div className="flex flex-col items-end ml-2 whitespace-nowrap shrink-0">
                        <span className={`text-[#ff4d4f] transition-all ${highlight === 'amount' ? 'font-bold' : 'font-medium'}`}>
                            {amount}
                        </span>
                        <span className={`text-[11px] mt-0.5 ${bigOrderNet > 0 ? 'text-[#ff4d4f]' : bigOrderNet < 0 ? 'text-[#3ecf7a]' : 'text-[#666]'}`}>
                            特大单 {bigOrderNet > 0 ? `+${bigOrderNetText}` : bigOrderNet < 0 ? bigOrderNetText : '—'}
                        </span>
                    </div>
                )}
            </div>

            {/* Tooltip for full detailed reason */}
            {detailedReason && (
                <div className="absolute left-0 bottom-full mb-2 w-64 p-2 bg-[#333] border border-[#444] text-xs text-gray-300 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 hidden group-hover:block">
                    <div className="font-bold mb-1 text-white">{reason}</div>
                    <div>{detailedReason}</div>
                </div>
            )}
        </div>
    );
};

export default StockCard;

import React from 'react';

interface StockCardProps {
    name: string;
    time: string;
    reason: string;
    detailedReason?: string;
    amount: string;
    changePercent: number;
}

const StockCard: React.FC<StockCardProps> = ({ name, time, reason, detailedReason, amount, changePercent }) => {
    return (
        <div className="bg-[#252525] border border-[#333] p-3 rounded hover:bg-[#2a2a2a] transition-colors cursor-pointer mb-2 group relative">
            <div className="flex justify-between items-center mb-1">
                <span className="text-base font-bold text-[#e0e0e0]">{name}</span>
                <span className="text-xs text-[#888] font-mono">{time}</span>
            </div>

            <div className="flex justify-between items-center text-xs">
                <div className="flex flex-col max-w-[65%]">
                    <span className="text-[#e5e5e5] font-medium truncate" title={reason}>
                        {reason}
                    </span>
                    {detailedReason && (
                        <span className="text-[#a3a3a3] text-[11px] truncate mt-0.5" title={detailedReason}>
                            {detailedReason}
                        </span>
                    )}
                </div>
                <span className="text-[#ff4d4f] font-medium whitespace-nowrap ml-2">
                    {amount}
                </span>
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

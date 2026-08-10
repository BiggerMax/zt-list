import React from 'react';
import StockCard from './StockCard';

interface Stock {
    code: string;
    name: string;
    time: string;
    reason: string;
    detailedReason?: string;
    amount: string;
    isZhaBan: boolean;
    bigOrderNet: number;
    bigOrderNetText: string;
    currentChange?: number;
}

interface BoardColumnProps {
    title: string;
    limitUp: Stock[];
    zhaBan: Stock[];
    sortBy?: 'time' | 'amount';
}

const BoardColumn: React.FC<BoardColumnProps> = ({ title, limitUp, zhaBan, sortBy }) => {
    return (
        <div className="flex flex-col h-full min-h-0 bg-[#161616] border-r border-[#333] last:border-r-0">
            <div className="p-3 border-b border-[#333] bg-[#1a1a1a] sticky top-0 z-10">
                <div className="flex justify-between items-center">
                    <h2 className="text-sm font-bold text-[#ccc] uppercase tracking-wider">{title}</h2>
                    <span className="text-xs bg-[#333] text-[#888] px-2 py-0.5 rounded-full whitespace-nowrap">
                        {limitUp.length}
                        {zhaBan.length > 0 && <span className="text-[#a08b3c]"> / {zhaBan.length}断</span>}
                    </span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                {limitUp.map((stock) => (
                    <StockCard
                        key={stock.code}
                        name={stock.name}
                        time={stock.time}
                        reason={stock.reason}
                        detailedReason={stock.detailedReason}
                        amount={stock.amount}
                        bigOrderNet={stock.bigOrderNet}
                        bigOrderNetText={stock.bigOrderNetText}
                        currentChange={stock.currentChange}
                        highlight={sortBy}
                    />
                ))}

                {zhaBan.length > 0 && (
                    <>
                        <div className="flex items-center gap-1.5 mt-3 mb-1.5 px-1">
                            <span className="text-[10px] font-bold text-[#a08b3c] uppercase tracking-wider whitespace-nowrap">
                                未涨停 · 昨涨停
                            </span>
                            <div className="flex-1 h-px bg-[#3a3a3a]" />
                        </div>
                        {zhaBan.map((stock) => (
                            <StockCard
                                key={stock.code}
                                name={stock.name}
                                time={stock.time}
                                reason={stock.reason}
                                detailedReason={stock.detailedReason}
                                amount={stock.amount}
                                bigOrderNet={stock.bigOrderNet}
                                bigOrderNetText={stock.bigOrderNetText}
                                currentChange={stock.currentChange}
                                isZhaBan
                                highlight={sortBy}
                            />
                        ))}
                    </>
                )}

                {limitUp.length === 0 && zhaBan.length === 0 && (
                    <div className="text-center text-[#444] text-xs mt-10">
                        暂无数据
                    </div>
                )}
            </div>
        </div>
    );
};

export default BoardColumn;

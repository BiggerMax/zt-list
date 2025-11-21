import React from 'react';
import StockCard from './StockCard';

interface Stock {
    code: string;
    name: string;
    time: string;
    reason: string;
    detailedReason?: string;
    amount: string;
    changePercent: number;
}

interface BoardColumnProps {
    title: string;
    stocks: Stock[];
}

const BoardColumn: React.FC<BoardColumnProps> = ({ title, stocks }) => {
    return (
        <div className="flex flex-col h-full bg-[#161616] border-r border-[#333] last:border-r-0">
            <div className="p-3 border-b border-[#333] bg-[#1a1a1a] sticky top-0 z-10">
                <div className="flex justify-between items-center">
                    <h2 className="text-sm font-bold text-[#ccc] uppercase tracking-wider">{title}</h2>
                    <span className="text-xs bg-[#333] text-[#888] px-2 py-0.5 rounded-full">
                        {stocks.length}
                    </span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                {stocks.map((stock) => (
                    <StockCard
                        key={stock.code}
                        name={stock.name}
                        time={stock.time}
                        reason={stock.reason}
                        detailedReason={stock.detailedReason}
                        amount={stock.amount}
                        changePercent={stock.changePercent}
                    />
                ))}
                {stocks.length === 0 && (
                    <div className="text-center text-[#444] text-xs mt-10">
                        暂无数据
                    </div>
                )}
            </div>
        </div>
    );
};

export default BoardColumn;

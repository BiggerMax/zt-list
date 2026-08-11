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
    turnoverText?: string;
    ltszText?: string;
    turnoverRate?: number;
    currentChange?: number;
    overHigh350?: boolean;
}

interface BoardColumnProps {
    title: string;
    limitUp: Stock[];
    zhaBan: Stock[];
    sortBy?: 'time' | 'amount';
    /** 由父级控制列的弹性宽度（如 min-w 用于窄屏横向滚动） */
    className?: string;
    /** 点击个股卡片（打开分时/K线弹窗） */
    onSelect?: (code: string, name: string) => void;
    /** 需要高亮的个股代码（从K线双击跳转而来） */
    highlightCode?: string | null;
}

const BoardColumn: React.FC<BoardColumnProps> = ({ title, limitUp, zhaBan, sortBy, className, onSelect, highlightCode }) => {
    return (
        <div
            className={`flex flex-col h-full min-h-0 bg-surface2 border-r border-line last:border-r-0 ${className ?? ''}`}
        >
            <div className="p-3 border-b border-line bg-surface sticky top-0 z-10">
                <div className="flex justify-between items-center">
                    <h2 className="text-sm font-bold text-ink uppercase tracking-wider">{title}</h2>
                    <span className="text-xs bg-badge text-ink2 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {limitUp.length}
                        {zhaBan.length > 0 && <span className="text-khaki"> / {zhaBan.length}断</span>}
                    </span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                {limitUp.map((stock, i) => (
                    <StockCard
                        key={stock.code}
                        isFirstCard={i === 0}
                        code={stock.code}
                        name={stock.name}
                        time={stock.time}
                        reason={stock.reason}
                        detailedReason={stock.detailedReason}
                        amount={stock.amount}
                        bigOrderNet={stock.bigOrderNet}
                        bigOrderNetText={stock.bigOrderNetText}
                        turnoverText={stock.turnoverText}
                        ltszText={stock.ltszText}
                        turnoverRate={stock.turnoverRate}
                        currentChange={stock.currentChange}
                        overHigh350={stock.overHigh350}
                        highlight={sortBy}
                        isHighlighted={highlightCode === stock.code}
                        onClick={onSelect ? () => onSelect(stock.code, stock.name) : undefined}
                    />
                ))}

                {zhaBan.length > 0 && (
                    <>
                        <div className="flex items-center gap-1.5 mt-3 mb-1.5 px-1">
                            <span className="text-[10px] font-bold text-khaki uppercase tracking-wider whitespace-nowrap">
                                未涨停 · 昨涨停
                            </span>
                            <div className="flex-1 h-px bg-line" />
                        </div>
                        {zhaBan.map((stock, i) => (
                            <StockCard
                                key={stock.code}
                                isFirstCard={limitUp.length === 0 && i === 0}
                                code={stock.code}
                                name={stock.name}
                                time={stock.time}
                                reason={stock.reason}
                                detailedReason={stock.detailedReason}
                                amount={stock.amount}
                                bigOrderNet={stock.bigOrderNet}
                                bigOrderNetText={stock.bigOrderNetText}
                                turnoverText={stock.turnoverText}
                                ltszText={stock.ltszText}
                                turnoverRate={stock.turnoverRate}
                                currentChange={stock.currentChange}
                                overHigh350={stock.overHigh350}
                                isZhaBan
                                highlight={sortBy}
                                isHighlighted={highlightCode === stock.code}
                                onClick={onSelect ? () => onSelect(stock.code, stock.name) : undefined}
                            />
                        ))}
                    </>
                )}

                {limitUp.length === 0 && zhaBan.length === 0 && (
                    <div className="text-center text-ink3 text-xs mt-10">
                        暂无数据
                    </div>
                )}
            </div>
        </div>
    );
};

export default BoardColumn;

import React from 'react';

export interface MetricCardProps {
    label: string;
    value: string;
    sub: string;
    subColor?: string;
    isToken?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({ label, value, sub, subColor = "text-gray-500", isToken }) => (
    <div className="bg-white dark:bg-[#1e1e1e] p-6 rounded-3xl border border-gray-200 dark:border-[#333] shadow-sm flex flex-col justify-between h-32">
        <div className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">{label}</div>
        <div className="flex items-center justify-between mt-2">
            <div className="text-2xl font-black text-gray-900 dark:text-white">{value}</div>
            {isToken && <div className="w-8 h-8 rounded-full bg-[#845fbc]/20 flex items-center justify-center"><div className="w-4 h-4 rounded-full bg-[#845fbc]"></div></div>}
        </div>
        <div className={`text-xs font-bold mt-1 ${subColor}`}>{sub}</div>
    </div>
);

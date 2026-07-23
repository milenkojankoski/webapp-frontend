import React from 'react';
import type { StatRow } from '../../types';

interface PoolStatsTableProps {
  rows: StatRow[];
  showHeader?: boolean;
  variant?: 'minimal' | 'table';
}

export const PoolStatsTable: React.FC<PoolStatsTableProps> = ({ 
  rows, 
  showHeader = true, 
  variant = 'table' 
}) => {
  
  // Shared Container Styles: Card look, Neutral Dark Mode colors
  const containerClasses = "w-full bg-white dark:bg-[#1e1e1e] rounded-xl overflow-hidden shadow-md border border-gray-200 dark:border-[#333333] transition-colors";

  // --- DESIGN 1: MINIMALIST LIST (Card Container + Clean List) ---
  if (variant === 'minimal') {
    return (
      <div className={`${containerClasses} p-4 mb-6`}>
        <div className="flex flex-col gap-4">
          {rows.map(([label, value, colorClass], index) => (
            <div key={index} className="flex justify-between items-center group">
              {/* Label: Subtle Grey */}
              <div className="text-sm font-medium text-gray-500 dark:text-[#9ca3af]">
                {label}
              </div>
              {/* Value: Bright, Bold & High Contrast */}
              <div className={`text-sm font-bold ${colorClass || "text-gray-900 dark:text-[#f3f4f6]"}`}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- DESIGN 2: STRUCTURED TABLE (Card Container + Grid/Stripes) ---
  return (
    <div className={containerClasses}>
      <table className="w-full border-collapse">
        {showHeader && (
          <thead className="bg-gray-50 dark:bg-[#2a2a2a] border-b border-gray-200 dark:border-[#333333]">
            <tr>
              <th className="py-3 px-4 text-left font-semibold text-gray-700 dark:text-gray-300">Metric</th>
              <th className="py-3 px-4 text-left font-semibold text-gray-700 dark:text-gray-300">Value</th>
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map(([label, value, colorClass = "text-gray-900 dark:text-gray-100"], index) => (
            <tr 
              key={index} 
              className={
                index % 2 === 0 
                  ? "bg-white dark:bg-[#1e1e1e]" 
                  : "bg-gray-50 dark:bg-[#2a2a2a] hover:bg-gray-100 dark:hover:bg-[#333] transition duration-150"
              }
            >
              <td className="py-3 px-4 text-gray-600 dark:text-gray-400 font-medium w-1/2">{label}</td>
              <td className={`py-3 px-4 ${colorClass} font-semibold w-1/2`}>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
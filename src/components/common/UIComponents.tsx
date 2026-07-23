import React from 'react';
import type { StatsTimeFrame, ChartTimeFrame, SearchResult } from "../../types";
import { shortenAddress } from '../../utils/formatters';

// --- STATS TAB BAR ---
export const StatsTabBar: React.FC<{ active: StatsTimeFrame; onClick: (tf: StatsTimeFrame) => void }> = ({ active, onClick }) => {
  const timeframes: StatsTimeFrame[] = ["5m", "1h", "6h", "24h"];
  return (
    <div className="flex justify-center w-full max-w-lg mx-auto py-4">
      {/* ✅ FIXED: Neutral Dark Background (#2a2a2a) */}
      <div className="flex space-x-2 p-1 bg-gray-100 dark:bg-[#2a2a2a] rounded-lg shadow-inner transition-colors duration-300">
        {timeframes.map((tf) => (
          <button 
            key={tf} 
            onClick={() => onClick(tf)} 
            // ✅ FIXED: Text Colors & Neutral Hover States
            className={`px-4 py-2 text-sm font-semibold rounded-md transition duration-150 ${
                active === tf 
                ? "bg-[#845fbc] text-white shadow-md" 
                : "bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3f3f3f]"
            }`}
          >
            {tf.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
};

// --- CHART TAB BAR ---
export const ChartTabBar: React.FC<{ active: ChartTimeFrame; onClick: (tf: ChartTimeFrame) => void }> = ({ active, onClick }) => {
  const timeframes: ChartTimeFrame[] = ["1h", "1d", "1w", "1m", "1y"];
  return (
    // ✅ FIXED: Neutral Dark Background (#2a2a2a)
    <div className="flex space-x-2 p-1 bg-gray-100 dark:bg-[#2a2a2a] rounded-lg shadow-inner transition-colors duration-300">
        {timeframes.map((tf) => (
          <button 
            key={`chart-${tf}`} 
            onClick={() => onClick(tf)} 
            // ✅ FIXED: Text Colors & Neutral Hover States
            className={`px-4 py-2 text-sm font-semibold rounded-md transition duration-150 ${
                active === tf 
                ? "bg-[#845fbc] text-white shadow-md" 
                : "bg-transparent text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3f3f3f]"
            }`}
          >
            {tf.toUpperCase()}
          </button>
        ))}
    </div>
  );
};

// --- METRIC COMPONENTS ---
export const MetricTitle: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
    <div className="flex flex-col justify-center h-full">
      {/* ✅ FIXED: Label & Value Text Colors */}
      <span className="text-gray-600 dark:text-gray-400 font-medium">{label}</span>
      <span className="text-gray-900 dark:text-gray-100 font-semibold">{value.toLocaleString()}</span>
    </div>
);

export const MetricBar: React.FC<{ buyLabel: string; buyValue: number; sellLabel: string; sellValue: number }> = ({ buyLabel, buyValue, sellLabel, sellValue }) => {
  const total = buyValue + sellValue;
  const percent = total > 0 ? (buyValue / total) * 100 : 0;
  return (
    <div className="w-full flex flex-col justify-center h-full gap-1">
      <div className="flex justify-between items-end text-xs font-semibold">
        {/* ✅ FIXED: Text Colors for Labels & Numbers */}
        <div className="text-green-600 dark:text-green-400">
            {buyLabel}: <span className="text-gray-700 dark:text-gray-300">{buyValue.toLocaleString()}</span>
        </div>
        <div className="text-red-500 dark:text-red-400">
            {sellLabel}: <span className="text-gray-700 dark:text-gray-300">{sellValue.toLocaleString()}</span>
        </div>
      </div>
      <div className="w-full h-2 bg-red-400 dark:bg-red-500/80 rounded-full overflow-hidden flex">
        <div className="h-full bg-green-500 dark:bg-green-500/90" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};

// --- POOL SELECTOR ---
export const MatchingPoolsSelector: React.FC<{ pools: SearchResult[]; onSelect: (id: string) => void }> = ({ pools, onSelect }) => {
  if (pools.length === 0) return null;
  return (
    // ✅ FIXED: Container Background (#1e1e1e) & Text
    <div className="mb-8 p-4 bg-white dark:bg-[#1e1e1e] shadow-md rounded-xl transition-colors duration-300">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-3">Multiple pools found. Please select one:</h2>
      <ul className="space-y-2">
        {pools.map((p) => (
          // ✅ FIXED: List Item BG (#1e1e1e) Border (#333) & Hover (#2a2a2a)
          <li key={p.id} className="flex justify-between items-center p-3 bg-gray-50 dark:bg-[#1e1e1e] hover:bg-gray-100 dark:hover:bg-[#2a2a2a] rounded-lg border border-gray-200 dark:border-[#333333] transition-colors duration-300">
            <div>
              <div className="font-semibold text-gray-800 dark:text-gray-200">{p.pairedTokenSymbol}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">ID: {p.id} — Address: {shortenAddress(p.address)}</div>
            </div>
            <button type="button" onClick={() => onSelect(p.id)} className="px-3 py-1 text-sm font-semibold bg-[#845fbc] text-white rounded-md hover:bg-[#ab8bdc] transition">Select</button>
          </li>
        ))}
      </ul>
    </div>
  );
};
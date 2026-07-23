import React, { useEffect, useState, useMemo, useRef } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../config/firebase";
import { useWallet } from "../context/WalletContext";

import Chart from 'chart.js/auto';

// --- Interfaces ---

interface PlatformStats {
  tvlUSD: number;
  volume24hUSD: number;
  activePoolsCount: number;
  ktaPriceUSD?: number;
}

interface DashboardMetricsLaunchpad {
  winnerPool: {
    id: string;
    pairedTokenSymbol: string;
    priceChange24h: string;
  } | null;
  dexVolumeData: { labels: string[], data: number[] };
  speedyAlpacas: { id: string, pairedTokenSymbol: string, createdAtSeconds: number }[];
  tokensPerDayData: { labels: string[], data: number[] };
}

// --- Components ---

// --- Components ---

const MetricCard: React.FC<{
  title: string;
  value: string;
  subValue?: string;
  icon?: React.ReactNode;
  color?: string;
  onValueClick?: () => void;
  valueCursor?: string;
}> = ({ title, value, subValue, icon, color = "text-gray-900 dark:text-white", onValueClick, valueCursor }) => (
  <div className="bg-white dark:bg-[#1a1a1a] p-5 rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-sm relative overflow-hidden group transition-colors">
    <div className="flex justify-between items-start mb-2">
      <div>
        <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">{title}</p>
        <h3
          className={`text-[22px] font-semibold tracking-tight ${color} ${valueCursor || ''}`}
          onClick={onValueClick}
        >
          {value}
        </h3>
      </div>
      {icon && <div className="p-2 bg-gray-50 dark:bg-white/[0.04] rounded-lg text-gray-400 group-hover:text-[#845fbc] transition-colors">{icon}</div>}
    </div>
    {subValue && <p className="text-[12px] text-gray-400 dark:text-gray-500 font-medium">{subValue}</p>}
  </div>
);

// --- Chart Components ---

const BarChart: React.FC<{ labels: string[]; data: number[]; color: string; label: string; className?: string }> = ({ labels, data, color, label, className = "h-64" }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label,
          data,
          backgroundColor: color,
          borderRadius: 4,
          hoverBackgroundColor: color
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#6b7280', font: { size: 10 } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6b7280', font: { size: 10 } } }
        }
      }
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [labels, data, color, label]);

  return <div className={`w-full ${className}`}><canvas ref={canvasRef} /></div>;
};

const PieChart: React.FC<{ labels: string[]; data: number[]; colors: string[] }> = ({ labels, data, colors }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartRef.current = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 10 } }
        },
        cutout: '70%'
      }
    });

    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [labels, data, colors]);

  return <div className="h-48 w-full"><canvas ref={canvasRef} /></div>;
};


export const AlpaMetric: React.FC = () => {
  const { network } = useWallet();
  const [platformStats, setPlatformStats] = useState<PlatformStats>({ tvlUSD: 0, volume24hUSD: 0, activePoolsCount: 0 });
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetricsLaunchpad>({
    winnerPool: null,
    dexVolumeData: { labels: [], data: [] },
    speedyAlpacas: [],
    tokensPerDayData: { labels: [], data: [] }
  });
  const [loading, setLoading] = useState(true);
  const [showTVLinUSD, setShowTVLinUSD] = useState(true);
  const [showVolInUSD, setShowVolInUSD] = useState(true);

  // Fetch Pools & Platform Stats
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        // 1. Fetch Aggregated Metrics
        const statsRef = doc(db, "platform_stats", "metrics");
        const statsSnap = await getDoc(statsRef);
        if (statsSnap.exists()) {
          setPlatformStats(statsSnap.data() as PlatformStats);
        }

        // 2. Fetch Dashboard Analytics (Launchpad)
        const launchpadRef = doc(db, "platform_stats", "launchpad");
        const launchpadSnap = await getDoc(launchpadRef);
        if (launchpadSnap.exists()) {
          setDashboardMetrics(launchpadSnap.data() as DashboardMetricsLaunchpad);
        }

      } catch (e) {
        console.error("Failed to fetch platform metrics", e);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [network]);

  // --- Calculate Metrics ---
  const metrics = useMemo(() => {
    return {
      tvl: platformStats.tvlUSD, // Use Server Side Metric
      volume24h: platformStats.volume24hUSD, // Use Server Side Metric
      totalAlpacas: platformStats.activePoolsCount, // Use Server Side Metric
      winnerPool: dashboardMetrics.winnerPool
    };
  }, [platformStats, dashboardMetrics.winnerPool]);




  // Helper to format "time ago"
  const getTimeAgo = (timestampSeconds: number) => {
    if (!timestampSeconds) return "Unknown";
    const diffMs = Date.now() - timestampSeconds * 1000;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}d ago`;
    if (diffHours > 0) return `${diffHours}h ago`;
    if (diffMins > 0) return `${diffMins}m ago`;
    return "Just now";
  };

  // 3. Mock Graduation Data
  const graduationData = {
    labels: ['Graduated', 'Failed', 'Active'],
    data: [12, 5, 83], // Mock percentages
    colors: ['#14b8a6', '#eb6161ff', '#845fbc']
  };

  return (
    <div className="w-full min-h-screen transition-colors duration-300 p-4 lg:p-8 pt-8 md:pt-8">
      <div className="max-w-7xl mx-auto animate-fade-in space-y-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-900 dark:text-white">Ecosystem Metrics</h1>
            <p className="text-[15px] text-gray-500 dark:text-gray-400">Real-time pulse of the Alpaca Protocol.</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-white dark:bg-[#2a2a2a] rounded-full border border-gray-200 dark:border-white/[0.08] shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">Live Updates</span>
          </div>
        </div>

        {loading ? (
          <div className="min-h-[60vh] flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-4 border-[#845fbc] border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-gray-400 dark:text-gray-500 animate-pulse">Aggregating ecosystem data...</p>
          </div>
        ) : (
          <>
            {/* --- GOD MODE ROW --- */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                title="Total Value Locked"
                value={
                  showTVLinUSD
                    ? metrics.tvl.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
                    : `${(metrics.tvl / (platformStats.ktaPriceUSD || 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })} KTA`
                }
                subValue={showTVLinUSD ? "Click to see in KTA" : "Click to see in USD"}
                icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
                onValueClick={() => setShowTVLinUSD(!showTVLinUSD)}
                valueCursor="cursor-pointer hover:text-purple-500 transition-colors select-none"
              />
              <MetricCard
                title="Volume (24h)"
                value={
                  showVolInUSD
                    ? metrics.volume24h.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
                    : `${(metrics.volume24h / (platformStats.ktaPriceUSD || 1)).toLocaleString(undefined, { maximumFractionDigits: 0 })} KTA`
                }
                subValue={showVolInUSD ? "Click to see in KTA" : "Click to see in USD"}
                color="text-[#845fbc]"
                icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>}
                onValueClick={() => setShowVolInUSD(!showVolInUSD)}
                valueCursor="cursor-pointer hover:text-purple-500 transition-colors select-none"
              />
              <MetricCard
                title="Alpacas Born"
                value={metrics.totalAlpacas.toString()}
                subValue="Total Tokens Created"
                icon={<svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>}
              />
              {metrics.winnerPool && (
                <div className="bg-gradient-to-br from-[#845fbc] to-[#6d44a8] p-5 rounded-xl shadow-lg relative overflow-hidden group text-white">
                  <div className="absolute top-0 right-0 p-4 opacity-20"><svg className="w-16 h-16" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.699-3.181a1 1 0 111.751 1.031l-1.874 3.501c.666 1.636 2.293 2.866 2.408 2.953a1 1 0 11-1.229 1.565c-.092-.073-1.464-1.201-2.222-2.583l-2.035 3.805a1 1 0 01-1.767-.93l1.874-3.502-3.808-1.523V16a1 1 0 01-2 0V5.923L2.747 7.447A1 1 0 011.96 6.31l3.954-1.582V3a1 1 0 011-1z" clipRule="evenodd" /></svg></div>
                  <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-purple-200 mb-1">Gainer of the Day</p>
                  <h3 className="text-2xl font-bold font-heading">{metrics.winnerPool.pairedTokenSymbol}</h3>
                  <p className="text-lg font-mono font-medium">+{(parseFloat(metrics.winnerPool.priceChange24h || "0") * 100).toFixed(2)}%</p>
                </div>
              )}
            </div>

            {/* --- LAUNCHPAD ZONE --- */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Tokens Created Chart */}
              <div className="lg:col-span-2 bg-white dark:bg-[#1a1a1a] p-6 rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-sm flex flex-col">
                <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#845fbc]"></span> Launchpad Activity (Tokens/Day)
                </h3>
                <div className="flex-1 w-full relative min-h-[16rem]">
                  <BarChart label="Tokens Created" labels={dashboardMetrics.tokensPerDayData.labels} data={dashboardMetrics.tokensPerDayData.data} color="#845fbc" className="absolute inset-0 h-full" />
                </div>
              </div>

              {/* Graduation Stats */}
              <div className="space-y-6">
                <div className="bg-white dark:bg-[#1a1a1a] p-6 rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-sm">
                  <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-4">Graduation Rate</h3>
                  <PieChart labels={graduationData.labels} data={graduationData.data} colors={graduationData.colors} />
                  <div className="mt-4 text-center text-xs text-gray-400 italic">* Simulated Data</div>
                </div>

                {/* Speedy Alpacas Live Data */}
                <div className="bg-white dark:bg-[#1a1a1a] p-6 rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-sm">
                  <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    Speedy Alpacas
                  </h3>
                  <div className="space-y-3">
                    {dashboardMetrics.speedyAlpacas.length > 0 ? (
                      dashboardMetrics.speedyAlpacas.map((pool) => (
                        <div key={pool.id} className="flex justify-between items-center text-[13px]">
                          <span className="font-semibold text-gray-700 dark:text-gray-200 truncate max-w-[150px]">
                            {pool.pairedTokenSymbol || "Unknown"}
                          </span>
                          <span className="font-mono text-amber-500 font-semibold whitespace-nowrap">
                            {getTimeAgo(pool.createdAtSeconds)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-gray-500 text-center py-2">No active fundraisers</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* --- DEX ZONE --- */}
            <div className="bg-white dark:bg-[#1a1a1a] p-6 rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-sm">
              <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-teal-500"></span> Top DEX Volume (24h)
              </h3>
              <BarChart label="Volume (KTA)" labels={dashboardMetrics.dexVolumeData.labels} data={dashboardMetrics.dexVolumeData.data} color="#14b8a6" />
            </div>
          </>
        )}

      </div>
    </div>
  );
};

export default AlpaMetric;

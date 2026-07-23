import React, { useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CreatePoolForm } from "../components/launchpad/CreatePoolForm";
import { PriceChart, type ChartDataPoint } from "../components/charts/BondingCurveChart";
import {
    calculateLaunchSplit,
    calculateLaunchPrices,
    calculateSpotPrice,
    BondingCurve
} from "../utils/launchpadMath";
import { formatNumber, formatCurrency } from "../utils/formatters";

type TabType = 'sandbox' | 'create';

export const LaunchpadPage: React.FC = () => {
    const { tab } = useParams<{ tab?: string }>();
    const navigate = useNavigate();

    const activeTab: TabType = (tab === 'sandbox' || tab === 'create') ? tab : 'create';

    // --- ARCHITECT STATE ---
    const [totalSupply, setTotalSupply] = useState(1000000);
    const [launchPercent, setLaunchPercent] = useState(50);
    const [targetLiquidity, setTargetLiquidity] = useState(1500);
    const [teamSplitPercent, setTeamSplitPercent] = useState(20);
    const [curveType, setCurveType] = useState('Sigmoid');
    const [premiumPercent, setPremiumPercent] = useState(0);
    const [showPublicAllocInfo, setShowPublicAllocInfo] = useState(false);
    const [showPremiumInfo, setShowPremiumInfo] = useState(false);
    const [showTeamSplitInfo, setShowTeamSplitInfo] = useState(false);

    const launchTokens = useMemo(() => totalSupply * (launchPercent / 100), [totalSupply, launchPercent]);

    // --- ARCHITECT LOGIC ---
    const architectLaunchPercentage = launchPercent;
    const architectIsLaunchAllocationLow = architectLaunchPercentage < 10;
    const architectIsLiquidityInvalid = targetLiquidity < 1500;

    const MATH_DECIMALS = 18;
    const SCALE = 10 ** MATH_DECIMALS;

    const { saleTokens, poolTokens } = useMemo(() => {
        const split = calculateLaunchSplit(
            BigInt(Math.floor(launchTokens)),
            teamSplitPercent / 100,
            curveType.toLowerCase() as BondingCurve,
            premiumPercent / 100
        );
        return {
            saleTokens: Number(split.saleTokens),
            poolTokens: Number(split.poolTokens)
        };
    }, [launchTokens, teamSplitPercent, curveType, premiumPercent]);

    const { listingPriceNum, averagePriceNum, startPriceNum } = useMemo(() => {
        if (poolTokens <= 0) return { listingPriceNum: 0, averagePriceNum: 0, startPriceNum: 0 };
        try {
            const prices = calculateLaunchPrices(
                BigInt(Math.floor(targetLiquidity)),
                BigInt(Math.floor(poolTokens)),
                curveType.toLowerCase() as BondingCurve,
                premiumPercent / 100,
                MATH_DECIMALS
            );
            return {
                listingPriceNum: Number(prices.listingPrice) / SCALE,
                averagePriceNum: Number(prices.avg) / SCALE,
                startPriceNum: Number(prices.startPrice) / SCALE,
            };
        } catch (e) {
            console.error(e);
            return { listingPriceNum: 0, averagePriceNum: 0, startPriceNum: 0 };
        }
    }, [targetLiquidity, poolTokens, curveType, premiumPercent]);

    const expectedTotalRaise = saleTokens * averagePriceNum;
    const teamFunds = targetLiquidity * (teamSplitPercent / 100);
    const baseInLP = expectedTotalRaise - teamFunds;

    const architectGraphData = useMemo(() => {
        const points = 100;
        const data: ChartDataPoint[] = [];
        for (let i = 0; i <= points; i++) {
            const progress = i / points;
            const currentTokensSold = saleTokens * progress;
            let currentPriceNum = 0;

            try {
                const priceBigInt = calculateSpotPrice(
                    curveType.toLowerCase() as BondingCurve,
                    BigInt(Math.floor(startPriceNum * SCALE)),
                    BigInt(Math.floor(expectedTotalRaise)),
                    BigInt(Math.floor(saleTokens)),
                    BigInt(Math.floor(currentTokensSold)),
                    MATH_DECIMALS
                );
                currentPriceNum = Number(priceBigInt) / SCALE;
            } catch (e) {
                currentPriceNum = averagePriceNum;
            }

            data.push({ tokensSold: currentTokensSold, price: currentPriceNum });
        }
        return data;
    }, [saleTokens, startPriceNum, expectedTotalRaise, curveType, averagePriceNum]);

    // --- RENDER ---

    // Tab bar shared across views
    const tabTitles: Record<TabType, string> = {
        sandbox: 'Sandbox',
        create: 'Create Token',
    };

    const TabBar: React.FC<{ current: TabType }> = ({ current }) => (
        <div className="flex gap-0">
            <button
                onClick={() => navigate(`/launchpad/create`)}
                className={`px-4 pb-3 text-[13px] font-semibold transition-colors border-b-2 ${current === 'create'
                    ? 'border-[#845fbc] text-gray-900 dark:text-white'
                    : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
            >
                Create Token
            </button>
            <button
                onClick={() => navigate(`/launchpad/sandbox`)}
                className={`px-4 pb-3 text-[13px] font-semibold transition-colors border-b-2 ${current === 'sandbox'
                    ? 'border-[#845fbc] text-gray-900 dark:text-white'
                    : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
            >
                Sandbox
            </button>
        </div>
    );

    const PageHeader: React.FC<{ current: TabType; maxWidth?: string }> = ({ current, maxWidth = 'max-w-7xl' }) => (
        <div className={`flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 w-full ${maxWidth}`}>
            <div className="flex flex-col items-center md:items-start text-center md:text-left">
                <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white">{tabTitles[current]}</h1>
            </div>
            <div className="flex justify-center">
                <TabBar current={current} />
            </div>
        </div>
    );

    if (activeTab === 'sandbox') {
        return (
            <div className="w-full min-h-screen transition-colors duration-300 pt-8 md:pt-8 p-4 lg:p-8">
                <div className="w-full flex flex-col items-center justify-start animate-fade-in">
                    <PageHeader current="sandbox" />
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full max-w-7xl animate-fade-in">
                        {/* Controls (Left) */}
                        <div className="lg:col-span-4 space-y-6">
                            <div className="glass-panel p-8 relative overflow-hidden">
                                <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-6 flex items-center gap-2">Parameters</h2>

                                <div className="space-y-6">
                                    {/* Curve Type */}
                                    <div>
                                        <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2 block">Bonding Curve Model</label>
                                        <div className="relative">
                                            <select value={curveType} onChange={(e) => setCurveType(e.target.value)} className="w-full p-3 pr-10 rounded-md appearance-none cursor-pointer font-mono text-sm bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white focus:outline-none focus:border-[#845fbc] hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
                                                <option value="Sigmoid">Balanced</option>
                                                <option value="Exponential">Rapid</option>
                                                <option value="Fixed">Static</option>
                                            </select>
                                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 dark:text-gray-400">
                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                                                </svg>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Total Supply */}
                                    <div>
                                        <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2 block">Total Supply</label>
                                        <input type="number" value={totalSupply} onChange={(e) => setTotalSupply(Number(e.target.value))} className="w-full p-3 rounded-md font-mono text-sm bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white focus:outline-none focus:border-[#845fbc]" />
                                    </div>

                                    {/* Launch Allocation */}
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-2">
                                                <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 block">Public Allocation (%)</label>
                                                <button onClick={() => setShowPublicAllocInfo(!showPublicAllocInfo)} className="text-gray-400 hover:text-teal-500 transition-colors" title="Info">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                </button>
                                            </div>
                                            <span className="text-[10px] px-2 py-0.5 rounded border bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 border-teal-200 dark:border-teal-800">{launchPercent}% of Supply</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="1"
                                            max="100"
                                            value={launchPercent}
                                            onChange={(e) => setLaunchPercent(Number(e.target.value))}
                                            className="w-full mb-2 slider-teal-purple-track"
                                            style={{ '--track-bg': `linear-gradient(to right, #14b8a6 ${((launchPercent - 1) / 99) * 100}%, rgba(132, 95, 188, 0.2) ${((launchPercent - 1) / 99) * 100}%)` } as React.CSSProperties}
                                        />
                                        <div className="flex justify-between items-center mt-1">
                                            <div className="text-xs font-mono text-gray-500">{formatNumber(launchTokens)} Tokens</div>
                                            <div className={`text-xs text-right font-mono font-bold ${architectIsLaunchAllocationLow ? "text-amber-500" : "text-teal-500"}`}>
                                                {architectIsLaunchAllocationLow && "Low Allocation Warning"}
                                            </div>
                                        </div>
                                        {showPublicAllocInfo && (
                                            <div className="mt-4 p-3 rounded-lg border border-teal-200/50 dark:border-teal-800/30 bg-teal-50/50 dark:bg-teal-900/10 flex items-start gap-3 shadow-sm animate-fade-in transition-all">
                                                <svg className="w-4 h-4 text-teal-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <p className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                                                    This portion of the token supply is dedicated to the Launch Phase and the Liquidity Pool. The rest is sent directly to the token creator's wallet.
                                                    The optimal split between the Launch & Liquidity Pool is calculated dynamically by the protocol to ensure healthy initial liquidity depth and perfectly align the end of the bonding curve with the DEX AMM starting price (see TOKEN DISTRIBUTION)
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Premium */}
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-2">
                                                <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 block">Sale Discount</label>
                                                <button onClick={() => setShowPremiumInfo(!showPremiumInfo)} className="text-gray-400 hover:text-[#845fbc] transition-colors" title="Info">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                </button>
                                            </div>
                                            <span className="text-[10px] px-2 py-0.5 rounded border bg-purple-100 dark:bg-purple-900/30 text-[#845fbc] border-purple-200 dark:border-purple-800">{premiumPercent}% Boost</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="50"
                                            step="1"
                                            value={premiumPercent}
                                            onChange={(e) => setPremiumPercent(Number(e.target.value))}
                                            className="w-full mb-2 slider-purple-track"
                                            style={{ '--track-bg': `linear-gradient(to right, #845fbc ${(premiumPercent / 50) * 100}%, rgba(132, 95, 188, 0.2) ${(premiumPercent / 50) * 100}%)` } as React.CSSProperties}
                                        />
                                        {showPremiumInfo && (
                                            <div className="mt-4 p-3 rounded-lg border border-purple-200/50 dark:border-purple-800/30 bg-purple-50/50 dark:bg-purple-900/10 flex items-start gap-3 shadow-sm animate-fade-in transition-all">
                                                <svg className="w-4 h-4 text-[#845fbc] mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <div className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                                                    <p className="font-semibold font-heading text-gray-900 dark:text-gray-200 mb-1">Do you want to reward early buyers?</p>
                                                    <p className="mb-2">Also known as "Listing Premium". This sets how much higher the trading price will be on the DEX compared to the final launchpad price.</p>
                                                    <p className="text-gray-500 dark:text-gray-500 italic">
                                                        <span className="font-semibold">Example:</span> A 10% discount means the DEX starts trading 10% higher than the final sale price, giving presale buyers instant profit.
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Liquidity Goal */}
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <label className={`text-[11px] uppercase tracking-[0.08em] font-semibold block ${architectIsLiquidityInvalid ? "text-red-500" : "text-teal-600 dark:text-teal-400"}`}>Liquidity Pool Target (KTA)</label>
                                        </div>
                                        <input type="number" min="1500" value={targetLiquidity} onChange={(e) => setTargetLiquidity(Number(e.target.value))} className={`w-full p-3 rounded-md font-mono text-sm bg-gray-50 dark:bg-[#121212] border ${architectIsLiquidityInvalid ? 'border-red-500' : 'border-teal-200 dark:border-teal-800/30'} text-gray-900 dark:text-white focus:outline-none`} />
                                    </div>

                                    {/* Split */}
                                    <div>
                                        <div className="flex justify-between items-center mb-2">
                                            <div className="flex items-center gap-2">
                                                <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 block">Team Fundraise Add On</label>
                                                <button onClick={() => setShowTeamSplitInfo(!showTeamSplitInfo)} className="text-gray-400 hover:text-[#845fbc] transition-colors" title="Info">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                </button>
                                            </div>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="90"
                                            value={teamSplitPercent}
                                            onChange={(e) => setTeamSplitPercent(Number(e.target.value))}
                                            className="w-full mb-3 slider-purple-track"
                                            style={{ '--track-bg': `linear-gradient(to right, #845fbc ${(teamSplitPercent / 90) * 100}%, rgba(132, 95, 188, 0.2) ${(teamSplitPercent / 90) * 100}%)` } as React.CSSProperties}
                                        />
                                        <div className="flex justify-center text-xs font-mono bg-gray-100 dark:bg-black/20 p-2 rounded border border-gray-200 dark:border-white/5">
                                            <span className="text-[#845fbc] font-bold">+{teamSplitPercent}% Team Funds on top of Liquidity</span>
                                        </div>
                                        {showTeamSplitInfo && (
                                            <div className="mt-4 p-3 rounded-lg border border-purple-200/50 dark:border-purple-800/30 bg-purple-50/50 dark:bg-purple-900/10 flex items-start gap-3 shadow-sm animate-fade-in transition-all">
                                                <svg className="w-4 h-4 text-[#845fbc] mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                                <div className="text-[11px] leading-relaxed text-gray-600 dark:text-gray-400">
                                                    <p className="font-semibold font-heading text-gray-900 dark:text-gray-200 mb-1">Do you need extra funds for development?</p>
                                                    <p className="mb-2">The percentage of the total capital raised that is allocated to the project team. This is calculated as an add-on to your liquidity goal.</p>
                                                    <p className="text-gray-500 dark:text-gray-500 italic mt-2">
                                                        <span className="font-semibold text-gray-600 dark:text-gray-400">Example:<br /></span>
                                                        If your Liquidity Goal is 80,000 KTA and you set a 20% Team Share, the system raises a total of 96,000 KTA.
                                                        <br /><br />
                                                        • 16,000 &rarr; Team Wallet<br />
                                                        • 80,000 &rarr; Liquidity Pool
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Visualization (Right) */}
                        <div className="lg:col-span-8 flex flex-col gap-6">
                            {/* HUD */}
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                                <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-5 rounded-xl">
                                    <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Liquidity Goal</p>
                                    <p className="text-[18px] font-semibold tracking-tight mt-1 text-gray-900 dark:text-white">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'KTA', maximumFractionDigits: 0 }).format(targetLiquidity)}</p>
                                </div>
                                <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-5 rounded-xl">
                                    <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Total Raise</p>
                                    <p className="text-[18px] font-semibold tracking-tight text-gray-900 dark:text-white mt-1">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'KTA', maximumFractionDigits: 0 }).format(expectedTotalRaise)}</p>
                                </div>
                                <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-5 rounded-xl">
                                    <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Listing Price</p>
                                    <p className="text-[18px] font-semibold tracking-tight text-[#14b8a6] mt-1">{formatCurrency(listingPriceNum)}</p>
                                </div>
                                <div className="bg-white dark:bg-[#1a1a1a] border border-[#845fbc]/20 dark:border-[#845fbc]/20 ring-1 ring-[#845fbc]/10 p-5 rounded-xl">
                                    <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Listing MCap</p>
                                    <p className="text-[18px] font-semibold tracking-tight text-[#845fbc] mt-1">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'KTA', maximumFractionDigits: 0 }).format(listingPriceNum * totalSupply)}</p>
                                </div>
                            </div>

                            {/* Chart */}
                            <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-6 rounded-xl flex-grow flex flex-col min-h-[400px]">
                                <div className="flex justify-between items-center mb-6">
                                    <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#845fbc]"></span>Bonding Curve Simulation</h2>
                                    <span className="px-3 py-1 bg-gray-100 dark:bg-white/5 rounded-md text-[10px] font-medium text-gray-500 border border-gray-200 dark:border-white/5">Real-time Preview</span>
                                </div>
                                <div className="flex-grow w-full relative">
                                    <PriceChart data={architectGraphData} curveType={curveType} listingPrice={listingPriceNum} />
                                </div>
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-6 rounded-xl">
                                    <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-4">Token Distribution</h3>
                                    <div className="space-y-3 font-mono text-sm">
                                        <div className="flex justify-between items-center text-gray-600 dark:text-white/80"><span>Launch (Sale)</span><span className="text-gray-900 dark:text-white font-bold">{formatNumber(saleTokens)}</span></div>
                                        <div className="flex justify-between items-center text-gray-600 dark:text-white/80"><span>Liquidity (Pool)</span><span className="text-gray-900 dark:text-white font-bold">{formatNumber(poolTokens)}</span></div>
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-6 rounded-xl">
                                    <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-4">Cash Flow</h3>
                                    <div className="space-y-3 font-mono text-sm">
                                        <div className="flex justify-between items-center"><span className="text-gray-600 dark:text-gray-400">Team Payout</span><span className="text-[#845fbc] font-bold">{formatCurrency(teamFunds)}</span></div>
                                        <div className="flex justify-between items-center"><span className="text-gray-600 dark:text-gray-400">Locked in LP</span><span className="text-teal-600 dark:text-teal-400 font-bold">{formatCurrency(baseInLP)}</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // 2. Create Token View
    if (activeTab === 'create') {
        return (
            <div className="w-full min-h-screen transition-colors duration-300 pt-8 md:pt-8 p-4 lg:p-8">
                <div className="w-full flex flex-col items-center justify-start animate-fade-in">
                    <PageHeader current="create" />
                    <CreatePoolForm />
                </div>
            </div>
        );
    }

    // Fallback: redirect to sandbox
    return null;
};

export default LaunchpadPage;
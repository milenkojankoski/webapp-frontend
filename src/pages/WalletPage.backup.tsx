import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useSwap } from '../context/SwapContext';
import { WalletService } from '../services/wallet';
import { TokenLogo } from '../components/common/TokenLogo';
import { WalletTransactionsList } from '../components/layout/WalletTransactionsList';
import { shortenAddress, formatAmount18 } from '../utils/formatters';
import { getTokenDisplayData } from '../utils/token';

import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../config/firebase';

import { SendModal } from '../components/layout/SendModal';
import { MetricCard } from '../components/common/MetricCard';
import { KYCSharingModal } from '../components/common/KYCSharingModal';
export const WalletPage: React.FC = () => {
    const { isConnected, address, balances, connectToExtension, network, logout } = useWallet();
    const { openSwap } = useSwap();
    const navigate = useNavigate();

    const [history, setHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [activeTab, setActiveTab] = useState<'assets' | 'history' | 'created'>('assets');
    const [marketData, setMarketData] = useState<Record<string, any>>({});
    const [blockchainSymbols, setBlockchainSymbols] = useState<Record<string, string>>({});

    // State for Send Modal
    const [sendToken, setSendToken] = useState<any | null>(null);
    // State for KYC Sharing Modal
    const [showKycModal, setShowKycModal] = useState(false);

    // State for My Created Tokens
    const [createdTokens, setCreatedTokens] = useState<{ id: string; symbol: string; address: string; mode?: string; price?: string; marketCap?: string; network?: string; active?: boolean }[]>([]);
    const [createdTokensLoading, setCreatedTokensLoading] = useState(false);

    // Fetch tokens created by this wallet
    useEffect(() => {
        if (!address) { setCreatedTokens([]); return; }

        const fetchCreatedTokens = async () => {
            setCreatedTokensLoading(true);
            try {
                const results: typeof createdTokens = [];
                for (const colName of ["pools", "pools_test"]) {
                    const poolsRef = collection(db, colName);
                    const q = query(poolsRef, where("creator", "==", address), limit(50));
                    const snaps = await getDocs(q);
                    snaps.forEach(d => {
                        const data = d.data();
                        if (!results.find(r => r.id === d.id)) {
                            results.push({
                                id: d.id,
                                symbol: data.pairedTokenSymbol || "UNK",
                                address: data.address || "",
                                mode: data.mode,
                                price: data.price,
                                marketCap: data.marketCap,
                                network: data.network || (colName === "pools_test" ? "test" : "main"),
                                active: data.active ?? false,
                            });
                        }
                    });
                }
                setCreatedTokens(results);
            } catch (err) {
                console.error("Failed to fetch creator tokens:", err);
            } finally {
                setCreatedTokensLoading(false);
            }
        };
        fetchCreatedTokens();
    }, [address]);

    // 1. Fetch History
    useEffect(() => {
        const fetchHistory = async () => {
            if (address) {
                setLoadingHistory(true);
                try {
                    const txs = await WalletService.getWalletHistory(address, network);
                    setHistory(txs);
                } catch (e) {
                    console.error("Failed to load history", e);
                } finally {
                    setLoadingHistory(false);
                }
            }
        };
        fetchHistory();
    }, [address, network]);

    // ✅ 2. Fetch Market Data (DIRECT FROM FIRESTORE)
    useEffect(() => {
        const fetchPrices = async () => {
            try {
                // A. Reference your collection
                const poolsRef = collection(db, "pools");

                // B. Build the query (Filter by Network)
                // We use limit(500) to match your previous API logic and prevent 
                // downloading 10,000 tokens if your DB grows huge.
                const q = query(
                    poolsRef,
                    where("network", "==", network),
                    limit(500)
                );

                // C. Execute the fetch
                // This will use your "Anonymous Auth" token automatically
                const querySnapshot = await getDocs(q);

                // D. Map the data
                const map: Record<string, any> = {};

                querySnapshot.forEach((doc) => {
                    const t = doc.data();

                    // Ensure your Firestore documents have these fields!
                    if (t.pairedToken) {
                        map[t.pairedToken] = {
                            price: t.price,         // Check if this is t.price or t.stats.price in your DB
                            change24h: t.change24h || t.stats?.priceChange24h,
                            symbol: t.pairedTokenSymbol || t.symbol,
                            vol24h: t.vol24h || t.stats?.vol24h,
                            baseTokenDecimals: t.baseTokenDecimals,
                            tokenDecimals: t.tokenDecimals,
                            baseTokenSymbol: t.baseTokenSymbol,
                            pairedTokenDecimals: t.pairedTokenDecimals
                        };
                    }
                });

                setMarketData(map);
            } catch (e) {
                console.error("Market data fetch failed (Firestore)", e);
            }
        };

        if (network) {
            fetchPrices();
        }
    }, [network]);

    // ✅ 2b. Resolve symbols from blockchain for tokens not found in DB
    useEffect(() => {
        const resolveSymbols = async () => {
            const missing = balances.filter(token => {
                if (token.symbol === 'KTA' || token.symbol === 'KEETA') return false;
                if (marketData[token.address]) return false;
                if (blockchainSymbols[token.address]) return false;
                return true;
            });

            if (missing.length === 0) return;

            const resolved: Record<string, string> = {};
            await Promise.all(missing.map(async (token) => {
                try {
                    const meta = await WalletService.getTokenMetadata(token.address, network);
                    if (meta.symbol && !meta.symbol.startsWith('KEETA')) {
                        resolved[token.address] = meta.symbol;
                    }
                } catch {
                    // blockchain lookup failed, keep existing symbol
                }
            }));

            if (Object.keys(resolved).length > 0) {
                setBlockchainSymbols(prev => ({ ...prev, ...resolved }));
            }
        };

        if (balances.length > 0) {
            resolveSymbols();
        }
    }, [balances, marketData, network]);

    // 3. Calculate Total Value
    const totalValue = useMemo(() => {
        return balances.reduce((acc, token) => {
            if (token.symbol === 'KTA' || token.symbol === 'KEETA') return acc + parseFloat(token.amount);
            const tokenMarket = marketData[token.address];
            const displayDecimals = tokenMarket?.baseTokenDecimals || tokenMarket?.tokenDecimals || 18;
            const price = tokenMarket ? parseFloat(formatAmount18(tokenMarket.price, displayDecimals)) : 0;
            return acc + (parseFloat(token.amount) * price);
        }, 0);
    }, [balances, marketData]);

    // ✅ Helper: Find Top Gainer (User's Wallet)
    const topGainer = useMemo(() => {
        let bestToken = { symbol: '-', change: -Infinity };
        let found = false;

        balances.forEach((token) => {
            let change = -Infinity;
            let symbol = token.symbol;

            if (token.symbol === 'KTA' || token.symbol === 'KEETA') {
                change = 0;
                symbol = 'KTA';
            } else {
                const market = marketData[token.address];
                if (market) {
                    change = parseFloat(market.change24h || "0");
                    symbol = market.symbol || token.symbol;
                }
            }

            if (change !== -Infinity && change > bestToken.change) {
                bestToken = { symbol, change };
                found = true;
            }
        });

        return found ? bestToken : { symbol: '-', change: 0 };
    }, [balances, marketData]);

    // ✅ Helper: Find the Real KTA Address from balances
    const ktaAddress = useMemo(() => {
        const kta = balances.find(b => b.symbol === 'KTA' || b.symbol === 'KEETA');
        return kta?.address || "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg";
    }, [balances]);

    if (!isConnected) {
        return (
            <div className="w-full min-h-screen p-6 md:p-12 bg-gray-50 dark:bg-[#171717] flex flex-col items-center justify-center text-center animate-fade-in transition-colors duration-300">
                <div className="relative mb-8 group">
                    <div className="absolute inset-0 bg-[#845fbc] blur-[40px] opacity-20 rounded-full group-hover:opacity-40 transition-opacity"></div>
                    <div className="relative bg-white dark:bg-[#1e1e1e] p-8 rounded-3xl shadow-xl border border-gray-200 dark:border-[#333]">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-16 h-16 text-[#845fbc] animate-pulse">
                            <path d="M3 7h18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1-2-2z" /><path d="M16 12h4" /><circle cx="14" cy="12" r="1" />
                        </svg>
                    </div>
                </div>
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-3">Connect Wallet</h1>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mb-8">Access your Alpaca portfolio by connecting your extension.</p>
                <button onClick={() => connectToExtension()} className="px-8 py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-bold rounded-xl transition-all shadow-lg">Connect Extension</button>
            </div>
        );
    }

    return (
        <div className="w-full min-h-screen p-6 md:p-12 bg-gray-50 dark:bg-[#121212] transition-colors duration-300">
            <div className="max-w-7xl mx-auto animate-fade-in">

                {/* HERO BANNER */}
                <div className="relative w-full bg-[#845fbc] rounded-[40px] p-10 mb-8 overflow-hidden shadow-2xl">
                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-6">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                <span className="text-xs font-bold uppercase tracking-widest text-purple-200">{network.toUpperCase()} CONNECTED</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <h2 className="text-3xl md:text-5xl font-mono font-bold text-white tracking-tight">
                                    {shortenAddress(address || "")}
                                </h2>
                                <div className="flex gap-2">
                                    <button onClick={() => navigator.clipboard.writeText(address || "")} className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-all" title="Copy Address">
                                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-3">
                            <button onClick={() => setShowKycModal(true)} className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-bold transition-all border border-white/5 flex items-center gap-2">
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                </svg>
                                Share KYC
                            </button>
                            <button onClick={logout} className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-2xl font-bold transition-all border border-white/5">Disconnect</button>
                        </div>
                    </div>
                    <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3"></div>
                </div>

                {/* METRICS ROW */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
                    <MetricCard label="TOTAL VALUE" value={`${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KTA`} sub="0.00% (24h)" subColor="text-gray-500" />
                    <MetricCard
                        label="TOP GAINER"
                        value={topGainer.symbol}
                        sub={`${topGainer.change >= 0 ? "+" : ""}${(topGainer.change * 100).toFixed(2)}%`}
                        subColor={topGainer.change >= 0 ? "text-green-500" : "text-red-500"}
                        isToken
                    />
                    <MetricCard label="ASSET MIX" value="KTA 97%" sub="Others 3%" />
                    <MetricCard label="NETWORK STATUS" value="OPERATIONAL" sub={`${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} • Fee: 0.05 KTA`} subColor="text-green-400" />
                </div>

                {/* TABS */}
                <div className="flex gap-8 mb-6 border-b border-gray-200 dark:border-[#333]">
                    <button onClick={() => setActiveTab('assets')} className={`pb-4 text-sm font-black tracking-widest transition-all ${activeTab === 'assets' ? 'text-gray-900 dark:text-white border-b-2 border-[#845fbc]' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>MY ASSETS</button>
                    <button onClick={() => setActiveTab('created')} className={`pb-4 text-sm font-black tracking-widest transition-all ${activeTab === 'created' ? 'text-gray-900 dark:text-white border-b-2 border-[#845fbc]' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>MY TOKENS</button>
                    <button onClick={() => setActiveTab('history')} className={`pb-4 text-sm font-black tracking-widest transition-all ${activeTab === 'history' ? 'text-gray-900 dark:text-white border-b-2 border-[#845fbc]' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>HISTORY</button>
                </div>

                {/* CONTENT */}
                <div className="animate-fade-in">
                    {activeTab === 'created' ? (
                        <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] overflow-hidden shadow-xl">
                            <div className="p-6 border-b border-gray-200 dark:border-[#333]">
                                <h3 className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest text-sm">Tokens You Created</h3>
                            </div>
                            {createdTokensLoading ? (
                                <div className="p-10 text-center text-gray-500">Loading your tokens...</div>
                            ) : createdTokens.length === 0 ? (
                                <div className="p-10 text-center">
                                    <p className="text-gray-500 mb-4">You haven't created any tokens yet.</p>
                                    <button onClick={() => navigate('/launchpad/create')} className="px-6 py-2.5 bg-[#845fbc] hover:bg-[#724bad] text-white font-bold rounded-xl transition-all">
                                        Create a Token
                                    </button>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="text-[10px] text-gray-500 font-bold uppercase tracking-widest bg-gray-100 dark:bg-[#252525]">
                                            <tr>
                                                <th className="px-8 py-4">Token</th>
                                                <th className="px-8 py-4 text-right">Price</th>
                                                <th className="px-8 py-4 text-right">Status</th>
                                                <th className="px-8 py-4 text-right">Network</th>
                                                <th className="px-8 py-4 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-[#333]">
                                            {createdTokens.map(t => (
                                                <tr key={t.id} className="hover:bg-purple-50 dark:hover:bg-[#2a2a2a] transition-colors group">
                                                    <td className="px-8 py-6">
                                                        <div className="flex items-center gap-4">
                                                            <TokenLogo address={t.address} symbol={t.symbol} network={(t.network as "main" | "test") || network} className="w-10 h-10" />
                                                            <div>
                                                                <div className="font-bold text-gray-900 dark:text-white text-lg">{t.symbol}</div>
                                                                <div className="text-xs text-gray-500 font-mono">{shortenAddress(t.address)}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-8 py-6 text-right font-mono font-medium text-gray-600 dark:text-gray-300">
                                                        {t.price ? `${formatAmount18(t.price)} KTA` : '-'}
                                                    </td>
                                                    <td className="px-8 py-6 text-right">
                                                        {t.mode === 'fundRaising' ? (
                                                            <span className="text-[10px] px-2.5 py-1 rounded-full bg-[#845fbc]/10 text-[#845fbc] border border-[#845fbc]/20 font-black uppercase tracking-widest">Fundraising</span>
                                                        ) : t.active ? (
                                                            <span className="text-[10px] px-2.5 py-1 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 font-black uppercase tracking-widest">Active</span>
                                                        ) : (
                                                            <span className="text-[10px] px-2.5 py-1 rounded-full bg-gray-500/10 text-gray-500 border border-gray-500/20 font-black uppercase tracking-widest">Inactive</span>
                                                        )}
                                                    </td>
                                                    <td className="px-8 py-6 text-right">
                                                        <span className={`text-[10px] px-2.5 py-1 rounded-full font-black uppercase tracking-widest ${t.network === 'test' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'}`}>
                                                            {t.network === 'test' ? 'Testnet' : 'Mainnet'}
                                                        </span>
                                                    </td>
                                                    <td className="px-8 py-6 text-right">
                                                        <button
                                                            onClick={() => navigate(`/token-details?q=${t.id}`)}
                                                            className="px-4 py-1.5 bg-[#845fbc]/20 hover:bg-[#845fbc] text-[#845fbc] hover:text-white text-[10px] font-black rounded-lg transition-all uppercase tracking-widest"
                                                        >
                                                            View
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    ) : activeTab === 'assets' ? (
                        <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] overflow-hidden shadow-xl">
                            <div className="p-6 border-b border-gray-200 dark:border-[#333] flex justify-between items-center">
                                <h3 className="font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest text-sm">Your Assets</h3>
                                <div className="relative">
                                    <input type="text" placeholder="Search assets..." className="bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-[#333] rounded-xl px-4 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#845fbc]" />
                                </div>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="text-[10px] text-gray-500 font-bold uppercase tracking-widest bg-gray-100 dark:bg-[#252525]">
                                        <tr>
                                            <th className="px-8 py-4">Asset</th>
                                            <th className="px-8 py-4 text-right">Price</th>
                                            <th className="px-8 py-4 text-right">24h Change</th>
                                            <th className="px-8 py-4 text-right">Balance</th>
                                            <th className="px-8 py-4 text-right">Value (KTA)</th>
                                            <th className="px-8 py-4 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-[#333]">
                                        {balances.map((token, idx) => {
                                            const market = marketData[token.address];

                                            // Merge wallet token data with market data (if available) for the helper
                                            // If not in DB, use blockchain-resolved symbol as fallback
                                            const bcSymbol = blockchainSymbols[token.address];
                                            const compositeToken = {
                                                ...token,
                                                ...(bcSymbol ? { symbol: bcSymbol } : {}),
                                                ...market
                                            };

                                            const {
                                                displaySymbol,
                                                displayDecimals,
                                                currencySymbol,
                                                logoAddress,
                                                pairedTokenDecimals
                                            } = getTokenDisplayData(compositeToken, network);

                                            // Fix Decimals for Send/Swap: Prioritize DB (pairedTokenDecimals) > Wallet (token.decimals)
                                            const correctDecimals = pairedTokenDecimals ?? token.decimals ?? 18;

                                            // KTA Special Handling for Raw Price is handled in helper? 
                                            // Only partly. Helper gives display meta.
                                            // We still need to determine rawPrice source.
                                            const isKTA = token.symbol === 'KTA' || token.symbol === 'KEETA';

                                            const rawPrice = isKTA ? (network === 'test' ? "1000000000" : "1000000000000000000") : (market?.price || "0");
                                            // Format using the Dynamic Decimals
                                            const price = parseFloat(formatAmount18(rawPrice, displayDecimals));

                                            const change = isKTA ? 0 : (market?.change24h ? parseFloat(market.change24h) : 0);

                                            const balance = parseFloat(token.amount);
                                            const value = balance * price;

                                            const isPositive = change >= 0;
                                            const changeColor = isPositive ? "text-green-500" : "text-red-500";
                                            const changeSign = isPositive ? "+" : "";

                                            return (
                                                <tr key={idx} className="hover:bg-purple-50 dark:hover:bg-[#2a2a2a] transition-colors group">
                                                    <td className="px-8 py-6">
                                                        <div className="flex items-center gap-4">
                                                            <TokenLogo address={logoAddress} symbol={displaySymbol} network={network} className="w-10 h-10" />
                                                            <div>
                                                                <div className="font-bold text-gray-900 dark:text-white text-lg">{displaySymbol}</div>
                                                                <div className="text-xs text-gray-500 font-mono">{shortenAddress(token.address)}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-8 py-6 text-right font-medium text-gray-600 dark:text-gray-300">
                                                        {price.toLocaleString(undefined, { maximumFractionDigits: 6 })} {currencySymbol}
                                                    </td>
                                                    <td className={`px-8 py-6 text-right font-bold ${changeColor}`}>
                                                        {changeSign}{(change * 100).toFixed(2)}%
                                                    </td>
                                                    <td className="px-8 py-6 text-right font-mono font-bold text-gray-800 dark:text-gray-200 text-lg">
                                                        {balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                                    </td>
                                                    <td className="px-8 py-6 text-right font-mono text-[#845fbc]">
                                                        {value.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-[10px] text-gray-500 text-gray-500">{currencySymbol}</span>
                                                    </td>
                                                    <td className="px-8 py-6 text-right">
                                                        <div className="flex gap-2 justify-end">
                                                            <button
                                                                onClick={() => setSendToken({ ...token, decimals: correctDecimals })}
                                                                className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-[#333] dark:hover:bg-[#444] text-gray-700 dark:text-white text-[10px] font-black rounded-lg transition-all uppercase tracking-widest"
                                                            >
                                                                Send
                                                            </button>

                                                            <button
                                                                onClick={() => {
                                                                    openSwap(
                                                                        { address: ktaAddress, symbol: 'KTA', decimals: network === 'test' ? 9 : 18 },
                                                                        { address: token.address, symbol: displaySymbol, decimals: correctDecimals }
                                                                    );
                                                                }}
                                                                className="px-4 py-1.5 bg-[#845fbc]/20 hover:bg-[#845fbc] text-[#845fbc] hover:text-white text-[10px] font-black rounded-lg transition-all uppercase tracking-widest inline-block"
                                                            >
                                                                Trade
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] overflow-hidden shadow-xl p-4">
                            <WalletTransactionsList
                                transactions={history}
                                loading={loadingHistory}
                                network={network}
                                tokenMap={marketData}
                            />
                        </div>
                    )}
                </div>
            </div>

            <SendModal
                isOpen={!!sendToken}
                onClose={() => setSendToken(null)}
                token={sendToken}
            />

            <KYCSharingModal
                isOpen={showKycModal}
                onClose={() => setShowKycModal(false)}
                address={address || ""}
                network={network as "main" | "test"}
            />
        </div>
    );
};
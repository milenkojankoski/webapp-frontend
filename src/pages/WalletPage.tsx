import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '../context/WalletContext';
import { useSwap } from '../context/SwapContext';
import { WalletService } from '../services/wallet';
import { TokenLogo } from '../components/common/TokenLogo';
import { WalletTransactionsList } from '../components/layout/WalletTransactionsList';
import { shortenAddress, formatAmount18 } from '../utils/formatters';
import { getTokenDisplayData } from '../utils/token';

import { collection, query, where, getDocs, limit, doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { cacheGet, cacheSet } from '../services/cache';

import { SendModal } from '../components/layout/SendModal';
import { KYCSharingModal } from '../components/common/KYCSharingModal';
import { BuyModal } from '../components/common/BuyModal';

// ── Allocation bar: horizontal stacked bar showing portfolio composition ──
const AllocationBar: React.FC<{ items: { symbol: string; pct: number; color: string }[] }> = ({ items }) => {
    if (items.length === 0) return null;
    return (
        <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-500">Allocation</span>
                <div className="flex gap-3 flex-wrap">
                    {items.filter(i => i.pct >= 1).map(i => (
                        <span key={i.symbol} className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-gray-400">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: i.color }} />
                            {i.symbol} {i.pct.toFixed(1)}%
                        </span>
                    ))}
                </div>
            </div>
            <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-gray-100 dark:bg-[#252525]">
                {items.map((i, idx) => (
                    <div
                        key={i.symbol}
                        className={`h-full transition-all duration-500 ${idx === 0 ? 'rounded-l-full' : ''} ${idx === items.length - 1 ? 'rounded-r-full' : ''}`}
                        style={{ width: `${Math.max(i.pct, 0.5)}%`, backgroundColor: i.color }}
                        title={`${i.symbol}: ${i.pct.toFixed(2)}%`}
                    />
                ))}
            </div>
        </div>
    );
};

// ── Mobile asset card ──
const MobileAssetCard: React.FC<{
    symbol: string; address: string; logoAddress: string; network: string;
    price: number; currencySymbol: string; change: number; balance: number; value: number; weight: number;
    onSend: () => void; onTrade: () => void;
}> = ({ symbol, address, logoAddress, network, price, currencySymbol, change, balance, value, weight, onSend, onTrade }) => {
    const isPositive = change >= 0;
    return (
        <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                    <TokenLogo address={logoAddress} symbol={symbol} network={network as "main" | "test"} className="w-9 h-9" />
                    <div>
                        <div className="font-semibold text-[13px] text-gray-900 dark:text-white">{symbol}</div>
                        <div className="text-[10px] text-gray-500 font-mono">{shortenAddress(address)}</div>
                    </div>
                </div>
                <div className="text-right">
                    <div className="font-mono font-semibold text-[13px] text-gray-900 dark:text-white">{balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                    <div className={`text-xs font-semibold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                        {isPositive ? '+' : ''}{(change * 100).toFixed(2)}%
                    </div>
                </div>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                <span>{price.toLocaleString(undefined, { maximumFractionDigits: 6 })} {currencySymbol}</span>
                <span className="font-mono text-[#845fbc]">{value.toLocaleString(undefined, { maximumFractionDigits: 2 })} {currencySymbol}</span>
                <span className="bg-gray-100 dark:bg-white/[0.02] px-2 py-0.5 rounded-md text-[10px] font-semibold">{weight.toFixed(1)}%</span>
            </div>
            <div className="flex gap-2">
                <button onClick={onSend} className="flex-1 py-2 bg-gray-100 dark:bg-[#333] hover:bg-gray-200 dark:hover:bg-[#444] text-gray-700 dark:text-white text-[12px] font-semibold rounded-md transition-colors">Send</button>
                <button onClick={onTrade} className="flex-1 py-2 bg-[#845fbc]/8 hover:bg-[#845fbc] text-[#845fbc] hover:text-white text-[12px] font-semibold rounded-md transition-colors">Trade</button>
            </div>
        </div>
    );
};

export const WalletPage: React.FC = () => {
    const { isConnected, address, balances, connectToExtension, network, logout } = useWallet();
    const { openSwap } = useSwap();
    const navigate = useNavigate();

    const [history, setHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [activeTab, setActiveTab] = useState<'assets' | 'fiat' | 'history' | 'created'>('assets');
    const [marketData, setMarketData] = useState<Record<string, any>>({});
    const [blockchainSymbols, setBlockchainSymbols] = useState<Record<string, string>>({});
    const [assetSearch, setAssetSearch] = useState('');
    const [copiedAddress, setCopiedAddress] = useState(false);

    // State for Send Modal
    const [sendToken, setSendToken] = useState<any | null>(null);
    // State for KYC Sharing Modal
    const [showKycModal, setShowKycModal] = useState(false);
    // State for KYC Chooser Modal
    const [showKycChooser, setShowKycChooser] = useState(false);
    const [kycChooserLoading, setKycChooserLoading] = useState(false);
    const [hasCert, setHasCert] = useState<boolean | null>(null);
    const [bivoKycSharing, setBivoKycSharing] = useState(false);
    const [bivoKycShared, setBivoKycShared] = useState(false);
    const [bivoKycError, setBivoKycError] = useState('');
    // State for Buy Modal
    const [showBuyModal, setShowBuyModal] = useState(false);

    // State for My Created Tokens
    const [createdTokens, setCreatedTokens] = useState<{ id: string; symbol: string; address: string; mode?: string; price?: string; marketCap?: string; network?: string; active?: boolean }[]>([]);
    const [createdTokensLoading, setCreatedTokensLoading] = useState(false);

    // KTA USD price
    const [ktaPriceUSD, setKtaPriceUSD] = useState<number>(0);

    // Fiat exchange rates (USD base) for fiat tab value conversion
    const [fiatRates, setFiatRates] = useState<Record<string, number>>({});

    // Map fiat token addresses → currency codes
    const FIAT_TOKEN_CURRENCY: Record<string, string> = useMemo(() => ({
        "keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc": "USD",
        "keeta_aozyboy42uks7ticj72awfhpdxwqqfcowezxcew6ecaz5afdt7q2ffycxim4u": "CAD",
        "keeta_anjsvaiiycybwhixlalcpwuvobvmpll4lh24td5qipccegmvfi7c2qdcqnlgu": "AED",
        "keeta_anutgo4o3yp5tvc6wjt4vzsehjbn7t2wylpxmam4d4ojtdkjj2yca2qoinfcs": "EUR",
        "keeta_aojfknc74dabtg72mdhijtszdlv7gi3ht2xp2wrfmdagkthi4n7rulb5e54ss": "GBP",
        "keeta_apbn7f34cdq62d7iw4ui6sbfaz7fcqdit354wfaotu5zw6d6xfef5vluhdaos": "HKD",
        "keeta_aowqb2hvkak7frntfbtde27bdmqvxancrja7ndh24m66ahkbrzeda3crqh3vg": "JPY",
        "keeta_amb3hbd5gbhaorl4y2ddl3xn2q4eyi6dqkn5fpug6diz26v2awsdqhkivmyza": "MXN",
        "keeta_ao44m7r4utf2vvytsfijermgkstnkka6rp44eahrekvp4cmj5g2orzm3blrvc": "CNY",
    }), []);

    // Check Bivo KYC cache on mount
    useEffect(() => {
        if (address) {
            const cached = sessionStorage.getItem(`alpaca_bivo_kyc_${address}`);
            if (cached === 'true') setBivoKycShared(true);
        }
    }, [address]);

    const handleOpenKycChooser = async () => {
        setShowKycChooser(true);
        setKycChooserLoading(true);
        setHasCert(null);
        setBivoKycError('');

        try {
            if (!window.alpaca?.shareKYC) {
                setHasCert(false);
                return;
            }
            const result = await window.alpaca.shareKYC();
            setHasCert(result.hasCertificate);
        } catch {
            setHasCert(false);
        } finally {
            setKycChooserLoading(false);
        }
    };

    const handleShareBivoKyc = async () => {
        if (!window.alpaca?.bridgeShareKYC) {
            setBivoKycError('Please update your Alpaca Wallet extension to use this feature.');
            return;
        }
        setBivoKycSharing(true);
        setBivoKycError('');
        try {
            const result = await window.alpaca.bridgeShareKYC('bivo-anchor.keeta.com');
            if (result.shared) {
                setBivoKycShared(true);
                sessionStorage.setItem(`alpaca_bivo_kyc_${address}`, 'true');
            } else {
                setBivoKycError(result.reason || 'Failed to share KYC with Bivo.');
            }
        } catch (err: any) {
            setBivoKycError(err.message || 'Failed to share KYC with Bivo.');
        } finally {
            setBivoKycSharing(false);
        }
    };

    useEffect(() => {
        const fetchKtaPrice = async () => {
            const cached = cacheGet<number>('ktaPriceUSD', 5 * 60 * 1000);
            if (cached !== undefined) { setKtaPriceUSD(cached); return; }
            try {
                const statsRef = doc(db, "platform_stats", "metrics");
                const statsSnap = await getDoc(statsRef);
                if (statsSnap.exists()) {
                    const price = statsSnap.data().ktaPriceUSD || 0;
                    setKtaPriceUSD(price);
                    cacheSet('ktaPriceUSD', price);
                }
            } catch (err) {
                console.error("Failed to fetch KTA USD price:", err);
            }
        };
        fetchKtaPrice();
    }, []);

    // Fetch fiat exchange rates (USD base)
    useEffect(() => {
        const fetchFiatRates = async () => {
            const cached = cacheGet<Record<string, number>>('fiatRates', 30 * 60 * 1000);
            if (cached) { setFiatRates(cached); return; }
            try {
                const res = await fetch("https://open.er-api.com/v6/latest/USD");
                const data = await res.json();
                if (data?.rates) {
                    const rates: Record<string, number> = { USD: 1 };
                    for (const code of ['EUR', 'GBP', 'JPY', 'CAD', 'AED', 'HKD', 'MXN', 'CNY']) {
                        if (data.rates[code]) rates[code] = data.rates[code];
                    }
                    setFiatRates(rates);
                    cacheSet('fiatRates', rates);
                }
            } catch (e) { console.error("Failed to fetch fiat rates:", e); }
        };
        fetchFiatRates();
    }, []);

    // Fetch tokens created by this wallet
    useEffect(() => {
        if (!address) { setCreatedTokens([]); return; }

        const fetchCreatedTokens = async () => {
            const cacheKey = `createdTokens_${address}`;
            const cached = cacheGet<typeof createdTokens>(cacheKey);
            if (cached) { setCreatedTokens(cached); setCreatedTokensLoading(false); return; }

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
                cacheSet(cacheKey, results);
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
            if (!address) return;
            const cacheKey = `walletHistory_${address}_${network}`;
            const cached = cacheGet<any[]>(cacheKey, 2 * 60 * 1000);
            if (cached) { setHistory(cached); return; }

            setLoadingHistory(true);
            try {
                const txs = await WalletService.getWalletHistory(address, network);
                setHistory(txs);
                cacheSet(cacheKey, txs);
            } catch (e) {
                console.error("Failed to load history", e);
            } finally {
                setLoadingHistory(false);
            }
        };
        fetchHistory();
    }, [address, network]);

    // 2. Fetch Market Data
    useEffect(() => {
        const fetchPrices = async () => {
            const cacheKey = `marketData_${network}`;
            const cached = cacheGet<Record<string, any>>(cacheKey, 2 * 60 * 1000);
            if (cached) { setMarketData(cached); return; }

            try {
                const poolsRef = collection(db, "pools");
                const q = query(poolsRef, where("network", "==", network), limit(500));
                const querySnapshot = await getDocs(q);
                const map: Record<string, any> = {};

                querySnapshot.forEach((doc) => {
                    const t = doc.data();
                    if (t.pairedToken) {
                        map[t.pairedToken] = {
                            price: t.price,
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
                cacheSet(cacheKey, map);
            } catch (e) {
                console.error("Market data fetch failed (Firestore)", e);
            }
        };
        if (network) fetchPrices();
    }, [network]);

    // 2b. Resolve symbols from blockchain for tokens not found in DB
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
                } catch { /* keep existing symbol */ }
            }));
            if (Object.keys(resolved).length > 0) {
                setBlockchainSymbols(prev => ({ ...prev, ...resolved }));
            }
        };
        if (balances.length > 0) resolveSymbols();
    }, [balances, marketData, network]);

    // ── Enriched asset rows: compute once, reuse in table + metrics ──
    const enrichedAssets = useMemo(() => {
        return balances.map(token => {
            const market = marketData[token.address];
            const bcSymbol = blockchainSymbols[token.address];
            const compositeToken = { ...token, ...(bcSymbol ? { symbol: bcSymbol } : {}), ...market };
            const { displaySymbol, displayDecimals, currencySymbol, logoAddress, pairedTokenDecimals } = getTokenDisplayData(compositeToken, network);
            const correctDecimals = pairedTokenDecimals ?? token.decimals ?? 18;
            const isKTA = token.symbol === 'KTA' || token.symbol === 'KEETA';
            const rawPrice = isKTA ? (network === 'test' ? "1000000000" : "1000000000000000000") : (market?.price || "0");
            const price = parseFloat(formatAmount18(rawPrice, displayDecimals));
            const change = isKTA ? 0 : (market?.change24h ? parseFloat(market.change24h) : 0);
            const balance = parseFloat(token.amount);
            const value = balance * price;

            return {
                token, market, displaySymbol, displayDecimals, currencySymbol, logoAddress,
                correctDecimals, isKTA, price, change, balance, value
            };
        }).sort((a, b) => {
            // KTA always first, then by value descending
            if (a.isKTA && !b.isKTA) return -1;
            if (!a.isKTA && b.isKTA) return 1;
            return b.value - a.value;
        });
    }, [balances, marketData, blockchainSymbols, network]);

    // ── Portfolio metrics: total value, 24h P&L, asset count ──
    const totalValue = useMemo(() => enrichedAssets.reduce((acc, a) => acc + a.value, 0), [enrichedAssets]);

    const portfolioChange24h = useMemo(() => {
        if (totalValue === 0) return 0;
        // Weighted average of 24h changes by portfolio value
        const weightedSum = enrichedAssets.reduce((acc, a) => {
            return acc + (a.change * a.value);
        }, 0);
        return weightedSum / totalValue;
    }, [enrichedAssets, totalValue]);

    const totalValueUSD = ktaPriceUSD > 0 ? totalValue * ktaPriceUSD : 0;

    // ── Allocation data ──
    const allocationItems = useMemo(() => {
        if (totalValue === 0) return [];
        const COLORS = ['#845fbc', '#14b8a6', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#10b981', '#f97316', '#ec4899'];
        const items = enrichedAssets
            .filter(a => a.value > 0)
            .map((a, i) => ({
                symbol: a.displaySymbol,
                pct: (a.value / totalValue) * 100,
                color: COLORS[i % COLORS.length]
            }));
        return items;
    }, [enrichedAssets, totalValue]);

    // ── Filter assets by search ──
    const filteredAssets = useMemo(() => {
        if (!assetSearch.trim()) return enrichedAssets;
        const q = assetSearch.toLowerCase();
        return enrichedAssets.filter(a =>
            a.displaySymbol.toLowerCase().includes(q) || a.token.address.toLowerCase().includes(q)
        );
    }, [enrichedAssets, assetSearch]);

    // ── Fiat currency tokens ──
    const FIAT_TOKEN_ADDRESSES = useMemo(() => new Set([
        "keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc", // USD
        "keeta_aozyboy42uks7ticj72awfhpdxwqqfcowezxcew6ecaz5afdt7q2ffycxim4u", // CAD
        "keeta_anjsvaiiycybwhixlalcpwuvobvmpll4lh24td5qipccegmvfi7c2qdcqnlgu", // AED
        "keeta_anutgo4o3yp5tvc6wjt4vzsehjbn7t2wylpxmam4d4ojtdkjj2yca2qoinfcs", // EUR
        "keeta_aojfknc74dabtg72mdhijtszdlv7gi3ht2xp2wrfmdagkthi4n7rulb5e54ss", // GBP
        "keeta_apbn7f34cdq62d7iw4ui6sbfaz7fcqdit354wfaotu5zw6d6xfef5vluhdaos", // HKD
        "keeta_aowqb2hvkak7frntfbtde27bdmqvxancrja7ndh24m66ahkbrzeda3crqh3vg", // JPY
        "keeta_amb3hbd5gbhaorl4y2ddl3xn2q4eyi6dqkn5fpug6diz26v2awsdqhkivmyza", // MXN
        "keeta_ao44m7r4utf2vvytsfijermgkstnkka6rp44eahrekvp4cmj5g2orzm3blrvc", // CNY
    ]), []);

    const fiatAssets = useMemo(() => {
        const fiat = enrichedAssets
            .filter(a => FIAT_TOKEN_ADDRESSES.has(a.token.address))
            .map(a => {
                // Compute real KTA value: fiat balance → USD → KTA
                const currencyCode = FIAT_TOKEN_CURRENCY[a.token.address];
                const fxRate = currencyCode && fiatRates[currencyCode] ? fiatRates[currencyCode] : 1;
                // balance in USD = balance / fxRate (e.g. 100 EUR / 0.92 = ~108.7 USD)
                const balanceUSD = a.balance / fxRate;
                // KTA value = USD value / KTA price in USD
                const ktaValue = ktaPriceUSD > 0 ? balanceUSD / ktaPriceUSD : 0;
                return { ...a, value: ktaValue };
            });
        if (!assetSearch.trim()) return fiat;
        const q = assetSearch.toLowerCase();
        return fiat.filter(a => a.displaySymbol.toLowerCase().includes(q) || a.token.address.toLowerCase().includes(q));
    }, [enrichedAssets, FIAT_TOKEN_ADDRESSES, FIAT_TOKEN_CURRENCY, fiatRates, ktaPriceUSD, assetSearch]);

    const ktaAddress = useMemo(() => {
        const kta = balances.find(b => b.symbol === 'KTA' || b.symbol === 'KEETA');
        return kta?.address || "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg";
    }, [balances]);

    const copyAddress = () => {
        navigator.clipboard.writeText(address || "");
        setCopiedAddress(true);
        setTimeout(() => setCopiedAddress(false), 2000);
    };

    if (!isConnected) {
        return (
            <div className="w-full min-h-screen p-6 md:p-12 bg-gray-50 dark:bg-[#171717] flex flex-col items-center justify-center text-center animate-fade-in transition-colors duration-300">
                <div className="relative mb-8 group">
                    <div className="absolute inset-0 bg-[#845fbc] blur-[40px] opacity-20 rounded-full group-hover:opacity-40 transition-opacity"></div>
                    <div className="relative bg-white dark:bg-[#1a1a1a] p-8 rounded-xl border border-gray-200 dark:border-white/[0.08]">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-16 h-16 text-[#845fbc] animate-pulse">
                            <path d="M3 7h18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1-2-2z" /><path d="M16 12h4" /><circle cx="14" cy="12" r="1" />
                        </svg>
                    </div>
                </div>
                <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-900 dark:text-white mb-3">Connect Wallet</h1>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mb-8">Access your Alpaca portfolio by connecting your extension.</p>
                <button onClick={() => connectToExtension()} className="px-8 py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md transition-colors">Connect Extension</button>
            </div>
        );
    }

    const isChangePositive = portfolioChange24h >= 0;

    return (
        <div className="w-full min-h-screen p-4 md:p-8 lg:p-12 bg-gray-50 dark:bg-[#121212] transition-colors duration-300">
            <div className="max-w-7xl mx-auto animate-fade-in">

                {/* ══════ HERO: Portfolio Value + Address ══════ */}
                <div className="relative w-full bg-[#845fbc] rounded-xl px-6 py-6 md:px-10 md:py-7 mb-8 overflow-hidden">
                    <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        {/* Left: value */}
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                                <button
                                    onClick={copyAddress}
                                    className="flex items-center gap-1.5 px-2.5 py-1 bg-white/10 hover:bg-white/20 rounded-full transition-all text-xs font-mono text-white/80"
                                    title="Copy address"
                                >
                                    {shortenAddress(address || "")}
                                    {copiedAddress ? (
                                        <svg className="w-3 h-3 text-green-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                    ) : (
                                        <svg className="w-3 h-3 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                    )}
                                </button>
                                <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-purple-200 bg-white/10 px-2 py-0.5 rounded-md">{network}</span>
                            </div>
                            <div className="text-[32px] md:text-4xl lg:text-5xl font-semibold text-white tracking-tight">
                                {totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                <span className="text-base md:text-lg text-white/50 ml-2">KTA</span>
                            </div>
                            {totalValueUSD > 0 && (
                                <div className="text-xs font-mono text-white/40 mt-0.5">
                                    ${totalValueUSD.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                                </div>
                            )}
                        </div>

                        {/* Right: actions + 24h change */}
                        <div className="flex flex-col items-start md:items-end gap-2">
                            <div className="flex gap-2">
                                <button onClick={() => setShowBuyModal(true)} className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-md font-semibold text-sm transition-colors border border-white/10 flex items-center gap-2">
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
                                    </svg>
                                    Buy
                                </button>
                                <button onClick={handleOpenKycChooser} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md font-semibold text-sm transition-colors border border-white/5 flex items-center gap-2">
                                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                    KYC
                                </button>
                                <button onClick={logout} className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-md font-semibold text-sm transition-colors border border-white/5">Disconnect</button>
                            </div>
                            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold ${isChangePositive ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                                {isChangePositive ? '▲' : '▼'} {isChangePositive ? '+' : ''}{(portfolioChange24h * 100).toFixed(2)}%
                                <span className="text-white/40 font-normal ml-1">24h</span>
                            </div>
                        </div>
                    </div>

                    {/* Decorative element */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3" />
                </div>

                {/* ══════ QUICK METRICS ══════ */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-8">
                    <div className="bg-white dark:bg-[#1a1a1a] p-5 rounded-xl border border-gray-200 dark:border-white/[0.08] transition-colors cursor-default">
                        <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-500">Assets</div>
                        <div className="text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white mt-1">{balances.length}</div>
                        <div className="text-xs text-gray-500 mt-1">tokens held</div>
                    </div>
                    <div className="bg-white dark:bg-[#1a1a1a] p-5 rounded-xl border border-gray-200 dark:border-white/[0.08] transition-colors cursor-default">
                        <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-500">24h P&L</div>
                        <div className={`text-[22px] font-semibold tracking-tight font-mono mt-1 ${isChangePositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                            {isChangePositive ? '+' : ''}{(portfolioChange24h * totalValue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">KTA</div>
                    </div>
                    <div className="bg-white dark:bg-[#1a1a1a] p-5 rounded-xl border border-gray-200 dark:border-white/[0.08] transition-colors cursor-default">
                        <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-500">Largest Position</div>
                        <div className="text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white mt-1 truncate">
                            {enrichedAssets.length > 0 ? enrichedAssets[0].displaySymbol : '-'}
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                            {enrichedAssets.length > 0 && totalValue > 0
                                ? `${((enrichedAssets[0].value / totalValue) * 100).toFixed(1)}% of portfolio`
                                : '-'}
                        </div>
                    </div>
                    <div className="bg-white dark:bg-[#1a1a1a] p-5 rounded-xl border border-gray-200 dark:border-white/[0.08] border-[#845fbc]/20 ring-1 ring-[#845fbc]/10 transition-colors cursor-default">
                        <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-500">Created Tokens</div>
                        <div className="text-[22px] font-semibold tracking-tight text-[#845fbc] mt-1">{createdTokens.length}</div>
                        <div className="text-xs text-gray-500 mt-1">
                            {createdTokens.filter(t => t.active).length} active
                        </div>
                    </div>
                </div>

                {/* ══════ TABS ══════ */}
                <div className="flex gap-6 md:gap-8 mb-6 border-b border-gray-200 dark:border-white/[0.08] overflow-x-auto">
                    {(['assets', 'fiat', 'created', 'history'] as const).map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`pb-4 text-[13px] font-semibold transition-colors whitespace-nowrap ${activeTab === tab ? 'text-gray-900 dark:text-white border-b-2 border-[#845fbc]' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                        >
                            {tab === 'assets' ? 'MY ASSETS' : tab === 'fiat' ? 'FIAT' : tab === 'created' ? 'MY TOKENS' : 'HISTORY'}
                        </button>
                    ))}
                </div>

                {/* ══════ CONTENT ══════ */}
                <div className="animate-fade-in">

                    {/* ── MY TOKENS tab ── */}
                    {activeTab === 'created' ? (
                        <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden">
                            <div className="p-6 border-b border-gray-200 dark:border-white/[0.08]">
                                <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">Tokens You Created</h3>
                            </div>
                            {createdTokensLoading ? (
                                <div className="p-10 text-center text-gray-500">Loading your tokens...</div>
                            ) : createdTokens.length === 0 ? (
                                <div className="p-10 text-center">
                                    <p className="text-gray-500 mb-4">You haven't created any tokens yet.</p>
                                    <button onClick={() => navigate('/launchpad/create')} className="px-6 py-2.5 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md transition-colors">
                                        Create a Token
                                    </button>
                                </div>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-[0.08em] bg-gray-50 dark:bg-white/[0.02]">
                                            <tr>
                                                <th className="px-4 py-2.5">Token</th>
                                                <th className="px-4 py-2.5 text-right">Price</th>
                                                <th className="px-4 py-2.5 text-right">Status</th>
                                                <th className="px-4 py-2.5 text-right">Network</th>
                                                <th className="px-4 py-2.5 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                                            {createdTokens.map(t => (
                                                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors group">
                                                    <td className="px-4 py-2.5">
                                                        <div className="flex items-center gap-3">
                                                            <TokenLogo address={t.address} symbol={t.symbol} network={(t.network as "main" | "test") || network} className="w-9 h-9" />
                                                            <div>
                                                                <div className="font-semibold text-[13px] text-gray-900 dark:text-white">{t.symbol}</div>
                                                                <div className="text-[11px] text-gray-500 font-mono">{shortenAddress(t.address)}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right font-mono text-[13px] font-medium text-gray-600 dark:text-gray-300">
                                                        {t.price ? `${formatAmount18(t.price)} KTA` : '-'}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right">
                                                        {t.mode === 'fundRaising' ? (
                                                            <span className="text-[9px] px-2.5 py-1 rounded-md bg-[#845fbc]/10 text-[#845fbc] border border-[#845fbc]/20 font-semibold uppercase tracking-[0.06em]">Fundraising</span>
                                                        ) : t.active ? (
                                                            <span className="text-[9px] px-2.5 py-1 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20 font-semibold uppercase tracking-[0.06em]">Active</span>
                                                        ) : (
                                                            <span className="text-[9px] px-2.5 py-1 rounded-md bg-gray-500/10 text-gray-500 border border-gray-500/20 font-semibold uppercase tracking-[0.06em]">Inactive</span>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right">
                                                        <span className={`text-[9px] px-2.5 py-1 rounded-md font-semibold uppercase tracking-[0.06em] ${t.network === 'test' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20'}`}>
                                                            {t.network === 'test' ? 'Testnet' : 'Mainnet'}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right">
                                                        <button
                                                            onClick={() => navigate(`/token-details?q=${t.id}`)}
                                                            className="px-3 py-1 bg-[#845fbc]/8 hover:bg-[#845fbc] text-[#845fbc] hover:text-white text-[12px] font-semibold rounded-md transition-colors"
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

                    ) : activeTab === 'fiat' ? (
                        <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden">
                            <div className="p-5 md:p-6 border-b border-gray-200 dark:border-white/[0.08] flex justify-between items-center gap-4">
                                <div>
                                    <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">Fiat Currencies</h3>
                                    <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">On-chain fiat-backed tokens in your wallet</p>
                                </div>
                                <div className="relative">
                                    <input
                                        type="text"
                                        value={assetSearch}
                                        onChange={e => setAssetSearch(e.target.value)}
                                        placeholder="Filter currencies..."
                                        className="bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-white/[0.08] rounded-md px-4 py-1.5 text-[13px] text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#845fbc] w-40 md:w-56"
                                    />
                                </div>
                            </div>

                            {/* Desktop Table */}
                            <div className="hidden md:block overflow-x-auto">
                                {fiatAssets.length === 0 ? (
                                    <div className="p-10 text-center text-gray-500">
                                        {balances.length === 0 ? 'No fiat currencies in this wallet.' : 'No fiat currencies match your search.'}
                                    </div>
                                ) : (
                                    <table className="w-full text-left">
                                        <thead className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-[0.08em] bg-gray-50 dark:bg-white/[0.02]">
                                            <tr>
                                                <th className="px-4 py-2.5">Currency</th>
                                                <th className="px-4 py-2.5 text-right">Balance</th>
                                                <th className="px-4 py-2.5 text-right">Value (KTA)</th>
                                                <th className="px-4 py-2.5 text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                                            {fiatAssets.map((a, idx) => (
                                                <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                                                    <td className="px-4 py-2.5">
                                                        <div className="flex items-center gap-3">
                                                            <TokenLogo address={a.logoAddress} symbol={a.displaySymbol} network={network} className="w-9 h-9" />
                                                            <div>
                                                                <div className="font-semibold text-[13px] text-gray-900 dark:text-white">{a.displaySymbol}</div>
                                                                <div className="text-[10px] text-gray-500 font-mono">{shortenAddress(a.token.address)}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right font-mono text-[13px] font-semibold text-gray-800 dark:text-gray-200">
                                                        {a.balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right font-mono text-[13px] text-[#845fbc] font-semibold">
                                                        {a.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                                        <span className="text-[10px] text-gray-500 ml-1">KTA</span>
                                                    </td>
                                                    <td className="px-4 py-2.5 text-right">
                                                        <div className="flex gap-2 justify-end">
                                                            <button
                                                                onClick={() => setSendToken({ ...a.token, decimals: a.correctDecimals })}
                                                                className="px-3 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-[#333] dark:hover:bg-[#444] text-gray-700 dark:text-white text-[12px] font-semibold rounded-md transition-colors"
                                                            >
                                                                Send
                                                            </button>
                                                            <button
                                                                onClick={() => openSwap(
                                                                    { address: ktaAddress, symbol: 'KTA', decimals: network === 'test' ? 9 : 18 },
                                                                    { address: a.token.address, symbol: a.displaySymbol, decimals: a.correctDecimals }
                                                                )}
                                                                className="px-3 py-1 bg-[#845fbc]/8 hover:bg-[#845fbc] text-[#845fbc] hover:text-white text-[12px] font-semibold rounded-md transition-colors"
                                                            >
                                                                Trade
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            {/* Mobile Cards */}
                            <div className="md:hidden p-4 space-y-3">
                                {fiatAssets.length === 0 ? (
                                    <div className="p-6 text-center text-gray-500">No fiat currencies found.</div>
                                ) : (
                                    fiatAssets.map((a, idx) => (
                                        <MobileAssetCard
                                            key={idx}
                                            symbol={a.displaySymbol}
                                            address={a.token.address}
                                            logoAddress={a.logoAddress}
                                            network={network}
                                            price={a.price}
                                            currencySymbol={a.currencySymbol}
                                            change={a.change}
                                            balance={a.balance}
                                            value={a.value}
                                            weight={totalValue > 0 ? (a.value / totalValue) * 100 : 0}
                                            onSend={() => setSendToken({ ...a.token, decimals: a.correctDecimals })}
                                            onTrade={() => openSwap(
                                                { address: ktaAddress, symbol: 'KTA', decimals: network === 'test' ? 9 : 18 },
                                                { address: a.token.address, symbol: a.displaySymbol, decimals: a.correctDecimals }
                                            )}
                                        />
                                    ))
                                )}
                            </div>
                        </div>

                    ) : activeTab === 'assets' ? (
                        <>
                            {/* Allocation Bar */}
                            <AllocationBar items={allocationItems} />

                            <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden">
                                <div className="p-5 md:p-6 border-b border-gray-200 dark:border-white/[0.08] flex justify-between items-center gap-4">
                                    <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white whitespace-nowrap">Your Assets</h3>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            value={assetSearch}
                                            onChange={e => setAssetSearch(e.target.value)}
                                            placeholder="Filter assets..."
                                            className="bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-white/[0.08] rounded-md px-4 py-1.5 text-[13px] text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#845fbc] w-40 md:w-56"
                                        />
                                    </div>
                                </div>

                                {/* Desktop Table */}
                                <div className="hidden md:block overflow-x-auto">
                                    {filteredAssets.length === 0 ? (
                                        <div className="p-10 text-center text-gray-500">
                                            {balances.length === 0 ? 'No assets found in this wallet.' : 'No assets match your search.'}
                                        </div>
                                    ) : (
                                        <table className="w-full text-left">
                                            <thead className="text-[11px] text-gray-500 dark:text-gray-400 font-medium uppercase tracking-[0.08em] bg-gray-50 dark:bg-white/[0.02]">
                                                <tr>
                                                    <th className="px-4 py-2.5">Asset</th>
                                                    <th className="px-4 py-2.5 text-right">Price</th>
                                                    <th className="px-4 py-2.5 text-right">24h</th>
                                                    <th className="px-4 py-2.5 text-right">Balance</th>
                                                    <th className="px-4 py-2.5 text-right">Value</th>
                                                    <th className="px-4 py-2.5 text-right">Weight</th>
                                                    <th className="px-4 py-2.5 text-right">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                                                {filteredAssets.map((a, idx) => {
                                                    const isPositive = a.change >= 0;
                                                    const weight = totalValue > 0 ? (a.value / totalValue) * 100 : 0;
                                                    return (
                                                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
                                                            <td className="px-4 py-2.5">
                                                                <div className="flex items-center gap-3">
                                                                    <TokenLogo address={a.logoAddress} symbol={a.displaySymbol} network={network} className="w-9 h-9" />
                                                                    <div>
                                                                        <div className="font-semibold text-[13px] text-gray-900 dark:text-white">{a.displaySymbol}</div>
                                                                        <div className="text-[10px] text-gray-500 font-mono">{shortenAddress(a.token.address)}</div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-4 py-2.5 text-right font-mono text-[13px] text-gray-600 dark:text-gray-300">
                                                                {a.price.toLocaleString(undefined, { maximumFractionDigits: 6 })} {a.currencySymbol}
                                                            </td>
                                                            <td className={`px-4 py-2.5 text-right text-[13px] font-semibold ${isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                                                {isPositive ? '+' : ''}{(a.change * 100).toFixed(2)}%
                                                            </td>
                                                            <td className="px-4 py-2.5 text-right font-mono text-[13px] font-semibold text-gray-800 dark:text-gray-200">
                                                                {a.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                                            </td>
                                                            <td className="px-4 py-2.5 text-right font-mono text-[13px] text-[#845fbc] font-semibold">
                                                                {a.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                                                <span className="text-[10px] text-gray-500 ml-1">{a.currencySymbol}</span>
                                                            </td>
                                                            <td className="px-4 py-2.5 text-right">
                                                                <span className="text-[11px] font-semibold text-gray-500 bg-gray-100 dark:bg-white/[0.02] px-2 py-0.5 rounded-md">
                                                                    {weight.toFixed(1)}%
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-2.5 text-right">
                                                                <div className="flex gap-2 justify-end">
                                                                    <button
                                                                        onClick={() => setSendToken({ ...a.token, decimals: a.correctDecimals })}
                                                                        className="px-3 py-1 bg-gray-200 hover:bg-gray-300 dark:bg-[#333] dark:hover:bg-[#444] text-gray-700 dark:text-white text-[12px] font-semibold rounded-md transition-colors"
                                                                    >
                                                                        Send
                                                                    </button>
                                                                    <button
                                                                        onClick={() => openSwap(
                                                                            { address: ktaAddress, symbol: 'KTA', decimals: network === 'test' ? 9 : 18 },
                                                                            { address: a.token.address, symbol: a.displaySymbol, decimals: a.correctDecimals }
                                                                        )}
                                                                        className="px-3 py-1 bg-[#845fbc]/8 hover:bg-[#845fbc] text-[#845fbc] hover:text-white text-[12px] font-semibold rounded-md transition-colors"
                                                                    >
                                                                        Trade
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    )}
                                </div>

                                {/* Mobile Cards */}
                                <div className="md:hidden p-4 space-y-3">
                                    {filteredAssets.length === 0 ? (
                                        <div className="p-6 text-center text-gray-500">
                                            {balances.length === 0 ? 'No assets found in this wallet.' : 'No assets match your search.'}
                                        </div>
                                    ) : (
                                        filteredAssets.map((a, idx) => (
                                            <MobileAssetCard
                                                key={idx}
                                                symbol={a.displaySymbol}
                                                address={a.token.address}
                                                logoAddress={a.logoAddress}
                                                network={network}
                                                price={a.price}
                                                currencySymbol={a.currencySymbol}
                                                change={a.change}
                                                balance={a.balance}
                                                value={a.value}
                                                weight={totalValue > 0 ? (a.value / totalValue) * 100 : 0}
                                                onSend={() => setSendToken({ ...a.token, decimals: a.correctDecimals })}
                                                onTrade={() => openSwap(
                                                    { address: ktaAddress, symbol: 'KTA', decimals: network === 'test' ? 9 : 18 },
                                                    { address: a.token.address, symbol: a.displaySymbol, decimals: a.correctDecimals }
                                                )}
                                            />
                                        ))
                                    )}
                                </div>
                            </div>
                        </>

                    ) : (
                        <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden p-4">
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

            {/* KYC Chooser Modal */}
            {showKycChooser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowKycChooser(false)} />
                    <div className="relative w-full max-w-md bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-2xl overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-white/[0.04]">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center">
                                    <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                    </svg>
                                </div>
                                <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">Identity Verification</h3>
                            </div>
                            <button onClick={() => setShowKycChooser(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-white/[0.04] rounded-lg transition-colors">
                                <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-5">
                            {kycChooserLoading ? (
                                <div className="flex flex-col items-center py-8">
                                    <div className="w-8 h-8 border-2 border-[#845fbc] border-t-transparent rounded-full animate-spin mb-3" />
                                    <p className="text-[13px] text-gray-500 dark:text-gray-400">Checking certificate status...</p>
                                </div>
                            ) : hasCert === false ? (
                                /* No certificate — Get Verified only */
                                <>
                                    <div className="flex flex-col items-center py-4 mb-4">
                                        <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center mb-3">
                                            <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                            </svg>
                                        </div>
                                        <p className="text-[15px] font-semibold text-gray-900 dark:text-white mb-1">No KYC Certificate</p>
                                        <p className="text-[13px] text-gray-500 dark:text-gray-400 text-center">You need to complete identity verification first. Once verified, you can share your KYC data with services.</p>
                                    </div>
                                    <button
                                        onClick={() => { setShowKycChooser(false); setShowKycModal(true); }}
                                        className="w-full py-2.5 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md text-[13px] transition-colors"
                                    >
                                        Get Verified
                                    </button>
                                </>
                            ) : (
                                /* Has certificate — show sharing options */
                                <>
                                    <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">
                                        Your on-chain KYC certificate is verified. Share your identity data with services to unlock features.
                                    </p>

                                    <div className="space-y-3 mb-4">
                                        {/* Share with Alpaca */}
                                        <button
                                            onClick={() => { setShowKycChooser(false); setShowKycModal(true); }}
                                            className="w-full text-left p-4 rounded-xl border border-gray-200 dark:border-white/[0.08] hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors group"
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="w-9 h-9 rounded-full bg-teal-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                    <svg className="w-4 h-4 text-teal-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                                    </svg>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Share with Alpaca</span>
                                                        <svg className="w-3.5 h-3.5 text-gray-400 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                                    </div>
                                                    <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">Get the verified KYC badge on your tokens and pools. Shows other users your identity is verified.</p>
                                                </div>
                                            </div>
                                        </button>

                                        {/* Share with Bivo */}
                                        <button
                                            onClick={bivoKycShared ? undefined : handleShareBivoKyc}
                                            disabled={bivoKycSharing || bivoKycShared}
                                            className={`w-full text-left p-4 rounded-xl border transition-colors group ${
                                                bivoKycShared
                                                    ? 'border-teal-200 dark:border-teal-800/30 bg-teal-50/50 dark:bg-teal-900/10'
                                                    : 'border-gray-200 dark:border-white/[0.08] hover:bg-gray-50 dark:hover:bg-white/[0.02]'
                                            }`}
                                        >
                                            <div className="flex items-start gap-3">
                                                <div className="w-9 h-9 rounded-full bg-[#845fbc]/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                    {bivoKycSharing ? (
                                                        <div className="w-4 h-4 border-2 border-[#845fbc] border-t-transparent rounded-full animate-spin" />
                                                    ) : bivoKycShared ? (
                                                        <svg className="w-4 h-4 text-teal-500" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                                    ) : (
                                                        <svg className="w-4 h-4 text-[#845fbc]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                                                        </svg>
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
                                                            {bivoKycShared ? 'Shared with Bivo' : bivoKycSharing ? 'Sharing...' : 'Share with Bivo'}
                                                        </span>
                                                        {bivoKycShared && (
                                                            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-[0.06em] bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 border border-teal-200 dark:border-teal-800/30">Connected</span>
                                                        )}
                                                        {!bivoKycShared && !bivoKycSharing && (
                                                            <svg className="w-3.5 h-3.5 text-gray-400 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                                        )}
                                                    </div>
                                                    <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">
                                                        {bivoKycShared
                                                            ? 'Your KYC is shared with Bivo. Fiat features are unlocked.'
                                                            : 'Unlock fiat on/off-ramp features. Required to convert between crypto and fiat currencies.'}
                                                    </p>
                                                </div>
                                            </div>
                                        </button>
                                    </div>

                                    {bivoKycError && (
                                        <p className="text-[12px] text-red-500 dark:text-red-400 mb-3">{bivoKycError}</p>
                                    )}

                                    <div className="bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.04] rounded-lg p-3">
                                        <p className="text-[11px] text-gray-400 dark:text-gray-500">
                                            Your data is cryptographically proven from your on-chain KYC certificate. Each service receives only the data they need. You can revoke access at any time.
                                        </p>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <KYCSharingModal
                isOpen={showKycModal}
                onClose={() => setShowKycModal(false)}
                address={address || ""}
                network={network as "main" | "test"}
            />

            <BuyModal
                isOpen={showBuyModal}
                onClose={() => setShowBuyModal(false)}
                address={address || ""}
                network={network as "main" | "test"}
            />
        </div>
    );
};

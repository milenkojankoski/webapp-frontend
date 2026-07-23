import React, {
  useState,
  useEffect,
  useCallback,
  useMemo
} from "react";

import { useNavigate } from "react-router-dom";
import { useSwap } from "../context/SwapContext";
import { useWallet } from "../context/WalletContext";
import { formatAmount18, parseRawAmount } from "../utils/formatters";
import { getTokenDisplayData } from "../utils/token";
import { TokenLogo } from "../components/common/TokenLogo";
import { KYCCheckmark } from "../components/common/KYCBadge";
import { LaunchpadProgress } from "../components/launchpad/LaunchpadProgress";
import { BASE_TOKEN } from "../services/pool";

import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../config/firebase';

// --- DEX Token Interface ---
interface TokenListItem {
  id: string;
  address: string;
  pairedToken: string;
  symbol: string;
  price: string;
  marketCap: string;
  change24h: string | number;
  vol24h: string;
  tokenDecimals?: number;
  pairedTokenDecimals?: number;
  baseTokenDecimals?: number;
  pairedTokenSymbol?: string;
  baseTokenSymbol?: string;
  mode?: string;
  fundraised?: boolean;
  creator?: string;
  creatorKycVerified?: boolean;
}

// --- Fundraise Token Interfaces ---
interface FundRaiseData {
  launchKontingent: string;
  fundraiseSupply: string;
  poolSupply: string;
  startSalePrice: string;
  finalSalePrice: string;
  liquidityGoal: string;
  expectedTotalRaise: string;
  raised: string;
  tokensSold: string;
  teamGoal: string;
  platformFee: string;
  curve: string;
  premiumPercentage: number;
  tradingStartPrice: string;
}

interface FundraiseToken {
  id: string;
  address: string;
  symbol: string;
  pairedToken: string;
  price: string;
  network?: "main" | "test";
  totalSupply: string;
  change24h: string | number;
  marketCap: string;
  fundRaise?: FundRaiseData;
  creator?: string;
  creatorKycVerified?: boolean;
}

type ViewMode = 'dex' | 'fundraise' | 'graduated';

/** Token logo with KYC checkmark overlay */
const TokenLogoWithKYC: React.FC<{
  address: string; symbol: string; network: "main" | "test"; kycVerified?: boolean;
}> = ({ address, symbol, network, kycVerified }) => (
  <div className="relative">
    <TokenLogo address={address} symbol={symbol} network={network} />
    {kycVerified && <KYCCheckmark size={14} />}
  </div>
);

const PAGE_SIZE = 500;

/** Adaptive formatting: 2 decimals if value >= 1, 6 decimals if < 1 */
const smartFormat = (rawStr: string | number, decimals: number = 18): string => {
  const full = formatAmount18(rawStr, decimals);
  const num = parseFloat(full.replace(/,/g, ''));
  if (isNaN(num) || num === 0) return full;
  const dp = Math.abs(num) >= 1 ? 2 : 6;
  const parts = num.toFixed(dp).split('.');
  parts[0] = Number(parts[0]).toLocaleString();
  return parts.join('.');
};

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { openSwap } = useSwap();
  const { network } = useWallet();

  const [viewMode, setViewMode] = useState<ViewMode>('dex');
  const [filterText, setFilterText] = useState("");
  const [filterKYC, setFilterKYC] = useState(false);

  // --- DEX STATE ---
  const [tokens, setTokens] = useState<TokenListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sortConfig, setSortConfig] = useState<{ key: keyof TokenListItem; direction: "asc" | "desc" } | null>({
    key: "marketCap",
    direction: "desc",
  });

  // --- FUNDRAISE STATE ---
  const [fundraiseTokens, setFundraiseTokens] = useState<FundraiseToken[]>([]);
  const [loadingFundraise, setLoadingFundraise] = useState(false);

  // --- GRADUATED STATE ---
  const [graduatedTokens, setGraduatedTokens] = useState<FundraiseToken[]>([]);
  const [loadingGraduated, setLoadingGraduated] = useState(false);

  // --- DEX TRADE HANDLER ---
  const handleTrade = (e: React.MouseEvent, token: TokenListItem) => {
    e.stopPropagation();

    const {
      displaySymbol,
      displayDecimals,
      logoAddress,
      pairedTokenDecimals
    } = getTokenDisplayData(token, network);

    const baseToken = {
      address: network === 'test'
        ? "keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52"
        : "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg",
      symbol: "KTA",
      decimals: network === 'test' ? 9 : 18
    };

    const correctDecimals = pairedTokenDecimals ?? displayDecimals ?? 18;
    const assetAddress = token.pairedToken || logoAddress || token.address;

    const selectedToken = {
      address: assetAddress,
      symbol: displaySymbol,
      decimals: correctDecimals
    };

    openSwap(baseToken, selectedToken);
  };

  // --- FUNDRAISE TRADE HANDLER ---
  const handleFundraiseTrade = (e: React.MouseEvent, token: FundraiseToken) => {
    e.stopPropagation();
    const net = token.network || 'main';
    const baseToken = {
      address: net === 'test'
        ? "keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52"
        : "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg",
      symbol: "KTA",
      decimals: net === 'test' ? 9 : 18
    };
    const assetToken = {
      address: token.pairedToken || token.address,
      symbol: token.symbol,
      decimals: BASE_TOKEN[net].decimals
    };
    openSwap(baseToken, assetToken, true);
  };

  // --- DEX FETCH ---
  const fetchTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const poolsRef = collection(db, "pools");
      const q = query(
        poolsRef,
        where("network", "==", network),
        limit(PAGE_SIZE)
      );

      const querySnapshot = await getDocs(q);
      const fetchedTokens: TokenListItem[] = [];

      querySnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.pairedToken) {
          fetchedTokens.push({
            id: doc.id,
            address: data.address || doc.id,
            pairedToken: data.pairedToken,
            symbol: data.pairedTokenSymbol || data.symbol || "Unknown",
            price: data.price || "0",
            marketCap: data.marketCap || "0",
            change24h: data.change24h || data.stats?.priceChange24h || 0,
            vol24h: data.vol24h || data.stats?.vol24h || "0",
            tokenDecimals: data.tokenDecimals,
            pairedTokenDecimals: data.pairedTokenDecimals,
            baseTokenDecimals: data.baseTokenDecimals,
            pairedTokenSymbol: data.pairedTokenSymbol,
            baseTokenSymbol: data.baseTokenSymbol || "Unknown",
            mode: data.mode,
            fundraised: data.fundraised,
            creator: data.creator || "",
            creatorKycVerified: data.creatorKycVerified || false,
          });
        }
      });

      setTokens(fetchedTokens);
    } catch (err) {
      console.error(err);
      setError("Unable to fetch market data from database.");
    } finally {
      setLoading(false);
    }
  }, [network]);

  // --- FUNDRAISE FETCH ---
  const fetchFundraiseTokens = useCallback(async () => {
    setLoadingFundraise(true);
    try {
      const collectionNames = ['pools', 'pools_test'];

      const mapDoc = (doc: any): FundraiseToken => {
        const data = doc.data();
        return {
          id: doc.id,
          address: data.address || "",
          symbol: data.pairedTokenSymbol || "UNK",
          pairedToken: data.pairedToken || "",
          price: data.price || "0",
          network: data.network || "main",
          totalSupply: data.totalSupply || "0",
          change24h: data.change24h || data.stats?.priceChange24h || 0,
          marketCap: data.marketCap || "0",
          fundRaise: data.fundRaise ? {
            launchKontingent: data.fundRaise.launchKontingent,
            fundraiseSupply: data.fundRaise.fundraiseSupply,
            poolSupply: data.fundRaise.poolSupply,
            startSalePrice: data.fundRaise.startSalePrice,
            finalSalePrice: data.fundRaise.finalSalePrice,
            liquidityGoal: data.fundRaise.liquidityGoal,
            expectedTotalRaise: data.fundRaise.expectedTotalRaise,
            raised: data.fundRaise.raised,
            tokensSold: data.fundRaise.tokensSold || "0",
            teamGoal: data.fundRaise.teamGoal || "0",
            platformFee: data.fundRaise.platformFee || "0",
            curve: data.fundRaise.curve,
            premiumPercentage: data.fundRaise.premiumPercentage,
            tradingStartPrice: data.fundRaise.tradingStartPrice || "0"
          } : undefined,
          creator: data.creator || "",
          creatorKycVerified: data.creatorKycVerified || false,
        };
      };

      const snapshots = await Promise.all(
        collectionNames.map(name => {
          const ref = collection(db, name);
          const q = query(
            ref,
            where("active", "==", true),
            where("mode", "==", "fundRaising"),
            limit(100)
          );
          return getDocs(q);
        })
      );

      const fetched = snapshots.flatMap(snap => snap.docs.map(mapDoc));
      setFundraiseTokens(fetched);
    } catch (e) {
      console.error("Failed to load fundraise tokens from DB", e);
    } finally {
      setLoadingFundraise(false);
    }
  }, []);

  // --- GRADUATED FETCH ---
  const fetchGraduatedTokens = useCallback(async () => {
    setLoadingGraduated(true);
    try {
      const collectionNames = ['pools', 'pools_test'];

      const mapDoc = (doc: any): FundraiseToken => {
        const data = doc.data();
        return {
          id: doc.id,
          address: data.address || "",
          symbol: data.pairedTokenSymbol || "UNK",
          pairedToken: data.pairedToken || "",
          price: data.price || "0",
          network: data.network || "main",
          totalSupply: data.totalSupply || "0",
          change24h: data.change24h || data.stats?.priceChange24h || 0,
          marketCap: data.marketCap || "0",
          fundRaise: data.fundRaise ? {
            launchKontingent: data.fundRaise.launchKontingent,
            fundraiseSupply: data.fundRaise.fundraiseSupply,
            poolSupply: data.fundRaise.poolSupply,
            startSalePrice: data.fundRaise.startSalePrice,
            finalSalePrice: data.fundRaise.finalSalePrice,
            liquidityGoal: data.fundRaise.liquidityGoal,
            expectedTotalRaise: data.fundRaise.expectedTotalRaise,
            raised: data.fundRaise.raised,
            tokensSold: data.fundRaise.tokensSold || "0",
            teamGoal: data.fundRaise.teamGoal || "0",
            platformFee: data.fundRaise.platformFee || "0",
            curve: data.fundRaise.curve,
            premiumPercentage: data.fundRaise.premiumPercentage,
            tradingStartPrice: data.fundRaise.tradingStartPrice || "0"
          } : undefined,
          creator: data.creator || "",
          creatorKycVerified: data.creatorKycVerified || false,
        };
      };

      const snapshots = await Promise.all(
        collectionNames.map(name => {
          const ref = collection(db, name);
          const q = query(
            ref,
            where("mode", "==", "provideLiquidity"),
            where("fundraised", "==", true),
            limit(100)
          );
          return getDocs(q);
        })
      );

      const fetched = snapshots.flatMap(snap => snap.docs.map(mapDoc));
      setGraduatedTokens(fetched);
    } catch (e) {
      console.error("Failed to load graduated tokens from DB", e);
    } finally {
      setLoadingGraduated(false);
    }
  }, []);

  // --- FETCH ON MOUNT / NETWORK CHANGE ---
  useEffect(() => {
    void fetchTokens();
  }, [network, fetchTokens]);

  useEffect(() => {
    void fetchFundraiseTokens();
  }, [fetchFundraiseTokens]);

  useEffect(() => {
    void fetchGraduatedTokens();
  }, [fetchGraduatedTokens]);

  // --- DEX SORTING & FILTERING ---
  const requestSort = (key: keyof TokenListItem) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") {
      direction = "desc";
    }
    setSortConfig({ key, direction });
  };

  const getSortIndicator = (key: keyof TokenListItem) => {
    if (sortConfig?.key !== key) return <span className="text-gray-300 dark:text-gray-600 ml-1 opacity-0 group-hover:opacity-100">&#x21C5;</span>;
    return sortConfig.direction === "asc" ? <span className="text-[#845fbc] ml-1">&#x25B2;</span> : <span className="text-[#845fbc] ml-1">&#x25BC;</span>;
  };

  const sortedAndFilteredTokens = useMemo(() => {
    const filtered = tokens.filter((t) => {
      if (t.mode === "fundRaising") return false;
      if (filterKYC && !t.creatorKycVerified) return false;
      const text = filterText.toLowerCase();
      return (
        t.symbol.toLowerCase().includes(text) ||
        t.address.toLowerCase().includes(text) ||
        t.id.toLowerCase().includes(text)
      );
    });

    if (!sortConfig) return filtered;

    return [...filtered].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (["marketCap", "price", "vol24h", "change24h"].includes(sortConfig.key)) {
        const numA = Number(aValue);
        const numB = Number(bValue);
        if (numA < numB) return sortConfig.direction === "asc" ? -1 : 1;
        if (numA > numB) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      }

      const strA = String(aValue).toLowerCase();
      const strB = String(bValue).toLowerCase();
      if (strA < strB) return sortConfig.direction === "asc" ? -1 : 1;
      if (strA > strB) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [tokens, filterText, sortConfig, filterKYC]);

  // --- FUNDRAISE FILTERING ---
  const filteredFundraiseTokens = useMemo(() => {
    const networkFilter = network === 'main' ? 'main' : 'test';
    return fundraiseTokens.filter(t => {
      if ((t.network || 'main') !== networkFilter) return false;
      if (filterKYC && !t.creatorKycVerified) return false;
      return (t.symbol.toLowerCase().includes(filterText.toLowerCase()) ||
        t.address.toLowerCase().includes(filterText.toLowerCase()));
    });
  }, [fundraiseTokens, filterText, network, filterKYC]);

  // --- GRADUATED FILTERING ---
  const filteredGraduatedTokens = useMemo(() => {
    const networkFilter = network === 'main' ? 'main' : 'test';
    return graduatedTokens.filter(t => {
      if ((t.network || 'main') !== networkFilter) return false;
      if (filterKYC && !t.creatorKycVerified) return false;
      return (t.symbol.toLowerCase().includes(filterText.toLowerCase()) ||
        t.address.toLowerCase().includes(filterText.toLowerCase()));
    });
  }, [graduatedTokens, filterText, network, filterKYC]);

  const displayedCount = viewMode === 'dex' ? sortedAndFilteredTokens.length : viewMode === 'fundraise' ? filteredFundraiseTokens.length : filteredGraduatedTokens.length;
  const isLoading = viewMode === 'dex' ? loading : viewMode === 'fundraise' ? loadingFundraise : loadingGraduated;

  return (
    <div className="w-full min-h-screen flex flex-col items-center px-4 md:px-8 pt-16 md:pt-4 bg-gray-50 dark:bg-[#171717] transition-colors duration-300">

      {/* HERO SECTION */}
      <div className="w-full max-w-4xl mt-4 mb-6 text-center">
        <h1 className="text-3xl md:text-5xl font-bold font-heading text-gray-800 dark:text-white tracking-tight mb-2">
          Explore Alpaca Pools
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mb-0 text-lg">
          Discover, analyze, and trade tokens on the Keeta network.
        </p>
      </div>

      {/* MARKET OVERVIEW SECTION */}
      <div className="w-full max-w-6xl bg-white dark:bg-[#1e1e1e] rounded-2xl shadow-xl border border-gray-200 dark:border-[#333333] overflow-hidden mb-12 mt-8 transition-colors">

        {/* Toolbar */}
        <div className="p-6 border-b border-gray-100 dark:border-[#333333] flex flex-col md:flex-row justify-between items-center gap-4 bg-gray-50 dark:bg-[#2a2a2a]">
          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex bg-gray-200/60 dark:bg-black/30 rounded-lg p-1 border border-gray-200/50 dark:border-white/5">
              <button
                onClick={() => setViewMode('dex')}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all duration-200 ${viewMode === 'dex'
                  ? 'bg-white dark:bg-[#845fbc] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                DEX Pools
              </button>
              <button
                onClick={() => setViewMode('fundraise')}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all duration-200 ${viewMode === 'fundraise'
                  ? 'bg-white dark:bg-[#845fbc] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                Active Sales
              </button>
              <button
                onClick={() => setViewMode('graduated')}
                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all duration-200 ${viewMode === 'graduated'
                  ? 'bg-white dark:bg-[#845fbc] text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                Graduated
              </button>
            </div>

            <span className="text-sm font-bold text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-[#333] px-3 py-1 rounded-md uppercase tracking-wider">
              {network === 'main' ? 'Mainnet' : 'Testnet'}
            </span>

            <button
              type="button"
              onClick={() => setFilterKYC(!filterKYC)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md transition-all duration-200 border ${
                filterKYC
                  ? 'bg-teal-500 text-white border-teal-500 shadow-sm'
                  : 'bg-transparent text-gray-500 dark:text-gray-400 border-gray-300 dark:border-[#444] hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-400'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
              KYC
            </button>
          </div>

          <div className="relative w-full md:w-64">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter visible rows..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-[#1e1e1e] border text-gray-500 dark:text-gray-200 border-gray-300 dark:border-[#333333] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#845fbc] focus:border-transparent placeholder-gray-400 dark:placeholder-gray-600"
            />
          </div>
        </div>

        {/* View Description */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-[#333333] flex flex-col md:flex-row md:items-center gap-3 md:gap-6">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${viewMode === 'dex' ? 'bg-[#845fbc]' : viewMode === 'fundraise' ? 'bg-teal-500 animate-pulse' : 'bg-green-500'}`} />
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {viewMode === 'dex' && 'Tokens actively trading on the Alpaca DEX. These pools have established liquidity and are available for swaps.'}
              {viewMode === 'fundraise' && 'Tokens currently in their launch phase via bonding curve. Buy early at lower prices — once the funding goal is reached, liquidity moves to the DEX.'}
              {viewMode === 'graduated' && 'Tokens that successfully completed their launch and graduated to full DEX trading. Originally funded through PacaLaunch.'}
            </p>
          </div>
          {viewMode === 'dex' && (
            <div className="flex flex-col gap-1.5 flex-shrink-0 pl-4 md:pl-0 md:border-l md:border-gray-200 md:dark:border-[#333] md:pl-6">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 border border-teal-200/50 dark:border-teal-800/50 leading-none">Raised</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">Funded via PacaLaunch bonding curve</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-white/5 leading-none">Seeded</span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">Liquidity provided directly by creator</span>
              </div>
            </div>
          )}
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto">
          {viewMode === 'dex' && (
            /* --- DEX TABLE --- */
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#2a2a2a] text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider border-b border-gray-200 dark:border-[#333333]">
                  <th className="px-6 py-4 font-semibold w-12">#</th>
                  <th onClick={() => requestSort("symbol")} className="px-6 py-4 font-semibold cursor-pointer group hover:text-[#845fbc] transition">
                    Token {getSortIndicator("symbol")}
                  </th>
                  <th onClick={() => requestSort("price")} className="px-6 py-4 font-semibold text-right cursor-pointer group hover:text-[#845fbc] transition">
                    Price {getSortIndicator("price")}
                  </th>
                  <th onClick={() => requestSort("change24h")} className="px-6 py-4 font-semibold text-right cursor-pointer group hover:text-[#845fbc] transition">
                    24h Change {getSortIndicator("change24h")}
                  </th>
                  <th onClick={() => requestSort("vol24h")} className="px-6 py-4 font-semibold text-right hidden md:table-cell cursor-pointer group hover:text-[#845fbc] transition">
                    Volume (24h) {getSortIndicator("vol24h")}
                  </th>
                  <th onClick={() => requestSort("marketCap")} className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300 text-right hidden lg:table-cell cursor-pointer group hover:text-[#845fbc] transition">
                    Market Cap {getSortIndicator("marketCap")}
                  </th>
                  <th className="px-6 py-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#333333]">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400 italic">Loading market data...</td></tr>
                ) : error ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-red-500 font-bold">{error}</td></tr>
                ) : sortedAndFilteredTokens.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400 italic">No tokens found.</td></tr>
                ) : (
                  sortedAndFilteredTokens.map((token, index) => {
                    const change = Number(token.change24h);
                    const isPositive = change >= 0;
                    const changeColor = isPositive ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400";
                    const changeSign = isPositive ? "+" : "";
                    const rank = index + 1;
                    const { displayDecimals, currencySymbol } = getTokenDisplayData(token, network);

                    return (
                      <tr
                        key={token.id}
                        onClick={() => navigate(`/token-details?q=${token.address}`)}
                        className="hover:bg-purple-50 dark:hover:bg-[#2a2a2a] transition duration-150 cursor-pointer group"
                      >
                        <td className="px-6 py-4 text-gray-400 dark:text-gray-500 font-mono text-sm">{rank}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <TokenLogoWithKYC address={token.pairedToken} symbol={token.symbol} network={network} kycVerified={token.creatorKycVerified} />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-gray-800 dark:text-gray-200 group-hover:text-[#845fbc] dark:group-hover:text-[#a78bfa] transition">{token.symbol}</span>
                                {token.fundraised ? (
                                  <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 border border-teal-200/50 dark:border-teal-800/50 leading-none">Raised</span>
                                ) : (
                                  <span className="px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-white/5 leading-none">Seeded</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-400 dark:text-gray-500 font-mono">{token.address.substring(0, 6)}...{token.address.substring(token.address.length - 4)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-gray-800 dark:text-gray-200">{smartFormat(token.price, displayDecimals)} <span className="text-xs text-gray-400 dark:text-gray-500">{currencySymbol}</span></td>
                        <td className={`px-6 py-4 text-right font-bold ${changeColor}`}>{changeSign}{(change * 100).toFixed(2)}%</td>
                        <td className="px-6 py-4 text-right text-gray-600 dark:text-gray-400 hidden md:table-cell">{smartFormat(token.vol24h, displayDecimals)} <span className="text-xs text-gray-400 dark:text-gray-500">{currencySymbol}</span></td>
                        <td className="px-6 py-4 text-right text-gray-800 dark:text-gray-200 font-medium hidden lg:table-cell">{smartFormat(token.marketCap, displayDecimals)} <span className="text-xs text-gray-400 dark:text-gray-500">{currencySymbol}</span></td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={(e) => handleTrade(e, token)}
                            className="px-4 py-1.5 bg-[#845fbc]/10 hover:bg-[#845fbc] text-[#845fbc] hover:text-white border border-[#845fbc]/50 rounded-lg text-xs font-bold uppercase tracking-wide transition-all z-10 relative"
                          >
                            Trade
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {viewMode === 'fundraise' && (
            /* --- ACTIVE SALES TABLE --- */
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#2a2a2a] text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider border-b border-gray-200 dark:border-[#333]">
                  <th className="px-6 py-4 font-semibold w-12">#</th>
                  <th className="px-6 py-4 font-semibold">Token</th>
                  <th className="px-6 py-4 font-semibold text-right">Price</th>
                  <th className="px-6 py-4 font-semibold text-right">24h Change</th>
                  <th className="px-6 py-4 font-semibold text-right hidden lg:table-cell">Market Cap</th>
                  <th className="px-6 py-4 font-semibold text-center">Progress (Funded)</th>
                  <th className="px-6 py-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#333333]">
                {loadingFundraise ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">Loading tokens...</td></tr>
                ) : filteredFundraiseTokens.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">No active sales found.</td></tr>
                ) : (
                  filteredFundraiseTokens.map((token, index) => {
                    const change = Number(token.change24h);
                    const isPositive = change >= 0;
                    const changeColor = isPositive ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400";
                    const changeSign = isPositive ? "+" : "";
                    const decimals = BASE_TOKEN[token.network || 'main'].decimals;

                    return (
                      <tr
                        key={token.id}
                        onClick={() => navigate(`/token-details?q=${token.address}`)}
                        className="hover:bg-purple-50 dark:hover:bg-[#2a2a2a] transition-all duration-300 ease-out hover:shadow-lg hover:shadow-purple-500/10 cursor-pointer"
                      >
                        <td className="px-6 py-4 text-gray-400 font-mono text-sm">{index + 1}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <TokenLogoWithKYC address={token.pairedToken} symbol={token.symbol} network={token.network || "main"} kycVerified={token.creatorKycVerified} />
                            <div>
                              <div className="font-bold text-gray-900 dark:text-white">{token.symbol}</div>
                              <div className="text-xs text-gray-500 font-mono">{token.address.slice(0, 6)}...</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-gray-900 dark:text-white">
                          {parseRawAmount(token.price, decimals).toFixed(6)} <span className="text-xs text-gray-500">KTA</span>
                        </td>
                        <td className={`px-6 py-4 text-right font-bold ${changeColor}`}>{changeSign}{(change * 100).toFixed(2)}%</td>
                        <td className="px-6 py-4 text-right text-gray-800 dark:text-gray-200 font-medium hidden lg:table-cell">{smartFormat(token.marketCap, decimals)} <span className="text-xs text-gray-400 dark:text-gray-500">KTA</span></td>
                        <td className="px-6 py-4 flex justify-center">
                          <LaunchpadProgress
                            percent={token.fundRaise ? (parseRawAmount(token.fundRaise.raised, decimals) / parseRawAmount(token.fundRaise.expectedTotalRaise, decimals)) * 100 : 0}
                            width={120}
                            height={40}
                            curve={token.fundRaise?.curve || 'linear'}
                          />
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={(e) => handleFundraiseTrade(e, token)}
                            className="px-4 py-1.5 bg-[#845fbc]/10 hover:bg-[#845fbc] text-[#845fbc] hover:text-white border border-[#845fbc]/50 rounded-lg text-xs font-bold uppercase tracking-wide transition-all z-10 relative"
                          >
                            Buy
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {viewMode === 'graduated' && (
            /* --- GRADUATED TABLE --- */
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#2a2a2a] text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider border-b border-gray-200 dark:border-[#333]">
                  <th className="px-6 py-4 font-semibold w-12">#</th>
                  <th className="px-6 py-4 font-semibold">Token</th>
                  <th className="px-6 py-4 font-semibold text-right">Price</th>
                  <th className="px-6 py-4 font-semibold text-right">24h Change</th>
                  <th className="px-6 py-4 font-semibold text-right hidden lg:table-cell">Market Cap</th>
                  <th className="px-6 py-4 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-[#333333]">
                {loadingGraduated ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">Loading tokens...</td></tr>
                ) : filteredGraduatedTokens.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">No graduated tokens found.</td></tr>
                ) : (
                  filteredGraduatedTokens.map((token, index) => {
                    const change = Number(token.change24h);
                    const isPositive = change >= 0;
                    const changeColor = isPositive ? "text-green-500 dark:text-green-400" : "text-red-500 dark:text-red-400";
                    const changeSign = isPositive ? "+" : "";
                    const decimals = BASE_TOKEN[token.network || 'main'].decimals;

                    return (
                      <tr
                        key={token.id}
                        onClick={() => navigate(`/token-details?q=${token.address}`)}
                        className="hover:bg-purple-50 dark:hover:bg-[#2a2a2a] transition-all duration-300 ease-out hover:shadow-lg hover:shadow-purple-500/10 cursor-pointer group"
                      >
                        <td className="px-6 py-4 text-gray-400 font-mono text-sm">{index + 1}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <TokenLogoWithKYC address={token.pairedToken} symbol={token.symbol} network={token.network || "main"} kycVerified={token.creatorKycVerified} />
                            <div>
                              <div className="font-bold text-gray-900 dark:text-white group-hover:text-[#845fbc] dark:group-hover:text-[#a78bfa] transition">{token.symbol}</div>
                              <div className="text-xs text-gray-500 font-mono">{token.address.slice(0, 6)}...</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-gray-900 dark:text-white">
                          {parseRawAmount(token.price, decimals).toFixed(6)} <span className="text-xs text-gray-500">KTA</span>
                        </td>
                        <td className={`px-6 py-4 text-right font-bold ${changeColor}`}>{changeSign}{(change * 100).toFixed(2)}%</td>
                        <td className="px-6 py-4 text-right text-gray-800 dark:text-gray-200 font-medium hidden lg:table-cell">{smartFormat(token.marketCap, decimals)} <span className="text-xs text-gray-400 dark:text-gray-500">KTA</span></td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={(e) => handleFundraiseTrade(e, token)}
                            className="px-4 py-1.5 bg-[#845fbc]/10 hover:bg-[#845fbc] text-[#845fbc] hover:text-white border border-[#845fbc]/50 rounded-lg text-xs font-bold uppercase tracking-wide transition-all z-10 relative"
                          >
                            Trade
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-[#333333] bg-gray-50 dark:bg-[#2a2a2a] flex justify-center items-center">
          <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold">
            {isLoading ? "Loading..." : `Showing ${displayedCount} tokens`}
          </span>
        </div>

      </div>
    </div>
  );
};

export default HomePage;

import React, {
  useState,
  useCallback,
  useMemo,
  useEffect
} from "react";
import type { FormEvent } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";

import type {
  PoolData,
  SearchResult,
  Transaction,
  StatsTimeFrame,
  StatRow,
  //FundRaiseData
} from "../types";


import { formatAmount18, shortenAddress, formatNumber, formatCurrency, parseRawAmount } from "../utils/formatters";
import { getTokenDisplayData } from "../utils/token";

import { useWallet } from "../context/WalletContext"; // Import useWallet
import { useSwap } from "../context/SwapContext";

import { TokenLogo } from "../components/common/TokenLogo";
import { CommentSection } from "../components/pool/CommentSection";
import { useKYCStatus, KYCCheckmark } from "../components/common/KYCBadge";
import AdvancedPriceChart from "../components/charts/AdvancedPriceChart";
import { PriceChart as BondingCurvePriceChart, type ChartDataPoint } from "../components/charts/BondingCurveChart";
import { calculateSpotPrice, BondingCurve } from "../utils/launchpadMath";
import { BASE_TOKEN } from "../services/pool";
import { PoolStatsTable } from "../components/pool/PoolStatsTable";
import { TransactionsList, MobileTransactionsList } from "../components/pool/TransactionsList";
import { EditPoolModal } from "../components/pool/EditPoolModal";
import {
  StatsTabBar, MatchingPoolsSelector,
  MetricTitle, MetricBar
} from "../components/common/UIComponents";
//import { TopHoldersTable } from "../components/common/TopHoldersTable";


import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit
} from "firebase/firestore";
import { db } from "../config/firebase";
import { WalletService } from "../services/wallet";
import { cacheGet, cacheSet } from "../services/cache";

const TokenDetailsPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryParam = searchParams.get("q");
  const navigate = useNavigate();

  const { openSwap } = useSwap();
  const { network, address: walletAddress } = useWallet();

  const [showEditModal, setShowEditModal] = useState(false);

  const [mobileTab, setMobileTab] = useState<"metrics" | "transactions">("metrics");

  const [poolIdInput, setPoolIdInput] = useState<string>("");

  const [poolData, setPoolData] = useState<PoolData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [matchingPools, setMatchingPools] = useState<SearchResult[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);

  const [statsTimeFrame, setStatsTimeFrame] = useState<StatsTimeFrame>("24h");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  const [isUsd, setIsUsd] = useState(false);
  const [ktaPriceUSD, setKtaPriceUSD] = useState<number>(0);

  const kyc = useKYCStatus(poolData?.creator, network);
  const isCreator = !!(walletAddress && poolData?.creator && walletAddress === poolData.creator);

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

  const KTA_ADDRESS = "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg";



  // --- API HANDLERS ---

  const handleSearch = useCallback(async (q: string): Promise<void> => {
    if (!q) {
      setError("Please enter an ID, Address, or Token Symbol.");
      return;
    }
    const term = q.trim();
    setLoading(true); setError(null); setPoolData(null); setMatchingPools([]); setSelectedPoolId(null);

    // Check search cache (5-min TTL)
    const searchCacheKey = `poolSearch_${term.toLowerCase()}`;
    const cachedResults = cacheGet<SearchResult[]>(searchCacheKey);
    if (cachedResults) {
      if (cachedResults.length === 0) setError(`No pool found matching query: ${term}`);
      else if (cachedResults.length === 1) setSelectedPoolId(cachedResults[0].id);
      else setMatchingPools(cachedResults);
      setSearchParams({ q: term });
      setLoading(false);
      return;
    }

    try {
      const results: SearchResult[] = [];
      const collectionNames = ["pools", "pools_test"];

      for (const colName of collectionNames) {
        const poolsRef = collection(db, colName);

        // 1. Try by ID (Document Key)
        const docRef = doc(db, colName, term);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          results.push({
            id: docSnap.id,
            address: data.address || "N/A",
            pairedTokenSymbol: data.pairedTokenSymbol || "N/A"
          });
        }

        // 2. Try by Address
        const qAddress = query(poolsRef, where("address", "==", term), limit(5));
        const addressSnaps = await getDocs(qAddress);
        addressSnaps.forEach(doc => {
          const data = doc.data();
          results.push({
            id: doc.id,
            address: data.address || "N/A",
            pairedTokenSymbol: data.pairedTokenSymbol || "N/A"
          });
        });

        // 3. Try by Symbol (pairedTokenSymbol)
        const qSymbol = query(poolsRef, where("pairedTokenSymbol", "==", term.toUpperCase()), limit(5));
        const symbolSnaps = await getDocs(qSymbol);
        symbolSnaps.forEach(doc => {
          const data = doc.data();
          results.push({
            id: doc.id,
            address: data.address || "N/A",
            pairedTokenSymbol: data.pairedTokenSymbol || "N/A"
          });
        });
      }

      // Deduplicate results
      const uniqueResults = results.filter((pool, index, self) =>
        index === self.findIndex((t) => t.id === pool.id)
      );

      cacheSet(searchCacheKey, uniqueResults);

      if (uniqueResults.length === 0) setError(`No pool found matching query: ${term}`);
      else if (uniqueResults.length === 1) setSelectedPoolId(uniqueResults[0].id);
      else setMatchingPools(uniqueResults);

      setSearchParams({ q: term });
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "An unknown search error occurred.";
      setError(`Search failed. Details: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }, [setSearchParams]);



  const fetchStatsByPoolId = useCallback(async (id: string): Promise<void> => {
    setLoading(true); setError(null); setPoolData(null); setMatchingPools([]);

    // Check cache first (2-min TTL — pool prices change)
    const cacheKey = `poolData_${id}`;
    const cachedPool = cacheGet<PoolData>(cacheKey, 2 * 60 * 1000);
    if (cachedPool) {
      setPoolData(cachedPool);
      setLoading(false);
      return;
    }

    try {
      // Try pools first, then pools_test
      let docSnap = await getDoc(doc(db, "pools", id));
      if (!docSnap.exists()) {
        docSnap = await getDoc(doc(db, "pools_test", id));
      }

      if (!docSnap.exists()) {
        setError("Pool found in search but document is missing.");
        return;
      }

      const data = docSnap.data();

      // Map Firestore data to PoolData interface
      const pool: PoolData = {
        poolId: docSnap.id,
        address: data.address || "",
        pairedTokenSymbol: data.pairedTokenSymbol || "UNK",
        baseTokenSymbol: data.baseTokenSymbol || "BASE",
        pairedTokenName: data.pairedTokenName || "",
        baseTokenName: data.baseTokenName || "",
        tokenomicsUrl: data.tokenomicsUrl || "",
        totalSupply: data.totalSupply || "0",
        creatorSupplyOwnership: data.creatorSupplyOwnership || "0",
        marketCap: data.marketCap || "0",
        baseToken: data.baseToken,
        pairedToken: data.pairedToken,
        price: data.price,
        stats: data.stats,
        tokenDecimals: data.tokenDecimals || data.baseTokenDecimals,
        pairedTokenDecimals: data.pairedTokenDecimals,
        baseTokenDecimals: data.baseTokenDecimals,
        mode: data.mode,
        network: data.network || "main",
        baseTokenAmount: data.baseTokenAmount || "0",
        pairedTokenAmount: data.pairedTokenAmount || "0",
        description: data.description || "",
        website: data.website || "",
        xAccount: data.xAccount || "",
        discord: data.discord || "",
        creator: data.creator || "",
        creatorFee: data.creatorFee ?? 0,
        liquidityFeeTokenBurnRate: data.liquidityFeeTokenBurnRate ?? 0,
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
      };

      setPoolData(pool);
      cacheSet(cacheKey, pool);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error fetching pool details");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTransactions = useCallback(async (poolAddress: string, network: "main" | "test") => {
    const cacheKey = `txCache_${poolAddress}`;

    // Show cached data instantly if available
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const { txs, ts } = JSON.parse(cached);
        setTransactions(txs);
        setTxLoading(false);
        // If cache is fresh (< 2 min), skip refetch
        if (Date.now() - ts < 120_000) return;
      } else {
        setTxLoading(true);
      }
    } catch { setTxLoading(true); }

    // Fetch fresh data in background
    try {
      const history = await WalletService.getWalletHistory(poolAddress, network);

      const deduped = history.filter(tx =>
        tx.type !== 'SWAP' || tx.blockAuthor !== poolAddress
      );

      const mappedTxs: Transaction[] = deduped.map(tx => ({
        type: tx.type === 'SWAP' ? 'SWAP' : 'UNKNOWN',
        hash: tx.hash,
        timestamp: tx.timestamp,
        data: {
          sendAmount: tx.tokenIn?.amount,
          sendToken: tx.tokenIn?.address,
          sendSymbol: tx.tokenIn?.symbol,
          receiveAmount: tx.tokenOut?.amount,
          receiveToken: tx.tokenOut?.address,
          receiveSymbol: tx.tokenOut?.symbol,
          trader: tx.blockAuthor || undefined,
        }
      }));

      setTransactions(mappedTxs);
      try { sessionStorage.setItem(cacheKey, JSON.stringify({ txs: mappedTxs, ts: Date.now() })); } catch { }
    } catch (e) { console.error("Tx Load Error", e); } finally { setTxLoading(false); }
  }, []);

  // ✅ FIXED: Added decimals to token objects
  const handleSwap = () => {
    if (!poolData) return;

    // Use Helper for standardized data
    const {
      displaySymbol,
      pairedTokenDecimals,
      logoAddress
    } = getTokenDisplayData(poolData, network);

    const kta = {
      address: KTA_ADDRESS,
      symbol: "KTA",
      decimals: 18 // KTA always has 18 decimals
    };

    // Asset Decimals Logic
    // Prioritize pairedTokenDecimals (from Helper/DB). 
    // Fallback to tokenDecimals (legacy DB field) or 18.
    const assetDecimals = pairedTokenDecimals ?? (poolData as any).tokenDecimals ?? 18;

    const assetToken = {
      address: logoAddress || poolData.pairedToken || "",
      symbol: displaySymbol,
      decimals: Number(assetDecimals)
    };

    openSwap(kta, assetToken, poolData.mode === "fundRaising");
  };

  useEffect(() => {
    if (queryParam) {
      setPoolIdInput(queryParam);
      void handleSearch(queryParam);
    }
  }, [queryParam, handleSearch]);


  useEffect(() => {
    if (poolData && poolData.address) {
      const net = (poolData as any).network || 'main';
      void fetchTransactions(poolData.address, net);
    }
  }, [poolData, fetchTransactions]);
  useEffect(() => { if (selectedPoolId) void fetchStatsByPoolId(selectedPoolId); }, [selectedPoolId, fetchStatsByPoolId]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void handleSearch(poolIdInput.trim());
  };

  const [universalRows, dynamicRows] = useMemo<[StatRow[], StatRow[]]>(() => {
    if (!poolData) return [[], []];
    const s = poolData.stats || {};
    const tf = statsTimeFrame.toLowerCase() as "5m" | "1h" | "6h" | "24h";
    const changeRaw = s && typeof s.priceChange24h !== "undefined" ? Number(s.priceChange24h) : NaN;
    const formattedChange = Number.isNaN(changeRaw) ? "N/A" : `${(changeRaw * 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    const changeColor = !Number.isNaN(changeRaw) ? (changeRaw > 0 ? "text-emerald-600 dark:text-emerald-400 font-bold" : changeRaw < 0 ? "text-red-500 font-bold" : "text-gray-500") : "text-gray-500";

    // Dynamic Decimals Logic - Use Helper
    const { displayDecimals, currencySymbol } = getTokenDisplayData(poolData, network);

    const formatValue = (rawValue: string | number | undefined, decimals: number | undefined, skipDecimals: boolean = false) => {
      if (rawValue === undefined || rawValue === null || rawValue === "") return "-";
      const formatted = formatAmount18(rawValue.toString(), decimals);
      const cleanFormatted = skipDecimals ? formatted.split(".")[0] : formatted;
      if (isUsd && ktaPriceUSD > 0) {
        const usdValue = parseFloat(formatted.replace(/,/g, "")) * ktaPriceUSD;
        if (usdValue < 0.000001 && usdValue > 0) return `< $0.000001`;
        return `$${usdValue.toLocaleString('en-US', { minimumFractionDigits: skipDecimals ? 0 : 2, maximumFractionDigits: skipDecimals ? 0 : 6 })}`;
      }
      return `${cleanFormatted} ${currencySymbol}`;
    };

    const universal: StatRow[] = [
      ["Price", poolData.price ? formatValue(poolData.price, displayDecimals) : "-"],
      ["Market Cap", poolData.marketCap ? formatValue(poolData.marketCap, displayDecimals, true) : "-"],
      ["Token Symbol", poolData.pairedTokenSymbol || "-"],
      ["Total Supply", poolData.totalSupply ? formatAmount18(poolData.totalSupply, 18).split(".")[0] : "-"], // Supply usually own decimals? Maybe 18 for now.
      ["All Time High", s.ath ? formatValue(s.ath, displayDecimals) : "-"],
      ["Price Change (24h)", formattedChange, changeColor],
      ["Creator Ownership", `${Math.round(Number(poolData.creatorSupplyOwnership || 0) * 100)}%`],
      ["Pool Address", <a href={`https://explorer.keeta.com/storage/${poolData.address}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 dark:text-blue-400 underline">{shortenAddress(poolData.address)}</a>],
    ];

    const sAny = s as any;
    const vol = sAny[`vol${tf}`] || "-";
    const buysInt = parseInt((sAny[`buys${tf}`] || "0").replace(/,/g, ""), 10);
    const sellsInt = parseInt((sAny[`sells${tf}`] || "0").replace(/,/g, ""), 10);
    const buyersInt = parseInt((sAny[`buyers${tf}`] || "0").replace(/,/g, ""), 10);
    const sellersInt = parseInt((sAny[`sellers${tf}`] || "0").replace(/,/g, ""), 10);
    const tradersInt = parseInt((sAny[`traders${tf}`] || "0").replace(/,/g, ""), 10);

    const volumeLabel = tf === "5m" ? "Volume (5m)" : tf === "1h" ? "Volume (1h)" : tf === "6h" ? "Volume (6h)" : "Volume (24h)";

    const dynamic: StatRow[] = [
      [volumeLabel, vol === "-" ? "-" : formatValue(vol, displayDecimals)],
      [<MetricTitle label="Total Txns" value={buysInt + sellsInt} />, <MetricBar buyLabel="Buys" buyValue={buysInt} sellLabel="Sells" sellValue={sellsInt} />],
      [<MetricTitle label="Makers" value={tradersInt} />, <MetricBar buyLabel="Buyers" buyValue={buyersInt} sellLabel="Sellers" sellValue={sellersInt} />]
    ];
    return [universal, dynamic];
  }, [poolData, statsTimeFrame, network, isUsd, ktaPriceUSD]);

  const currentPriceDisplay = useMemo(() => {
    let rawValue: string | number = 0;

    if (poolData && poolData.price) {
      // Get raw value from pool data
      rawValue = poolData.price;
    }

    // Dynamic Decimals logic for Price Display - Use Helper
    const { displayDecimals } = getTokenDisplayData(poolData || {}, network);
    return parseFloat(formatAmount18(rawValue.toString(), displayDecimals).replace(/,/g, ""));
  }, [poolData, network]);

  // Use poolData.stats.priceChange24h as the source of truth if available
  const changePercentDisplay = useMemo(() => {
    if (poolData && poolData.stats && typeof poolData.stats.priceChange24h !== "undefined") {
      return Number(poolData.stats.priceChange24h) * 100;
    }

    return 0;
  }, [poolData]);

  const isPositive = changePercentDisplay >= 0;

  const headerToken = useMemo(() => {
    if (!poolData) return { symbol: "TOKEN", name: "Token", address: "" };

    // Use centralized helper to determine display symbol and logo address
    const { displaySymbol, logoAddress } = getTokenDisplayData(poolData, network);

    return {
      symbol: displaySymbol,
      name: poolData.pairedTokenName || displaySymbol, // Fallback name
      address: logoAddress
    };
  }, [poolData, network]);

  const hasLinks = poolData && (poolData.website || poolData.xAccount || poolData.discord || poolData.tokenomicsUrl);

  const [kycTooltipOpen, setKycTooltipOpen] = useState(false);

  const AboutSection = ({ className = "" }: { className?: string }) => {
    if (!poolData) return null;
    const hasDescription = poolData.description && poolData.description.trim().length > 0;
    if (!hasDescription && !hasLinks && !kyc.verified) return null;

    const validDate = kyc.validUntil ? new Date(kyc.validUntil) : null;
    const issuedDate = kyc.issuedAt ? new Date(kyc.issuedAt) : null;

    return (
      <div className={`bg-white dark:bg-[#1a1a1a] rounded-xl shadow-sm border border-gray-200 dark:border-white/[0.08] overflow-hidden ${className}`}>
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/[0.08] flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-gray-800 dark:text-white flex items-center gap-2">
            About {poolData.pairedTokenSymbol}
            {/* Creator edit button */}
            {isCreator && (
              <button
                onClick={() => setShowEditModal(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-md bg-[#845fbc]/10 text-[#845fbc] border border-[#845fbc]/20 hover:bg-[#845fbc]/20 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                Edit
              </button>
            )}
            {/* Desktop: integrated tooltip badge */}
            {kyc.verified && (
              <div className="relative hidden md:block">
                <button
                  type="button"
                  onClick={() => setKycTooltipOpen(!kycTooltipOpen)}
                  onMouseEnter={() => setKycTooltipOpen(true)}
                  onMouseLeave={() => setKycTooltipOpen(false)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20 hover:bg-teal-500/20 transition-colors cursor-default"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                  Verified
                </button>
                {kycTooltipOpen && (
                  <div className="absolute top-full left-0 mt-2 w-56 p-3 rounded-xl bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] shadow-sm z-50 animate-fade-in">
                    <div className="text-xs font-bold text-teal-600 dark:text-teal-400 mb-2">Creator KYC Verified</div>
                    <div className="space-y-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                      {kyc.issuer && <div className="truncate">Issuer: <span className="text-gray-700 dark:text-gray-300">{kyc.issuer}</span></div>}
                      {issuedDate && <div>Issued: <span className="text-gray-700 dark:text-gray-300">{issuedDate.toLocaleDateString()}</span></div>}
                      {validDate && <div>Expires: <span className="text-gray-700 dark:text-gray-300">{validDate.toLocaleDateString()}</span></div>}
                    </div>
                    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-white/[0.08] text-[10px] text-gray-400">On-chain certificate</div>
                  </div>
                )}
              </div>
            )}
          </h3>
        </div>
        <div className="p-5 space-y-4">
          {/* Mobile: full KYC card */}
          {kyc.verified && (
            <div className="md:hidden flex items-start gap-3 p-3 rounded-xl bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-800/30">
              <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-teal-700 dark:text-teal-400">Creator KYC Verified</div>
                {kyc.issuer && (
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">Issuer: {kyc.issuer}</div>
                )}
                <div className="flex gap-3 mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                  {issuedDate && <span>Issued: {issuedDate.toLocaleDateString()}</span>}
                  {validDate && <span>Expires: {validDate.toLocaleDateString()}</span>}
                </div>
              </div>
            </div>
          )}
          {hasDescription && (
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">
              {poolData.description}
            </p>
          )}
          {hasLinks && (
            <div className={`flex flex-wrap gap-2 ${hasDescription ? 'pt-3 border-t border-gray-100 dark:border-white/[0.08]' : ''}`}>
              {poolData.website && (
                <a href={poolData.website} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] text-gray-700 dark:text-gray-300 hover:border-[#845fbc] hover:text-[#845fbc] dark:hover:border-[#845fbc] dark:hover:text-[#845fbc] transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" /></svg>
                  Website
                </a>
              )}
              {poolData.xAccount && (
                <a href={poolData.xAccount.startsWith('http') ? poolData.xAccount : `https://x.com/${poolData.xAccount.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] text-gray-700 dark:text-gray-300 hover:border-[#845fbc] hover:text-[#845fbc] dark:hover:border-[#845fbc] dark:hover:text-[#845fbc] transition-colors">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                  X / Twitter
                </a>
              )}
              {poolData.discord && (
                <a href={poolData.discord.startsWith('http') ? poolData.discord : `https://discord.gg/${poolData.discord}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] text-gray-700 dark:text-gray-300 hover:border-[#845fbc] hover:text-[#845fbc] dark:hover:border-[#845fbc] dark:hover:text-[#845fbc] transition-colors">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" /></svg>
                  Discord
                </a>
              )}
              {poolData.tokenomicsUrl && (
                <a href={poolData.tokenomicsUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] text-gray-700 dark:text-gray-300 hover:border-[#845fbc] hover:text-[#845fbc] dark:hover:border-[#845fbc] dark:hover:text-[#845fbc] transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Tokenomics
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- Fundraise Details Data ---
  const detailsData = useMemo(() => {
    if (!poolData || poolData.mode !== "fundRaising" || !poolData.fundRaise) return null;

    const fr = poolData.fundRaise;
    const decimals = BASE_TOKEN[poolData.network || 'main'].decimals;

    const d_fundraiseSupply = parseRawAmount(fr.fundraiseSupply ?? "0", decimals);
    const d_poolSupply = parseRawAmount(fr.poolSupply ?? "0", decimals);
    const d_startPrice = parseRawAmount(fr.startSalePrice ?? "0", decimals);
    const d_tokensSold = parseRawAmount(fr.tokensSold ?? "0", decimals);
    const d_raised = parseRawAmount(fr.raised ?? "0", decimals);
    const d_goal = parseRawAmount(fr.liquidityGoal ?? "0", decimals);
    const d_expectedRaise = parseRawAmount(fr.expectedTotalRaise ?? "0", decimals);
    const d_tradingStartPrice = parseRawAmount(fr.tradingStartPrice ?? "0", decimals);
    const d_totalSupply = parseRawAmount(poolData.totalSupply ?? "0", decimals);
    const d_targetMarketCap = d_tradingStartPrice * d_totalSupply;

    const d_teamFunds = parseRawAmount(fr.teamGoal ?? "0", decimals);
    const d_platformFee = parseRawAmount(fr.platformFee ?? "0", decimals);
    const d_baseInLP = d_goal;

    const MATH_DECIMALS = 18;
    const SCALE = 10 ** MATH_DECIMALS;

    let d_currentSpotPrice = d_startPrice;
    if (d_fundraiseSupply > 0) {
      try {
        const spotBigInt = calculateSpotPrice(
          (fr.curve || 'fixed') as BondingCurve,
          BigInt(Math.floor(d_startPrice * SCALE)),
          BigInt(Math.floor(d_expectedRaise)),
          BigInt(Math.floor(d_fundraiseSupply)),
          BigInt(Math.floor(d_tokensSold)),
          MATH_DECIMALS
        );
        d_currentSpotPrice = Number(spotBigInt) / SCALE;
      } catch {
        d_currentSpotPrice = d_startPrice;
      }
    }

    const points = 100;
    const data: ChartDataPoint[] = [];
    const curveType = (fr.curve || 'fixed').toLowerCase();

    for (let i = 0; i <= points; i++) {
      const progress = i / points;
      const x = d_fundraiseSupply * progress;
      let y = d_startPrice;

      try {
        const spotBigInt = calculateSpotPrice(
          curveType as BondingCurve,
          BigInt(Math.floor(d_startPrice * SCALE)),
          BigInt(Math.floor(d_expectedRaise)),
          BigInt(Math.floor(d_fundraiseSupply)),
          BigInt(Math.floor(x)),
          MATH_DECIMALS
        );
        y = Number(spotBigInt) / SCALE;
      } catch {
        y = d_startPrice;
      }

      data.push({ tokensSold: x, price: y });
    }

    const inventoryPercent = d_fundraiseSupply > 0 ? (d_tokensSold / d_fundraiseSupply) * 100 : 0;
    const cashPercent = d_expectedRaise > 0 ? (d_raised / d_expectedRaise) * 100 : 0;
    const d_listingPrice = d_poolSupply > 0 ? d_goal / d_poolSupply : 0;

    return {
      graphData: data,
      fundraiseSupply: d_fundraiseSupply,
      poolSupply: d_poolSupply,
      tokensSold: d_tokensSold,
      raised: d_raised,
      goal: d_goal,
      curve: fr.curve ?? "Unknown",
      teamFunds: d_teamFunds,
      platformFee: d_platformFee,
      baseInLP: d_baseInLP,
      expectedRaise: d_expectedRaise,
      premium: fr.premiumPercentage ?? 0,
      inventoryPercent: Math.min(inventoryPercent, 100),
      cashPercent: Math.min(cashPercent, 100),
      listingPrice: d_listingPrice,
      listingPriceDB: d_tradingStartPrice,
      targetMarketCap: d_targetMarketCap,
      currentSpotPrice: d_currentSpotPrice,
      currentMarketCap: d_currentSpotPrice * d_totalSupply,
      hasData: true
    };
  }, [poolData]);

  // --- Fundraise detail view ---
  if (poolData && poolData.mode === "fundRaising" && detailsData) {
    return (
      <div className="w-full min-h-screen transition-colors duration-300 pt-24 p-4 lg:p-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button onClick={() => navigate("/")} className="p-2 rounded-full bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-500 hover:text-gray-900 dark:hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <div>
                <div className="inline-block px-2 py-0.5 rounded border border-[#845fbc]/30 bg-[#845fbc]/10 text-[#845fbc] text-[9px] font-semibold uppercase tracking-[0.06em] mb-1">
                  LIVE POOL
                </div>
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-white flex items-center gap-3">
                  <div className="w-10 h-10 relative">
                    <TokenLogo address={poolData.pairedToken || ""} symbol={poolData.pairedTokenSymbol} network={poolData.network || "main"} />
                    {kyc.verified && <KYCCheckmark size={16} />}
                  </div>
                  {poolData.pairedTokenSymbol} Fundraise
                </h1>
              </div>
            </div>
            <button onClick={handleSwap} className="px-6 py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md transition">
              Buy {poolData.pairedTokenSymbol}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fade-in">
            {/* LEFT Panel */}
            <div className="lg:col-span-4 flex flex-col">
              <div className="glass-panel shadow-none p-8 transition-all duration-300 ease-out hover:shadow-sm hover:border-purple-400/30 dark:hover:border-purple-500/20 flex-grow flex flex-col justify-between">
                <div>
                  <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-8 flex items-center gap-2">Launch Configuration</h2>
                  <div className="space-y-6">
                    <div><p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Pool Address</p><a href={`${poolData.network === 'test' ? 'https://explorer.test.keeta.com' : 'https://explorer.keeta.com'}/account/${poolData.address}`} target="_blank" rel="noopener noreferrer" className="block font-mono text-xs text-[#845fbc] hover:underline break-all bg-gray-50 dark:bg-black/20 p-2 rounded border border-gray-200 dark:border-white/5 cursor-pointer">{poolData.address}</a></div>
                    <div className="grid grid-cols-2 gap-4">
                      <div><p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Curve Type</p><p className="text-sm font-medium text-gray-900 dark:text-white capitalize">{detailsData.curve}</p></div>
                      <div><p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Sale Discount</p><span className="text-[10px] px-2 py-0.5 rounded border bg-purple-100 dark:bg-purple-900/30 text-[#845fbc] border-purple-200 dark:border-purple-800">{Math.round(detailsData.premium * 100)}% Boost</span></div>
                    </div>
                    <div className="pt-5 border-t border-gray-100 dark:border-white/[0.08]">
                      <div className="flex justify-between items-center mb-3"><span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Target Liquidity</span><span className="text-sm font-bold text-gray-900 dark:text-white font-mono">{formatCurrency(detailsData.goal)}</span></div>
                      <div className="flex justify-between items-center"><span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Total Raise</span><span className="text-xs font-medium text-[#845fbc]">{formatCurrency(detailsData.expectedRaise)}</span></div>
                    </div>
                    <div className="pt-5 border-t border-gray-100 dark:border-white/[0.08]">
                      <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-4">Pricing Target</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <div><p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Listing Price</p><p className="text-sm font-bold text-teal-500 font-mono">{detailsData.listingPriceDB.toFixed(6)} KTA</p></div>
                        <div><p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Target Market Cap</p><p className="text-sm font-bold text-[#845fbc] font-mono">{formatCurrency(detailsData.targetMarketCap)}</p></div>
                      </div>
                    </div>
                    <div className="pt-5 border-t border-gray-100 dark:border-white/[0.08]">
                      <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-4">Token Distribution</h3>
                      <div className="space-y-3 font-mono text-xs">
                        <div className="flex justify-between items-center text-gray-600 dark:text-white/80"><span>Launch (Sale)</span><span className="font-bold text-gray-900 dark:text-white">{formatNumber(detailsData.fundraiseSupply)}</span></div>
                        <div className="w-full h-1.5 bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-[#845fbc]" style={{ width: '100%' }}></div></div>
                        <div className="flex justify-between items-center text-gray-600 dark:text-white/80"><span>Liquidity (Pool)</span><span className="font-bold text-gray-900 dark:text-white">{formatNumber(detailsData.poolSupply)}</span></div>
                      </div>
                    </div>
                    <div className="pt-5 border-t border-gray-100 dark:border-white/[0.08]">
                      <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-4">Projected Cash Flow</h3>
                      <div className="space-y-3 font-mono text-xs">
                        <div className="flex justify-between items-center"><span className="text-gray-600 dark:text-gray-400">Locked in LP</span><span className="text-teal-600 dark:text-teal-400 font-bold">{formatCurrency(detailsData.baseInLP)}</span></div>
                        <div className="flex justify-between items-center"><span className="text-gray-600 dark:text-gray-400">Team Payout</span><span className="text-[#845fbc] font-bold">{formatCurrency(detailsData.teamFunds)}</span></div>
                        <div className="flex justify-between items-center"><span className="text-gray-600 dark:text-gray-400">Platform Fee</span><span className="text-gray-500 font-bold">{formatCurrency(detailsData.platformFee)}</span></div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="pt-6 mt-6 border-t border-gray-100 dark:border-white/[0.08]">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Funded (Cash)</p>
                    <span className="text-teal-500 text-xs font-bold">{detailsData.cashPercent.toFixed(2)}%</span>
                  </div>
                  <div className="w-full h-3 bg-gray-100 dark:bg-black/30 rounded-full overflow-hidden">
                    <div className="h-full bg-teal-500" style={{ width: `${detailsData.cashPercent}%` }}></div>
                  </div>
                </div>
              </div>
              <AboutSection className="mt-6" />
            </div>

            {/* RIGHT Panel */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-5 rounded-xl shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-sm hover:border-teal-400/50 dark:hover:border-teal-500/30">
                  <p className="text-gray-500 text-[11px] uppercase tracking-[0.08em] font-semibold">Raised</p>
                  <p className="text-2xl font-bold font-mono mt-1 text-teal-500">{formatCurrency(detailsData.raised)}</p>
                  <p className="text-[10px] text-gray-500 mt-2">Goal: {formatCurrency(detailsData.goal)}</p>
                </div>
                <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-5 rounded-xl shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-sm hover:border-gray-400/50 dark:hover:shadow-white/5 dark:hover:border-white/20 min-w-0">
                  <p className="text-gray-500 text-[11px] uppercase tracking-[0.08em] font-semibold">Remaining Inventory</p>
                  <p className="text-2xl font-bold font-mono mt-1 text-gray-900 dark:text-white truncate" title={formatNumber(detailsData.fundraiseSupply - detailsData.tokensSold)}>{formatNumber(detailsData.fundraiseSupply - detailsData.tokensSold)}</p>
                </div>
                <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-5 rounded-xl shadow-sm transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-sm hover:border-purple-400/50 dark:hover:border-purple-500/30">
                  <p className="text-gray-500 text-[11px] uppercase tracking-[0.08em] font-semibold">Market Cap</p>
                  <p className="text-2xl font-bold font-mono mt-1 text-[#845fbc]">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'KTA', maximumFractionDigits: 0 }).format(detailsData.currentMarketCap)}</p>
                  <p className="text-[10px] text-gray-500 mt-2">Target: {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'KTA', maximumFractionDigits: 0 }).format(detailsData.targetMarketCap)}</p>
                </div>
                <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-5 rounded-xl shadow-sm border-r-4 border-r-[#845fbc] transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-sm hover:border-purple-400/50 dark:hover:border-purple-500/30">
                  <p className="text-gray-500 text-[11px] uppercase tracking-[0.08em] font-semibold">Current Spot Price</p>
                  <p className="text-2xl font-bold font-mono mt-1 text-[#845fbc]">{detailsData.currentSpotPrice.toFixed(6)} KTA</p>
                </div>
              </div>

              <div className="glass-panel shadow-none p-6 flex-grow flex flex-col min-h-[400px]">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse"></span>Live Bonding Curve</h2>
                </div>
                <div className="flex-grow w-full relative">
                  <BondingCurvePriceChart
                    data={detailsData.graphData}
                    curveType={detailsData.curve}
                    currentSold={detailsData.tokensSold}
                    listingPrice={detailsData.listingPrice}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen flex flex-col items-center px-4 md:px-8 pt-16 md:pt-4 transition-colors duration-300">

      <header className="mt-3 mb-3 w-full max-w-2xl text-center">
        {/* ✅ FIXED: Hidden when poolData exists, only shows search prompt otherwise */}
        {!poolData && (
          <p className="mt-9 text-gray-500 dark:text-gray-400 mb-8 text-lg font-semibold">
            Search by Pool ID, Pool Address, or Token Symbol.
          </p>
        )}
      </header>

      {!poolData && (
        <form onSubmit={handleSubmit} className="w-full max-w-lg mx-auto relative flex items-center mb-12">
          <input
            type="text"
            value={poolIdInput}
            onChange={(e) => {
              setPoolIdInput(e.target.value);
              if (matchingPools.length > 0 || poolData || error) { setMatchingPools([]); setPoolData(null); setError(null); }
            }}
            placeholder="ID, Address, or Token Symbol (e.g., KTA)"
            className="w-full p-4 pl-6 pr-32 text-[13px] rounded-md border border-gray-300 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] text-gray-900 dark:text-gray-200 focus:ring-2 focus:ring-[#845fbc] focus:border-transparent outline-none transition"
            disabled={loading}
          />
          <button
            type="submit"
            className="absolute right-2 top-2 bottom-2 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md px-6 transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading || poolIdInput.trim() === ""}
          >
            {loading ? "..." : "Search"}
          </button>
        </form>
      )}

      <div className="w-full max-w-7xl px-4">
        <div className="w-full max-w-lg mx-auto">
          {loading && (
            <div className="text-center py-10">
              <p className="text-gray-500 mt-2">Searching for pools...</p>
            </div>
          )}
          {error && (<div role="alert" className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-md shadow-sm mb-8"><p className="font-bold">Search Error</p><p>{error}</p></div>)}
          {!loading && matchingPools.length > 0 && <MatchingPoolsSelector pools={matchingPools} onSelect={(id: string) => setSelectedPoolId(id)} />}
        </div>

        {!loading && selectedPoolId && poolData && (
          <div className="w-full max-w-7xl mx-auto animate-fade-in">

            {/* ─── MOBILE HERO ─── */}
            <div className="lg:hidden mb-4 bg-white dark:bg-[#1a1a1a] p-4 rounded-xl border border-gray-200 dark:border-white/[0.08]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <TokenLogo symbol={headerToken.symbol} address={headerToken.address} className="w-10 h-10" network={network} />
                    {kyc.verified && <KYCCheckmark size={16} />}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 dark:text-white">{headerToken.symbol}</div>
                    <div className="text-xs text-gray-500">{headerToken.name}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-gray-900 dark:text-white text-sm">{Number(currentPriceDisplay).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} {poolData?.baseTokenSymbol || "KTA"}</div>
                  <div className={`text-xs font-bold ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>{isPositive ? "+" : ""}{changePercentDisplay.toFixed(2)}%</div>
                </div>
              </div>
              <button onClick={handleSwap} className="w-full py-2.5 bg-[#845fbc] text-white font-semibold rounded-md text-sm">Swap</button>
            </div>

            {/* ─── DESKTOP HERO BAR ─── */}
            <div className="hidden lg:flex items-center justify-between mb-6 bg-white dark:bg-[#1a1a1a] px-6 py-4 rounded-xl border border-gray-200 dark:border-white/[0.08]">
              <div className="flex items-center gap-4">
                <button onClick={() => navigate("/")} className="p-2 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                </button>
                <div className="relative">
                  <TokenLogo symbol={headerToken.symbol} address={headerToken.address} className="w-10 h-10" network={network} />
                  {kyc.verified && <KYCCheckmark size={18} />}
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-gray-900 dark:text-white">{headerToken.symbol} <span className="text-gray-400 font-normal">/</span> <span className="text-gray-400 font-normal">{poolData?.baseTokenSymbol || "KTA"}</span></h1>
                  <div className="text-xs text-gray-500 cursor-pointer hover:text-[#845fbc] transition-colors" onClick={() => navigator.clipboard.writeText(headerToken.address)}>{shortenAddress(headerToken.address)}</div>
                </div>
              </div>
              <div className="flex items-center gap-8">
                <div className="text-right">
                  <div className="text-2xl font-mono font-bold text-gray-900 dark:text-white">{Number(currentPriceDisplay).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} <span className="text-sm text-gray-400">{poolData?.baseTokenSymbol || "KTA"}</span></div>
                  <div className={`text-sm font-bold ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                    {isPositive ? "\u25B2" : "\u25BC"} {changePercentDisplay.toFixed(2)}% <span className="text-gray-400 font-normal text-xs">(24h)</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`text-xs font-medium ${!isUsd ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>KTA</span>
                  <button type="button" onClick={() => setIsUsd(!isUsd)} className="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none" style={{ backgroundColor: isUsd ? '#845fbc' : '#d1d5db' }}>
                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isUsd ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <span className={`text-xs font-medium ${isUsd ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>USD</span>
                </div>
                <button onClick={handleSwap} className="px-6 py-2.5 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md transition text-sm">Swap</button>
              </div>
            </div>

            {/* ─── KPI CARDS ─── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] rounded-xl px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Market Cap</div>
                <div className="text-[17px] font-semibold text-gray-900 dark:text-white mt-1 font-mono truncate">{universalRows[1]?.[1] || "-"}</div>
              </div>
              <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] rounded-xl px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">All Time High</div>
                <div className="text-[17px] font-semibold text-gray-900 dark:text-white mt-1 font-mono truncate">{universalRows[4]?.[1] || "-"}</div>
              </div>
              <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] rounded-xl px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Total Supply</div>
                <div className="text-[17px] font-semibold text-gray-900 dark:text-white mt-1 font-mono truncate">{universalRows[3]?.[1] || "-"}</div>
              </div>
              <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] rounded-xl px-4 py-3">
                <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">24h Change</div>
                <div className={`text-[17px] font-semibold mt-1 font-mono ${isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>{isPositive ? "+" : ""}{changePercentDisplay.toFixed(2)}%</div>
              </div>
            </div>

            {/* ─── MAIN 2-COLUMN LAYOUT ─── */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

              {/* LEFT COLUMN — Chart + Activity */}
              <div className="lg:col-span-8 space-y-6">

                {/* Price Chart */}
                <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 dark:border-white/[0.08]">
                    <h2 className="text-[15px] font-semibold text-gray-800 dark:text-white">Price History</h2>
                  </div>
                  <div className="p-3">
                    <AdvancedPriceChart poolId={poolData.poolId} symbol={poolData.pairedTokenSymbol} priceHint={poolData.price} className="w-full h-[500px]" />
                  </div>
                </div>

                {/* Recent Swaps — desktop */}
                <div className="hidden lg:block bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden">
                  <div className="px-6 pt-4 border-b border-gray-100 dark:border-white/[0.08]">
                    <span className="text-[13px] font-semibold pb-3 border-b-2 border-[#845fbc] text-gray-900 dark:text-white inline-block">
                      Recent Swaps
                    </span>
                  </div>
                  <TransactionsList transactions={transactions.slice(0, 36)} loading={txLoading} poolAddress={poolData.address} baseTokenAddress={poolData?.baseToken ?? ""} baseTokenSymbol={poolData?.baseTokenSymbol ?? "BASE"} pairedTokenSymbol={poolData?.pairedTokenSymbol ?? "QUOTE"} compact={true} />
                </div>

                {/* Comments — desktop */}
                <div className="hidden lg:block">
                  <CommentSection poolId={poolData.poolId} network={network as "main" | "test"} />
                </div>
              </div>

              {/* RIGHT COLUMN — Info sidebar */}
              <div className="hidden lg:block lg:col-span-4">
                <div className="lg:sticky lg:top-4 space-y-6">

                  {/* About */}
                  <AboutSection />

                  {/* Pool Stats */}
                  <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 dark:border-white/[0.08]">
                      <h3 className="text-[15px] font-semibold text-gray-800 dark:text-white">Pool Stats</h3>
                    </div>
                    <div className="p-4">
                      <PoolStatsTable rows={universalRows} showHeader={false} variant="minimal" />
                    </div>
                  </div>

                  {/* Trading Activity */}
                  <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 dark:border-white/[0.08] flex items-center justify-between">
                      <h3 className="text-[15px] font-semibold text-gray-800 dark:text-white">Trading Activity</h3>
                      <StatsTabBar active={statsTimeFrame} onClick={setStatsTimeFrame} />
                    </div>
                    <div className="p-4">
                      <PoolStatsTable rows={dynamicRows} showHeader variant="table" />
                    </div>
                  </div>

                  {/* Pool Composition */}
                  <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 dark:border-white/[0.08]">
                      <h3 className="text-[15px] font-semibold text-gray-800 dark:text-white">Pool Composition</h3>
                    </div>
                    <div className="p-5 space-y-4">
                      <div>
                        <div className="flex justify-between text-sm mb-1 font-medium">
                          <span className="text-gray-700 dark:text-gray-300">{poolData.baseTokenSymbol}</span>
                          <span className="font-mono text-gray-500">{formatAmount18((poolData as any).baseTokenAmount || "0")}</span>
                        </div>
                        <div className="h-2 w-full bg-purple-100 dark:bg-purple-900/30 rounded-full overflow-hidden">
                          <div className="h-full bg-[#845fbc]" style={{ width: '100%' }}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-sm mb-1 font-medium">
                          <span className="text-gray-700 dark:text-gray-300">{poolData.pairedTokenSymbol}</span>
                          <span className="font-mono text-gray-500">{formatAmount18((poolData as any).pairedTokenAmount || "0")}</span>
                        </div>
                        <div className="h-2 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-gray-400" style={{ width: '100%' }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ─── MOBILE CONTENT (below chart) ─── */}
            <div className="mt-6 lg:hidden">
              <div className="flex bg-gray-100 dark:bg-white/[0.04] rounded-full p-1 mb-4">
                <button type="button" onClick={() => setMobileTab("metrics")} className={`flex-1 px-3 py-2 text-sm font-semibold rounded-xl transition ${mobileTab === "metrics" ? "bg-[#845fbc] text-white shadow" : "text-gray-700 dark:text-gray-300"}`}>Stats</button>
                <button type="button" onClick={() => setMobileTab("transactions")} className={`flex-1 px-3 py-2 text-sm font-semibold rounded-xl transition ${mobileTab === "transactions" ? "bg-[#845fbc] text-white shadow" : "text-gray-700 dark:text-gray-300"}`}>Trades</button>
              </div>
              {mobileTab === "metrics" && (
                <div className="space-y-4">
                  <div className="flex justify-end items-center space-x-2">
                    <span className={`text-xs font-medium ${!isUsd ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>KTA</span>
                    <button type="button" onClick={() => setIsUsd(!isUsd)} className="relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out" style={{ backgroundColor: isUsd ? '#845fbc' : '#d1d5db' }}>
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isUsd ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                    <span className={`text-xs font-medium ${isUsd ? 'text-gray-900 dark:text-white' : 'text-gray-500'}`}>USD</span>
                  </div>
                  <PoolStatsTable rows={universalRows} showHeader={false} variant="minimal" />
                  <StatsTabBar active={statsTimeFrame} onClick={setStatsTimeFrame} />
                  <PoolStatsTable rows={dynamicRows} showHeader variant="table" />
                  <AboutSection />
                </div>
              )}
              {mobileTab === "transactions" && (
                <div className="space-y-4">
                  <MobileTransactionsList transactions={transactions} loading={txLoading} baseTokenAddress={poolData?.baseToken ?? ""} baseTokenSymbol={poolData?.baseTokenSymbol ?? "BASE"} pairedTokenSymbol={poolData?.pairedTokenSymbol ?? "PAIRED"} />
                  <CommentSection poolId={poolData.poolId} network={network as "main" | "test"} />
                </div>
              )}
            </div>
          </div>
        )}
        <div className="w-full max-w-lg mx-auto">
          {!loading && !error && !poolData && matchingPools.length === 0 && (<div className="text-center py-10 text-gray-500 italic">Awaiting pool search...</div>)}
        </div>
      </div>

      {/* Edit Pool Modal */}
      {showEditModal && poolData && (
        <EditPoolModal
          pool={poolData}
          onClose={() => setShowEditModal(false)}
          onSaved={() => {
            // Re-fetch pool data
            if (selectedPoolId) {
              setPoolData(null);
              void handleSearch(selectedPoolId);
            }
          }}
        />
      )}
    </div>
  );
};

export default TokenDetailsPage;
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useWallet } from "../context/WalletContext";
import { formatAmount18, parseRawAmount } from "../utils/formatters";
import { getTokenDisplayData } from "../utils/token";
import { TokenLogo } from "../components/common/TokenLogo";
import { useKYCStatus, KYCCheckmark } from "../components/common/KYCBadge";
import { LaunchpadProgress } from "../components/launchpad/LaunchpadProgress";
import { BASE_TOKEN } from "../services/pool";
import { WalletService } from "../services/wallet";
import type { WalletTransaction } from "../services/wallet";
import { httpsCallable } from "firebase/functions";
import { collection, collectionGroup, query, where, getDocs, getDoc, doc, limit } from "firebase/firestore";
import { db, functions, authReady } from "../config/firebase";

// --- Interfaces (same as HomePage) ---
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
  keepPairedToken?: boolean;
  collectiveShare?: number | null;
  decayRate?: number | null;
}

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
  keepPairedToken?: boolean;
  collectiveShare?: number | null;
  decayRate?: number | null;
}

type AdminTab = "pools" | "wallets" | "config";
type ViewMode = "dex" | "fundraise" | "graduated";

interface WalletPayoutTotals {
  [symbol: string]: {
    symbol: string;
    token: string;
    total: string;
  };
}

interface WalletPayoutSummary {
  totalCycles: number;
  lastPayoutAt?: any;
  totals: WalletPayoutTotals;
}

interface WalletListItem {
  address: string;
  hasCollective: boolean;
  disqualified?: boolean;
  balance?: string;
  balanceFormatted?: string;
  cycleBalance?: string;
  disqualifiedAt?: any;
  disqualifiedReason?: string;
  joinedAt?: any;
  lastCheckedAt?: any;
  lastCheckedBalance?: string;
  multiplier?: number;
  streakStartedAt?: any;
  payouts?: WalletPayoutSummary | null;
}

const formatTimestamp = (ts: any): string => {
  if (!ts) return "—";
  const date = ts.toDate ? ts.toDate() : new Date(ts.seconds ? ts.seconds * 1000 : ts);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) +
    " " + date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
};

const shortenAddress = (addr: string, chars = 5): string =>
  addr.length <= chars * 2 + 3 ? addr : `${addr.slice(0, chars + 6)}...${addr.slice(-chars)}`;

const TokenLogoWithKYC: React.FC<{
  address: string; symbol: string; network: "main" | "test"; creator?: string;
  onKYCResolved?: (creator: string, verified: boolean) => void;
}> = ({ address, symbol, network, creator, onKYCResolved }) => {
  const kyc = useKYCStatus(creator, network);
  useEffect(() => {
    if (!kyc.loading && creator && onKYCResolved) {
      onKYCResolved(creator, kyc.verified);
    }
  }, [kyc.loading, kyc.verified, creator, onKYCResolved]);
  return (
    <div className="relative">
      <TokenLogo address={address} symbol={symbol} network={network} />
      {kyc.verified && <KYCCheckmark size={14} />}
    </div>
  );
};

const PAGE_SIZE = 500;

const smartFormat = (rawStr: string | number, decimals: number = 18): string => {
  const full = formatAmount18(rawStr, decimals);
  const num = parseFloat(full.replace(/,/g, ""));
  if (isNaN(num) || num === 0) return full;
  const dp = Math.abs(num) >= 1 ? 2 : 6;
  const parts = num.toFixed(dp).split(".");
  parts[0] = Number(parts[0]).toLocaleString();
  return parts.join(".");
};

const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => (
  <div className="relative group/tip inline-flex items-center gap-1">
    {children}
    <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 cursor-help shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth="2"/><path strokeWidth="2" strokeLinecap="round" d="M12 16v-4m0-4h.01"/></svg>
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs text-white bg-gray-900 dark:bg-black rounded-lg shadow-lg opacity-0 pointer-events-none group-hover/tip:opacity-100 group-hover/tip:pointer-events-auto transition-opacity duration-200 w-56 text-center z-50 whitespace-normal">
      {text}
      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-black" />
    </div>
  </div>
);

const InlineIncentiveInput: React.FC<{
  value: number | null;
  placeholder: string;
  onSave: (val: number | null) => Promise<void>;
}> = ({ value, placeholder, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? (value * 100).toFixed(0) : "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const trimmed = draft.trim();
      const newVal = trimmed === "" ? null : parseFloat(trimmed) / 100;
      if (newVal !== null && (isNaN(newVal) || newVal < 0 || newVal > 1)) return;
      await onSave(newVal);
      setEditing(false);
    } catch (err) {
      console.error("Failed to save:", err);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          type="number"
          min="0" max="100" step="1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
          className="w-16 px-1.5 py-0.5 text-xs text-center bg-white dark:bg-white/[0.04] border border-[#845fbc] rounded focus:outline-none text-gray-800 dark:text-gray-200"
          disabled={saving}
        />
        <span className="text-[10px] text-gray-400">%</span>
        <button onClick={handleSave} disabled={saving} className="text-green-500 hover:text-green-400 disabled:opacity-50">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
        </button>
        <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-300">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); setDraft(value != null ? (value * 100).toFixed(0) : ""); setEditing(true); }}
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded-md cursor-pointer transition-all hover:scale-105 active:scale-95 bg-gray-100 dark:bg-white/5 text-gray-600 dark:text-gray-400 border border-gray-200/50 dark:border-white/10 hover:border-[#845fbc]/50 hover:text-[#845fbc] dark:hover:text-[#a78bfa]"
    >
      {value != null ? `${(value * 100).toFixed(0)}%` : <span className="text-gray-400 dark:text-gray-600 italic">{placeholder}</span>}
    </button>
  );
};

const AdminPage: React.FC = () => {
  const navigate = useNavigate();
  const { isConnected, address, network, connectToExtension } = useWallet();

  // --- Admin check ---
  const [adminChecking, setAdminChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!address) {
      setAdminChecking(false);
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setAdminChecking(true);
      try {
        await authReady;
        const fn = httpsCallable(functions, "isAdminCall");
        const result = await fn({ address });
        if (!cancelled) setIsAdmin((result.data as any).isAdmin === true);
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setAdminChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address]);

  // --- Admin tab ---
  const [adminTab, setAdminTab] = useState<AdminTab>("pools");

  // --- Wallet data ---
  const [wallets, setWallets] = useState<WalletListItem[]>([]);
  const [loadingWallets, setLoadingWallets] = useState(false);
  const [walletFilter, setWalletFilter] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<WalletListItem | null>(null);
  const [walletHistory, setWalletHistory] = useState<WalletTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [walletTokenMap, setWalletTokenMap] = useState<Record<string, { symbol: string }>>({});

  const fetchWallets = useCallback(async () => {
    setLoadingWallets(true);
    try {
      // Parent wallet docs are phantom — query the subcollection directly.
      // Two parallel queries on "disqualified" to get all alpaca_collective docs.
      const [activeSnap, disqualifiedSnap] = await Promise.all([
        getDocs(query(collectionGroup(db, network), where("disqualified", "==", false))),
        getDocs(query(collectionGroup(db, network), where("disqualified", "==", true))),
      ]);

      const allDocs = [...activeSnap.docs, ...disqualifiedSnap.docs];
      const items: WalletListItem[] = allDocs.map(snap => {
        // Path: wallets/{address}/{network}/alpaca_collective
        const walletAddress = snap.ref.parent.parent?.id || "";
        const d = snap.data();
        return {
          address: walletAddress,
          hasCollective: true,
          disqualified: d.disqualified,
          balance: d.balance,
          balanceFormatted: d.balanceFormatted,
          cycleBalance: d.cycleBalance,
          disqualifiedAt: d.disqualifiedAt,
          disqualifiedReason: d.disqualifiedReason,
          joinedAt: d.joinedAt,
          lastCheckedAt: d.lastCheckedAt,
          lastCheckedBalance: d.lastCheckedBalance,
          multiplier: d.multiplier,
          streakStartedAt: d.streakStartedAt,
        };
      });

      setWallets(items);
    } catch (err) {
      console.error("Failed to fetch wallets:", err);
    } finally {
      setLoadingWallets(false);
    }
  }, [network]);

  useEffect(() => {
    if (isAdmin && adminTab === "wallets") void fetchWallets();
  }, [isAdmin, adminTab, fetchWallets]);

  const selectWallet = useCallback(async (w: WalletListItem) => {
    setSelectedWallet(w);
    setWalletHistory([]);
    setWalletTokenMap({});

    // Fetch payout summary + history in parallel
    const payoutPromise = getDoc(doc(db, "wallets", w.address, network, "collective_payouts"))
      .then(payoutsSnap => {
        if (payoutsSnap.exists()) {
          const pd = payoutsSnap.data();
          setSelectedWallet(prev => prev?.address === w.address ? {
            ...prev,
            payouts: {
              totalCycles: pd.totalCycles || 0,
              lastPayoutAt: pd.lastPayoutAt,
              totals: pd.totals || {},
            },
          } : prev);
        }
      })
      .catch(err => console.error("Failed to fetch payout summary:", err));

    const historyPromise = (async () => {
      setLoadingHistory(true);
      try {
        const txs = await WalletService.getWalletHistory(w.address, network);
        setWalletHistory(txs);
        // Build token map from transaction data
        const map: Record<string, { symbol: string }> = {};
        for (const tx of txs) {
          if (tx.tokenIn?.address && tx.tokenIn.symbol) map[tx.tokenIn.address] = { symbol: tx.tokenIn.symbol };
          if (tx.tokenOut?.address && tx.tokenOut.symbol) map[tx.tokenOut.address] = { symbol: tx.tokenOut.symbol };
        }
        setWalletTokenMap(map);
      } catch (err) {
        console.error("Failed to fetch wallet history:", err);
      } finally {
        setLoadingHistory(false);
      }
    })();

    await Promise.all([payoutPromise, historyPromise]);
  }, [network]);

  const filteredWallets = useMemo(() => {
    if (!walletFilter) return wallets;
    const q = walletFilter.toLowerCase();
    return wallets.filter(w => w.address.toLowerCase().includes(q));
  }, [wallets, walletFilter]);

  // --- Token data ---
  const [viewMode, setViewMode] = useState<ViewMode>("dex");
  const [filterText, setFilterText] = useState("");
  const [filterKYC, setFilterKYC] = useState(false);
  const [kycMap, setKycMap] = useState<Record<string, boolean>>({});

  const handleKYCResolved = useCallback((creator: string, verified: boolean) => {
    setKycMap(prev => {
      if (prev[creator] === verified) return prev;
      return { ...prev, [creator]: verified };
    });
  }, []);

  const [tokens, setTokens] = useState<TokenListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof TokenListItem; direction: "asc" | "desc" } | null>({
    key: "marketCap", direction: "desc",
  });

  const [fundraiseTokens, setFundraiseTokens] = useState<FundraiseToken[]>([]);
  const [loadingFundraise, setLoadingFundraise] = useState(false);
  const [graduatedTokens, setGraduatedTokens] = useState<FundraiseToken[]>([]);
  const [loadingGraduated, setLoadingGraduated] = useState(false);

  // --- Fetch DEX ---
  const fetchTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const poolsRef = collection(db, "pools");
      const q = query(poolsRef, where("network", "==", network), limit(PAGE_SIZE));
      const snap = await getDocs(q);
      const fetched: TokenListItem[] = [];
      snap.forEach((doc) => {
        const data = doc.data();
        if (data.pairedToken) {
          fetched.push({
            id: doc.id, address: data.address || doc.id, pairedToken: data.pairedToken,
            symbol: data.pairedTokenSymbol || data.symbol || "Unknown",
            price: data.price || "0", marketCap: data.marketCap || "0",
            change24h: data.change24h || data.stats?.priceChange24h || 0,
            vol24h: data.vol24h || data.stats?.vol24h || "0",
            tokenDecimals: data.tokenDecimals, pairedTokenDecimals: data.pairedTokenDecimals,
            baseTokenDecimals: data.baseTokenDecimals,
            pairedTokenSymbol: data.pairedTokenSymbol, baseTokenSymbol: data.baseTokenSymbol || "Unknown",
            mode: data.mode, fundraised: data.fundraised, creator: data.creator || "",
            keepPairedToken: data.keepPairedToken === true,
            collectiveShare: data.collectiveShare ?? null,
            decayRate: data.decayRate ?? null,
          });
        }
      });
      setTokens(fetched);
    } catch (err) {
      console.error(err);
      setError("Unable to fetch market data from database.");
    } finally {
      setLoading(false);
    }
  }, [network]);

  // --- Fetch Fundraise ---
  const fetchFundraiseTokens = useCallback(async () => {
    setLoadingFundraise(true);
    try {
      const collectionNames = ["pools", "pools_test"];
      const mapDoc = (doc: any): FundraiseToken => {
        const data = doc.data();
        return {
          id: doc.id, address: data.address || "", symbol: data.pairedTokenSymbol || "UNK",
          pairedToken: data.pairedToken || "", price: data.price || "0",
          network: data.network || "main", totalSupply: data.totalSupply || "0",
          change24h: data.change24h || data.stats?.priceChange24h || 0,
          marketCap: data.marketCap || "0",
          fundRaise: data.fundRaise ? {
            launchKontingent: data.fundRaise.launchKontingent, fundraiseSupply: data.fundRaise.fundraiseSupply,
            poolSupply: data.fundRaise.poolSupply, startSalePrice: data.fundRaise.startSalePrice,
            finalSalePrice: data.fundRaise.finalSalePrice, liquidityGoal: data.fundRaise.liquidityGoal,
            expectedTotalRaise: data.fundRaise.expectedTotalRaise, raised: data.fundRaise.raised,
            tokensSold: data.fundRaise.tokensSold || "0", teamGoal: data.fundRaise.teamGoal || "0",
            platformFee: data.fundRaise.platformFee || "0", curve: data.fundRaise.curve,
            premiumPercentage: data.fundRaise.premiumPercentage,
            tradingStartPrice: data.fundRaise.tradingStartPrice || "0",
          } : undefined,
          creator: data.creator || "",
          keepPairedToken: data.keepPairedToken === true,
          collectiveShare: data.collectiveShare ?? null,
          decayRate: data.decayRate ?? null,
        };
      };
      const snapshots = await Promise.all(
        collectionNames.map(name => getDocs(query(collection(db, name), where("active", "==", true), where("mode", "==", "fundRaising"), limit(100))))
      );
      setFundraiseTokens(snapshots.flatMap(snap => snap.docs.map(mapDoc)));
    } catch (e) {
      console.error("Failed to load fundraise tokens", e);
    } finally {
      setLoadingFundraise(false);
    }
  }, []);

  // --- Fetch Graduated ---
  const fetchGraduatedTokens = useCallback(async () => {
    setLoadingGraduated(true);
    try {
      const collectionNames = ["pools", "pools_test"];
      const mapDoc = (doc: any): FundraiseToken => {
        const data = doc.data();
        return {
          id: doc.id, address: data.address || "", symbol: data.pairedTokenSymbol || "UNK",
          pairedToken: data.pairedToken || "", price: data.price || "0",
          network: data.network || "main", totalSupply: data.totalSupply || "0",
          change24h: data.change24h || data.stats?.priceChange24h || 0,
          marketCap: data.marketCap || "0",
          fundRaise: data.fundRaise ? {
            launchKontingent: data.fundRaise.launchKontingent, fundraiseSupply: data.fundRaise.fundraiseSupply,
            poolSupply: data.fundRaise.poolSupply, startSalePrice: data.fundRaise.startSalePrice,
            finalSalePrice: data.fundRaise.finalSalePrice, liquidityGoal: data.fundRaise.liquidityGoal,
            expectedTotalRaise: data.fundRaise.expectedTotalRaise, raised: data.fundRaise.raised,
            tokensSold: data.fundRaise.tokensSold || "0", teamGoal: data.fundRaise.teamGoal || "0",
            platformFee: data.fundRaise.platformFee || "0", curve: data.fundRaise.curve,
            premiumPercentage: data.fundRaise.premiumPercentage,
            tradingStartPrice: data.fundRaise.tradingStartPrice || "0",
          } : undefined,
          creator: data.creator || "",
          keepPairedToken: data.keepPairedToken === true,
          collectiveShare: data.collectiveShare ?? null,
          decayRate: data.decayRate ?? null,
        };
      };
      const snapshots = await Promise.all(
        collectionNames.map(name => getDocs(query(collection(db, name), where("mode", "==", "provideLiquidity"), where("fundraised", "==", true), limit(100))))
      );
      setGraduatedTokens(snapshots.flatMap(snap => snap.docs.map(mapDoc)));
    } catch (e) {
      console.error("Failed to load graduated tokens", e);
    } finally {
      setLoadingGraduated(false);
    }
  }, []);

  useEffect(() => { if (isAdmin) void fetchTokens(); }, [network, fetchTokens, isAdmin]);
  useEffect(() => { if (isAdmin) void fetchFundraiseTokens(); }, [fetchFundraiseTokens, isAdmin]);
  useEffect(() => { if (isAdmin) void fetchGraduatedTokens(); }, [fetchGraduatedTokens, isAdmin]);

  // --- Sorting & Filtering ---
  const requestSort = (key: keyof TokenListItem) => {
    let direction: "asc" | "desc" = "asc";
    if (sortConfig && sortConfig.key === key && sortConfig.direction === "asc") direction = "desc";
    setSortConfig({ key, direction });
  };

  const getSortIndicator = (key: keyof TokenListItem) => {
    if (sortConfig?.key !== key) return <span className="text-gray-300 dark:text-gray-600 ml-1 opacity-0 group-hover:opacity-100">&#x21C5;</span>;
    return sortConfig.direction === "asc" ? <span className="text-[#845fbc] ml-1">&#x25B2;</span> : <span className="text-[#845fbc] ml-1">&#x25BC;</span>;
  };

  const sortedAndFilteredTokens = useMemo(() => {
    const filtered = tokens.filter((t) => {
      if (t.mode === "fundRaising") return false;
      if (filterKYC && (!t.creator || !kycMap[t.creator])) return false;
      const text = filterText.toLowerCase();
      return t.symbol.toLowerCase().includes(text) || t.address.toLowerCase().includes(text) || t.id.toLowerCase().includes(text);
    });
    if (!sortConfig) return filtered;
    return [...filtered].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];
      if (["marketCap", "price", "vol24h", "change24h"].includes(sortConfig.key)) {
        const numA = Number(aValue);
        const numB = Number(bValue);
        return sortConfig.direction === "asc" ? numA - numB : numB - numA;
      }
      const strA = String(aValue).toLowerCase();
      const strB = String(bValue).toLowerCase();
      if (strA < strB) return sortConfig.direction === "asc" ? -1 : 1;
      if (strA > strB) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });
  }, [tokens, filterText, sortConfig, filterKYC, kycMap]);

  const filteredFundraiseTokens = useMemo(() => {
    const networkFilter = network === "main" ? "main" : "test";
    return fundraiseTokens.filter(t => {
      if ((t.network || "main") !== networkFilter) return false;
      if (filterKYC && (!t.creator || !kycMap[t.creator])) return false;
      return t.symbol.toLowerCase().includes(filterText.toLowerCase()) || t.address.toLowerCase().includes(filterText.toLowerCase());
    });
  }, [fundraiseTokens, filterText, network, filterKYC, kycMap]);

  const filteredGraduatedTokens = useMemo(() => {
    const networkFilter = network === "main" ? "main" : "test";
    return graduatedTokens.filter(t => {
      if ((t.network || "main") !== networkFilter) return false;
      if (filterKYC && (!t.creator || !kycMap[t.creator])) return false;
      return t.symbol.toLowerCase().includes(filterText.toLowerCase()) || t.address.toLowerCase().includes(filterText.toLowerCase());
    });
  }, [graduatedTokens, filterText, network, filterKYC, kycMap]);

  const displayedCount = viewMode === "dex" ? sortedAndFilteredTokens.length : viewMode === "fundraise" ? filteredFundraiseTokens.length : filteredGraduatedTokens.length;
  const isLoading = viewMode === "dex" ? loading : viewMode === "fundraise" ? loadingFundraise : loadingGraduated;

  // --- Keep Paired Token toggle ---
  const [togglingPools, setTogglingPools] = useState<Record<string, boolean>>({});

  const toggleKeepPairedToken = useCallback(async (poolId: string, currentValue: boolean) => {
    setTogglingPools(prev => ({ ...prev, [poolId]: true }));
    try {
      await authReady;
      const fn = httpsCallable(functions, "setKeepPairedTokenCall");
      await fn({ address, poolId, keepPairedToken: !currentValue });
      // Update local state across all lists
      const newVal = !currentValue;
      setTokens(prev => prev.map(t => t.id === poolId ? { ...t, keepPairedToken: newVal } : t));
      setFundraiseTokens(prev => prev.map(t => t.id === poolId ? { ...t, keepPairedToken: newVal } : t));
      setGraduatedTokens(prev => prev.map(t => t.id === poolId ? { ...t, keepPairedToken: newVal } : t));
    } catch (err) {
      console.error("[Admin] Failed to toggle keepPairedToken:", err);
    } finally {
      setTogglingPools(prev => ({ ...prev, [poolId]: false }));
    }
  }, [address]);

  // --- Update incentive params (collectiveShare / decayRate) ---
  const updateIncentiveParam = useCallback(async (poolId: string, field: "collectiveShare" | "decayRate", value: number | null) => {
    try {
      await authReady;
      const fn = httpsCallable(functions, "setPoolIncentiveParamsCall");
      await fn({ address, poolId, [field]: value });
      const updater = (t: any) => t.id === poolId ? { ...t, [field]: value } : t;
      setTokens(prev => prev.map(updater));
      setFundraiseTokens(prev => prev.map(updater));
      setGraduatedTokens(prev => prev.map(updater));
    } catch (err) {
      console.error(`[Admin] Failed to update ${field}:`, err);
    }
  }, [address]);

  // --- Incentive Remote Config ---
  interface IncentiveConfig {
    INCENTIVE_COLLECTIVE_SHARE: number | null;
    INCENTIVE_KTA_SHARE: number | null;
    INCENTIVE_DECAY_RATE: number | null;
    INCENTIVE_DUST_THRESHOLD: string | null;
  }
  const [incentiveConfig, setIncentiveConfig] = useState<IncentiveConfig>({
    INCENTIVE_COLLECTIVE_SHARE: null,
    INCENTIVE_KTA_SHARE: null,
    INCENTIVE_DECAY_RATE: null,
    INCENTIVE_DUST_THRESHOLD: null,
  });
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configDraft, setConfigDraft] = useState<IncentiveConfig>({
    INCENTIVE_COLLECTIVE_SHARE: null,
    INCENTIVE_KTA_SHARE: null,
    INCENTIVE_DECAY_RATE: null,
    INCENTIVE_DUST_THRESHOLD: null,
  });
  const [configSaveMsg, setConfigSaveMsg] = useState<string | null>(null);

  const fetchIncentiveConfig = useCallback(async () => {
    setLoadingConfig(true);
    try {
      await authReady;
      const fn = httpsCallable(functions, "getIncentiveConfigCall");
      const result = await fn({ address });
      const cfg = (result.data as any).config;
      setIncentiveConfig(cfg);
      setConfigDraft(cfg);
    } catch (err) {
      console.error("[Admin] Failed to fetch incentive config:", err);
    } finally {
      setLoadingConfig(false);
    }
  }, [address]);

  useEffect(() => {
    if (isAdmin && adminTab === "config") void fetchIncentiveConfig();
  }, [isAdmin, adminTab, fetchIncentiveConfig]);

  const saveIncentiveConfig = useCallback(async () => {
    setSavingConfig(true);
    setConfigSaveMsg(null);
    try {
      await authReady;
      const updates: Record<string, number | string> = {};
      if (configDraft.INCENTIVE_COLLECTIVE_SHARE !== incentiveConfig.INCENTIVE_COLLECTIVE_SHARE && configDraft.INCENTIVE_COLLECTIVE_SHARE != null) {
        updates.INCENTIVE_COLLECTIVE_SHARE = configDraft.INCENTIVE_COLLECTIVE_SHARE;
      }
      if (configDraft.INCENTIVE_KTA_SHARE !== incentiveConfig.INCENTIVE_KTA_SHARE && configDraft.INCENTIVE_KTA_SHARE != null) {
        updates.INCENTIVE_KTA_SHARE = configDraft.INCENTIVE_KTA_SHARE;
      }
      if (configDraft.INCENTIVE_DECAY_RATE !== incentiveConfig.INCENTIVE_DECAY_RATE && configDraft.INCENTIVE_DECAY_RATE != null) {
        updates.INCENTIVE_DECAY_RATE = configDraft.INCENTIVE_DECAY_RATE;
      }
      if (configDraft.INCENTIVE_DUST_THRESHOLD !== incentiveConfig.INCENTIVE_DUST_THRESHOLD && configDraft.INCENTIVE_DUST_THRESHOLD != null) {
        updates.INCENTIVE_DUST_THRESHOLD = configDraft.INCENTIVE_DUST_THRESHOLD;
      }
      if (Object.keys(updates).length === 0) {
        setConfigSaveMsg("No changes to save.");
        return;
      }
      const fn = httpsCallable(functions, "setIncentiveConfigCall");
      await fn({ address, config: updates });
      setIncentiveConfig({ ...incentiveConfig, ...configDraft });
      setConfigSaveMsg("Saved successfully.");
    } catch (err: any) {
      console.error("[Admin] Failed to save incentive config:", err);
      setConfigSaveMsg(`Error: ${err.message || "Failed to save"}`);
    } finally {
      setSavingConfig(false);
    }
  }, [address, configDraft, incentiveConfig]);

  // --- Enable Liquidity ---
  const [liqPoolId, setLiqPoolId] = useState("");
  const [liqLoading, setLiqLoading] = useState(false);
  const [liqResult, setLiqResult] = useState<{ success: boolean; message: string; data?: any } | null>(null);

  const enableLiquidity = useCallback(async () => {
    if (!liqPoolId.trim()) return;
    setLiqLoading(true);
    setLiqResult(null);
    try {
      await authReady;
      const fnName = network === "test" ? "enablePoolTestLiquidityCall" : "enablePoolLiquidityCall";
      const fn = httpsCallable(functions, fnName);
      const result = await fn({ poolId: liqPoolId.trim(), address });
      const d = result.data as any;
      setLiqResult({ success: true, message: "Liquidity enabled successfully.", data: d });
    } catch (err: any) {
      console.error("[Admin] enablePoolLiquidity failed:", err);
      setLiqResult({ success: false, message: err.message || "Failed to enable liquidity." });
    } finally {
      setLiqLoading(false);
    }
  }, [liqPoolId, network]);

  const configHasChanges = useMemo(() => {
    return (
      configDraft.INCENTIVE_COLLECTIVE_SHARE !== incentiveConfig.INCENTIVE_COLLECTIVE_SHARE ||
      configDraft.INCENTIVE_KTA_SHARE !== incentiveConfig.INCENTIVE_KTA_SHARE ||
      configDraft.INCENTIVE_DECAY_RATE !== incentiveConfig.INCENTIVE_DECAY_RATE ||
      configDraft.INCENTIVE_DUST_THRESHOLD !== incentiveConfig.INCENTIVE_DUST_THRESHOLD
    );
  }, [configDraft, incentiveConfig]);

  // --- Not connected ---
  if (!isConnected) {
    return (
      <div className="w-full min-h-screen p-6 md:p-12 bg-gray-50 dark:bg-[#171717] flex flex-col items-center justify-center text-center transition-colors duration-300">
        <div className="bg-white dark:bg-[#1a1a1a] p-8 rounded-xl border border-gray-200 dark:border-white/[0.08] transition-colors mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-16 h-16 text-[#845fbc] dark:text-[#a78bfa]">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white mb-3">Administration</h1>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 max-w-md mb-8">Connect your wallet to access the admin panel.</p>
        <button onClick={() => connectToExtension()} className="px-6 py-2.5 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md transition-colors">Connect Extension</button>
      </div>
    );
  }

  // --- Checking admin ---
  if (adminChecking) {
    return (
      <div className="w-full min-h-screen bg-gray-50 dark:bg-[#171717] flex items-center justify-center transition-colors duration-300">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-[#845fbc] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Verifying access...</span>
        </div>
      </div>
    );
  }

  // --- Not admin ---
  if (!isAdmin) {
    return (
      <div className="w-full min-h-screen p-6 md:p-12 bg-gray-50 dark:bg-[#171717] flex flex-col items-center justify-center text-center transition-colors duration-300">
        <div className="bg-white dark:bg-[#1a1a1a] p-8 rounded-xl border border-gray-200 dark:border-white/[0.08] transition-colors mb-6">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-16 h-16 text-red-400">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white mb-3">Access Denied</h1>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 max-w-md">Your wallet is not authorized to access this page.</p>
      </div>
    );
  }

  // --- Admin view ---
  return (
    <div className="w-full min-h-screen flex flex-col items-center px-4 md:px-8 pt-16 md:pt-4 bg-gray-50 dark:bg-[#171717] transition-colors duration-300">

      {/* HERO SECTION */}
      <div className="w-full max-w-4xl mt-4 mb-6 text-center">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white mb-2">
          Administration
        </h1>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-0">
          {adminTab === "pools" ? "Overview of all tokens across Alpaca pools." : adminTab === "wallets" ? "Overview of all registered wallets." : "Global platform configuration."}
        </p>

        {/* Top-level tabs */}
        <div className="flex justify-center mt-5">
          <div className="inline-flex bg-gray-200/60 dark:bg-black/30 rounded-xl p-1 border border-gray-200/50 dark:border-white/5">
            <button
              onClick={() => { setAdminTab("pools"); setSelectedWallet(null); }}
              className={`px-6 py-2 text-[13px] font-semibold rounded-md transition-colors duration-200 ${adminTab === "pools" ? "bg-white dark:bg-[#845fbc] text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
            >
              Pools
            </button>
            <button
              onClick={() => { setAdminTab("wallets"); setSelectedWallet(null); }}
              className={`px-6 py-2 text-[13px] font-semibold rounded-md transition-colors duration-200 ${adminTab === "wallets" ? "bg-white dark:bg-[#845fbc] text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
            >
              Wallets
            </button>
            <button
              onClick={() => { setAdminTab("config"); setSelectedWallet(null); }}
              className={`px-6 py-2 text-[13px] font-semibold rounded-md transition-colors duration-200 ${adminTab === "config" ? "bg-white dark:bg-[#845fbc] text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}
            >
              Config
            </button>
          </div>
        </div>
      </div>

      {/* POOLS TABLE SECTION */}
      {adminTab === "pools" && (
      <div className="w-full max-w-6xl bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden mb-12 mt-8 transition-colors">

        {/* Toolbar */}
        <div className="p-6 border-b border-gray-100 dark:border-white/[0.08] flex flex-col md:flex-row justify-between items-center gap-4 bg-gray-50 dark:bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="flex bg-gray-200/60 dark:bg-black/30 rounded-lg p-1 border border-gray-200/50 dark:border-white/5">
              <button onClick={() => setViewMode("dex")} className={`px-4 py-1.5 text-[12px] font-semibold rounded-md transition-colors duration-200 ${viewMode === "dex" ? "bg-white dark:bg-[#845fbc] text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}>
                DEX Pools
              </button>
              <button onClick={() => setViewMode("fundraise")} className={`px-4 py-1.5 text-[12px] font-semibold rounded-md transition-colors duration-200 ${viewMode === "fundraise" ? "bg-white dark:bg-[#845fbc] text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}>
                Active Sales
              </button>
              <button onClick={() => setViewMode("graduated")} className={`px-4 py-1.5 text-[12px] font-semibold rounded-md transition-colors duration-200 ${viewMode === "graduated" ? "bg-white dark:bg-[#845fbc] text-gray-900 dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}>
                Graduated
              </button>
            </div>

            <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/[0.04] px-2.5 py-1 rounded-md uppercase tracking-[0.08em]">
              {network === "main" ? "Mainnet" : "Testnet"}
            </span>

            <button
              type="button"
              onClick={() => setFilterKYC(!filterKYC)}
              className={`inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-semibold rounded-md transition-colors duration-200 border ${filterKYC ? "bg-teal-500 text-white border-teal-500 shadow-sm" : "bg-transparent text-gray-500 dark:text-gray-400 border-gray-300 dark:border-white/[0.08] hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-400"}`}
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
              className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-[#1a1a1a] border text-gray-500 dark:text-gray-200 border-gray-300 dark:border-white/[0.08] rounded-md text-[13px] focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 placeholder-gray-400 dark:placeholder-gray-600"
            />
          </div>
        </div>

        {/* TABLE */}
        <div className="overflow-x-auto">
          {viewMode === "dex" && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/[0.02] text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider border-b border-gray-200 dark:border-white/[0.08]">
                  <th className="px-6 py-4 font-semibold w-12">#</th>
                  <th onClick={() => requestSort("symbol")} className="px-6 py-4 font-semibold cursor-pointer group hover:text-[#845fbc] transition">Token {getSortIndicator("symbol")}</th>
                  <th onClick={() => requestSort("price")} className="px-6 py-4 font-semibold text-right cursor-pointer group hover:text-[#845fbc] transition">Price {getSortIndicator("price")}</th>
                  <th onClick={() => requestSort("vol24h")} className="px-6 py-4 font-semibold text-right hidden md:table-cell cursor-pointer group hover:text-[#845fbc] transition">Volume (24h) {getSortIndicator("vol24h")}</th>
                  <th onClick={() => requestSort("marketCap")} className="px-6 py-4 font-medium text-gray-500 dark:text-gray-400 text-right hidden lg:table-cell cursor-pointer group hover:text-[#845fbc] transition">Market Cap {getSortIndicator("marketCap")}</th>
                  <th className="px-6 py-4 font-semibold text-center hidden md:table-cell">Keep Paired</th>
                  <th className="px-6 py-4 font-semibold text-center hidden lg:table-cell"><Tooltip text="Fraction of paired token fees going to the collective. Null = uses global INCENTIVE_COLLECTIVE_SHARE from Remote Config.">Collective Share</Tooltip></th>
                  <th className="px-6 py-4 font-semibold text-center hidden lg:table-cell"><Tooltip text="Exponential decay rate for distributing this pool's paired token each cycle. Null = uses global INCENTIVE_DECAY_RATE from Remote Config.">Decay Rate</Tooltip></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                {loading ? (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400 italic">Loading market data...</td></tr>
                ) : error ? (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-red-500 font-medium">{error}</td></tr>
                ) : sortedAndFilteredTokens.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400 italic">No tokens found.</td></tr>
                ) : (
                  sortedAndFilteredTokens.map((token, index) => {
                    const { displayDecimals, currencySymbol } = getTokenDisplayData(token, network);

                    return (
                      <tr key={token.id} onClick={() => navigate(`/token-details?q=${token.address}`)} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition duration-150 cursor-pointer group">
                        <td className="px-6 py-4 text-gray-400 dark:text-gray-500 font-mono text-sm">{index + 1}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center">
                            <TokenLogoWithKYC address={token.pairedToken} symbol={token.symbol} network={network} creator={token.creator} onKYCResolved={handleKYCResolved} />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-gray-800 dark:text-gray-200 group-hover:text-[#845fbc] dark:group-hover:text-[#a78bfa] transition">{token.symbol}</span>
                                {token.fundraised ? (
                                  <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] rounded-md bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 border border-teal-200/50 dark:border-teal-800/50 leading-none">Raised</span>
                                ) : (
                                  <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] rounded-md bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-white/5 leading-none">Seeded</span>
                                )}
                              </div>
                              <div className="text-xs text-gray-400 dark:text-gray-500 font-mono">{token.address.substring(0, 6)}...{token.address.substring(token.address.length - 4)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-gray-800 dark:text-gray-200">{smartFormat(token.price, displayDecimals)} <span className="text-xs text-gray-400 dark:text-gray-500">{currencySymbol}</span></td>
                        <td className="px-6 py-4 text-right text-gray-600 dark:text-gray-400 hidden md:table-cell">{smartFormat(token.vol24h, displayDecimals)} <span className="text-xs text-gray-400 dark:text-gray-500">{currencySymbol}</span></td>
                        <td className="px-6 py-4 text-right text-gray-800 dark:text-gray-200 font-medium hidden lg:table-cell">{smartFormat(token.marketCap, displayDecimals)} <span className="text-xs text-gray-400 dark:text-gray-500">{currencySymbol}</span></td>
                        <td className="px-6 py-4 text-center hidden md:table-cell">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleKeepPairedToken(token.id, !!token.keepPairedToken); }}
                            disabled={!!togglingPools[token.id]}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] rounded-md cursor-pointer transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-wait ${token.keepPairedToken ? "bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200/50 dark:border-green-500/20 hover:bg-green-200 dark:hover:bg-green-500/20" : "bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-white/10 hover:bg-gray-200 dark:hover:bg-white/10"}`}
                          >
                            {togglingPools[token.id] ? (
                              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <>
                                <span className={`w-1.5 h-1.5 rounded-full ${token.keepPairedToken ? "bg-green-500" : "bg-gray-400 dark:bg-gray-600"}`} />
                                {token.keepPairedToken ? "Yes" : "No"}
                              </>
                            )}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-center hidden lg:table-cell">
                          <InlineIncentiveInput value={token.collectiveShare ?? null} placeholder="default" onSave={(val) => updateIncentiveParam(token.id, "collectiveShare", val)} />
                        </td>
                        <td className="px-6 py-4 text-center hidden lg:table-cell">
                          <InlineIncentiveInput value={token.decayRate ?? null} placeholder="default" onSave={(val) => updateIncentiveParam(token.id, "decayRate", val)} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {viewMode === "fundraise" && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/[0.02] text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider border-b border-gray-200 dark:border-white/[0.08]">
                  <th className="px-6 py-4 font-semibold w-12">#</th>
                  <th className="px-6 py-4 font-semibold">Token</th>
                  <th className="px-6 py-4 font-semibold text-right">Price</th>
                  <th className="px-6 py-4 font-semibold text-right hidden lg:table-cell">Market Cap</th>
                  <th className="px-6 py-4 font-semibold text-center">Progress (Funded)</th>
                  <th className="px-6 py-4 font-semibold text-center hidden md:table-cell">Keep Paired</th>
                  <th className="px-6 py-4 font-semibold text-center hidden lg:table-cell"><Tooltip text="Fraction of paired token fees going to the collective. Null = uses global INCENTIVE_COLLECTIVE_SHARE from Remote Config.">Collective Share</Tooltip></th>
                  <th className="px-6 py-4 font-semibold text-center hidden lg:table-cell"><Tooltip text="Exponential decay rate for distributing this pool's paired token each cycle. Null = uses global INCENTIVE_DECAY_RATE from Remote Config.">Decay Rate</Tooltip></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                {loadingFundraise ? (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">Loading tokens...</td></tr>
                ) : filteredFundraiseTokens.length === 0 ? (
                  <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">No active sales found.</td></tr>
                ) : (
                  filteredFundraiseTokens.map((token, index) => {
                    const decimals = BASE_TOKEN[token.network || "main"].decimals;

                    return (
                      <tr key={token.id} onClick={() => navigate(`/token-details?q=${token.address}`)} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors duration-150 cursor-pointer">
                        <td className="px-6 py-4 text-gray-400 font-mono text-sm">{index + 1}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <TokenLogoWithKYC address={token.pairedToken} symbol={token.symbol} network={token.network || "main"} creator={token.creator} onKYCResolved={handleKYCResolved} />
                            <div>
                              <div className="font-semibold text-gray-900 dark:text-white">{token.symbol}</div>
                              <div className="text-xs text-gray-500 font-mono">{token.address.slice(0, 6)}...</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-gray-900 dark:text-white">
                          {parseRawAmount(token.price, decimals).toFixed(6)} <span className="text-xs text-gray-500">KTA</span>
                        </td>
                        <td className="px-6 py-4 text-right text-gray-800 dark:text-gray-200 font-medium hidden lg:table-cell">{smartFormat(token.marketCap, decimals)} <span className="text-xs text-gray-400 dark:text-gray-500">KTA</span></td>
                        <td className="px-6 py-4 flex justify-center">
                          <LaunchpadProgress
                            percent={token.fundRaise ? (parseRawAmount(token.fundRaise.raised, decimals) / parseRawAmount(token.fundRaise.expectedTotalRaise, decimals)) * 100 : 0}
                            width={120} height={40} curve={token.fundRaise?.curve || "linear"}
                          />
                        </td>
                        <td className="px-6 py-4 text-center hidden md:table-cell">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleKeepPairedToken(token.id, !!token.keepPairedToken); }}
                            disabled={!!togglingPools[token.id]}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] rounded-md cursor-pointer transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-wait ${token.keepPairedToken ? "bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200/50 dark:border-green-500/20 hover:bg-green-200 dark:hover:bg-green-500/20" : "bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-white/10 hover:bg-gray-200 dark:hover:bg-white/10"}`}
                          >
                            {togglingPools[token.id] ? (
                              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <>
                                <span className={`w-1.5 h-1.5 rounded-full ${token.keepPairedToken ? "bg-green-500" : "bg-gray-400 dark:bg-gray-600"}`} />
                                {token.keepPairedToken ? "Yes" : "No"}
                              </>
                            )}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-center hidden lg:table-cell">
                          <InlineIncentiveInput value={token.collectiveShare ?? null} placeholder="default" onSave={(val) => updateIncentiveParam(token.id, "collectiveShare", val)} />
                        </td>
                        <td className="px-6 py-4 text-center hidden lg:table-cell">
                          <InlineIncentiveInput value={token.decayRate ?? null} placeholder="default" onSave={(val) => updateIncentiveParam(token.id, "decayRate", val)} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {viewMode === "graduated" && (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/[0.02] text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider border-b border-gray-200 dark:border-white/[0.08]">
                  <th className="px-6 py-4 font-semibold w-12">#</th>
                  <th className="px-6 py-4 font-semibold">Token</th>
                  <th className="px-6 py-4 font-semibold text-right">Price</th>
                  <th className="px-6 py-4 font-semibold text-right hidden lg:table-cell">Market Cap</th>
                  <th className="px-6 py-4 font-semibold text-center hidden md:table-cell">Keep Paired</th>
                  <th className="px-6 py-4 font-semibold text-center hidden lg:table-cell"><Tooltip text="Fraction of paired token fees going to the collective. Null = uses global INCENTIVE_COLLECTIVE_SHARE from Remote Config.">Collective Share</Tooltip></th>
                  <th className="px-6 py-4 font-semibold text-center hidden lg:table-cell"><Tooltip text="Exponential decay rate for distributing this pool's paired token each cycle. Null = uses global INCENTIVE_DECAY_RATE from Remote Config.">Decay Rate</Tooltip></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                {loadingGraduated ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">Loading tokens...</td></tr>
                ) : filteredGraduatedTokens.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">No graduated tokens found.</td></tr>
                ) : (
                  filteredGraduatedTokens.map((token, index) => {
                    const decimals = BASE_TOKEN[token.network || "main"].decimals;

                    return (
                      <tr key={token.id} onClick={() => navigate(`/token-details?q=${token.address}`)} className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors duration-150 cursor-pointer group">
                        <td className="px-6 py-4 text-gray-400 font-mono text-sm">{index + 1}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <TokenLogoWithKYC address={token.pairedToken} symbol={token.symbol} network={token.network || "main"} creator={token.creator} onKYCResolved={handleKYCResolved} />
                            <div>
                              <div className="font-semibold text-gray-900 dark:text-white group-hover:text-[#845fbc] dark:group-hover:text-[#a78bfa] transition">{token.symbol}</div>
                              <div className="text-xs text-gray-500 font-mono">{token.address.slice(0, 6)}...</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-gray-900 dark:text-white">
                          {parseRawAmount(token.price, decimals).toFixed(6)} <span className="text-xs text-gray-500">KTA</span>
                        </td>
                        <td className="px-6 py-4 text-right text-gray-800 dark:text-gray-200 font-medium hidden lg:table-cell">{smartFormat(token.marketCap, decimals)} <span className="text-xs text-gray-400 dark:text-gray-500">KTA</span></td>
                        <td className="px-6 py-4 text-center hidden md:table-cell">
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleKeepPairedToken(token.id, !!token.keepPairedToken); }}
                            disabled={!!togglingPools[token.id]}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] rounded-md cursor-pointer transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-wait ${token.keepPairedToken ? "bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200/50 dark:border-green-500/20 hover:bg-green-200 dark:hover:bg-green-500/20" : "bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-white/10 hover:bg-gray-200 dark:hover:bg-white/10"}`}
                          >
                            {togglingPools[token.id] ? (
                              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <>
                                <span className={`w-1.5 h-1.5 rounded-full ${token.keepPairedToken ? "bg-green-500" : "bg-gray-400 dark:bg-gray-600"}`} />
                                {token.keepPairedToken ? "Yes" : "No"}
                              </>
                            )}
                          </button>
                        </td>
                        <td className="px-6 py-4 text-center hidden lg:table-cell">
                          <InlineIncentiveInput value={token.collectiveShare ?? null} placeholder="default" onSave={(val) => updateIncentiveParam(token.id, "collectiveShare", val)} />
                        </td>
                        <td className="px-6 py-4 text-center hidden lg:table-cell">
                          <InlineIncentiveInput value={token.decayRate ?? null} placeholder="default" onSave={(val) => updateIncentiveParam(token.id, "decayRate", val)} />
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
        <div className="p-4 border-t border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02] flex justify-center items-center">
          <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold">
            {isLoading ? "Loading..." : `Showing ${displayedCount} tokens`}
          </span>
        </div>
      </div>
      )}

      {/* WALLETS SECTION */}
      {adminTab === "wallets" && !selectedWallet && (
        <div className="w-full max-w-6xl bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden mb-12 mt-8 transition-colors">

          {/* Toolbar */}
          <div className="p-6 border-b border-gray-100 dark:border-white/[0.08] flex flex-col md:flex-row justify-between items-center gap-4 bg-gray-50 dark:bg-white/[0.02]">
            <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/[0.04] px-2.5 py-1 rounded-md uppercase tracking-[0.08em]">
              {network === "main" ? "Mainnet" : "Testnet"}
            </span>
            <div className="relative w-full md:w-64">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></div>
              <input
                type="text"
                value={walletFilter}
                onChange={(e) => setWalletFilter(e.target.value)}
                placeholder="Filter by address..."
                className="w-full pl-10 pr-4 py-2 bg-gray-50 dark:bg-[#1a1a1a] border text-gray-500 dark:text-gray-200 border-gray-300 dark:border-white/[0.08] rounded-md text-[13px] focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 placeholder-gray-400 dark:placeholder-gray-600"
              />
            </div>
          </div>

          {/* Wallets table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/[0.02] text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider border-b border-gray-200 dark:border-white/[0.08]">
                  <th className="px-6 py-4 font-semibold w-12">#</th>
                  <th className="px-6 py-4 font-semibold">Address</th>
                  <th className="px-6 py-4 font-semibold text-center">Collective Member</th>
                  <th className="px-6 py-4 font-semibold text-center">Disqualified</th>
                  <th className="px-6 py-4 font-semibold text-right hidden md:table-cell">Balance</th>
                  <th className="px-6 py-4 font-semibold text-right hidden lg:table-cell">Multiplier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                {loadingWallets ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400 italic">Loading wallets...</td></tr>
                ) : filteredWallets.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400 italic">No wallets found.</td></tr>
                ) : (
                  filteredWallets.map((w, index) => (
                    <tr
                      key={w.address}
                      onClick={() => selectWallet(w)}
                      className="hover:bg-gray-50 dark:hover:bg-white/[0.02] transition duration-150 cursor-pointer group"
                    >
                      <td className="px-6 py-4 text-gray-400 dark:text-gray-500 font-mono text-sm">{index + 1}</td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-sm font-medium text-gray-800 dark:text-gray-200 group-hover:text-[#845fbc] dark:group-hover:text-[#a78bfa] transition">
                          {shortenAddress(w.address)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] rounded-md ${w.hasCollective ? "bg-[#845fbc]/10 text-[#845fbc] dark:text-[#a78bfa] border border-[#845fbc]/20" : "bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-gray-500 border border-gray-200/50 dark:border-white/10"}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${w.hasCollective ? "bg-[#845fbc] dark:bg-[#a78bfa]" : "bg-gray-400 dark:bg-gray-600"}`} />
                          {w.hasCollective ? "Yes" : "No"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {w.hasCollective ? (
                          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] rounded-md ${w.disqualified ? "bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200/50 dark:border-red-500/20" : "bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200/50 dark:border-green-500/20"}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${w.disqualified ? "bg-red-500" : "bg-green-500"}`} />
                            {w.disqualified ? "Yes" : "No"}
                          </span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right hidden md:table-cell">
                        {w.hasCollective && w.balanceFormatted ? (
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{w.balanceFormatted} <span className="text-xs text-gray-400 dark:text-gray-500">PACA</span></span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right hidden lg:table-cell">
                        {w.hasCollective && w.multiplier != null ? (
                          <span className="text-[13px] font-semibold text-[#845fbc] dark:text-[#a78bfa]">{w.multiplier.toFixed(2)}x</span>
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02] flex justify-center items-center">
            <span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-semibold">
              {loadingWallets ? "Loading..." : `Showing ${filteredWallets.length} wallets`}
            </span>
          </div>
        </div>
      )}

      {/* WALLET DETAIL VIEW */}
      {adminTab === "wallets" && selectedWallet && (
        <div className="w-full max-w-4xl mb-12 mt-8 space-y-6">

          {/* Back button */}
          <button
            onClick={() => setSelectedWallet(null)}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-[#845fbc] dark:hover:text-[#a78bfa] transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to Wallets
          </button>

          {/* Wallet header card */}
          <div className="bg-gradient-to-r from-[#845fbc] to-[#6b46a3] rounded-xl p-6 shadow-2xl text-white">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-white/60 text-[11px] uppercase tracking-[0.08em] font-semibold mb-1">Wallet Address</p>
                <p className="font-mono text-sm md:text-base break-all">{selectedWallet.address}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] rounded-md ${selectedWallet.hasCollective ? "bg-white/20 text-white" : "bg-red-500/30 text-red-200"}`}>
                  {selectedWallet.hasCollective ? "Collective Member" : "Not a Member"}
                </span>
                <span className="px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.06em] rounded-md bg-white/20 text-white">
                  {network === "main" ? "Mainnet" : "Testnet"}
                </span>
              </div>
            </div>
          </div>

          {!selectedWallet.hasCollective ? (
            <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-12 text-center">
              <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>
              <p className="text-gray-500 dark:text-gray-400 font-medium">No Alpaca Collective data for this wallet on {network === "main" ? "mainnet" : "testnet"}.</p>
            </div>
          ) : (
            <>
              {/* Membership & Status */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 transition-colors">
                  <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-4">Membership</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Joined</span>
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{formatTimestamp(selectedWallet.joinedAt)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Last Checked</span>
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{formatTimestamp(selectedWallet.lastCheckedAt)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Streak Started</span>
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{formatTimestamp(selectedWallet.streakStartedAt)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 transition-colors">
                  <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-4">Qualification Status</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-gray-500 dark:text-gray-400">Disqualified</span>
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em] rounded-md ${selectedWallet.disqualified ? "bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200/50 dark:border-red-500/20" : "bg-green-100 dark:bg-green-500/10 text-green-600 dark:text-green-400 border border-green-200/50 dark:border-green-500/20"}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${selectedWallet.disqualified ? "bg-red-500" : "bg-green-500"}`} />
                        {selectedWallet.disqualified ? "Yes" : "No"}
                      </span>
                    </div>
                    {selectedWallet.disqualified && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-500 dark:text-gray-400">Reason</span>
                          <span className="text-sm font-medium text-red-500 dark:text-red-400">
                            {selectedWallet.disqualifiedReason === "sold_paca_on_dex" ? "Sold PACA on DEX"
                              : selectedWallet.disqualifiedReason === "balance_decreased" ? "Balance decreased"
                              : selectedWallet.disqualifiedReason || "—"}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm text-gray-500 dark:text-gray-400">Disqualified At</span>
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{formatTimestamp(selectedWallet.disqualifiedAt)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Balances & Multiplier */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 transition-colors">
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-2">PACA Balance</p>
                  <p className="text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white">
                    {selectedWallet.balanceFormatted || "0"}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 font-mono break-all">{selectedWallet.balance || "0"}</p>
                </div>

                <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 transition-colors">
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-2">Cycle Balance</p>
                  <p className="text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white">
                    {selectedWallet.cycleBalance && selectedWallet.cycleBalance !== "0"
                      ? formatAmount18(selectedWallet.cycleBalance, 18)
                      : "0"}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 font-mono break-all">{selectedWallet.cycleBalance || "0"}</p>
                </div>

                <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 transition-colors">
                  <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-2">Loyalty Multiplier</p>
                  <p className="text-[22px] font-semibold tracking-tight text-[#845fbc] dark:text-[#a78bfa]">
                    {selectedWallet.multiplier != null ? `${selectedWallet.multiplier.toFixed(2)}x` : "—"}
                  </p>
                  {selectedWallet.multiplier != null && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      {selectedWallet.multiplier >= 1.40 ? "The Summit" :
                        selectedWallet.multiplier >= 1.32 ? "Step 4" :
                        selectedWallet.multiplier >= 1.24 ? "Step 3" :
                        selectedWallet.multiplier >= 1.16 ? "Step 2" :
                        selectedWallet.multiplier >= 1.08 ? "Step 1" : "Base Camp"}
                    </p>
                  )}
                  {/* Multiplier progress bar */}
                  <div className="mt-3 w-full bg-gray-200 dark:bg-white/[0.08] rounded-full h-1.5">
                    <div
                      className="bg-[#845fbc] dark:bg-[#a78bfa] h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(((selectedWallet.multiplier ?? 1) - 1) / 0.4 * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Rewards Received */}
              {selectedWallet.payouts && Object.keys(selectedWallet.payouts.totals).length > 0 && (
                <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                    <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Rewards Received</h3>
                    <div className="flex items-center gap-4 text-xs text-gray-400 dark:text-gray-500">
                      <span>{selectedWallet.payouts.totalCycles} cycle{selectedWallet.payouts.totalCycles !== 1 ? "s" : ""}</span>
                      {selectedWallet.payouts.lastPayoutAt && (
                        <span>Last: {formatTimestamp(selectedWallet.payouts.lastPayoutAt)}</span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Object.entries(selectedWallet.payouts.totals)
                      .sort(([a], [b]) => (a === "KTA" ? -1 : b === "KTA" ? 1 : a.localeCompare(b)))
                      .map(([symbol, info]) => (
                        <div key={symbol} className="bg-gray-50 dark:bg-white/[0.04] rounded-xl p-4 border border-gray-100 dark:border-white/[0.08]">
                          <p className="text-[9px] font-semibold uppercase tracking-[0.06em]st text-gray-500 mb-1">{symbol}</p>
                          <p className="text-lg font-semibold text-gray-900 dark:text-white">{formatAmount18(info.total || "0", 18)}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-1 break-all">{info.total || "0"}</p>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Raw data card */}
              <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 transition-colors">
                <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-4">Last Checked Balance</h3>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {selectedWallet.lastCheckedBalance ? formatAmount18(selectedWallet.lastCheckedBalance, 18) : "—"} <span className="text-xs text-gray-400">PACA</span>
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 font-mono">{selectedWallet.lastCheckedBalance || "—"}</p>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">{formatTimestamp(selectedWallet.lastCheckedAt)}</p>
                </div>
              </div>

              {/* Recent Transactions */}
              <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-6 transition-colors">
                <h3 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-4">Recent Transactions</h3>
                {loadingHistory ? (
                  <div className="py-8 text-center">
                    <div className="w-8 h-8 border-4 border-[#845fbc] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-xs text-gray-400">Loading on-chain history...</p>
                  </div>
                ) : walletHistory.length === 0 ? (
                  <p className="text-sm text-gray-400 dark:text-gray-500 italic text-center py-6">No transaction history found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="text-gray-500 dark:text-gray-400 uppercase text-[11px] font-medium tracking-[0.08em] border-b border-gray-100 dark:border-white/[0.08]">
                          <th className="px-4 py-3">Action</th>
                          <th className="px-4 py-3">Sent</th>
                          <th className="px-4 py-3">Received</th>
                          <th className="px-4 py-3">Details</th>
                          <th className="px-4 py-3">Time</th>
                          <th className="px-4 py-3 text-right">Hash</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-white/[0.04]">
                        {walletHistory
                          .filter(tx => {
                            if (tx.type !== 'SWAP') return true;
                            if (tx.tokenIn?.address && tx.tokenOut?.address && tx.tokenIn.address === tx.tokenOut.address) return false;
                            const inSym = tx.tokenIn?.symbol?.toUpperCase();
                            const outSym = tx.tokenOut?.symbol?.toUpperCase();
                            const ktaAmt = (inSym === 'KTA' || inSym === 'KEETA') ? parseFloat(tx.tokenIn?.amount || "0")
                              : (outSym === 'KTA' || outSym === 'KEETA') ? parseFloat(tx.tokenOut?.amount || "0") : null;
                            return !(ktaAmt !== null && ktaAmt < 0.005);
                          })
                          .map(tx => {
                            const isReward = tx.external?.startsWith("PD-");
                            const inSymbol = tx.tokenIn ? (walletTokenMap[tx.tokenIn.address]?.symbol || tx.tokenIn.symbol) : '';
                            const outSymbol = tx.tokenOut ? (walletTokenMap[tx.tokenOut.address]?.symbol || tx.tokenOut.symbol) : '';
                            const isReceive = tx.type === 'RECEIVE';
                            const isSend = tx.type === 'SEND';
                            const tokenSymbol = tx.tokenIn ? (walletTokenMap[tx.tokenIn.address]?.symbol || tx.tokenIn.symbol) : '';

                            const getBadge = () => {
                              if (isReward) return { style: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300', label: 'Reward' };
                              if (tx.type === 'SWAP') return { style: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', label: 'Swap' };
                              if (tx.type === 'RECEIVE') return { style: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', label: 'Received' };
                              if (tx.type === 'SEND') return { style: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', label: 'Sent' };
                              return { style: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300', label: tx.type };
                            };
                            const badge = getBadge();

                            const counterpartyLabel = (() => {
                              if (!tx.counterparty || tx.counterparty === "Unknown") return "—";
                              const parts = tx.counterparty.split(": ");
                              const addr = parts.length > 1 ? parts[1] : tx.counterparty;
                              if (addr.length < 10) return tx.counterparty;
                              const prefix = parts.length > 1 ? parts[0] + ": " : "";
                              return `${prefix}${addr.substring(0, 6)}...${addr.slice(-4)}`;
                            })();

                            return (
                              <tr key={tx.hash} className={`hover:bg-gray-50 dark:hover:bg-white/[0.02] transition duration-150 ${isReward ? 'bg-amber-50/50 dark:bg-amber-900/5' : ''}`}>
                                <td className="px-4 py-3">
                                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.06em] ${badge.style}`}>
                                    {badge.label}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-mono text-sm text-gray-700 dark:text-gray-300">
                                  {isSend && tx.tokenIn ? (
                                    <div className="flex items-center gap-1.5">
                                      <span>-{Number(tx.tokenIn.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                                      <TokenLogo symbol={tokenSymbol} address={tx.tokenIn.address} network={network} className="w-4 h-4" />
                                      <span className="font-medium text-gray-500 text-xs">{tokenSymbol}</span>
                                    </div>
                                  ) : tx.type === 'SWAP' && tx.tokenIn ? (
                                    <div className="flex items-center gap-1.5">
                                      <span>{Number(tx.tokenIn.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                                      <TokenLogo symbol={inSymbol} address={tx.tokenIn.address} network={network} className="w-4 h-4" />
                                      <span className="font-medium text-gray-500 text-xs">{inSymbol}</span>
                                    </div>
                                  ) : <span className="text-gray-400">-</span>}
                                </td>
                                <td className="px-4 py-3 font-mono text-sm text-gray-900 dark:text-white font-medium">
                                  {isReceive && tx.tokenIn ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-green-500">+</span>
                                      <span>{Number(tx.tokenIn.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                                      <TokenLogo symbol={tokenSymbol} address={tx.tokenIn.address} network={network} className="w-4 h-4" />
                                      <span className="font-medium text-xs">{tokenSymbol}</span>
                                    </div>
                                  ) : tx.type === 'SWAP' && tx.tokenOut ? (
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-green-500">+</span>
                                      <span>{Number(tx.tokenOut.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                                      <TokenLogo symbol={outSymbol} address={tx.tokenOut.address} network={network} className="w-4 h-4" />
                                      <span className="font-medium text-xs">{outSymbol}</span>
                                    </div>
                                  ) : <span className="text-gray-400">-</span>}
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                                  {isReward ? (
                                    <span className="font-mono text-amber-600 dark:text-amber-400">{tx.external}</span>
                                  ) : (
                                    <span className="font-mono">{counterpartyLabel}</span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                                  {new Date(tx.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <a href={`https://explorer.keeta.com/block/${tx.hash}`} target="_blank" rel="noreferrer" className="text-[#845fbc] hover:text-[#6d4c9e] hover:underline text-xs font-mono">
                                    {tx.hash.substring(0, 6)}...
                                  </a>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* CONFIG SECTION */}
      {adminTab === "config" && (
        <div className="w-full max-w-4xl mb-12 mt-8 space-y-8">

          {/* Incentives */}
          <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden transition-colors">
            <div className="p-6 border-b border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#845fbc]/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#845fbc]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Incentive Parameters</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Paca Collective distribution settings (Firebase Remote Config)</p>
                </div>
              </div>
            </div>

            {loadingConfig ? (
              <div className="p-12 flex justify-center">
                <div className="w-8 h-8 border-4 border-[#845fbc] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="p-6 space-y-6">
                {/* INCENTIVE_COLLECTIVE_SHARE */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Collective Share</p>
                      <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">INCENTIVE_COLLECTIVE_SHARE</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Fraction of paired token fees going to the collective at sweep time. The rest goes to the revenue wallet.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" max="100" step="1"
                      value={configDraft.INCENTIVE_COLLECTIVE_SHARE != null ? (configDraft.INCENTIVE_COLLECTIVE_SHARE * 100).toFixed(0) : ""}
                      onChange={(e) => setConfigDraft(prev => ({ ...prev, INCENTIVE_COLLECTIVE_SHARE: e.target.value === "" ? null : parseFloat(e.target.value) / 100 }))}
                      placeholder="—"
                      className="w-20 px-3 py-2 text-sm text-center bg-gray-50 dark:bg-white/[0.04] border border-gray-300 dark:border-white/[0.08] rounded-md focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 text-gray-800 dark:text-gray-200"
                    />
                    <span className="text-sm text-gray-400 font-medium">%</span>
                  </div>
                </div>

                <div className="border-t border-gray-100 dark:border-white/[0.08]" />

                {/* INCENTIVE_KTA_SHARE */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-gray-900 dark:text-white">KTA Share</p>
                      <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">INCENTIVE_KTA_SHARE</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Fraction of KTA on the sweep wallet distributed to participants each cycle. The remainder is sent to the revenue wallet.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" max="100" step="1"
                      value={configDraft.INCENTIVE_KTA_SHARE != null ? (configDraft.INCENTIVE_KTA_SHARE * 100).toFixed(0) : ""}
                      onChange={(e) => setConfigDraft(prev => ({ ...prev, INCENTIVE_KTA_SHARE: e.target.value === "" ? null : parseFloat(e.target.value) / 100 }))}
                      placeholder="—"
                      className="w-20 px-3 py-2 text-sm text-center bg-gray-50 dark:bg-white/[0.04] border border-gray-300 dark:border-white/[0.08] rounded-md focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 text-gray-800 dark:text-gray-200"
                    />
                    <span className="text-sm text-gray-400 font-medium">%</span>
                  </div>
                </div>

                <div className="border-t border-gray-100 dark:border-white/[0.08]" />

                {/* INCENTIVE_DECAY_RATE */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Decay Rate</p>
                      <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">INCENTIVE_DECAY_RATE</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Default fraction of each non-KTA token balance distributed per cycle (exponential decay). Pools can override this individually.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" max="100" step="1"
                      value={configDraft.INCENTIVE_DECAY_RATE != null ? (configDraft.INCENTIVE_DECAY_RATE * 100).toFixed(0) : ""}
                      onChange={(e) => setConfigDraft(prev => ({ ...prev, INCENTIVE_DECAY_RATE: e.target.value === "" ? null : parseFloat(e.target.value) / 100 }))}
                      placeholder="—"
                      className="w-20 px-3 py-2 text-sm text-center bg-gray-50 dark:bg-white/[0.04] border border-gray-300 dark:border-white/[0.08] rounded-md focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 text-gray-800 dark:text-gray-200"
                    />
                    <span className="text-sm text-gray-400 font-medium">%</span>
                  </div>
                </div>

                <div className="border-t border-gray-100 dark:border-white/[0.08]" />

                {/* INCENTIVE_DUST_THRESHOLD */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-gray-900 dark:text-white">Dust Threshold</p>
                      <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">INCENTIVE_DUST_THRESHOLD</span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Minimum token balance (raw BigInt, 18 decimals) required to trigger distribution. Default: 1000000000000000000 (1 KTA).</p>
                  </div>
                  <input
                    type="text"
                    value={configDraft.INCENTIVE_DUST_THRESHOLD ?? ""}
                    onChange={(e) => setConfigDraft(prev => ({ ...prev, INCENTIVE_DUST_THRESHOLD: e.target.value || null }))}
                    placeholder="1000000000000000000"
                    className="w-56 px-3 py-2 text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-300 dark:border-white/[0.08] rounded-md focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 text-gray-800 dark:text-gray-200 font-mono"
                  />
                </div>

                {/* Save bar */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-white/[0.08]">
                  <div>
                    {configSaveMsg && (
                      <p className={`text-xs font-medium ${configSaveMsg.startsWith("Error") ? "text-red-500" : "text-green-500"}`}>{configSaveMsg}</p>
                    )}
                  </div>
                  <button
                    onClick={saveIncentiveConfig}
                    disabled={savingConfig || !configHasChanges}
                    className="px-4 py-2 bg-[#845fbc] hover:bg-[#724bad] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-md transition-colors"
                  >
                    {savingConfig ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Saving...
                      </span>
                    ) : "Save Changes"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Liquidity Management */}
          <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] overflow-hidden transition-colors">
            <div className="p-6 border-b border-gray-100 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#845fbc]/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-[#845fbc]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Liquidity Management</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Enable LP deposits for existing pools. Creates fresh LP token if needed.</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <div>
                <label className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] mb-2 block">Pool ID</label>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={liqPoolId}
                    onChange={(e) => { setLiqPoolId(e.target.value); setLiqResult(null); }}
                    placeholder="Enter Firestore pool document ID..."
                    className="flex-1 px-3 py-2 text-[13px] bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-md focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 font-mono"
                  />
                  <button
                    onClick={enableLiquidity}
                    disabled={liqLoading || !liqPoolId.trim()}
                    className="px-4 py-2 bg-[#845fbc] hover:bg-[#724bad] disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-semibold rounded-md transition-colors whitespace-nowrap"
                  >
                    {liqLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Processing...
                      </span>
                    ) : "Enable Liquidity"}
                  </button>
                </div>
              </div>

              {liqResult && (
                <div className={`rounded-xl border p-4 ${liqResult.success ? "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800/30" : "bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800/30"}`}>
                  <p className={`text-[13px] font-medium ${liqResult.success ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
                    {liqResult.message}
                  </p>
                  {liqResult.success && liqResult.data && (
                    <div className="mt-3 space-y-2">
                      {liqResult.data.lpTokenAddress && (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">LP Token Address</span>
                          <span className="text-[13px] font-mono text-gray-800 dark:text-gray-200 select-all">{liqResult.data.lpTokenAddress}</span>
                        </div>
                      )}
                      {liqResult.data.lpTokenSupply && (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">LP Supply</span>
                          <span className="text-[13px] font-mono text-gray-800 dark:text-gray-200">{liqResult.data.lpTokenSupply}</span>
                        </div>
                      )}
                      {liqResult.data.burnAddress && (
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Burn Address</span>
                          <span className="text-[13px] font-mono text-gray-800 dark:text-gray-200 select-all">{liqResult.data.burnAddress}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-gray-400 dark:text-gray-500">
                Sets <code className="text-[11px] bg-gray-100 dark:bg-white/[0.04] px-1 py-0.5 rounded">liquidityEnabled: true</code> on the pool and creates a fresh LP token with all supply locked on the pool address. If an old LP token exists, the new one is created at a different identifier index (old token becomes orphaned). Uses {network === "test" ? "testnet" : "mainnet"} environment.
              </p>
            </div>
          </div>

        </div>
      )}

    </div>
  );
};

export default AdminPage;

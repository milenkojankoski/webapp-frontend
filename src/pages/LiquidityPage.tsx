import React, { useState, useEffect, useCallback, useMemo } from "react";
import { collection as firestoreCollection, query, where, getDocs, limit } from "firebase/firestore";
import { db } from "../config/firebase";
import { useWallet } from "../context/WalletContext";
import { BASE_TOKEN } from "../services/pool";
import {
  getWithdrawQuote,
  submitLiquidityDeposit,
  submitLiquidityWithdrawal,
  type WithdrawQuoteResponse,
} from "../services/liquidity";
import { formatAmount18 } from "../utils/formatters";
import { TokenLogo } from "../components/common/TokenLogo";

// ── Types ──────────────────────────────────────────────────────────────────

interface PoolItem {
  id: string;
  address: string;
  pairedToken: string;
  baseToken: string;
  pairedTokenSymbol: string;
  baseTokenSymbol: string;
  pairedTokenDecimals: number;
  baseTokenDecimals: number;
  price: string;
  baseTokenAmount: string;
  pairedTokenAmount: string;
  burnAddress?: string;
  lpToken?: {
    address: string;
    supply: string;
    decimals: number;
  };
  network: "main" | "test";
  mode?: string;
  active?: boolean;
  seedIndex?: number;
}

// ── Network fee (same as trades — covers block publishing costs) ───────────
const LIQUIDITY_NETWORK_FEE: Record<string, string> = {
  main: "50000000000000000",   // 0.05 KTA (18 decimals)
  test: "1000000",             // testnet fee (9 decimals)
};

// ── Helpers ────────────────────────────────────────────────────────────────

function parseRawToHuman(raw: string, decimals: number): string {
  if (!raw || raw === "0") return "0";
  const str = raw.padStart(decimals + 1, "0");
  const intPart = str.slice(0, str.length - decimals) || "0";
  const fracPart = str.slice(str.length - decimals).replace(/0+$/, "");
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

function humanToRaw(human: string, decimals: number): string {
  if (!human || human === "0") return "0";
  const [intPart, fracPart = ""] = human.split(".");
  const padded = fracPart.padEnd(decimals, "0").slice(0, decimals);
  const raw = (intPart + padded).replace(/^0+/, "") || "0";
  return raw;
}

// ── Component ──────────────────────────────────────────────────────────────

export const LiquidityPage: React.FC = () => {
  const { isConnected, address, network, balances } = useWallet();

  // Tab state
  const [activeTab, setActiveTab] = useState<"deposit" | "withdraw">("deposit");

  // Pool selection
  const [pools, setPools] = useState<PoolItem[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(false);
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const [poolSearch, setPoolSearch] = useState("");

  // Deposit state
  const [depositMode, setDepositMode] = useState<"zap" | "dual">("zap");
  const [zapAmount, setZapAmount] = useState("");
  const [dualBaseAmount, setDualBaseAmount] = useState("");
  const [dualPairedAmount, setDualPairedAmount] = useState("");
  const [slippagePct, setSlippagePct] = useState(5);

  // Withdraw state
  const [withdrawLpAmount, setWithdrawLpAmount] = useState("");
  const [withdrawQuote, setWithdrawQuote] = useState<WithdrawQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // General state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedPool = useMemo(
    () => pools.find((p) => p.id === selectedPoolId) || null,
    [pools, selectedPoolId]
  );

  const baseToken = BASE_TOKEN[network];
  const baseDecimals = baseToken.decimals;

  // ── Fetch pools ────────────────────────────────────────────────────────

  const fetchPools = useCallback(async () => {
    setPoolsLoading(true);
    try {
      const colName = network === "test" ? "pools_test" : "pools";
      const poolsRef = firestoreCollection(db, colName);
      const q = query(
        poolsRef,
        where("active", "==", true),
        where("network", "==", network),
        where("liquidityEnabled", "==", true),
        limit(200)
      );
      const snap = await getDocs(q);
      const items: PoolItem[] = [];
      snap.forEach((d) => {
        const data = d.data();
        if (data.pairedToken && data.lpToken?.address) {
          items.push({
            id: d.id,
            address: data.address,
            pairedToken: data.pairedToken,
            baseToken: data.baseToken,
            pairedTokenSymbol: data.pairedTokenSymbol || "???",
            baseTokenSymbol: data.baseTokenSymbol || "KTA",
            pairedTokenDecimals: data.pairedTokenDecimals ?? data.tokenDecimals ?? 18,
            baseTokenDecimals: data.baseTokenDecimals ?? baseDecimals,
            price: data.price || "0",
            baseTokenAmount: data.baseTokenAmount || "0",
            pairedTokenAmount: data.pairedTokenAmount || "0",
            burnAddress: data.burnAddress,
            lpToken: data.lpToken,
            network: data.network,
            mode: data.mode,
            active: data.active,
            seedIndex: data.seedIndex,
          });
        }
      });
      items.sort((a, b) => a.pairedTokenSymbol.localeCompare(b.pairedTokenSymbol));
      setPools(items);
      if (items.length > 0 && !selectedPoolId) {
        setSelectedPoolId(items[0].id);
      }
    } catch (err: any) {
      console.error("Failed to fetch pools:", err);
      setError("Failed to load pools.");
    } finally {
      setPoolsLoading(false);
    }
  }, [network, baseDecimals]);

  useEffect(() => {
    fetchPools();
  }, [fetchPools]);

  // ── Withdraw quote (debounced) ─────────────────────────────────────────

  useEffect(() => {
    if (activeTab !== "withdraw" || !selectedPoolId || !withdrawLpAmount) {
      setWithdrawQuote(null);
      return;
    }

    const raw = humanToRaw(withdrawLpAmount, selectedPool?.lpToken?.decimals ?? baseDecimals);
    if (raw === "0") {
      setWithdrawQuote(null);
      return;
    }

    const timer = setTimeout(async () => {
      setQuoteLoading(true);
      setError(null);
      try {
        const quote = await getWithdrawQuote({ poolId: selectedPoolId, lpAmount: raw }, network);
        setWithdrawQuote(quote);
      } catch (err: any) {
        console.error("Withdraw quote error:", err);
        setWithdrawQuote(null);
        setError(err.message || "Failed to get withdrawal quote");
      } finally {
        setQuoteLoading(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [activeTab, selectedPoolId, withdrawLpAmount, network, selectedPool, baseDecimals]);

  // ── LP balance for selected pool ───────────────────────────────────────

  const lpBalance = useMemo(() => {
    if (!selectedPool?.lpToken?.address) return null;
    return balances.find((b) => b.address === selectedPool.lpToken!.address) || null;
  }, [balances, selectedPool]);

  // ── KTA balance ────────────────────────────────────────────────────────

  const ktaBalance = useMemo(() => {
    return balances.find((b) => b.address === baseToken.address) || null;
  }, [balances, baseToken.address]);

  // ── Paired token balance ───────────────────────────────────────────────

  const pairedBalance = useMemo(() => {
    if (!selectedPool) return null;
    return balances.find((b) => b.address === selectedPool.pairedToken) || null;
  }, [balances, selectedPool]);

  // ── LP token price (value of 1 LP token in KTA) ────────────────────────

  const lpTokenPrice = useMemo(() => {
    if (!selectedPool?.lpToken?.supply || !selectedPool.baseTokenAmount || !selectedPool.pairedTokenAmount || !selectedPool.price) return null;
    const lpSupply = BigInt(selectedPool.lpToken.supply || "0");
    if (lpSupply === 0n) return null;

    const baseReserve = BigInt(selectedPool.baseTokenAmount || "0");
    const pairedReserve = BigInt(selectedPool.pairedTokenAmount || "0");
    const price = BigInt(selectedPool.price || "0"); // price of paired token in base units
    if (baseReserve === 0n || pairedReserve === 0n || price === 0n) return null;

    const pairedDecimals = BigInt(selectedPool.pairedTokenDecimals);
    const pairedScale = 10n ** pairedDecimals;

    // Convert paired reserve value to base units: (pairedReserve * price) / pairedScale
    const pairedValueInBase = (pairedReserve * price) / pairedScale;
    const totalPoolValue = baseReserve + pairedValueInBase;

    // LP price in base units (scaled to baseDecimals)
    const baseScale = 10n ** BigInt(selectedPool.baseTokenDecimals);
    const lpPriceRaw = (totalPoolValue * baseScale) / lpSupply;

    return parseRawToHuman(lpPriceRaw.toString(), selectedPool.baseTokenDecimals);
  }, [selectedPool]);

  // ── Filtered pools ─────────────────────────────────────────────────────

  const filteredPools = useMemo(() => {
    if (!poolSearch.trim()) return pools;
    const s = poolSearch.toLowerCase();
    return pools.filter(
      (p) =>
        p.pairedTokenSymbol.toLowerCase().includes(s) ||
        p.baseTokenSymbol.toLowerCase().includes(s) ||
        p.id.toLowerCase().includes(s)
    );
  }, [pools, poolSearch]);

  // ── Deposit handler ────────────────────────────────────────────────────

  const handleDeposit = async () => {
    if (!window.alpaca) {
      setError("Wallet extension not found. Please install the Alpaca wallet.");
      return;
    }
    if (!address || !selectedPool) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      if (depositMode === "zap") {
        // Zap-in: single KTA send to pool
        const rawAmount = humanToRaw(zapAmount, baseDecimals);
        if (rawAmount === "0") throw new Error("Enter an amount");

        const result = await window.alpaca.signTransaction({
          type: "FUND",
          params: {
            network,
            to: selectedPool.address,
            token: baseToken.address,
            amount: rawAmount,
          },
        });

        const { base64, hash } = result as { base64: string; hash: string };

        // Fee block: send network fee KTA to pool (chained after deposit block)
        const feeResult = await window.alpaca.signTransaction({
          type: "FUND",
          params: {
            network,
            to: selectedPool.address,
            token: baseToken.address,
            amount: LIQUIDITY_NETWORK_FEE[network],
            previous: hash,
          },
        });
        const feeBlock = (feeResult as { base64: string }).base64;

        const liqId = await submitLiquidityDeposit(selectedPool.id, network, {
          type: "zap",
          sender: address,
          block: base64,
          feeBlock,
          amountIn: rawAmount,
          maxSlippagePct: slippagePct,
        });

        setSuccess(`Deposit submitted (ID: ${liqId.slice(0, 8)}...). Processing...`);
        setZapAmount("");
      } else {
        // Dual: send both tokens to pool (chained blocks)
        const rawBase = humanToRaw(dualBaseAmount, baseDecimals);
        const rawPaired = humanToRaw(dualPairedAmount, selectedPool.pairedTokenDecimals);
        if (rawBase === "0" || rawPaired === "0") throw new Error("Enter amounts for both tokens");

        // Block 1: send KTA
        const result1 = await window.alpaca.signTransaction({
          type: "FUND",
          params: {
            network,
            to: selectedPool.address,
            token: baseToken.address,
            amount: rawBase,
          },
        });

        const { base64: block1, hash: hash1 } = result1 as { base64: string; hash: string };

        // Block 2: send paired token (chained to block 1)
        const result2 = await window.alpaca.signTransaction({
          type: "FUND",
          params: {
            network,
            to: selectedPool.address,
            token: selectedPool.pairedToken,
            amount: rawPaired,
            previous: hash1,
          },
        });

        const { base64: block2, hash: hash2 } = result2 as { base64: string; hash: string };

        // Fee block: send network fee KTA to pool (chained after block 2)
        const feeResult = await window.alpaca.signTransaction({
          type: "FUND",
          params: {
            network,
            to: selectedPool.address,
            token: baseToken.address,
            amount: LIQUIDITY_NETWORK_FEE[network],
            previous: hash2,
          },
        });
        const feeBlock = (feeResult as { base64: string }).base64;

        const liqId = await submitLiquidityDeposit(selectedPool.id, network, {
          type: "dual",
          sender: address,
          block: block1 + "|" + block2,
          feeBlock,
          amountBase: rawBase,
          amountPaired: rawPaired,
        });

        setSuccess(`Deposit submitted (ID: ${liqId.slice(0, 8)}...). Processing...`);
        setDualBaseAmount("");
        setDualPairedAmount("");
      }
    } catch (err: any) {
      console.error("Deposit error:", err);
      setError(err.message || "Deposit failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Withdraw handler ───────────────────────────────────────────────────

  const handleWithdraw = async () => {
    if (!window.alpaca) {
      setError("Wallet extension not found. Please install the Alpaca wallet.");
      return;
    }
    if (!address || !selectedPool || !withdrawQuote) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const rawLp = humanToRaw(withdrawLpAmount, selectedPool.lpToken?.decimals ?? baseDecimals);
      if (rawLp === "0") throw new Error("Enter an LP amount");

      // Sign: send LP tokens to burn address
      const result = await window.alpaca.signTransaction({
        type: "FUND",
        params: {
          network,
          to: withdrawQuote.burnAddress,
          token: withdrawQuote.lpTokenAddress,
          amount: rawLp,
        },
      });

      const { base64, hash } = result as { base64: string; hash: string };

      // Fee block: send network fee KTA to pool (chained after LP send block)
      const feeResult = await window.alpaca.signTransaction({
        type: "FUND",
        params: {
          network,
          to: selectedPool.address,
          token: baseToken.address,
          amount: LIQUIDITY_NETWORK_FEE[network],
          previous: hash,
        },
      });
      const feeBlock = (feeResult as { base64: string }).base64;

      const withdrawId = await submitLiquidityWithdrawal(selectedPool.id, network, {
        sender: address,
        block: base64,
        feeBlock,
        lpAmount: rawLp,
      });

      setSuccess(`Withdrawal submitted (ID: ${withdrawId.slice(0, 8)}...). Processing...`);
      setWithdrawLpAmount("");
      setWithdrawQuote(null);
    } catch (err: any) {
      console.error("Withdrawal error:", err);
      setError(err.message || "Withdrawal failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Preset amount buttons ──────────────────────────────────────────────

  const setPresetPercent = (pct: number) => {
    if (activeTab === "deposit" && depositMode === "zap" && ktaBalance) {
      const raw = BigInt(ktaBalance.rawBalance || "0");
      const amount = (raw * BigInt(pct)) / 100n;
      setZapAmount(parseRawToHuman(amount.toString(), baseDecimals));
    } else if (activeTab === "withdraw" && lpBalance) {
      const raw = BigInt(lpBalance.rawBalance || "0");
      const amount = (raw * BigInt(pct)) / 100n;
      setWithdrawLpAmount(parseRawToHuman(amount.toString(), selectedPool?.lpToken?.decimals ?? baseDecimals));
    }
  };

  // ── Not connected state ────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="w-full min-h-screen bg-gray-50 dark:bg-[#171717] transition-colors duration-300 p-4 md:p-8 lg:p-12">
        <div className="max-w-2xl mx-auto">
          <div className="mb-6">
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white">Manage Liquidity</h1>
          </div>
          <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 text-[15px]">
              Connect your wallet to deposit or withdraw liquidity.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="w-full min-h-screen bg-gray-50 dark:bg-[#171717] transition-colors duration-300 p-4 md:p-8 lg:p-12">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Liquidity</p>
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white mt-1">Manage Liquidity</h1>
          <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">Deposit tokens to earn trading fees, or withdraw your position.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 mb-6 border-b border-gray-200 dark:border-white/[0.08]">
          {(["deposit", "withdraw"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                setError(null);
                setSuccess(null);
              }}
              className={`pb-4 text-[13px] font-semibold transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? "text-gray-900 dark:text-white border-b-2 border-[#845fbc]"
                  : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              }`}
            >
              {tab === "deposit" ? "DEPOSIT" : "WITHDRAW"}
            </button>
          ))}
        </div>

        {/* Main card */}
        <div className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] p-5 md:p-6">
          {/* Pool selector */}
          <div className="mb-5">
            <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 block mb-2">
              Select Pool
            </label>
            <input
              type="text"
              placeholder="Search pools..."
              value={poolSearch}
              onChange={(e) => setPoolSearch(e.target.value)}
              className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-white/[0.08] rounded-md px-4 py-1.5 text-[13px] text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#845fbc] mb-2"
            />
            <div className="max-h-40 overflow-y-auto rounded-md border border-gray-200 dark:border-white/[0.08]">
              {poolsLoading ? (
                <div className="px-4 py-3 text-[13px] text-gray-500">Loading pools...</div>
              ) : filteredPools.length === 0 ? (
                <div className="px-4 py-3 text-[13px] text-gray-500">No liquidity pools found.</div>
              ) : (
                filteredPools.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedPoolId(p.id);
                      setPoolSearch("");
                      setError(null);
                      setSuccess(null);
                      setWithdrawQuote(null);
                      setWithdrawLpAmount("");
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      p.id === selectedPoolId
                        ? "bg-[#845fbc]/5 dark:bg-[#845fbc]/10"
                        : "hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                    }`}
                  >
                    <TokenLogo address={p.pairedToken} symbol={p.pairedTokenSymbol} network={network} className="w-6 h-6" />
                    <div className="flex-1 min-w-0">
                      <span className="text-[13px] font-semibold text-gray-900 dark:text-white">
                        {p.baseTokenSymbol}/{p.pairedTokenSymbol}
                      </span>
                    </div>
                    <span className="text-[11px] text-gray-400 font-mono">{p.id.slice(0, 6)}...</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Pool info */}
          {selectedPool && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
              <div className="bg-gray-50 dark:bg-white/[0.02] rounded-md px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">{selectedPool.baseTokenSymbol} Reserve</div>
                <div className="text-[13px] font-semibold text-gray-900 dark:text-white mt-0.5">
                  {formatAmount18(selectedPool.baseTokenAmount, selectedPool.baseTokenDecimals)}
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-white/[0.02] rounded-md px-3 py-2">
                <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">{selectedPool.pairedTokenSymbol} Reserve</div>
                <div className="text-[13px] font-semibold text-gray-900 dark:text-white mt-0.5">
                  {formatAmount18(selectedPool.pairedTokenAmount, selectedPool.pairedTokenDecimals)}
                </div>
              </div>
              {selectedPool.lpToken && (
                <>
                  <div className="bg-gray-50 dark:bg-white/[0.02] rounded-md px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">LP Supply</div>
                    <div className="text-[13px] font-semibold text-gray-900 dark:text-white mt-0.5">
                      {formatAmount18(selectedPool.lpToken.supply, typeof selectedPool.lpToken.decimals === "number" ? selectedPool.lpToken.decimals : baseDecimals)}
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-white/[0.02] rounded-md px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">LP Token Price</div>
                    <div className="text-[13px] font-semibold text-gray-900 dark:text-white mt-0.5">
                      {lpTokenPrice ? `${lpTokenPrice} ${selectedPool.baseTokenSymbol}` : "—"}
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-white/[0.02] rounded-md px-3 py-2">
                    <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Your LP Balance</div>
                    <div className="text-[13px] font-semibold text-gray-900 dark:text-white mt-0.5">
                      {lpBalance
                        ? formatAmount18(lpBalance.rawBalance, typeof selectedPool.lpToken.decimals === "number" ? selectedPool.lpToken.decimals : baseDecimals)
                        : "0"}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── DEPOSIT TAB ─────────────────────────────────────────── */}
          {activeTab === "deposit" && selectedPool && (
            <>
              {/* Deposit mode toggle */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setDepositMode("zap")}
                  className={`flex-1 py-2 text-[12px] font-semibold rounded-md transition-colors ${
                    depositMode === "zap"
                      ? "bg-[#845fbc] text-white"
                      : "bg-gray-100 dark:bg-white/[0.04] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  Zap In (KTA Only)
                </button>
                <button
                  onClick={() => setDepositMode("dual")}
                  className={`flex-1 py-2 text-[12px] font-semibold rounded-md transition-colors ${
                    depositMode === "dual"
                      ? "bg-[#845fbc] text-white"
                      : "bg-gray-100 dark:bg-white/[0.04] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/[0.06]"
                  }`}
                >
                  Dual Deposit
                </button>
              </div>

              {depositMode === "zap" ? (
                <>
                  <div className="mb-4">
                    <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 block mb-2">
                      KTA Amount
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={zapAmount}
                        onChange={(e) => setZapAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-white/[0.08] rounded-md px-4 py-3 text-[15px] text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#845fbc] pr-20"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-gray-400 font-semibold">KTA</span>
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[11px] text-gray-400">
                        Balance: {ktaBalance ? formatAmount18(ktaBalance.rawBalance, baseDecimals) : "0"} KTA
                      </span>
                      <div className="flex gap-1">
                        {[25, 50, 75, 100].map((pct) => (
                          <button
                            key={pct}
                            onClick={() => setPresetPercent(pct)}
                            className="px-2 py-0.5 text-[10px] font-semibold text-[#845fbc] bg-[#845fbc]/8 hover:bg-[#845fbc]/15 rounded transition-colors"
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Slippage */}
                  <div className="mb-4">
                    <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 block mb-2">
                      Max Slippage
                    </label>
                    <div className="flex gap-2">
                      {[1, 3, 5, 10].map((s) => (
                        <button
                          key={s}
                          onClick={() => setSlippagePct(s)}
                          className={`flex-1 py-1.5 text-[12px] font-semibold rounded-md transition-colors ${
                            slippagePct === s
                              ? "bg-[#845fbc] text-white"
                              : "bg-gray-100 dark:bg-white/[0.04] text-gray-600 dark:text-gray-400"
                          }`}
                        >
                          {s}%
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-4">
                    Zap converts part of your KTA into {selectedPool.pairedTokenSymbol} via an internal swap, then deposits both tokens proportionally.
                  </p>
                </>
              ) : (
                <>
                  {/* Dual: Base token */}
                  <div className="mb-3">
                    <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 block mb-2">
                      {selectedPool.baseTokenSymbol} Amount
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={dualBaseAmount}
                        onChange={(e) => setDualBaseAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-white/[0.08] rounded-md px-4 py-3 text-[15px] text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#845fbc] pr-20"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-gray-400 font-semibold">{selectedPool.baseTokenSymbol}</span>
                    </div>
                    <span className="text-[11px] text-gray-400 mt-1 block">
                      Balance: {ktaBalance ? formatAmount18(ktaBalance.rawBalance, baseDecimals) : "0"}
                    </span>
                  </div>

                  {/* Dual: Paired token */}
                  <div className="mb-4">
                    <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 block mb-2">
                      {selectedPool.pairedTokenSymbol} Amount
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.0"
                        value={dualPairedAmount}
                        onChange={(e) => setDualPairedAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                        className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-white/[0.08] rounded-md px-4 py-3 text-[15px] text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#845fbc] pr-20"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-gray-400 font-semibold">{selectedPool.pairedTokenSymbol}</span>
                    </div>
                    <span className="text-[11px] text-gray-400 mt-1 block">
                      Balance: {pairedBalance ? formatAmount18(pairedBalance.rawBalance, selectedPool.pairedTokenDecimals) : "0"}
                    </span>
                  </div>

                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-4">
                    Deposit both tokens proportionally. Any excess will be returned.
                  </p>
                </>
              )}

              {/* Deposit button */}
              <button
                onClick={handleDeposit}
                disabled={isSubmitting || !selectedPool}
                className="w-full py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[14px]"
              >
                {isSubmitting ? "Signing & Submitting..." : "Deposit Liquidity"}
              </button>
            </>
          )}

          {/* ── WITHDRAW TAB ────────────────────────────────────────── */}
          {activeTab === "withdraw" && selectedPool && (
            <>
              <div className="mb-4">
                <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 block mb-2">
                  LP Tokens to Withdraw
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0"
                    value={withdrawLpAmount}
                    onChange={(e) => setWithdrawLpAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="w-full bg-gray-50 dark:bg-[#121212] border border-gray-200 dark:border-white/[0.08] rounded-md px-4 py-3 text-[15px] text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#845fbc] pr-20"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[12px] text-gray-400 font-semibold">LP</span>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[11px] text-gray-400">
                    Balance: {lpBalance ? formatAmount18(lpBalance.rawBalance, selectedPool.lpToken?.decimals ?? baseDecimals) : "0"} LP
                  </span>
                  <div className="flex gap-1">
                    {[25, 50, 75, 100].map((pct) => (
                      <button
                        key={pct}
                        onClick={() => setPresetPercent(pct)}
                        className="px-2 py-0.5 text-[10px] font-semibold text-[#845fbc] bg-[#845fbc]/8 hover:bg-[#845fbc]/15 rounded transition-colors"
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Withdraw quote */}
              {quoteLoading && (
                <div className="text-center py-3 text-[13px] text-gray-500">Fetching quote...</div>
              )}

              {withdrawQuote && !quoteLoading && (
                <div className="bg-gray-50 dark:bg-white/[0.02] rounded-md p-4 mb-4 space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2">You will receive</div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-gray-500 dark:text-gray-400">{withdrawQuote.baseTokenSymbol}</span>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {formatAmount18(withdrawQuote.amountBase, selectedPool.baseTokenDecimals)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-gray-500 dark:text-gray-400">{withdrawQuote.pairedTokenSymbol}</span>
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {formatAmount18(withdrawQuote.amountPaired, selectedPool.pairedTokenDecimals)}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 dark:border-white/[0.04] pt-2 mt-2">
                    <div className="flex justify-between text-[11px] text-gray-400">
                      <span>Pool share</span>
                      <span>{withdrawQuote.sharePercent.toFixed(2)}%</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Withdraw button */}
              <button
                onClick={handleWithdraw}
                disabled={isSubmitting || !withdrawQuote || quoteLoading}
                className="w-full py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[14px]"
              >
                {isSubmitting ? "Signing & Submitting..." : "Withdraw Liquidity"}
              </button>
            </>
          )}

          {/* Error / Success messages */}
          {error && (
            <div className="mt-4 px-4 py-2.5 rounded-md bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 text-[13px]">
              {error}
            </div>
          )}
          {success && (
            <div className="mt-4 px-4 py-2.5 rounded-md bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[13px]">
              {success}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiquidityPage;

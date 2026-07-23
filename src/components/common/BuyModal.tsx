import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  getBaseDepositAddress,
  createOnRampSession,
  getFxEstimate,
  createFxExchange,
  getTokenBalance,
  addPendingPurchase,
  updatePendingPurchase,
  loadPendingPurchases,
  removePendingPurchase,
  pruneStuckPendingPurchases,
  watchExchangeUntilComplete,
  recordOnRampPurchase,
  BUYABLE_TOKENS,
  BRIDGE_ASSETS,
  type BuyableToken,
  type BridgeRoute,
  type FxEstimate,
  type PendingKtaPurchase,
} from "../../services/bridge";
import { formatAmount18 } from "../../utils/formatters";
import { WalletService } from "../../services/wallet";

type Step =
  | "select"      // pick token
  | "kta-amount"  // KTA: enter amount, see FX estimate
  | "loading"     // processing
  | "awaiting"    // KTA: waiting for bridge deposit
  | "swapping"    // KTA: signing & submitting FX swap
  | "success"     // done
  | "error";

interface BuyModalProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  network: "main" | "test";
}

export const BuyModal: React.FC<BuyModalProps> = ({ isOpen, onClose, address, network }) => {
  const [step, setStep] = useState<Step>("select");
  const [selectedToken, setSelectedToken] = useState<BuyableToken | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<BridgeRoute | null>(null);
  const [fiatAmount, setFiatAmount] = useState("");
  const [estimate, setEstimate] = useState<FxEstimate | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingPurchase, setPendingPurchase] = useState<PendingKtaPurchase | null>(null);
  const [pollStatus, setPollStatus] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exchangeWatcherRef = useRef<(() => void) | null>(null);

  // Available tokens for this network
  const availableTokens = BUYABLE_TOKENS.filter(t => {
    if (t.bridgeRoutes) return true; // KTA available on all networks
    return BRIDGE_ASSETS[network]?.[t.name];
  });

  // Filter routes by network availability
  const availableRoutes = selectedToken?.bridgeRoutes?.filter(
    r => BRIDGE_ASSETS[network]?.[r.intermediate]
  ) || [];

  useEffect(() => {
    if (isOpen) {
      setStep("select");
      setSelectedToken(null);
      setSelectedRoute(null);
      setFiatAmount("");
      setEstimate(null);
      setError(null);
      setPendingPurchase(null);
      setPollStatus("");
      pruneStuckPendingPurchases();
      resumePendingIfExists();
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (exchangeWatcherRef.current) exchangeWatcherRef.current();
    };
  }, [isOpen]);

  // Check for existing pending KTA purchases on open
  const resumePendingIfExists = () => {
    const pending = loadPendingPurchases().filter(
      p => p.walletAddress === address && p.network === network && p.state === "awaitingDeposit"
    );
    if (pending.length > 0) {
      const p = pending[0];
      setPendingPurchase(p);
      const route = { fiatCurrency: p.route.fiatCurrency, intermediate: p.route.intermediate, coinbaseAsset: p.route.coinbaseAsset, coinbaseNetwork: p.route.coinbaseNetwork };
      setSelectedRoute(route);
      setStep("awaiting");
      startPolling(p);
    }
  };

  // Fetch FX estimate when amount changes (debounced)
  const fetchEstimate = useCallback(async (amount: number, route: BridgeRoute) => {
    if (amount <= 0) {
      setEstimate(null);
      return;
    }

    setEstimateLoading(true);
    setEstimateError(null);
    try {
      const fromToken = BRIDGE_ASSETS[network]?.[route.intermediate];
      const toToken = BRIDGE_ASSETS[network]?.KTA;
      if (!fromToken || !toToken) throw new Error("Missing token addresses");

      // Look up actual on-chain decimals for the intermediate token (USDC/EURC)
      const fromMeta = await WalletService.getTokenMetadata(fromToken, network);
      const rawAmount = toRawAmount(amount, fromMeta.decimals);

      const est = await getFxEstimate(network, fromToken, toToken, rawAmount);
      setEstimate(est);
    } catch (err: any) {
      console.error("FX estimate failed:", err);
      setEstimate(null);
      const msg = err?.message || "Failed to get estimate";
      if (msg.includes("Pool not found")) {
        setEstimateError(`No ${route.intermediate}/KTA liquidity pool found. This pair is not available yet.`);
      } else {
        setEstimateError(msg);
      }
    } finally {
      setEstimateLoading(false);
    }
  }, [network]);

  const onAmountChange = (value: string) => {
    setFiatAmount(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const num = parseFloat(value);
    if (!selectedRoute || isNaN(num) || num <= 0) {
      setEstimate(null);
      return;
    }

    debounceRef.current = setTimeout(() => fetchEstimate(num, selectedRoute), 600);
  };

  // ── Direct purchase flow (USDC/EURC) ──

  const handleDirectBuy = async (token: BuyableToken) => {
    setStep("loading");
    setError(null);

    try {
      const baseAddress = await getBaseDepositAddress(address, network, token.name);
      const redirectUrl = `${window.location.origin}/wallet?onramp=success`;
      const { url } = await createOnRampSession(baseAddress, [token.name], redirectUrl);
      window.open(url, "_blank");
      onClose();
    } catch (err: any) {
      console.error("Buy flow failed:", err);
      setError(err?.message || "Failed to start purchase");
      setStep("error");
    }
  };

  // ── KTA purchase flow ──

  const handleKtaBuy = async () => {
    if (!selectedRoute || !fiatAmount) return;
    const amount = parseFloat(fiatAmount);
    if (isNaN(amount) || amount <= 0) return;

    setStep("loading");
    setError(null);

    try {
      // 1. Get deposit address for the intermediate stablecoin
      const depositAddress = await getBaseDepositAddress(address, network, selectedRoute.intermediate);

      // 2. Create Coinbase session with prefilled crypto amount
      const redirectUrl = `${window.location.origin}/wallet?onramp=kta`;
      const { url } = await createOnRampSession(
        depositAddress,
        [selectedRoute.coinbaseAsset],
        redirectUrl,
        amount,
        selectedRoute.coinbaseAsset,
        selectedRoute.coinbaseNetwork
      );

      // 3. Save pending purchase
      const pending: PendingKtaPurchase = {
        id: crypto.randomUUID(),
        walletAddress: address,
        network,
        route: selectedRoute,
        fiatAmount: amount,
        depositAddress,
        createdAt: Date.now(),
        state: "awaitingDeposit",
      };
      addPendingPurchase(pending);
      setPendingPurchase(pending);

      // 4. Open Coinbase
      window.open(url, "_blank");

      // 5. Start polling for deposit
      setStep("awaiting");
      startPolling(pending);
    } catch (err: any) {
      console.error("KTA buy flow failed:", err);
      setError(err?.message || "Failed to start KTA purchase");
      setStep("error");
    }
  };

  // ── Poll for stablecoin deposit arrival ──

  const startPolling = (pending: PendingKtaPurchase) => {
    if (pollRef.current) clearInterval(pollRef.current);

    const intermediateAddress = BRIDGE_ASSETS[network]?.[pending.route.intermediate];
    if (!intermediateAddress) return;

    let previousBalance = "0";
    let pollCount = 0;

    // Get initial balance
    getTokenBalance(intermediateAddress).then(bal => { previousBalance = bal; }).catch(() => {});

    setPollStatus("Waiting for your purchase to arrive via the bridge...");

    pollRef.current = setInterval(async () => {
      pollCount++;
      try {
        const currentBalance = await getTokenBalance(intermediateAddress);

        // Detect new deposit: balance increased
        if (BigInt(currentBalance) > BigInt(previousBalance)) {
          if (pollRef.current) clearInterval(pollRef.current);

          const depositAmount = (BigInt(currentBalance) - BigInt(previousBalance)).toString();
          await executeKtaSwap(pending, depositAmount, intermediateAddress);
          return;
        }

        // Update status message
        if (pollCount % 6 === 0) {
          setPollStatus(`Still waiting... (${Math.floor(pollCount * 5 / 60)}m elapsed)`);
        }

        // Timeout after 10 minutes
        if (pollCount > 120) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPollStatus("Taking longer than expected. Your purchase will complete when the bridge delivers the funds. You can close this and check back later.");
        }
      } catch (err) {
        console.error("Balance poll error:", err);
      }
    }, 5000); // every 5 seconds
  };

  // ── Execute FX swap (stablecoin → KTA) ──

  const executeKtaSwap = async (pending: PendingKtaPurchase, depositAmount: string, intermediateAddress: string) => {
    setStep("swapping");
    setPollStatus("Deposit received! Converting to KTA...");
    updatePendingPurchase(pending.id, { state: "swapping" });

    try {
      const toToken = BRIDGE_ASSETS[network]?.KTA;
      if (!toToken || !intermediateAddress) throw new Error("Missing token addresses");

      // 1. Get fresh estimate for actual deposit amount
      const est = await getFxEstimate(network, intermediateAddress, toToken, depositAmount);

      // 2. Sign swap block via extension — use guaranteed lower bound as minAmountOut
      if (!window.alpaca) throw new Error("Wallet extension not detected");

      const minAmountOut = est.convertedAmountBound || est.convertedAmount;

      const swapBlock = await window.alpaca.signTransaction({
        type: "SWAP",
        poolAddress: est.account,
        tokenIn: intermediateAddress,
        tokenOut: toToken,
        amountIn: depositAmount,
        minAmountOut,
        estimatedFees: est.expectedCost.max,
        feeToken: est.expectedCost.token,
      });

      const blockBase64 = typeof swapBlock === "string" ? swapBlock : swapBlock.base64;

      // 3. Submit to FX anchor (via proxy)
      setPollStatus("Submitting swap to the network...");
      const exchangeId = await createFxExchange(network, intermediateAddress, toToken, depositAmount, blockBase64);

      // 4. Start polling for anchor confirmation (refreshes balances on completion)
      if (exchangeWatcherRef.current) exchangeWatcherRef.current();
      exchangeWatcherRef.current = watchExchangeUntilComplete(network, exchangeId, () => {
        // Trigger balance refresh via extension when anchor confirms
        window.alpaca?.getBalance?.(toToken).catch(() => {});
      });

      // 5. Record audit trail (non-blocking)
      recordOnRampPurchase({
        id: pending.id,
        accountPublicKey: address,
        network,
        intermediateAsset: pending.route.intermediate,
        fiatCurrency: pending.route.fiatCurrency,
        fiatAmount: pending.fiatAmount,
        depositAmount,
        ktaAmountRaw: est.convertedAmount,
        exchangeId,
        createdAt: pending.createdAt,
        completedAt: Date.now(),
      });

      // 6. Done
      updatePendingPurchase(pending.id, { state: "completed" });
      removePendingPurchase(pending.id);
      setStep("success");
    } catch (err: any) {
      console.error("KTA swap failed:", err);
      updatePendingPurchase(pending.id, { state: "awaitingDeposit", lastError: err?.message });
      setError(err?.message || "Failed to swap to KTA");
      setStep("error");
    }
  };

  if (!isOpen) return null;

  const ktaDecimals = network === "main" ? 18 : 9;
  const estimatedKta = estimate?.convertedAmount
    ? formatAmount18(estimate.convertedAmount, ktaDecimals)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] w-full max-w-md mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-white/[0.08]">
          <div className="flex items-center gap-3">
            {step !== "select" && step !== "loading" && step !== "success" && (
              <button
                onClick={() => {
                  if (pollRef.current) clearInterval(pollRef.current);
                  setStep("select");
                  setEstimate(null);
                  setFiatAmount("");
                  setError(null);
                }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">Buy Crypto</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-5">

          {/* ── Token selection ── */}
          {step === "select" && (
            <>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-5">
                Buy KTA directly, or fund your wallet with USDC/EURC. Purchased on Base and bridged to Keeta.
              </p>

              <div className="space-y-2">
                {availableTokens.map(token => (
                  <button
                    key={token.id}
                    onClick={() => {
                      if (token.bridgeRoutes) {
                        setSelectedToken(token);
                        setSelectedRoute(token.bridgeRoutes.filter(r => BRIDGE_ASSETS[network]?.[r.intermediate])[0] || null);
                        setStep("kta-amount");
                      } else {
                        handleDirectBuy(token);
                      }
                    }}
                    className="w-full flex items-center justify-between p-4 rounded-lg border border-gray-200 dark:border-white/[0.08] hover:border-[#845fbc]/30 hover:bg-[#845fbc]/[0.02] transition-colors text-left"
                  >
                    <div>
                      <div className="text-[13px] font-semibold text-gray-900 dark:text-white">{token.name}</div>
                      <div className="text-[11px] text-gray-500 dark:text-gray-400">
                        {token.bridgeRoutes ? "Buy via Coinbase + FX Anchor" : token.name === "USDC" ? "Buy with zero fees via Coinbase" : "Buy via Coinbase"}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>

              <div className="mt-4 text-center text-[11px] text-gray-400">
                Powered by Coinbase
              </div>
            </>
          )}

          {/* ── KTA: enter amount + see estimate ── */}
          {step === "kta-amount" && selectedRoute && (
            <>
              {/* Route selector (USD / EUR) */}
              {availableRoutes.length > 1 && (
                <div className="flex gap-2 mb-4">
                  {availableRoutes.map(route => (
                    <button
                      key={route.fiatCurrency}
                      onClick={() => {
                        setSelectedRoute(route);
                        setEstimate(null);
                        if (fiatAmount) {
                          const num = parseFloat(fiatAmount);
                          if (!isNaN(num) && num > 0) fetchEstimate(num, route);
                        }
                      }}
                      className={`flex-1 py-2 rounded-lg text-[13px] font-semibold border transition-colors ${
                        selectedRoute.fiatCurrency === route.fiatCurrency
                          ? "bg-[#845fbc]/10 border-[#845fbc]/30 text-[#845fbc]"
                          : "bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08] text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {route.fiatCurrency === "USD" ? "Pay with USD" : "Pay with EUR"}
                    </button>
                  ))}
                </div>
              )}

              {/* Amount input */}
              <div className="mb-4">
                <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-500 mb-2 block">
                  Amount ({selectedRoute.intermediate})
                </label>
                <input
                  type="number"
                  value={fiatAmount}
                  onChange={e => onAmountChange(e.target.value)}
                  placeholder="0.00"
                  min="0"
                  step="any"
                  autoFocus
                  className="w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] text-gray-900 dark:text-white text-[18px] font-mono focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40"
                />
              </div>

              {/* Estimate */}
              <div className="bg-gray-50 dark:bg-white/[0.02] rounded-lg p-4 mb-5 space-y-2">
                {estimateError ? (
                  <p className="text-[12px] text-red-500 dark:text-red-400">{estimateError}</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-gray-500">You receive (estimated)</span>
                      <span className="text-gray-900 dark:text-white font-semibold font-mono">
                        {estimateLoading ? (
                          <span className="text-gray-400">Calculating...</span>
                        ) : estimatedKta ? (
                          `${estimatedKta} KTA`
                        ) : (
                          "—"
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-gray-500">Network fee</span>
                      <span className="text-gray-900 dark:text-white font-medium font-mono">
                        {estimate ? `${formatAmount18(estimate.expectedCost.max, ktaDecimals)} KTA` : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-gray-500">Rate type</span>
                      <span className="text-gray-900 dark:text-white font-medium">Variable</span>
                    </div>
                  </>
                )}
              </div>

              <button
                onClick={handleKtaBuy}
                disabled={!estimate || estimateLoading || !fiatAmount || parseFloat(fiatAmount) <= 0}
                className="w-full py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue to Coinbase
              </button>

              <p className="mt-3 text-center text-[11px] text-gray-400">
                You'll be redirected to Coinbase to purchase {selectedRoute.intermediate}. It will be automatically converted to KTA.
              </p>
            </>
          )}

          {/* ── Loading ── */}
          {step === "loading" && (
            <div className="py-10 text-center">
              <svg className="animate-spin h-8 w-8 mx-auto text-[#845fbc] mb-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <p className="text-[13px] text-gray-500 dark:text-gray-400">Setting up your purchase...</p>
            </div>
          )}

          {/* ── Awaiting deposit ── */}
          {step === "awaiting" && (
            <div className="py-6 text-center">
              <svg className="animate-spin h-8 w-8 mx-auto text-[#845fbc] mb-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <p className="text-[13px] text-gray-700 dark:text-gray-300 font-semibold mb-2">Processing Purchase</p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-4">{pollStatus}</p>
              <p className="text-[11px] text-gray-400">
                Complete your purchase on Coinbase. Once the bridge delivers your {pendingPurchase?.route.intermediate || "tokens"}, the KTA swap will happen automatically.
              </p>
            </div>
          )}

          {/* ── Swapping ── */}
          {step === "swapping" && (
            <div className="py-6 text-center">
              <svg className="animate-spin h-8 w-8 mx-auto text-[#845fbc] mb-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <p className="text-[13px] text-gray-700 dark:text-gray-300 font-semibold mb-2">Converting to KTA</p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400">{pollStatus}</p>
            </div>
          )}

          {/* ── Success ── */}
          {step === "success" && (
            <div className="py-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-[15px] font-semibold text-gray-900 dark:text-white mb-2">Purchase Complete</p>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-5">
                Your KTA has been delivered to your wallet.
              </p>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-[#845fbc] hover:bg-[#724bad] text-white text-[13px] font-semibold rounded-md transition-colors"
              >
                Done
              </button>
            </div>
          )}

          {/* ── Error ── */}
          {step === "error" && (
            <div className="py-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-[13px] text-red-500 dark:text-red-400 mb-4">{error}</p>
              <button
                onClick={() => setStep("select")}
                className="px-6 py-2 bg-[#845fbc]/8 hover:bg-[#845fbc] text-[#845fbc] hover:text-white text-[12px] font-semibold rounded-md transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Helpers ──

function toRawAmount(amount: number, decimals: number): string {
  // Convert a human-readable amount to raw BigInt string
  const [whole, frac = ""] = amount.toString().split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole + paddedFrac).toString();
}


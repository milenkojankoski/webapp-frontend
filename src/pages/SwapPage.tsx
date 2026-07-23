import React, { useState, useEffect } from 'react';
import { useWallet } from '../context/WalletContext';
import { TradeService, type QuoteResponse } from '../services/trade';
import { type WalletBalance } from '../services/wallet';
import { useSearchParams } from 'react-router-dom';
import { logger } from '../utils/logger';

const SwapIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-[#845fbc]">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
  </svg>
);

export const SwapPage: React.FC = () => {
  const { isConnected, network, address, balances } = useWallet();
  const [searchParams] = useSearchParams();

  // Inputs
  const [tokenIn, setTokenIn] = useState(searchParams.get("in") || "");
  const [tokenOut, setTokenOut] = useState(searchParams.get("out") || "");
  const [amountIn, setAmountIn] = useState("");

  // Data
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balanceIn, setBalanceIn] = useState<WalletBalance | null>(null);

  // 0. Update Balance when token changes
  useEffect(() => {
    if (balances.length > 0 && tokenIn) {
      const found = balances.find(b => b.address === tokenIn);
      setBalanceIn(found || null);
    }
  }, [balances, tokenIn]);

  // 1. Fetch Quote
  useEffect(() => {
    const fetchQuote = async () => {
      if (!amountIn || !tokenIn || !tokenOut) return;
      setError(null);
      try {
        // Remove decimals from the call to prevent the 404
        const q = await TradeService.getQuote(network, tokenIn, tokenOut, amountIn);
        setQuote(q);
      } catch (e: any) {
        setError("Quote Error: " + e.message);
        setQuote(null);
      }
    };

    const timer = setTimeout(fetchQuote, 600);
    return () => clearTimeout(timer);
  }, [amountIn, tokenIn, tokenOut, network]);

  // Validation
  const hasInsufficientFunds = () => {
    if (!quote || !balanceIn) return false;
    const amountRaw = BigInt(quote.originalQuote.request.amount);
    const feeToken = quote.originalQuote.cost?.token || tokenIn;
    const isFeeInTokenIn = feeToken === tokenIn;
    const feeRaw = isFeeInTokenIn ? BigInt(quote.estimatedFees) : 0n;
    const totalRequired = amountRaw + feeRaw;
    const currentBalance = BigInt(balanceIn.rawBalance);
    return currentBalance < totalRequired;
  };

  const handleSwitch = () => {
    const oldIn = tokenIn;
    const oldOut = tokenOut;
    setTokenIn(oldOut);
    setTokenOut(oldIn);
    setAmountIn("");
    setQuote(null);
  };

  const handleSwap = async () => {
    if (!quote || !address || !tokenIn || !tokenOut) return;

    setIsSwapping(true);
    setError(null);

    try {
      // ✅ FIX: Get decimals again for the swap submission
      const decimalsIn = balances.find(b => b.address === tokenIn)?.decimals || 18;
      const decimalsOut = balances.find(b => b.address === tokenOut)?.decimals || 18;

      const swapParams = {
        type: "SWAP",
        params: {
          network: network,
          poolAddress: quote.poolAddress,
          tokenIn: tokenIn,
          tokenOut: tokenOut,
          amountIn: BigInt(parseFloat(quote.amountIn) * (10 ** decimalsIn)).toString(),
          minAmountOut: quote.minAmountOut,
          estimatedFees: quote.estimatedFees,
          feeToken: tokenIn
        }
      };

      const signedBlockBase64 = await window.alpaca?.signTransaction(swapParams) as string | undefined;

      if (!signedBlockBase64) {
        throw new Error("User rejected signature");
      }

      await TradeService.submitTrade(network, {
        network: network,
        swapBlock: signedBlockBase64,
        originalQuote: quote.originalQuote,
        tokenIn: { address: tokenIn, decimals: decimalsIn },
        tokenOut: { address: tokenOut, decimals: decimalsOut }
      });

      logger.log("Swap Success");
      alert("Swap Successful! Transaction Sent.");

    } catch (err: any) {
      console.error("Swap Failed:", err);
      setError(err.message || "Swap failed");
    } finally {
      setIsSwapping(false);
    }
  };

  if (!isConnected) return <div className="p-10 text-center text-gray-500 dark:text-gray-400">Please connect wallet</div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#171717] flex justify-center pt-20 transition-colors duration-300">
      <div className="w-full max-w-md bg-white dark:bg-[#1e1e1e] p-6 rounded-3xl border border-gray-200 dark:border-[#333] shadow-xl">
        <h2 className="text-gray-900 dark:text-white text-2xl font-bold font-heading mb-6">Swap</h2>

        <div className="relative flex flex-col gap-2 mb-6">
          <div className="bg-gray-50 dark:bg-[#2a2a2a] p-4 rounded-xl z-0 transition-colors">
            <div className="flex justify-between mb-2">
              <label className="text-xs text-gray-500 dark:text-gray-400">Sell</label>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Balance: {balanceIn ? balanceIn.amount : "0.0"}
              </span>
            </div>
            <input
              className="w-full bg-transparent text-2xl text-gray-900 dark:text-white outline-none font-mono mt-1 placeholder-gray-400 dark:placeholder-gray-600"
              placeholder="0.0"
              value={amountIn}
              onChange={e => setAmountIn(e.target.value)}
            />
            <div className="text-xs text-gray-500 dark:text-gray-500 mt-2 font-mono break-all">{tokenIn}</div>
          </div>

          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <button
              onClick={handleSwitch}
              className="bg-white dark:bg-[#1e1e1e] border-4 border-white dark:border-[#1e1e1e] p-2 rounded-full hover:bg-gray-100 dark:hover:bg-[#333] transition shadow-lg group"
            >
              <SwapIcon />
            </button>
          </div>

          <div className="bg-gray-50 dark:bg-[#2a2a2a] p-4 rounded-xl z-0 transition-colors">
            <label className="text-xs text-gray-500 dark:text-gray-400">Buy (Estimated)</label>
            <div className="text-2xl text-gray-900 dark:text-white font-mono mt-1">
              {quote ? quote.amountOut : "0.0"}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-500 mt-2 font-mono break-all">{tokenOut}</div>
          </div>
        </div>

        {error && <div className="text-red-500 text-sm mb-4 bg-red-100 dark:bg-red-900/20 p-3 rounded-lg">{error}</div>}

        {quote && (
          <div className="text-gray-500 dark:text-gray-400 text-sm mb-4 space-y-1">
            <div className="flex justify-between"><span>Rate</span><span>{Number(quote.rate).toFixed(6)}</span></div>
            <div className="flex justify-between">
              <span>Fee</span>
              <span>{Number(quote.estimatedFees) / 1e18} KTA</span>
            </div>
          </div>
        )}

        <button
          onClick={handleSwap}
          disabled={!quote || isSwapping || hasInsufficientFunds()}
          className={`w-full py-4 font-bold rounded-xl transition ${hasInsufficientFunds()
            ? "bg-red-100 dark:bg-red-500/20 text-red-500 cursor-not-allowed"
            : "bg-gradient-to-r from-[#845fbc] to-[#6d4c9e] text-white hover:shadow-lg disabled:opacity-50"
            }`}
        >
          {isSwapping ? "Signing..." : hasInsufficientFunds() ? "Insufficient Funds" : "Swap"}
        </button>

      </div>
    </div>
  );
};
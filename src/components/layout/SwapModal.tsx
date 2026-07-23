import React, { useState, useEffect } from 'react';
import { useWallet } from '../../context/WalletContext';
import { useSwap, type SwapToken } from '../../context/SwapContext';
import { TradeService, type QuoteResponse } from '../../services/trade';
import { WalletService, type WalletBalance } from '../../services/wallet';
import { logger } from '../../utils/logger';
import { TokenLogo } from '../common/TokenLogo';

const SwapIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-[#845fbc]">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
  </svg>
);

export const SwapModal: React.FC = () => {
  const { isSwapOpen, closeSwap, defaultTokenIn, defaultTokenOut, isFundRaising } = useSwap();
  const { isConnected, network, address } = useWallet();

  const [tokenIn, setTokenIn] = useState<SwapToken>(defaultTokenIn);
  const [tokenOut, setTokenOut] = useState<SwapToken>(defaultTokenOut);
  const [amountIn, setAmountIn] = useState("");
  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balanceIn, setBalanceIn] = useState<WalletBalance | null>(null);

  const [decimalsIn, setDecimalsIn] = useState(tokenIn.decimals ?? 18);
  const [decimalsOut, setDecimalsOut] = useState(tokenOut.decimals ?? 18);

  useEffect(() => {
    if (isSwapOpen) {
      setTokenIn(defaultTokenIn);
      setTokenOut(defaultTokenOut);
      setAmountIn("");
      setQuote(null);
      setError(null);
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeSwap();
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isSwapOpen, defaultTokenIn, defaultTokenOut, closeSwap]);

  // Fetch Metadata & Balances
  useEffect(() => {
    const updateMetadata = async () => {
      if (!tokenIn.address || !tokenOut.address) return;

      // ✅ DECIMALS PRIORITY: Context/Props (DB) > WalletService (Chain/Default)
      // If tokenIn has decimals (even 0), use them. Otherwise fetch.
      let dIn = tokenIn.decimals;
      let dOut = tokenOut.decimals;

      // Parallel fetch for balances (always needed) & metadata (if needed)
      const promises: Promise<any>[] = [];

      if (dIn === undefined) promises.push(WalletService.getTokenMetadata(tokenIn.address, network).then(m => dIn = m.decimals));
      if (dOut === undefined) promises.push(WalletService.getTokenMetadata(tokenOut.address, network).then(m => dOut = m.decimals));
      if (address) promises.push(WalletService.getBalances(address, network));

      await Promise.all(promises);

      // Sanity defaults
      setDecimalsIn(dIn ?? 18);
      setDecimalsOut(dOut ?? 18);

      if (address) {
        // Balances are fetched in the Promise.all but we didn't capture return. 
        // Re-fetching or reorganizing properly:
        const balances = await WalletService.getBalances(address, network);
        const bal = balances.find(b => b.address === tokenIn.address);
        setBalanceIn(bal || null);

        // Bonus: If balance has decimals, it might be from Chain/WalletService logic.
        // But we prefer our `dIn` if it came from DB.
      }
    };
    updateMetadata();
  }, [tokenIn, tokenOut, network, address]); // Added tokenIn/tokenOut dependency to re-run if decimals change (unlikely unless object ref changes)

  // Fetch Quote
  useEffect(() => {
    const fetchQuote = async () => {
      if (!amountIn || !tokenIn?.address || !tokenOut?.address) return;
      setError(null);
      try {
        const q = await TradeService.getQuote(network, tokenIn.address, tokenOut.address, amountIn, decimalsIn, decimalsOut);
        setQuote(q);
      } catch (e: any) {
        setQuote(null);
        setError(e.message);
      }
    };
    const timer = setTimeout(fetchQuote, 600);
    return () => clearTimeout(timer);
  }, [amountIn, tokenIn.address, tokenOut.address, network]);

  const handleSwitch = () => {
    const oldIn = tokenIn; const oldOut = tokenOut;
    setTokenIn(oldOut); setTokenOut(oldIn);
    setDecimalsIn(decimalsOut); setDecimalsOut(decimalsIn); // Swap decimals too
    setAmountIn(""); setQuote(null);
  };

  const hasInsufficientFunds = () => {
    if (!quote || !balanceIn) return false;
    const amountRaw = BigInt(quote.originalQuote.request.amount);
    const feeRaw = (quote.originalQuote.cost?.token === tokenIn.address) ? BigInt(quote.estimatedFees) : 0n;
    return BigInt(balanceIn.rawBalance) < (amountRaw + feeRaw);
  };

  // ✅ FINALIZED: Full Signature + Broadcast Flow
  const handleSwap = async () => {
    if (!quote) return;
    if (hasInsufficientFunds()) { setError("Insufficient Funds"); return; }

    setIsSwapping(true);
    setError(null);

    try {
      // 1. Get Signature from Extension
      if (!window.alpaca) throw new Error("Alpaca Wallet extension not found");

      const signedBlockBase64 = await window.alpaca.signTransaction({
        type: 'SWAP',
        params: {
          network,
          poolAddress: quote.poolAddress,
          tokenIn: tokenIn.address,
          tokenOut: tokenOut.address,
          amountIn: quote.originalQuote.request.amount,
          minAmountOut: quote.amountOutRaw,
          estimatedFees: quote.estimatedFees,
          feeToken: quote.originalQuote.expectedCost?.token || quote.originalQuote.cost?.token || tokenIn.address
        }
      }) as string;

      if (!signedBlockBase64) throw new Error("Signature rejected");

      // 2. Broadcast to Backend (The missing piece!)
      const result = await TradeService.submitTrade(network, {
        network,
        swapBlock: signedBlockBase64,
        originalQuote: quote.originalQuote,
        tokenIn: { address: tokenIn.address, decimals: decimalsIn },
        tokenOut: { address: tokenOut.address, decimals: decimalsOut }
      });

      logger.log("Trade Broadcast Success:", result);
      alert("Swap Successful! Transaction Hash: " + (result.txHash || "Submitted"));
      closeSwap();

    } catch (e: any) {
      console.error("Swap process failed:", e);
      setError(e.message || "Swap failed");
    } finally {
      setIsSwapping(false);
    }
  };

  const KTA_ADDRESS = "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg";
  const KTA_FEE_RAW = 100000000000000000n; // 0.1 KTA (18 decimals)

  const handlePreset = (pct: number) => {
    if (!balanceIn) return;
    let raw = BigInt(balanceIn.rawBalance) * BigInt(pct) / 100n;
    if (pct === 100 && tokenIn.address === KTA_ADDRESS) {
      raw = raw - KTA_FEE_RAW;
      if (raw < 0n) raw = 0n;
    }
    setAmountIn(formatDisplay(raw.toString(), decimalsIn));
  };

  const formatDisplay = (raw: string, dec: number) => {
    if (!raw || raw === "0") return "0.0";
    if (dec === 0) return BigInt(raw).toLocaleString();
    let str = raw.padStart(dec + 1, '0');
    const integerPart = str.slice(0, str.length - dec);
    const fractionalPart = str.slice(str.length - dec).replace(/0+$/, '');
    return fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart;
  };

  if (!isSwapOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn" onClick={closeSwap}>
      <div className="w-full max-w-md bg-white dark:bg-[#1a1a1a] p-6 rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-sm relative" onClick={e => e.stopPropagation()}>
        <button onClick={closeSwap} className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 dark:hover:text-white">✕</button>
        <h2 className="text-gray-900 dark:text-white text-2xl font-semibold mb-6">Swap</h2>

        {!isConnected ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-10">Please connect wallet first</div>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative z-10 bg-gray-50 dark:bg-white/[0.04] p-4 rounded-xl border border-transparent focus-within:border-[#845fbc]/50 transition-colors">
              <div className="flex justify-between mb-1">
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Sell</label>
                <span className="text-xs text-gray-500 dark:text-gray-400">Balance: {balanceIn ? balanceIn.amount : "0.0"}</span>
              </div>
              <input className="w-full bg-transparent text-2xl text-gray-900 dark:text-white outline-none font-mono font-medium placeholder-gray-400 dark:placeholder-gray-600" placeholder="0.0" value={amountIn} onChange={e => setAmountIn(e.target.value)} />
              <div className="flex items-center gap-1.5 mt-2">
                {[10, 25, 50, 75].map(pct => (
                  <button key={pct} onClick={() => handlePreset(pct)} className="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-white dark:bg-[#1a1a1a] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/[0.08] hover:border-[#845fbc] hover:text-[#845fbc] dark:hover:text-[#a78bfa] transition-colors">
                    {pct}%
                  </button>
                ))}
                <button onClick={() => handlePreset(100)} className="px-2 py-0.5 text-[10px] font-semibold rounded-md bg-white dark:bg-[#1a1a1a] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-white/[0.08] hover:border-[#845fbc] hover:text-[#845fbc] dark:hover:text-[#a78bfa] transition-colors">
                  Max
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                {tokenIn.address && <TokenLogo address={tokenIn.address} symbol={tokenIn.symbol} network={network} className="w-6 h-6" />}
                <span className="text-xs text-gray-700 dark:text-gray-200 font-mono font-semibold bg-white dark:bg-[#1a1a1a] px-2 py-1 rounded-md border border-gray-200 dark:border-white/[0.08]">
                  {tokenIn?.symbol || (tokenIn?.address || "").substring(0, 16) + "..."}
                </span>
              </div>
              <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 translate-y-1/2 z-20">
                <button onClick={handleSwitch} disabled={isFundRaising} className={`bg-white dark:bg-[#1a1a1a] border-4 border-white dark:border-[#1a1a1a] p-2 rounded-full transition shadow-sm group ${isFundRaising ? 'opacity-30 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-white/[0.08]'}`} title={isFundRaising ? 'Selling is not available during fundraise' : 'Switch tokens'}><SwapIcon /></button>
              </div>
            </div>

            <div className="bg-gray-50 dark:bg-white/[0.04] p-4 rounded-xl z-0">
              <div className="flex justify-between mb-1"><label className="text-xs font-medium text-gray-500 dark:text-gray-400">Buy (Estimated)</label></div>
              <div className="text-2xl text-gray-900 dark:text-white font-mono font-medium mt-1 min-h-[32px]">
                {quote ? formatDisplay(quote.amountOutRaw, decimalsOut) : "0.0"}
              </div>
              <div className="flex items-center gap-2 mt-2">
                {tokenOut.address && <TokenLogo address={tokenOut.address} symbol={tokenOut.symbol} network={network} className="w-6 h-6" />}
                <span className="text-xs text-gray-700 dark:text-gray-200 font-mono font-semibold bg-white dark:bg-[#1a1a1a] px-2 py-1 rounded-md border border-gray-200 dark:border-white/[0.08]">
                  {tokenOut?.symbol || (tokenOut?.address || "").substring(0, 16) + "..."}
                </span>
              </div>
            </div>

            {error && <div className="text-red-500 text-xs mt-2 p-2 bg-red-100 dark:bg-red-900/20 rounded">{error}</div>}

            {quote && (
              <div className="text-gray-500 dark:text-gray-400 text-xs mt-2 px-1 flex justify-between">
                <span>Rate: 1 {tokenIn?.symbol} ≈ {Number(quote.rate).toLocaleString(undefined, { maximumFractionDigits: decimalsOut === 0 ? 0 : 4 })} {tokenOut?.symbol}</span>
                <span>Fee: {(Number(quote.estimatedFees) / 1e18).toFixed(4)} KTA</span>
              </div>
            )}

            <button
              onClick={handleSwap}
              disabled={!quote || isSwapping || hasInsufficientFunds()}
              className={`w-full py-3.5 mt-4 font-semibold rounded-xl transition-colors ${hasInsufficientFunds() ? "bg-red-500/10 text-red-500 border border-red-500/20 cursor-not-allowed" : "bg-[#845fbc] text-white hover:bg-[#724bad] disabled:opacity-50 disabled:cursor-not-allowed"}`}
            >
              {isSwapping ? "Signing Block..." : hasInsufficientFunds() ? "Insufficient Funds" : "Swap Now"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
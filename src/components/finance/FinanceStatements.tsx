import React, { useState, useCallback, useEffect } from 'react';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions, authReady } from '../../config/firebase';
import { useWallet } from '../../context/WalletContext';
import { WalletService } from '../../services/wallet';
import { FinanceService } from '../../services/finance';
import { formatAmount18 } from '../../utils/formatters';
import { getTokenDisplayData } from '../../utils/token';
import { generateStatement, generateProofOfFunds } from '../../utils/pdfGenerator';
import { cacheGet, cacheSet } from '../../services/cache';
import type { FxRates } from '../../services/finance';

const FINANCE_SIGN_PREFIX = "ALPACA_FINANCE_";

async function signFinanceMessage(address: string): Promise<{ message: string; signature: string }> {
  if (!window.alpaca?.signMessage) {
    throw new Error("Wallet extension not found or outdated.");
  }
  const message = FINANCE_SIGN_PREFIX + address;
  const result = await window.alpaca.signMessage(message);
  return { message, signature: result.signature };
}

// Build available periods from current date back to a start year
function getAvailablePeriods(): { label: string; value: string; type: 'monthly' | 'annual'; startDate: string; endDate: string }[] {
  const now = new Date();
  const periods: { label: string; value: string; type: 'monthly' | 'annual'; startDate: string; endDate: string }[] = [];

  // Annual statements for completed years
  for (let year = now.getFullYear() - 1; year >= 2024; year--) {
    periods.push({
      label: `${year} Annual`,
      value: `annual-${year}`,
      type: 'annual',
      startDate: new Date(year, 0, 1).toISOString(),
      endDate: new Date(year + 1, 0, 1).toISOString(),
    });
  }

  // Monthly statements for the last 12 months
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthName = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    const endMonth = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    periods.push({
      label: monthName,
      value: `monthly-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      type: 'monthly',
      startDate: d.toISOString(),
      endDate: endMonth.toISOString(),
    });
  }

  return periods;
}

interface TradeRecord {
  timestamp: string;
  poolId: string;
  tradeType: string;
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
  baseToken: string;
  pairedToken: string;
  newPrice: string;
  baseDecimals: number;
  tradeId: string;
}

const FinanceStatements: React.FC = () => {
  const { address, network, balances } = useWallet();
  const [generating, setGenerating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fxRates, setFxRates] = useState<FxRates>({ USD: 1 });
  const [ktaPrice, setKtaPrice] = useState(0);
  const [homeCurrency] = useState(FinanceService.getHomeCurrency);

  // Symbol resolution state
  const [marketData, setMarketData] = useState<Record<string, any>>({});
  const [blockchainSymbols, setBlockchainSymbols] = useState<Record<string, string>>({});

  // Proof of Funds state
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [pofGenerating, setPofGenerating] = useState(false);
  const [pofError, setPofError] = useState<string | null>(null);

  // On-chain certificate state
  const [certPublishing, setCertPublishing] = useState(false);
  const [certResult, setCertResult] = useState<{ hash: string; attestedAt: string } | null>(null);
  const [certError, setCertError] = useState<string | null>(null);

  useEffect(() => {
    FinanceService.getFxRates().then(setFxRates);
    FinanceService.getKtaPriceUsd().then(setKtaPrice);
  }, []);

  // Fetch pool market data for symbol resolution
  useEffect(() => {
    const fetchMarketData = async () => {
      const cKey = `marketData_${network}`;
      const cached = cacheGet<Record<string, any>>(cKey, 2 * 60 * 1000);
      if (cached) { setMarketData(cached); return; }
      try {
        const poolsRef = collection(db, "pools");
        const q = query(poolsRef, where("network", "==", network), limit(500));
        const snap = await getDocs(q);
        const map: Record<string, any> = {};
        snap.forEach((d) => {
          const t = d.data();
          if (t.pairedToken) {
            map[t.pairedToken] = {
              price: t.price,
              symbol: t.pairedTokenSymbol || t.symbol,
              pairedTokenSymbol: t.pairedTokenSymbol,
            };
          }
        });
        setMarketData(map);
        cacheSet(cKey, map);
      } catch { /* silent */ }
    };
    if (network) fetchMarketData();
  }, [network]);

  // Resolve symbols from blockchain for tokens not in pool data
  useEffect(() => {
    const resolve = async () => {
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
        } catch { /* keep existing */ }
      }));
      if (Object.keys(resolved).length > 0) {
        setBlockchainSymbols(prev => ({ ...prev, ...resolved }));
      }
    };
    if (balances.length > 0) resolve();
  }, [balances, marketData, network]);

  // Resolve display symbol for a balance
  const resolveSymbol = useCallback((b: typeof balances[0]): string => {
    const market = marketData[b.address];
    const bcSymbol = blockchainSymbols[b.address];
    const compositeToken = { ...b, ...(bcSymbol ? { symbol: bcSymbol } : {}), ...market };
    const { displaySymbol } = getTokenDisplayData(compositeToken, network);
    return displaySymbol;
  }, [marketData, blockchainSymbols, network]);

  // Select all tokens by default when balances load
  useEffect(() => {
    if (balances.length > 0 && selectedTokens.size === 0) {
      setSelectedTokens(new Set(balances.map(b => b.address)));
    }
  }, [balances, selectedTokens.size]);

  const handleGenerateStatement = useCallback(async (period: ReturnType<typeof getAvailablePeriods>[0]) => {
    if (!address) return;
    setGenerating(period.value);
    setError(null);

    try {
      const { message, signature } = await signFinanceMessage(address);
      await authReady;
      const fn = httpsCallable(functions, 'financeTransactionHistoryCall');
      const result = await fn({
        address,
        network,
        message,
        signature,
        startDate: period.startDate,
        endDate: period.endDate,
      });

      const data = result.data as { transactions: TradeRecord[] };

      // Build balance values with resolved symbols
      const resolvedBalances = balances.map(b => ({ ...b, symbol: resolveSymbol(b) }));
      const balanceValues: Record<string, number> = {};
      for (const b of balances) {
        balanceValues[b.address] = FinanceService.estimateUsdValue(b, ktaPrice, fxRates, marketData);
      }
      const totalValueUsd = Object.values(balanceValues).reduce((s, v) => s + v, 0);
      const homeTotal = FinanceService.convertUsdTo(totalValueUsd, homeCurrency, fxRates);

      // Format transactions for the PDF
      const transactions = data.transactions.map(tx => ({
        date: tx.timestamp ? new Date(tx.timestamp).toLocaleDateString() : '',
        type: tx.tradeType === 'buy' ? 'Buy' : 'Sell',
        tokenIn: shortenToken(tx.tokenIn, tx.baseToken, tx.pairedToken),
        amountIn: formatTradeAmount(tx.amountIn, tx.baseDecimals),
        tokenOut: shortenToken(tx.tokenOut, tx.baseToken, tx.pairedToken),
        amountOut: formatTradeAmount(tx.amountOut, tx.baseDecimals),
        pool: tx.poolId,
      }));

      const doc = generateStatement({
        address,
        network,
        period: period.label,
        periodType: period.type,
        balances: resolvedBalances,
        balanceValues,
        totalValueUsd,
        homeCurrency,
        homeTotal,
        transactions,
      });

      doc.save(`alpaca-statement-${period.value}-${network}.pdf`);
    } catch (err: any) {
      console.error('Statement generation failed:', err);
      setError(err?.message || 'Failed to generate statement.');
    } finally {
      setGenerating(null);
    }
  }, [address, network, balances, ktaPrice, fxRates, homeCurrency, resolveSymbol, marketData]);

  const handleProofOfFunds = useCallback(async () => {
    if (!address || selectedTokens.size === 0) return;
    setPofGenerating(true);
    setPofError(null);

    try {
      const selected = balances.filter(b => selectedTokens.has(b.address));
      const pofBalances = selected.map(b => ({
        symbol: resolveSymbol(b),
        amount: b.amount,
        valueUsd: FinanceService.estimateUsdValue(b, ktaPrice, fxRates, marketData),
      }));

      const totalValueUsd = pofBalances.reduce((s, b) => s + b.valueUsd, 0);
      const homeTotal = FinanceService.convertUsdTo(totalValueUsd, homeCurrency, fxRates);
      const generatedAt = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      });

      const doc = generateProofOfFunds({
        address,
        network,
        balances: pofBalances,
        totalValueUsd,
        homeCurrency,
        homeTotal,
        generatedAt,
      });

      doc.save(`alpaca-proof-of-funds-${network}-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err: any) {
      console.error('Proof of funds generation failed:', err);
      setPofError(err?.message || 'Failed to generate proof of funds.');
    } finally {
      setPofGenerating(false);
    }
  }, [address, network, balances, selectedTokens, ktaPrice, fxRates, homeCurrency, resolveSymbol, marketData]);

  const handlePublishCertificate = useCallback(async () => {
    if (!address || selectedTokens.size === 0) return;
    if (!window.alpaca?.publishCertificate) {
      setCertError('Wallet extension outdated. Please update to the latest version.');
      return;
    }

    setCertPublishing(true);
    setCertError(null);
    setCertResult(null);

    try {
      // 1. Call Cloud Function to build the certificate
      const { message, signature } = await signFinanceMessage(address);
      await authReady;
      const fn = httpsCallable(functions, 'proofOfFundsCertCall');

      const selected = balances.filter(b => selectedTokens.has(b.address));
      const tokenInfos = selected.map(b => ({
        address: b.address,
        symbol: resolveSymbol(b),
        decimals: b.decimals || 18,
      }));

      const result = await fn({
        address,
        network,
        message,
        signature,
        tokens: tokenInfos,
      });

      const data = result.data as {
        certificatePem: string;
        certHash: string;
        attestedAt: string;
      };

      // 2. Publish certificate on-chain via extension
      await window.alpaca.publishCertificate(data.certificatePem);

      setCertResult({ hash: data.certHash, attestedAt: data.attestedAt });
    } catch (err: any) {
      console.error('Certificate publishing failed:', err);
      setCertError(err?.message || 'Failed to publish certificate on-chain.');
    } finally {
      setCertPublishing(false);
    }
  }, [address, network, balances, selectedTokens, resolveSymbol]);

  const toggleToken = (addr: string) => {
    setSelectedTokens(prev => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr);
      else next.add(addr);
      return next;
    });
  };

  const periods = getAvailablePeriods();
  const annualPeriods = periods.filter(p => p.type === 'annual');
  const monthlyPeriods = periods.filter(p => p.type === 'monthly');

  return (
    <div className="space-y-6">
      {/* Monthly & Annual Statements */}
      <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-8 hover:shadow-lg transition-shadow duration-300">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Monthly & Annual Statements</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Download branded PDF statements with your current balances and transaction history for any period.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Annual Statements */}
        {annualPeriods.length > 0 && (
          <div className="mb-6">
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] block mb-3">Annual Statements</label>
            <div className="space-y-2">
              {annualPeriods.map(period => (
                <div key={period.value} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-[#252525] border border-gray-100 dark:border-[#333]">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#845fbc]/10 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-[#845fbc]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
                      </svg>
                    </div>
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{period.label}</span>
                  </div>
                  <button
                    onClick={() => handleGenerateStatement(period)}
                    disabled={generating !== null}
                    className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#845fbc] text-white hover:bg-[#724bad] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {generating === period.value ? (
                      <>
                        <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        PDF
                      </>
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Monthly Statements */}
        <div>
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] block mb-3">Monthly Statements</label>
          <div className="space-y-2">
            {monthlyPeriods.map(period => (
              <div key={period.value} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-[#252525] border border-gray-100 dark:border-[#333]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-gray-100 dark:bg-[#333] flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                  </div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{period.label}</span>
                </div>
                <button
                  onClick={() => handleGenerateStatement(period)}
                  disabled={generating !== null}
                  className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-gray-200 dark:bg-[#333] text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-[#444] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {generating === period.value ? (
                    <>
                      <span className="w-3 h-3 border-2 border-gray-600 dark:border-gray-400 border-t-transparent rounded-full animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      PDF
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Proof of Funds */}
      <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-8 hover:shadow-lg transition-shadow duration-300">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Proof of Funds</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Generate a verifiable letter certifying your current balances. Select which assets to include.
        </p>

        {pofError && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
            {pofError}
          </div>
        )}

        {/* Token selector */}
        <div className="mb-6">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] block mb-3">Include Assets</label>
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setSelectedTokens(new Set(balances.map(b => b.address)))}
              className="text-xs font-semibold text-[#845fbc] hover:underline"
            >
              Select All
            </button>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <button
              onClick={() => setSelectedTokens(new Set())}
              className="text-xs font-semibold text-gray-500 hover:underline"
            >
              Clear
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {balances.map(b => (
              <button
                key={b.address}
                onClick={() => toggleToken(b.address)}
                className={[
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all border',
                  selectedTokens.has(b.address)
                    ? 'bg-[#845fbc]/10 border-[#845fbc]/30 text-[#845fbc] dark:text-[#a78bfa]'
                    : 'bg-gray-50 dark:bg-[#252525] border-gray-100 dark:border-[#333] text-gray-500 dark:text-gray-400',
                ].join(' ')}
              >
                <div className={[
                  'w-4 h-4 rounded border-2 flex items-center justify-center transition-all',
                  selectedTokens.has(b.address)
                    ? 'border-[#845fbc] bg-[#845fbc]'
                    : 'border-gray-300 dark:border-gray-600',
                ].join(' ')}>
                  {selectedTokens.has(b.address) && (
                    <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={4}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <span>{resolveSymbol(b)}</span>
                <span className="text-xs text-gray-400 ml-auto">{b.amount}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={handleProofOfFunds}
          disabled={pofGenerating || selectedTokens.size === 0}
          className="px-6 py-2.5 bg-[#845fbc] hover:bg-[#724bad] text-white font-bold rounded-xl transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {pofGenerating ? (
            <>
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
              Generate Proof of Funds (PDF)
            </>
          )}
        </button>

        {/* On-chain certificate */}
        <div className="mt-6 pt-6 border-t border-gray-100 dark:border-[#333]">
          <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-1">On-chain Certificate</h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Publish a verifiable Proof of Funds certificate to your wallet on the KeetaNet blockchain. Signed by Alpaca DEX.
          </p>

          {certError && (
            <div className="mb-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
              {certError}
            </div>
          )}

          {certResult && (
            <div className="mb-3 p-3 rounded-lg bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800">
              <p className="text-sm font-semibold text-teal-700 dark:text-teal-400">Certificate published on-chain</p>
              <p className="text-xs text-teal-600 dark:text-teal-500 mt-1 font-mono break-all">
                Hash: {certResult.hash}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                Attested at: {new Date(certResult.attestedAt).toLocaleString()}
              </p>
            </div>
          )}

          <button
            onClick={handlePublishCertificate}
            disabled={certPublishing || selectedTokens.size === 0}
            className="px-6 py-2.5 bg-gray-200 dark:bg-[#333] text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-[#444] font-bold rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {certPublishing ? (
              <>
                <span className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
                Publishing...
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                </svg>
                Publish On-chain
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Helpers

function shortenToken(tokenAddr: string, baseToken: string, pairedToken: string): string {
  if (tokenAddr === baseToken) return 'BASE';
  if (tokenAddr === pairedToken) return 'PAIRED';
  if (!tokenAddr || tokenAddr.length < 16) return tokenAddr || '';
  return tokenAddr.slice(0, 10) + '...';
}

function formatTradeAmount(raw: string, decimals: number): string {
  if (!raw || raw === '0') return '0';
  try {
    return formatAmount18(raw, decimals);
  } catch {
    return raw;
  }
}

export default FinanceStatements;

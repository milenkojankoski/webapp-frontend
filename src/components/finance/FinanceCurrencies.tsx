import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../../context/WalletContext';
import { WalletService, type WalletTransaction } from '../../services/wallet';
import { FinanceService, type FxRates } from '../../services/finance';
import { TokenLogo } from '../common/TokenLogo';

// Fiat token addresses → currency code + flag
const FIAT_CURRENCIES: { address: string; code: string; flag: string; name: string }[] = [
  { address: "keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc", code: "USD", flag: "us", name: "US Dollar" },
  { address: "keeta_anutgo4o3yp5tvc6wjt4vzsehjbn7t2wylpxmam4d4ojtdkjj2yca2qoinfcs", code: "EUR", flag: "eu", name: "Euro" },
  { address: "keeta_aojfknc74dabtg72mdhijtszdlv7gi3ht2xp2wrfmdagkthi4n7rulb5e54ss", code: "GBP", flag: "gb", name: "British Pound" },
  { address: "keeta_aozyboy42uks7ticj72awfhpdxwqqfcowezxcew6ecaz5afdt7q2ffycxim4u", code: "CAD", flag: "ca", name: "Canadian Dollar" },
  { address: "keeta_apbn7f34cdq62d7iw4ui6sbfaz7fcqdit354wfaotu5zw6d6xfef5vluhdaos", code: "HKD", flag: "hk", name: "Hong Kong Dollar" },
  { address: "keeta_aowqb2hvkak7frntfbtde27bdmqvxancrja7ndh24m66ahkbrzeda3crqh3vg", code: "JPY", flag: "jp", name: "Japanese Yen" },
  { address: "keeta_anjsvaiiycybwhixlalcpwuvobvmpll4lh24td5qipccegmvfi7c2qdcqnlgu", code: "AED", flag: "ae", name: "UAE Dirham" },
  { address: "keeta_amb3hbd5gbhaorl4y2ddl3xn2q4eyi6dqkn5fpug6diz26v2awsdqhkivmyza", code: "MXN", flag: "mx", name: "Mexican Peso" },
  { address: "keeta_ao44m7r4utf2vvytsfijermgkstnkka6rp44eahrekvp4cmj5g2orzm3blrvc", code: "CNY", flag: "cn", name: "Chinese Yuan" },
];

const FIAT_ADDRESS_SET = new Set(FIAT_CURRENCIES.map(f => f.address));
const FIAT_BY_ADDRESS: Record<string, typeof FIAT_CURRENCIES[0]> = {};
FIAT_CURRENCIES.forEach(f => { FIAT_BY_ADDRESS[f.address] = f; });

const formatFiat = (amount: number, code: string): string => {
  try {
    const noDecimal = ['JPY', 'HKD', 'CNY', 'MXN', 'AED'].includes(code);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: noDecimal ? 0 : 2,
      maximumFractionDigits: noDecimal ? 0 : 2,
    }).format(amount);
  } catch {
    return `${code} ${amount.toFixed(2)}`;
  }
};

const FinanceCurrencies: React.FC = () => {
  const { balances, address, network } = useWallet();
  const [fxRates, setFxRates] = useState<FxRates>({ USD: 1 });
  const [homeCurrency] = useState(FinanceService.getHomeCurrency);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<WalletTransaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [conversionPage, setConversionPage] = useState(0);
  const CONVERSIONS_PER_PAGE = 20;

  // Fetch FX rates
  useEffect(() => {
    let cancelled = false;
    FinanceService.getFxRates().then(rates => {
      if (!cancelled) { setFxRates(rates); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, []);

  // Fetch transaction history to find fiat conversions
  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoadingHistory(true);
    WalletService.getWalletHistory(address, network).then(txs => {
      if (!cancelled) { setHistory(txs); setLoadingHistory(false); }
    }).catch(() => { if (!cancelled) setLoadingHistory(false); });
    return () => { cancelled = true; };
  }, [address, network]);

  // Fiat balances from wallet
  const fiatHoldings = useMemo(() => {
    return FIAT_CURRENCIES.map(fc => {
      const bal = balances.find(b => b.address === fc.address);
      const amount = bal ? parseFloat(bal.amount.replace(/,/g, '')) : 0;
      const rate = fxRates[fc.code] || 1;
      const valueUsd = amount / rate;
      const valueHome = FinanceService.convertUsdTo(valueUsd, homeCurrency, fxRates);
      return { ...fc, amount, rawAmount: bal?.amount || '0', valueUsd, valueHome, held: amount > 0 };
    });
  }, [balances, fxRates, homeCurrency]);

  const heldCurrencies = useMemo(() => fiatHoldings.filter(h => h.held), [fiatHoldings]);
  const totalUsd = useMemo(() => heldCurrencies.reduce((sum, h) => sum + h.valueUsd, 0), [heldCurrencies]);
  const totalHome = FinanceService.convertUsdTo(totalUsd, homeCurrency, fxRates);

  // FX cross-rate matrix (only for held currencies)
  const crossRates = useMemo(() => {
    if (heldCurrencies.length < 2) return null;
    const codes = heldCurrencies.map(h => h.code);
    const matrix: { from: string; rates: { to: string; rate: number }[] }[] = [];
    for (const from of codes) {
      const fromRate = fxRates[from] || 1;
      const rates = codes.filter(to => to !== from).map(to => {
        const toRate = fxRates[to] || 1;
        return { to, rate: toRate / fromRate };
      });
      matrix.push({ from, rates });
    }
    return matrix;
  }, [heldCurrencies, fxRates]);

  // Filter conversion history — transactions involving fiat tokens
  const conversions = useMemo(() => {
    return history.filter(tx => {
      if (tx.type !== 'SWAP') return false;
      const inAddr = tx.tokenIn?.address || '';
      const outAddr = tx.tokenOut?.address || '';
      return FIAT_ADDRESS_SET.has(inAddr) || FIAT_ADDRESS_SET.has(outAddr);
    });
  }, [history]);

  const conversionPages = Math.ceil(conversions.length / CONVERSIONS_PER_PAGE);
  const pagedConversions = conversions.slice(
    conversionPage * CONVERSIONS_PER_PAGE,
    (conversionPage + 1) * CONVERSIONS_PER_PAGE
  );

  return (
    <div className="space-y-6">

      {/* Total fiat value */}
      <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-8 hover:shadow-lg transition-shadow duration-300">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-2">Total Fiat Holdings</div>
            {loading ? (
              <div className="h-9 w-48 bg-gray-200 dark:bg-[#333] rounded-lg animate-pulse" />
            ) : (
              <div className="text-3xl font-black text-gray-900 dark:text-white">
                {formatFiat(totalHome, homeCurrency)}
              </div>
            )}
            <div className="text-xs font-bold text-gray-500 mt-1">
              {heldCurrencies.length} currenc{heldCurrencies.length !== 1 ? 'ies' : 'y'} held
            </div>
          </div>
          {heldCurrencies.length > 0 && (
            <Link
              to="/converter"
              className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 dark:border-[#333] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors"
            >
              Convert
            </Link>
          )}
        </div>
      </div>

      {/* Currency balance cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {fiatHoldings.map(fc => (
          <div
            key={fc.code}
            className={[
              'bg-white dark:bg-[#1e1e1e] rounded-2xl border p-5 transition-all duration-300',
              fc.held
                ? 'border-[#845fbc]/30 dark:border-[#845fbc]/20 hover:shadow-lg'
                : 'border-gray-100 dark:border-[#333] opacity-50',
            ].join(' ')}
          >
            <div className="flex items-center gap-3 mb-3">
              <TokenLogo address={fc.address} symbol={fc.code} network={network} className="w-9 h-9" />
              <div>
                <div className="text-sm font-bold text-gray-900 dark:text-white">{fc.code}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{fc.name}</div>
              </div>
            </div>
            <div className="text-xl font-black text-gray-900 dark:text-white">
              {fc.held ? formatFiat(fc.amount, fc.code) : '—'}
            </div>
            {fc.held && homeCurrency !== fc.code && (
              <div className="text-xs font-bold text-gray-500 mt-1">
                {formatFiat(fc.valueHome, homeCurrency)}
              </div>
            )}
            {!fc.held && (
              <div className="text-xs text-gray-400 mt-1">No balance</div>
            )}
            {/* FX rate vs home */}
            {fc.code !== homeCurrency && (
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
                1 {fc.code} = {((fxRates[homeCurrency] || 1) / (fxRates[fc.code] || 1)).toFixed(4)} {homeCurrency}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Cross-rate matrix */}
      {crossRates && crossRates.length >= 2 && (
        <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-6 hover:shadow-lg transition-shadow duration-300">
          <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-4">Cross Rates</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400" />
                  {crossRates.map(r => (
                    <th key={r.from} className="text-right px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {r.from}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {crossRates.map(row => (
                  <tr key={row.from} className="border-t border-gray-100 dark:border-[#333]">
                    <td className="px-3 py-2 text-xs font-bold text-gray-700 dark:text-gray-300">{row.from}</td>
                    {crossRates.map(col => {
                      if (col.from === row.from) {
                        return <td key={col.from} className="px-3 py-2 text-right text-xs text-gray-300 dark:text-gray-600">—</td>;
                      }
                      const pair = row.rates.find(r => r.to === col.from);
                      return (
                        <td key={col.from} className="px-3 py-2 text-right text-xs font-mono text-gray-700 dark:text-gray-300">
                          {pair ? pair.rate.toFixed(4) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Conversion history */}
      <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-6 hover:shadow-lg transition-shadow duration-300">
        <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-4">Conversion History</h3>
        {loadingHistory ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-[#845fbc] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : conversions.length === 0 ? (
          <div className="text-center py-8 text-gray-400 dark:text-gray-500 text-sm">
            No fiat conversions found in recent history.
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-[#333]">
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Date</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">From</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">To</th>
                    <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedConversions.map((tx, i) => (
                    <ConversionRow key={`${tx.hash}-${i}`} tx={tx} />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-3">
              {pagedConversions.map((tx, i) => (
                <ConversionCard key={`${tx.hash}-${i}`} tx={tx} />
              ))}
            </div>

            {/* Pagination */}
            {conversionPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-[#333]">
                <button
                  onClick={() => setConversionPage(p => Math.max(0, p - 1))}
                  disabled={conversionPage === 0}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 dark:border-[#333] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                  {conversionPage + 1} / {conversionPages}
                </span>
                <button
                  onClick={() => setConversionPage(p => Math.min(conversionPages - 1, p + 1))}
                  disabled={conversionPage >= conversionPages - 1}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 dark:border-[#333] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// --- Sub-components ---

const ConversionRow: React.FC<{ tx: WalletTransaction }> = ({ tx }) => {
  const date = new Date(tx.timestamp);
  const inSymbol = tx.tokenIn?.symbol || '?';
  const outSymbol = tx.tokenOut?.symbol || '?';
  const inAmount = tx.tokenIn?.amount || '0';
  const outAmount = tx.tokenOut?.amount || '0';

  return (
    <tr className="border-t border-gray-100 dark:border-[#333] hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors">
      <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">
        {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </td>
      <td className="px-3 py-2.5">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{inAmount}</span>
        <span className="text-xs text-gray-500 ml-1">{inSymbol}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-sm font-semibold text-gray-900 dark:text-white">{outAmount}</span>
        <span className="text-xs text-gray-500 ml-1">{outSymbol}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-xs font-semibold text-green-600 dark:text-green-400">Completed</span>
      </td>
    </tr>
  );
};

const ConversionCard: React.FC<{ tx: WalletTransaction }> = ({ tx }) => {
  const date = new Date(tx.timestamp);
  const inSymbol = tx.tokenIn?.symbol || '?';
  const outSymbol = tx.tokenOut?.symbol || '?';
  const inAmount = tx.tokenIn?.amount || '0';
  const outAmount = tx.tokenOut?.amount || '0';

  return (
    <div className="bg-gray-50 dark:bg-[#252525] rounded-xl p-4 border border-gray-100 dark:border-[#333]">
      <div className="flex justify-between items-start mb-2">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <span className="text-xs font-semibold text-green-600 dark:text-green-400">Completed</span>
      </div>
      <div className="flex items-center gap-2">
        <div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{inAmount}</span>
          <span className="text-xs text-gray-500 ml-1">{inSymbol}</span>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
        <div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">{outAmount}</span>
          <span className="text-xs text-gray-500 ml-1">{outSymbol}</span>
        </div>
      </div>
    </div>
  );
};

export default FinanceCurrencies;

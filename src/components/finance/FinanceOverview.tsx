import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useWallet } from '../../context/WalletContext';
import { WalletService } from '../../services/wallet';
import { FinanceService, type FxRates } from '../../services/finance';
import { cacheGet, cacheSet } from '../../services/cache';
import { getTokenDisplayData } from '../../utils/token';
import { TokenLogo } from '../common/TokenLogo';

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'HKD', 'CNY', 'MXN', 'AED'];

const formatValue = (value: number, currency: string): string => {
  try {
    const noDecimal = ['JPY', 'HKD', 'CNY', 'MXN', 'AED'].includes(currency);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: noDecimal ? 0 : 2,
      maximumFractionDigits: noDecimal ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
};

interface EnrichedBalance {
  address: string;
  displaySymbol: string;
  logoAddress: string;
  amount: string;
  rawBalance: string;
  decimals: number;
  valueUsd: number;
}

const FinanceOverview: React.FC = () => {
  const { balances, network } = useWallet();
  const [ktaPriceUsd, setKtaPriceUsd] = useState(0);
  const [fxRates, setFxRates] = useState<FxRates>({ USD: 1 });
  const [homeCurrency, setHomeCurrency] = useState(FinanceService.getHomeCurrency);
  const [loading, setLoading] = useState(true);
  const [cryptoPage, setCryptoPage] = useState(0);
  const CRYPTO_PAGE_SIZE = 10;

  // Symbol resolution — same pattern as WalletPage
  const [marketData, setMarketData] = useState<Record<string, any>>({});
  const [blockchainSymbols, setBlockchainSymbols] = useState<Record<string, string>>({});

  // Fetch KTA price + FX rates
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [price, rates] = await Promise.all([
        FinanceService.getKtaPriceUsd(),
        FinanceService.getFxRates(),
      ]);
      if (!cancelled) {
        setKtaPriceUsd(price);
        setFxRates(rates);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Fetch pool market data for symbol resolution
  useEffect(() => {
    const fetchMarketData = async () => {
      const cacheKey = `marketData_${network}`;
      const cached = cacheGet<Record<string, any>>(cacheKey, 2 * 60 * 1000);
      if (cached) { setMarketData(cached); return; }

      try {
        const poolsRef = collection(db, "pools");
        const q = query(poolsRef, where("network", "==", network), limit(500));
        const snap = await getDocs(q);
        const map: Record<string, any> = {};
        snap.forEach((doc) => {
          const t = doc.data();
          if (t.pairedToken) {
            map[t.pairedToken] = {
              price: t.price,
              symbol: t.pairedTokenSymbol || t.symbol,
              baseTokenDecimals: t.baseTokenDecimals,
              tokenDecimals: t.tokenDecimals,
              baseTokenSymbol: t.baseTokenSymbol,
              pairedTokenDecimals: t.pairedTokenDecimals,
              pairedTokenSymbol: t.pairedTokenSymbol,
            };
          }
        });
        setMarketData(map);
        cacheSet(cacheKey, map);
      } catch { /* silent */ }
    };
    if (network) fetchMarketData();
  }, [network]);

  // Resolve symbols from blockchain for tokens not in pool data
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
        } catch { /* keep existing */ }
      }));
      if (Object.keys(resolved).length > 0) {
        setBlockchainSymbols(prev => ({ ...prev, ...resolved }));
      }
    };
    if (balances.length > 0) resolveSymbols();
  }, [balances, marketData, network]);

  const handleCurrencyChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setHomeCurrency(val);
    FinanceService.setHomeCurrency(val);
  }, []);

  // Resolve display symbol for a balance
  const resolveSymbol = useCallback((b: typeof balances[0]): { displaySymbol: string; logoAddress: string } => {
    const market = marketData[b.address];
    const bcSymbol = blockchainSymbols[b.address];
    const compositeToken = { ...b, ...(bcSymbol ? { symbol: bcSymbol } : {}), ...market };
    const { displaySymbol, logoAddress } = getTokenDisplayData(compositeToken, network);
    return { displaySymbol, logoAddress };
  }, [marketData, blockchainSymbols, network]);

  // Classify, enrich with resolved symbols, and value balances
  const { fiatBalances, cryptoBalances, totalNetWorthUsd } = useMemo(() => {
    const { fiat, crypto } = FinanceService.classifyBalances(balances);
    let total = 0;

    const enrich = (list: typeof balances): EnrichedBalance[] =>
      list.map(b => {
        const usd = FinanceService.estimateUsdValue(b, ktaPriceUsd, fxRates, marketData);
        total += usd;
        const { displaySymbol, logoAddress } = resolveSymbol(b);
        return {
          address: b.address,
          displaySymbol,
          logoAddress,
          amount: b.amount,
          rawBalance: b.rawBalance,
          decimals: b.decimals,
          valueUsd: usd,
        };
      }).sort((a, b) => b.valueUsd - a.valueUsd);

    return {
      fiatBalances: enrich(fiat),
      cryptoBalances: enrich(crypto),
      totalNetWorthUsd: total,
    };
  }, [balances, ktaPriceUsd, fxRates, marketData, resolveSymbol]);

  const totalInHome = FinanceService.convertUsdTo(totalNetWorthUsd, homeCurrency, fxRates);

  return (
    <div className="space-y-6">

      {/* Net Worth + Currency Selector */}
      <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-8 hover:shadow-lg transition-shadow duration-300">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-2">Total Net Worth</div>
            {loading ? (
              <div className="h-9 w-48 bg-gray-200 dark:bg-[#333] rounded-lg animate-pulse" />
            ) : (
              <div className="text-3xl font-black text-gray-900 dark:text-white">
                {formatValue(totalInHome, homeCurrency)}
              </div>
            )}
            <div className="text-xs font-bold text-gray-500 mt-1">
              {balances.length} asset{balances.length !== 1 ? 's' : ''} across {fiatBalances.length > 0 ? 'crypto & fiat' : 'crypto'}
            </div>
          </div>
          <select
            value={homeCurrency}
            onChange={handleCurrencyChange}
            className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40"
          >
            {CURRENCY_OPTIONS.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Crypto Assets"
          value={String(cryptoBalances.length)}
          sub={ktaPriceUsd > 0 ? `KTA at ${formatValue(ktaPriceUsd, 'USD')}` : 'KTA price unavailable'}
        />
        <MetricCard
          label="Fiat Currencies"
          value={String(fiatBalances.length)}
          sub={fiatBalances.length > 0 ? fiatBalances.map(b => FinanceService.getFiatCurrency(b.address) || b.displaySymbol).join(', ') : 'No fiat holdings'}
        />
        <MetricCard
          label="Network"
          value={network === 'main' ? 'Mainnet' : 'Testnet'}
          sub={network === 'main' ? 'Production environment' : 'Test environment'}
        />
      </div>

      {/* Crypto balances */}
      {cryptoBalances.length > 0 && (() => {
        const totalPages = Math.ceil(cryptoBalances.length / CRYPTO_PAGE_SIZE);
        const pageItems = cryptoBalances.slice(cryptoPage * CRYPTO_PAGE_SIZE, (cryptoPage + 1) * CRYPTO_PAGE_SIZE);
        return (
          <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-6 hover:shadow-lg transition-shadow duration-300">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">Crypto Assets</h3>
              {totalPages > 1 && (
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {cryptoPage * CRYPTO_PAGE_SIZE + 1}–{Math.min((cryptoPage + 1) * CRYPTO_PAGE_SIZE, cryptoBalances.length)} of {cryptoBalances.length}
                </span>
              )}
            </div>
            <div className="space-y-3">
              {pageItems.map(b => (
                <BalanceRow
                  key={b.address}
                  symbol={b.displaySymbol}
                  logoAddress={b.logoAddress}
                  address={b.address}
                  amount={b.amount}
                  valueUsd={b.valueUsd}
                  homeCurrency={homeCurrency}
                  fxRates={fxRates}
                  network={network}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-gray-100 dark:border-[#333]">
                <button
                  onClick={() => setCryptoPage(p => Math.max(0, p - 1))}
                  disabled={cryptoPage === 0}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 dark:border-[#333] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                  {cryptoPage + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setCryptoPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={cryptoPage >= totalPages - 1}
                  className="px-3 py-1.5 text-xs font-semibold rounded-md border border-gray-200 dark:border-[#333] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Fiat balances */}
      {fiatBalances.length > 0 && (
        <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-6 hover:shadow-lg transition-shadow duration-300">
          <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-4">Fiat Currencies</h3>
          <div className="space-y-3">
            {fiatBalances.map(b => (
              <BalanceRow
                key={b.address}
                symbol={FinanceService.getFiatCurrency(b.address) || b.displaySymbol}
                logoAddress={b.logoAddress}
                address={b.address}
                amount={b.amount}
                valueUsd={b.valueUsd}
                homeCurrency={homeCurrency}
                fxRates={fxRates}
                network={network}
                isFiat
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {balances.length === 0 && !loading && (
        <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-12 text-center">
          <p className="text-gray-500 dark:text-gray-400 text-sm">No assets found in this wallet on {network === 'main' ? 'mainnet' : 'testnet'}.</p>
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Link to="/finance/statements" className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-[#333] text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
          Download Statement
        </Link>
        <Link to="/finance/tax" className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-[#333] text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
          Generate Tax Report
        </Link>
        <Link to="/finance/currencies" className="px-5 py-2.5 rounded-xl border border-gray-200 dark:border-[#333] text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
          View Currencies
        </Link>
      </div>
    </div>
  );
};

// --- Sub-components ---

const MetricCard: React.FC<{ label: string; value: string; sub: string }> = ({ label, value, sub }) => (
  <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-6 flex flex-col justify-between h-32 hover:shadow-lg transition-shadow duration-300">
    <div className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em]">{label}</div>
    <div className="text-2xl font-black text-gray-900 dark:text-white">{value}</div>
    <div className="text-xs font-bold text-gray-500 mt-1 truncate">{sub}</div>
  </div>
);

interface BalanceRowProps {
  symbol: string;
  logoAddress: string;
  address: string;
  amount: string;
  valueUsd: number;
  homeCurrency: string;
  fxRates: FxRates;
  network: string;
  isFiat?: boolean;
}

const BalanceRow: React.FC<BalanceRowProps> = ({ symbol, logoAddress, address: _address, amount, valueUsd, homeCurrency, fxRates, network, isFiat }) => {
  const homeValue = FinanceService.convertUsdTo(valueUsd, homeCurrency, fxRates);

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors">
      <div className="flex items-center gap-3">
        <TokenLogo address={logoAddress} symbol={symbol} network={network as 'main' | 'test'} className="w-8 h-8" />
        <div>
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{symbol}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">{amount}</div>
        </div>
      </div>
      <div className="text-right">
        {valueUsd > 0 ? (
          <>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">{formatValue(homeValue, homeCurrency)}</div>
            {homeCurrency !== 'USD' && (
              <div className="text-xs text-gray-500 dark:text-gray-400">{formatValue(valueUsd, 'USD')}</div>
            )}
          </>
        ) : (
          <div className="text-sm text-gray-400 dark:text-gray-500">{isFiat ? formatValue(parseFloat(amount.replace(/,/g, '')) || 0, symbol) : '—'}</div>
        )}
      </div>
    </div>
  );
};

export default FinanceOverview;

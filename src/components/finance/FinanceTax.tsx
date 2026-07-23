import React, { useState, useCallback, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions, authReady } from '../../config/firebase';
import { useWallet } from '../../context/WalletContext';
import { calculateTaxReport, type CostBasisMethod, type TaxSummary } from '../../utils/taxCalculator';
import { generateTaxReport } from '../../utils/pdfGenerator';

const FINANCE_SIGN_PREFIX = "ALPACA_FINANCE_";

async function signFinanceMessage(address: string): Promise<{ message: string; signature: string }> {
  if (!window.alpaca?.signMessage) {
    throw new Error("Wallet extension not found or outdated.");
  }
  const message = FINANCE_SIGN_PREFIX + address;
  const result = await window.alpaca.signMessage(message);
  return { message, signature: result.signature };
}

type DateRange = 'all' | 'this-year' | 'last-year' | 'custom';

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
  sender: string;
}

function buildCsv(records: TradeRecord[]): string {
  const headers = [
    'Date', 'Type', 'Token In', 'Amount In', 'Token Out', 'Amount Out',
    'Pool ID', 'Price After Trade', 'Trade ID'
  ];
  const rows = records.map(r => {
    const date = r.timestamp ? new Date(r.timestamp).toISOString() : '';
    return [
      date,
      r.tradeType || '',
      r.tokenIn || '',
      r.amountIn || '0',
      r.tokenOut || '',
      r.amountOut || '0',
      r.poolId || '',
      r.newPrice || '',
      r.tradeId || '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  return [headers.join(','), ...rows].join('\n');
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatKta(value: number): string {
  if (Math.abs(value) < 0.000001) return '0';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

const FinanceTax: React.FC = () => {
  const { address, network } = useWallet();

  // Transaction export state
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [loading, setLoading] = useState(false);
  const [recordCount, setRecordCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<TradeRecord[] | null>(null);

  // Tax report state
  const [taxYear, setTaxYear] = useState(new Date().getFullYear() - 1);
  const [costBasisMethod, setCostBasisMethod] = useState<CostBasisMethod>(() => {
    return (localStorage.getItem('finance_cost_basis_method') as CostBasisMethod) || 'fifo';
  });
  const [taxLoading, setTaxLoading] = useState(false);
  const [taxError, setTaxError] = useState<string | null>(null);
  const [taxRecords, setTaxRecords] = useState<TradeRecord[] | null>(null);

  // Available years
  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    const arr = [];
    for (let y = currentYear; y >= 2024; y--) arr.push(y);
    return arr;
  }, [currentYear]);

  // Compute tax summary from fetched records
  const taxSummary: TaxSummary | null = useMemo(() => {
    if (!taxRecords || taxRecords.length === 0) return null;
    return calculateTaxReport(taxRecords, costBasisMethod);
  }, [taxRecords, costBasisMethod]);

  const getDateParams = useCallback((): { startDate?: string; endDate?: string } => {
    const now = new Date();
    switch (dateRange) {
      case 'this-year':
        return { startDate: new Date(now.getFullYear(), 0, 1).toISOString() };
      case 'last-year':
        return {
          startDate: new Date(now.getFullYear() - 1, 0, 1).toISOString(),
          endDate: new Date(now.getFullYear(), 0, 1).toISOString(),
        };
      case 'custom':
        return {
          ...(customStart ? { startDate: new Date(customStart).toISOString() } : {}),
          ...(customEnd ? { endDate: new Date(customEnd + 'T23:59:59').toISOString() } : {}),
        };
      default:
        return {};
    }
  }, [dateRange, customStart, customEnd]);

  const fetchHistory = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    setRecords(null);
    setRecordCount(null);

    try {
      const { message, signature } = await signFinanceMessage(address);
      await authReady;
      const fn = httpsCallable(functions, 'financeTransactionHistoryCall');
      const result = await fn({
        address,
        network,
        message,
        signature,
        ...getDateParams(),
      });
      const data = result.data as { transactions: TradeRecord[] };
      setRecords(data.transactions);
      setRecordCount(data.transactions.length);
    } catch (err: any) {
      console.error('Transaction history fetch failed:', err);
      setError(err?.message || 'Failed to fetch transaction history.');
    } finally {
      setLoading(false);
    }
  }, [address, network, getDateParams]);

  const handleDownload = useCallback(() => {
    if (!records || records.length === 0) return;
    const csv = buildCsv(records);
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `alpaca-trades-${network}-${dateStr}.csv`);
  }, [records, network]);

  // Tax report: fetch trades for the selected year then compute
  const fetchTaxReport = useCallback(async () => {
    if (!address) return;
    setTaxLoading(true);
    setTaxError(null);
    setTaxRecords(null);

    try {
      const { message, signature } = await signFinanceMessage(address);
      await authReady;
      const fn = httpsCallable(functions, 'financeTransactionHistoryCall');
      // Fetch ALL trades up to end of selected year (need full history for cost basis)
      const result = await fn({
        address,
        network,
        message,
        signature,
        endDate: new Date(taxYear + 1, 0, 1).toISOString(),
      });
      const data = result.data as { transactions: TradeRecord[] };
      setTaxRecords(data.transactions);
    } catch (err: any) {
      console.error('Tax report fetch failed:', err);
      setTaxError(err?.message || 'Failed to fetch trade data for tax report.');
    } finally {
      setTaxLoading(false);
    }
  }, [address, network, taxYear]);

  const handleTaxPdf = useCallback(() => {
    if (!taxSummary || !address) return;
    const doc = generateTaxReport({
      address,
      network,
      year: taxYear,
      method: costBasisMethod,
      summary: taxSummary,
    });
    doc.save(`alpaca-tax-report-${taxYear}-${costBasisMethod}-${network}.pdf`);
  }, [taxSummary, address, network, taxYear, costBasisMethod]);

  const handleMethodChange = (m: CostBasisMethod) => {
    setCostBasisMethod(m);
    localStorage.setItem('finance_cost_basis_method', m);
  };

  return (
    <div className="space-y-6">
      {/* Tax Reports */}
      <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-8 hover:shadow-lg transition-shadow duration-300">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Tax Reports</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Capital gains/losses with FIFO, LIFO, or HIFO cost basis. All values in KTA (base token).
        </p>

        {/* Year + Method selectors */}
        <div className="flex flex-wrap gap-6 mb-6">
          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] block mb-2">Tax Year</label>
            <select
              value={taxYear}
              onChange={e => { setTaxYear(Number(e.target.value)); setTaxRecords(null); }}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40"
            >
              {years.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] block mb-2">Cost Basis Method</label>
            <div className="flex gap-2">
              {(['fifo', 'lifo', 'hifo'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => handleMethodChange(m)}
                  className={[
                    'px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                    costBasisMethod === m
                      ? 'bg-[#845fbc] text-white shadow-md'
                      : 'bg-gray-100 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3f3f3f]',
                  ].join(' ')}
                >
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={fetchTaxReport}
          disabled={taxLoading || !address}
          className="px-6 py-2.5 bg-[#845fbc] hover:bg-[#724bad] text-white font-bold rounded-xl transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {taxLoading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Calculating...
            </span>
          ) : (
            'Generate Tax Report'
          )}
        </button>

        {taxError && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
            {taxError}
          </div>
        )}

        {/* Tax Summary Cards */}
        {taxSummary && (
          <div className="mt-6 space-y-4">
            {/* Key metrics row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <MetricCard
                label="Net Gain / Loss"
                value={`${formatKta(taxSummary.netGainLoss)} KTA`}
                color={taxSummary.netGainLoss >= 0 ? 'green' : 'red'}
              />
              <MetricCard
                label="Realized Gains"
                value={`${formatKta(taxSummary.totalRealizedGains)} KTA`}
                color="green"
              />
              <MetricCard
                label="Realized Losses"
                value={`${formatKta(taxSummary.totalRealizedLosses)} KTA`}
                color="red"
              />
            </div>

            {/* Holding period breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="Short-Term Gains" value={`${formatKta(taxSummary.shortTermGains)} KTA`} />
              <MetricCard label="Short-Term Losses" value={`${formatKta(taxSummary.shortTermLosses)} KTA`} />
              <MetricCard label="Long-Term Gains" value={`${formatKta(taxSummary.longTermGains)} KTA`} />
              <MetricCard label="Long-Term Losses" value={`${formatKta(taxSummary.longTermLosses)} KTA`} />
            </div>

            {/* Trade counts */}
            <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
              <span>{taxSummary.totalTrades} total trades</span>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span>{taxSummary.totalBuys} buys</span>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span>{taxSummary.totalSells} sells ({taxSummary.events.length} taxable events)</span>
            </div>

            {/* Download PDF */}
            <div className="p-4 rounded-xl bg-gray-50 dark:bg-[#252525] border border-gray-100 dark:border-[#333]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-white">Tax Report Ready</div>
                  <div className="text-xs text-gray-500">
                    {taxYear} — {costBasisMethod.toUpperCase()} method — {taxSummary.events.length} taxable events
                  </div>
                </div>
                <button
                  onClick={handleTaxPdf}
                  className="px-5 py-2.5 bg-gray-200 dark:bg-[#333] text-gray-700 dark:text-gray-300 font-bold rounded-xl transition-all hover:bg-gray-300 dark:hover:bg-[#444] flex items-center gap-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Download PDF
                </button>
              </div>
            </div>

            <p className="text-xs text-gray-400 dark:text-gray-500 italic">
              For informational purposes only. Consult a qualified tax professional for your specific situation.
            </p>
          </div>
        )}

        {taxRecords && taxRecords.length === 0 && (
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            No trades found for {taxYear}.
          </div>
        )}
      </div>

      {/* Transaction History Export */}
      <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-8 hover:shadow-lg transition-shadow duration-300">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Transaction History Export</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Download a CSV of all your executed trades with timestamps, amounts, and token details.
        </p>

        {/* Date range selector */}
        <div className="mb-6">
          <label className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] block mb-2">Period</label>
          <div className="flex flex-wrap gap-2">
            {([
              ['all', 'All Time'],
              ['this-year', 'This Year'],
              ['last-year', 'Last Year'],
              ['custom', 'Custom Range'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setDateRange(key); setRecords(null); setRecordCount(null); }}
                className={[
                  'px-4 py-2 rounded-lg text-sm font-semibold transition-all',
                  dateRange === key
                    ? 'bg-[#845fbc] text-white shadow-md'
                    : 'bg-gray-100 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#3f3f3f]',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {dateRange === 'custom' && (
            <div className="flex gap-3 mt-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Start</label>
                <input
                  type="date"
                  value={customStart}
                  onChange={e => { setCustomStart(e.target.value); setRecords(null); }}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">End</label>
                <input
                  type="date"
                  value={customEnd}
                  onChange={e => { setCustomEnd(e.target.value); setRecords(null); }}
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-[#333] bg-gray-50 dark:bg-[#2a2a2a] text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40"
                />
              </div>
            </div>
          )}
        </div>

        {/* Fetch button */}
        <div className="flex items-center gap-4">
          <button
            onClick={fetchHistory}
            disabled={loading || !address}
            className="px-6 py-2.5 bg-[#845fbc] hover:bg-[#724bad] text-white font-bold rounded-xl transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Fetching...
              </span>
            ) : (
              'Fetch Trades'
            )}
          </button>

          {recordCount !== null && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {recordCount} trade{recordCount !== 1 ? 's' : ''} found
            </span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Download button */}
        {records && records.length > 0 && (
          <div className="mt-6 p-4 rounded-xl bg-gray-50 dark:bg-[#252525] border border-gray-100 dark:border-[#333]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white">Ready to download</div>
                <div className="text-xs text-gray-500">{records.length} trades — CSV format with all trade details</div>
              </div>
              <button
                onClick={handleDownload}
                className="px-5 py-2.5 bg-gray-200 dark:bg-[#333] text-gray-700 dark:text-gray-300 font-bold rounded-xl transition-all hover:bg-gray-300 dark:hover:bg-[#444] flex items-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download CSV
              </button>
            </div>
          </div>
        )}

        {records && records.length === 0 && (
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
            No trades found for the selected period.
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Metric Card ─────────────────────────────────────────────────────────────

const MetricCard: React.FC<{ label: string; value: string; color?: 'green' | 'red' }> = ({ label, value, color }) => {
  const valueColor = color === 'green'
    ? 'text-green-600 dark:text-green-400'
    : color === 'red'
      ? 'text-red-600 dark:text-red-400'
      : 'text-gray-900 dark:text-white';

  return (
    <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#252525] border border-gray-100 dark:border-[#333]">
      <div className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-1">{label}</div>
      <div className={`text-sm font-bold ${valueColor}`}>{value}</div>
    </div>
  );
};

export default FinanceTax;

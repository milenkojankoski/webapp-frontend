import React from 'react';
import type { Transaction } from '../../types';
import { formatAmount18, shortenAddress } from '../../utils/formatters';

// Amounts from WalletService are already formatted (e.g. "0.5").
// Only call formatAmount18 if the value looks like a raw BigInt string.
const displayAmount = (val: string) => {
  if (!val || val === '0') return '0';
  const num = parseFloat(val);
  // If the string contains a decimal dot or is a small number, it's already formatted
  if (val.includes('.') || (!isNaN(num) && num < 1e15)) {
    // Already human-readable, format with commas and trim trailing zeros
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  }
  // Otherwise treat as raw 18-decimal BigInt
  const formatted = formatAmount18(val);
  return parseFloat(formatted).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 });
};

interface TxProps {
  transactions: Transaction[];
  loading: boolean;
  poolAddress?: string;
  baseTokenAddress: string;
  baseTokenSymbol: string;
  pairedTokenSymbol: string;
  compact?: boolean;
}

export const TransactionsList: React.FC<TxProps> = ({
  transactions,
  loading,
  baseTokenAddress,
  baseTokenSymbol,
  pairedTokenSymbol,
  compact = false
}) => {
  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const swapTx = transactions.filter((tx) => {
    if (tx.type !== "SWAP") return false;
    // Filter out same-token swaps (pool rebalancing)
    if (tx.data?.sendToken && tx.data?.receiveToken && tx.data.sendToken.toLowerCase() === tx.data.receiveToken.toLowerCase()) return false;
    // Filter out dust swaps (< 0.005 KTA)
    const sendIsKta = tx.data?.sendToken?.toLowerCase() === baseTokenAddress?.toLowerCase();
    const receiveIsKta = tx.data?.receiveToken?.toLowerCase() === baseTokenAddress?.toLowerCase();
    const ktaAmount = sendIsKta ? parseFloat(displayAmount(tx.data?.sendAmount ?? "0").replace(/,/g, ''))
      : receiveIsKta ? parseFloat(displayAmount(tx.data?.receiveAmount ?? "0").replace(/,/g, ''))
      : null;
    if (ktaAmount !== null && ktaAmount < 0.005) return false;
    return true;
  });

  if (loading) return <div className="hidden md:block mt-8 text-center text-gray-500 dark:text-gray-400 italic">Loading transactions...</div>;
  if (swapTx.length === 0) return null;

  return (
    <div className={`hidden md:block transition-colors ${compact ? 'mt-4' : 'mt-8 p-4 bg-white dark:bg-[#1e1e1e] shadow-md rounded-xl border border-gray-200 dark:border-[#333333]'}`}>
      {!compact && (
        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 border-b border-gray-200 dark:border-[#333333] pb-2">
          Recent Swaps
        </h3>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-gray-500 dark:text-gray-400 uppercase bg-gray-50 dark:bg-[#2a2a2a] border-b border-gray-200 dark:border-[#333333]">
            <tr>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">From</th>
              <th className="px-4 py-3">To</th>
              <th className="px-4 py-3">Trader</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-200 dark:divide-[#333333]">
            {swapTx.map((tx) => {
              const sendToken = tx.data?.sendToken?.toLowerCase() || "";
              const baseToken = baseTokenAddress?.toLowerCase() || "";
              const isBuy = sendToken === baseToken;

              // Pool-provided symbols take priority (always correct from Firestore)
              const sendSymbol = isBuy ? baseTokenSymbol : pairedTokenSymbol;
              const receiveSymbol = isBuy ? pairedTokenSymbol : baseTokenSymbol;

              return (
                <tr key={tx.hash} className="bg-white dark:bg-[#1e1e1e] hover:bg-gray-50 dark:hover:bg-[#2a2a2a] transition-colors border-b border-gray-100 dark:border-[#333333] last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${isBuy ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                      {isBuy ? 'Buy' : 'Sell'}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{formatTime(tx.timestamp)}</td>

                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 font-medium">
                    {displayAmount(tx.data?.sendAmount ?? "0")} <span className="text-xs text-gray-500 dark:text-gray-500">{sendSymbol}</span>
                  </td>

                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300 font-medium">
                    {displayAmount(tx.data?.receiveAmount ?? "0")} <span className="text-xs text-gray-500 dark:text-gray-500">{receiveSymbol}</span>
                  </td>

                  <td className="px-4 py-3 text-xs font-mono text-gray-500 dark:text-gray-400">
                    {tx.data?.trader ? (
                      <a
                        href={`https://explorer.keeta.com/account/${tx.data.trader}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border-b border-dotted border-gray-400 hover:border-[#845fbc] hover:text-[#845fbc] dark:hover:text-[#a78bfa] transition-colors"
                        title={tx.data.trader}
                      >
                        {shortenAddress(tx.data.trader)}
                      </a>
                    ) : '-'}
                  </td>

                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const MobileTransactionsList: React.FC<TxProps> = ({
  transactions,
  loading,
  baseTokenAddress,
  baseTokenSymbol,
  pairedTokenSymbol
}) => {
  const formatTimeShort = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const swapTx = transactions.filter((tx) => {
    if (tx.type !== "SWAP") return false;
    if (tx.data?.sendToken && tx.data?.receiveToken && tx.data.sendToken.toLowerCase() === tx.data.receiveToken.toLowerCase()) return false;
    const sendIsKta = tx.data?.sendToken?.toLowerCase() === baseTokenAddress?.toLowerCase();
    const receiveIsKta = tx.data?.receiveToken?.toLowerCase() === baseTokenAddress?.toLowerCase();
    const ktaAmount = sendIsKta ? parseFloat(displayAmount(tx.data?.sendAmount ?? "0").replace(/,/g, ''))
      : receiveIsKta ? parseFloat(displayAmount(tx.data?.receiveAmount ?? "0").replace(/,/g, ''))
      : null;
    if (ktaAmount !== null && ktaAmount < 0.005) return false;
    return true;
  });

  if (loading) return <div className="text-center text-gray-500 dark:text-gray-400 italic">Loading transactions...</div>;
  if (swapTx.length === 0) return <div className="text-center text-gray-400 dark:text-gray-500 text-sm italic">No swaps yet.</div>;

  return (
    <div className="p-4 bg-white dark:bg-[#1e1e1e] shadow-md rounded-xl border border-gray-200 dark:border-[#333333] transition-colors">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4 border-b border-gray-200 dark:border-[#333333] pb-2">Recent Swaps</h3>
      <div className="space-y-3">
        {swapTx.map((tx) => {
          const sendToken = tx.data?.sendToken?.toLowerCase() || "";
          const baseToken = baseTokenAddress?.toLowerCase() || "";
          const isBuy = sendToken === baseToken;

          const sendSymbol = isBuy ? baseTokenSymbol : pairedTokenSymbol;
          const receiveSymbol = isBuy ? pairedTokenSymbol : baseTokenSymbol;

          return (
            <div key={tx.hash} className="flex flex-col text-sm border-b border-gray-100 dark:border-[#333333] last:border-b-0 pb-3 last:pb-0">
              <div className="flex justify-between items-center mb-2">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${isBuy ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'}`}>
                  {isBuy ? 'Buy' : 'Sell'}
                </span>
                <div className="flex gap-2 items-center">
                  <span className="text-gray-500 dark:text-gray-400">{formatTimeShort(tx.timestamp)}</span>
                  <a href={`https://explorer.keeta.com/block/${tx.hash}`} target="_blank" rel="noreferrer" className="text-[#9333ea] dark:text-[#a78bfa] hover:text-[#7e22ce] dark:hover:text-[#c4b5fd] underline text-xs">
                    {tx.hash.substring(0, 8)}...
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-gray-800 dark:text-gray-200">
                <div>
                  <div className="text-xs text-gray-400 dark:text-gray-500 uppercase">From</div>
                  <div className="font-medium">{displayAmount(tx.data?.sendAmount ?? "0")} {sendSymbol}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-gray-400 dark:text-gray-500 uppercase">To</div>
                  <div className="font-medium">{displayAmount(tx.data?.receiveAmount ?? "0")} {receiveSymbol}</div>
                </div>
              </div>
              {tx.data?.trader && (
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400 font-mono">
                  Trader: <a
                    href={`https://explorer.keeta.com/account/${tx.data.trader}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border-b border-dotted border-gray-400 hover:border-[#845fbc] hover:text-[#845fbc] dark:hover:text-[#a78bfa] transition-colors"
                    title={tx.data.trader}
                  >{shortenAddress(tx.data.trader)}</a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
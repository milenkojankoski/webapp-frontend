import React from 'react';
import type { WalletTransaction } from '../../services/wallet';
import { TokenLogo } from '../common/TokenLogo';

interface TxProps {
  transactions: WalletTransaction[];
  loading: boolean;
  network: 'main' | 'test';
  tokenMap: Record<string, { symbol: string }>;
}

// Filter out noise from swap transactions
const filterSwaps = (txs: WalletTransaction[]) => txs.filter((tx) => {
  if (tx.type === 'SWAP') {
    // Filter out same-token swaps (pool rebalancing, not user swaps)
    if (tx.tokenIn?.address && tx.tokenOut?.address && tx.tokenIn.address === tx.tokenOut.address) return false;

    // Filter out dust swaps (< 0.005 KTA)
    const inSym = tx.tokenIn?.symbol?.toUpperCase();
    const outSym = tx.tokenOut?.symbol?.toUpperCase();
    const ktaAmount = (inSym === 'KTA' || inSym === 'KEETA')
      ? parseFloat(tx.tokenIn?.amount || "0")
      : (outSym === 'KTA' || outSym === 'KEETA')
        ? parseFloat(tx.tokenOut?.amount || "0")
        : null;
    if (ktaAmount !== null && ktaAmount < 0.005) return false;
  }
  return true;
});

export const WalletTransactionsList: React.FC<TxProps> = ({
  transactions,
  loading,
  network,
  tokenMap
}) => {
  const formatTime = (ts: number) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const getSymbol = (addr: string, defaultSym: string) => {
    if (tokenMap[addr]) return tokenMap[addr].symbol;
    return defaultSym;
  };

  const isRewardTx = (tx: WalletTransaction) => tx.external?.startsWith("PD-");

  const getBadgeStyle = (tx: WalletTransaction) => {
    if (isRewardTx(tx)) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
    if (tx.type === 'SWAP') return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300';
    if (tx.type === 'RECEIVE') return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300';
    if (tx.type === 'SEND') return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300';
    return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300';
  };

  const getBadgeLabel = (tx: WalletTransaction) => {
    if (isRewardTx(tx)) return 'Reward';
    if (tx.type === 'SWAP') return 'Swap';
    if (tx.type === 'RECEIVE') return 'Received';
    if (tx.type === 'SEND') return 'Sent';
    return tx.type;
  };

  const formatCounterparty = (tx: WalletTransaction) => {
    if (!tx.counterparty || tx.counterparty === "Unknown") return <span className="opacity-30">-</span>;

    const parts = tx.counterparty.split(": ");
    const label = parts.length > 1 ? parts[0] + ":" : "";
    const address = parts.length > 1 ? parts[1] : tx.counterparty;

    if (address.length < 10) return <span>{tx.counterparty}</span>;

    const shortAddr = `${address.substring(0, 6)}...${address.slice(-4)}`;

    const handleCopy = (e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(address);
      alert("Address copied!");
    };

    return (
      <span className="text-gray-500 flex items-center gap-1 text-xs">
        {label && <span className="font-semibold">{label}</span>}
        <span
          onClick={handleCopy}
          className="font-mono cursor-pointer border-b border-dotted border-gray-400 hover:border-[#845fbc] hover:text-[#845fbc] text-gray-700 dark:text-gray-300 transition-colors"
          title="Click to Copy"
        >
          {shortAddr}
        </span>
      </span>
    );
  };

  if (loading) return <div className="mt-8 text-center text-gray-500 dark:text-gray-400 italic animate-pulse">Loading history...</div>;
  if (transactions.length === 0) return <div className="mt-8 text-center text-gray-500 dark:text-gray-400 italic">No trading history found.</div>;

  const filtered = filterSwaps(transactions);

  return (
    <div className="mt-6 animate-fade-in">
      {/* DESKTOP VIEW */}
      <div className="hidden md:block overflow-x-auto bg-white dark:bg-[#1e1e1e] shadow-sm rounded-3xl border border-gray-200 dark:border-[#333]">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-gray-500 dark:text-gray-400 uppercase text-[10px] font-bold tracking-wider border-b border-gray-100 dark:border-[#333] bg-gray-50 dark:bg-[#252525]">
              <th className="px-6 py-4">Action</th>
              <th className="px-6 py-4">Sent</th>
              <th className="px-6 py-4">Received</th>
              <th className="px-6 py-4">Details</th>
              <th className="px-6 py-4">Time</th>
              <th className="px-6 py-4 text-right">Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-[#333]">
            {filtered.map((tx) => {
              const inSymbol = tx.tokenIn ? getSymbol(tx.tokenIn.address, tx.tokenIn.symbol) : '';
              const outSymbol = tx.tokenOut ? getSymbol(tx.tokenOut.address, tx.tokenOut.symbol) : '';
              const isReceive = tx.type === 'RECEIVE';
              const isSend = tx.type === 'SEND';
              const tokenSymbol = tx.tokenIn ? getSymbol(tx.tokenIn.address, tx.tokenIn.symbol) : '';
              const reward = isRewardTx(tx);

              return (
                <tr key={tx.hash} className={`hover:bg-purple-50 dark:hover:bg-[#2a2a2a] transition duration-150 group ${reward ? 'bg-amber-50/50 dark:bg-amber-900/5' : ''}`}>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${getBadgeStyle(tx)}`}>
                      {getBadgeLabel(tx)}
                    </span>
                  </td>

                  {/* Sent Amount */}
                  <td className="px-6 py-4 font-mono text-sm text-gray-700 dark:text-gray-300">
                    {isSend && tx.tokenIn ? (
                      <div className="flex items-center gap-2">
                        <span>-{Number(tx.tokenIn.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                        <div className="flex items-center gap-1">
                          <TokenLogo symbol={tokenSymbol} address={tx.tokenIn.address} network={network} className="w-4 h-4" />
                          <span className="font-bold text-gray-500 dark:text-gray-500">{tokenSymbol}</span>
                        </div>
                      </div>
                    ) : tx.type === 'SWAP' && tx.tokenIn ? (
                      <div className="flex items-center gap-2">
                        <span>{Number(tx.tokenIn.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                        <div className="flex items-center gap-1">
                          <TokenLogo symbol={inSymbol} address={tx.tokenIn.address} network={network} className="w-4 h-4" />
                          <span className="font-bold text-gray-500 dark:text-gray-500">{inSymbol}</span>
                        </div>
                      </div>
                    ) : <span className="text-gray-400">-</span>}
                  </td>

                  {/* Received Amount */}
                  <td className="px-6 py-4 font-mono text-sm text-gray-900 dark:text-white font-medium">
                    {isReceive && tx.tokenIn ? (
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">+</span>
                        <span>{Number(tx.tokenIn.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                        <div className="flex items-center gap-1">
                          <TokenLogo symbol={tokenSymbol} address={tx.tokenIn.address} network={network} className="w-4 h-4" />
                          <span className="font-bold">{tokenSymbol}</span>
                        </div>
                      </div>
                    ) : tx.type === 'SWAP' && tx.tokenOut ? (
                      <div className="flex items-center gap-2">
                        <span className="text-green-500">+</span>
                        <span>{Number(tx.tokenOut.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>
                        <div className="flex items-center gap-1">
                          <TokenLogo symbol={outSymbol} address={tx.tokenOut.address} network={network} className="w-4 h-4" />
                          <span className="font-bold">{outSymbol}</span>
                        </div>
                      </div>
                    ) : <span className="text-gray-400">-</span>}
                  </td>

                  {/* Address Details */}
                  <td className="px-6 py-4">
                    {reward ? (
                      <span className="font-mono text-xs text-amber-600 dark:text-amber-400">{tx.external}</span>
                    ) : formatCounterparty(tx)}
                  </td>

                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {formatTime(tx.timestamp)}
                  </td>

                  <td className="px-6 py-4 text-right">
                    <a
                      href={`https://explorer.keeta.com/block/${tx.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#845fbc] hover:text-[#6d4c9e] hover:underline text-xs font-mono"
                    >
                      {tx.hash.substring(0, 6)}...
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* MOBILE VIEW */}
      <div className="md:hidden space-y-3">
        {filtered.map((tx) => {
          const inSymbol = tx.tokenIn ? getSymbol(tx.tokenIn.address, tx.tokenIn.symbol) : '';
          const outSymbol = tx.tokenOut ? getSymbol(tx.tokenOut.address, tx.tokenOut.symbol) : '';
          const isSwap = tx.type === 'SWAP';
          const reward = isRewardTx(tx);

          return (
            <div key={tx.hash} className={`p-4 rounded-2xl shadow-sm border ${reward ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30' : 'bg-white dark:bg-[#1e1e1e] border-gray-200 dark:border-[#333]'}`}>
              {/* Header: Badge + Time */}
              <div className="flex justify-between items-center mb-3">
                <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${getBadgeStyle(tx)}`}>
                  {getBadgeLabel(tx)}
                </span>
                <span className="text-[11px] text-gray-400">{formatTime(tx.timestamp)}</span>
              </div>

              {/* Swap: show as "X TOKEN → Y TOKEN" */}
              {isSwap && tx.tokenIn && tx.tokenOut ? (
                <div className="flex items-center justify-between gap-2 text-sm mb-3">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <TokenLogo symbol={inSymbol} address={tx.tokenIn.address} network={network} className="w-5 h-5 shrink-0" />
                    <span className="font-mono font-bold text-gray-700 dark:text-gray-300 truncate">
                      {Number(tx.tokenIn.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </span>
                    <span className="text-xs font-bold text-gray-500 shrink-0">{inSymbol}</span>
                  </div>
                  <span className="text-gray-400 text-xs shrink-0 px-1">→</span>
                  <div className="flex items-center gap-1.5 min-w-0 justify-end">
                    <TokenLogo symbol={outSymbol} address={tx.tokenOut.address} network={network} className="w-5 h-5 shrink-0" />
                    <span className="font-mono font-bold text-green-500 truncate">
                      {Number(tx.tokenOut.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                    </span>
                    <span className="text-xs font-bold text-[#845fbc] shrink-0">{outSymbol}</span>
                  </div>
                </div>
              ) : (
                /* Send/Receive: simple amount with +/- prefix */
                <div className="text-sm mb-3">
                  {tx.tokenIn && (
                    <div className={`flex items-center gap-1.5 font-mono ${tx.type === 'RECEIVE' ? 'text-green-500' : 'text-gray-700 dark:text-gray-300'}`}>
                      <TokenLogo symbol={inSymbol} address={tx.tokenIn.address} network={network} className="w-5 h-5 shrink-0" />
                      <span className="font-bold">
                        {tx.type === 'RECEIVE' ? '+' : '-'}{Number(tx.tokenIn.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                      <span className={`text-xs font-bold ${tx.type === 'RECEIVE' ? 'text-green-400' : 'text-gray-500'}`}>{inSymbol}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Counterparty / Reward tag */}
              {reward ? (
                <div className="text-xs bg-amber-100/50 dark:bg-amber-900/20 p-2 rounded-lg border border-amber-200/50 dark:border-amber-800/30 mb-2 flex items-center justify-center">
                  <span className="font-mono text-amber-600 dark:text-amber-400">{tx.external}</span>
                </div>
              ) : tx.counterparty && tx.counterparty !== "Unknown" && tx.counterparty !== "Pool Interaction" && (
                <div className="text-xs bg-gray-50 dark:bg-[#252525] p-2 rounded-lg border border-gray-100 dark:border-[#333] mb-2 flex items-center justify-center">
                  {formatCounterparty(tx)}
                </div>
              )}

              <div className="mt-2 pt-2 border-t border-gray-100 dark:border-[#333] flex justify-end">
                <a href={`https://explorer.keeta.com/block/${tx.hash}`} target="_blank" rel="noreferrer" className="text-xs text-[#845fbc] hover:underline">
                  View on Explorer ↗
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
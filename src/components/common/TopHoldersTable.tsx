import React, { useState, useEffect } from 'react';
import { collection, getDocs, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { shortenAddress } from '../../utils/formatters';

interface Holder {
    address: string;
    balance: bigint;
}

interface TopHoldersTableProps {
    poolId: string;
    tokenDecimals: number;
    compact?: boolean;
}

export const TopHoldersTable: React.FC<TopHoldersTableProps> = ({ poolId, tokenDecimals, compact = false }) => {
    const [holders, setHolders] = useState<Holder[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchHolders() {
            try {
                setLoading(true);
                const holdersRef = collection(db, 'pools', poolId, 'topHolders');
                const q = query(holdersRef, orderBy('balance', 'desc'), limit(10));
                const snapshot = await getDocs(q);
                const data: Holder[] = snapshot.docs.map(doc => {
                    const d = doc.data();
                    const raw = d.balanceRaw || String(d.balance || '0');
                    return {
                        address: d.address,
                        balance: BigInt(raw.split('.')[0])
                    };
                });
                setHolders(data);
            } catch (err) {
                console.error("Failed to fetch holders:", err);
            } finally {
                setLoading(false);
            }
        }

        if (poolId) {
            fetchHolders();
        }
    }, [poolId]);

    if (loading) return <div className="p-4 text-center text-gray-500 animate-pulse">Loading holders...</div>;

    if (holders.length === 0) return <div className="p-4 text-center text-gray-500">No holders found.</div>;

    return (
        <div className={`overflow-hidden rounded-xl border border-gray-200 dark:border-[#333] bg-white dark:bg-[#1e1e1e] shadow-sm ${compact ? 'border-0 shadow-none bg-transparent' : ''}`}>
            {!compact && (
                <div className="px-6 py-4 border-b border-gray-100 dark:border-[#333]">
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white">Top Holders</h3>
                </div>
            )}
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-[#2a2a2a] text-gray-500 dark:text-gray-400 uppercase text-xs">
                        <tr>
                            <th className="px-6 py-3 font-semibold">Rank</th>
                            <th className="px-6 py-3 font-semibold">Address</th>
                            <th className="px-6 py-3 font-semibold text-right">Received</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-[#333]">
                        {holders.map((holder, index) => (
                            <tr key={holder.address} className="hover:bg-purple-50 dark:hover:bg-[#2a2a2a] transition-colors">
                                <td className="px-6 py-3 font-mono text-[#845fbc] font-bold">#{index + 1}</td>
                                <td className="px-6 py-3 font-mono text-gray-700 dark:text-gray-300">
                                    <a
                                        href={`https://explorer.keeta.com/storage/${holder.address}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="hover:text-[#845fbc]"
                                    >
                                        {shortenAddress(holder.address)}
                                    </a>
                                </td>
                                <td className="px-6 py-3 text-right font-medium text-gray-900 dark:text-white font-mono">
                                    {(Number(holder.balance) / Math.pow(10, tokenDecimals)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

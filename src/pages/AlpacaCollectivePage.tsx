import React, { useState, useEffect, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions, authReady } from "../config/firebase";
import { useWallet } from "../context/WalletContext";
import { shortenAddress } from "../utils/formatters";

const COLLECTIVE_SIGN_PREFIX = "ALPACA_COLLECTIVE_";

async function signCollectiveMessage(address: string): Promise<{ message: string; signature: string }> {
    if (!window.alpaca?.signMessage) {
        throw new Error("Wallet extension not found or outdated. Please update your Alpaca Wallet.");
    }
    const message = COLLECTIVE_SIGN_PREFIX + address;
    const result = await window.alpaca.signMessage(message);
    return { message, signature: result.signature };
}

interface PayoutTotals {
    [symbol: string]: {
        symbol: string;
        token: string;
        total: string;
    };
}

interface PayoutSummary {
    totalCycles: number;
    lastPayoutAt: number | null;
    totals: PayoutTotals;
}

interface CollectiveData {
    balance: string;
    balanceFormatted: string;
    cycleBalance: string;
    multiplier: number;
    disqualified: boolean;
    joinedAt: number | null;
    streakStartedAt: number | null;
    cycleEndsAt: number | null;
    payouts: PayoutSummary | null;
}

const MULTIPLIER_STEP = 0.08;
const STEP_INTERVAL_DAYS = 14;
const MULTIPLIER_MAX = 1.40;

function getMultiplierStage(multiplier: number) {
    if (multiplier >= MULTIPLIER_MAX) return { label: "The Summit", emoji: "summit", color: "text-violet-500" };
    if (multiplier > 1.0) return { label: "The Climb", emoji: "climb", color: "text-purple-500" };
    return { label: "Base Camp", emoji: "base", color: "text-gray-500" };
}

function formatCountdown(ms: number): string {
    if (ms <= 0) return "Resetting...";
    const totalSec = Math.floor(ms / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function useCycleCountdown(endsAt: number | null): string | null {
    const [remaining, setRemaining] = useState<string | null>(null);
    useEffect(() => {
        if (!endsAt) { setRemaining(null); return; }
        const tick = () => setRemaining(formatCountdown(endsAt - Date.now()));
        tick();
        const id = setInterval(tick, 60_000); // update every minute
        return () => clearInterval(id);
    }, [endsAt]);
    return remaining;
}

function getDaysToNextStep(streakStartedAt: number | null): number | null {
    if (!streakStartedAt) return STEP_INTERVAL_DAYS;
    const elapsed = Date.now() - streakStartedAt;
    const currentStepDays = Math.floor(elapsed / (STEP_INTERVAL_DAYS * 24 * 60 * 60 * 1000));
    const nextStepMs = (currentStepDays + 1) * STEP_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    const remaining = nextStepMs - elapsed;
    if (remaining <= 0) return 0;
    return Math.ceil(remaining / (24 * 60 * 60 * 1000));
}

export const AlpacaCollectivePage: React.FC = () => {
    const { isConnected, address, connectToExtension } = useWallet();

    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [subscribed, setSubscribed] = useState(false);
    const [data, setData] = useState<CollectiveData | null>(null);
    const [error, setError] = useState("");

    const applyData = (json: CollectiveData & { subscribed?: boolean }) => {
        setSubscribed(true);
        setData({
            balance: json.balance,
            balanceFormatted: json.balanceFormatted,
            cycleBalance: json.cycleBalance,
            multiplier: json.multiplier,
            disqualified: json.disqualified,
            joinedAt: json.joinedAt,
            streakStartedAt: json.streakStartedAt,
            cycleEndsAt: json.cycleEndsAt,
            payouts: json.payouts,
        });
    };

    const fetchStatus = useCallback(async () => {
        if (!address) return;
        setLoading(true);
        setError("");
        try {
            const { message, signature } = await signCollectiveMessage(address);
            await authReady;
            const fn = httpsCallable(functions, "collectiveStatusCall");
            const result = await fn({ address, message, signature });
            const json = result.data as any;
            if (json.subscribed) {
                applyData(json);
            } else {
                setSubscribed(false);
                setData(null);
            }
        } catch {
            setError("Failed to check subscription status.");
        } finally {
            setLoading(false);
        }
    }, [address]);

    useEffect(() => {
        if (address) fetchStatus();
    }, [address, fetchStatus]);

    const handleSubscribe = async () => {
        if (!address) return;
        setActionLoading(true);
        setError("");
        try {
            const { message, signature } = await signCollectiveMessage(address);
            await authReady;
            const fn = httpsCallable(functions, "collectiveSubscribeCall");
            const result = await fn({ address, message, signature });
            applyData(result.data as any);
        } catch (e: any) {
            setError(e?.message || "Something went wrong. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleUnsubscribe = async () => {
        if (!address) return;
        setActionLoading(true);
        setError("");
        try {
            const { message, signature } = await signCollectiveMessage(address);
            await authReady;
            const fn = httpsCallable(functions, "collectiveUnsubscribeCall");
            await fn({ address, message, signature });
            setSubscribed(false);
            setData(null);
        } catch (e: any) {
            setError(e?.message || "Something went wrong. Please try again.");
        } finally {
            setActionLoading(false);
        }
    };

    const cycleCountdown = useCycleCountdown(data?.cycleEndsAt ?? null);

    // --- Not connected ---
    if (!isConnected) {
        return (
            <div className="w-full min-h-screen p-6 md:p-12 bg-gray-50 dark:bg-[#171717] flex flex-col items-center justify-center text-center animate-fade-in transition-colors duration-300">
                <div className="relative mb-8 group">
                    <div className="absolute inset-0 bg-[#845fbc] blur-[40px] opacity-20 rounded-full group-hover:opacity-40 transition-opacity"></div>
                    <div className="relative bg-white dark:bg-[#1e1e1e] p-8 rounded-3xl border border-gray-200 dark:border-[#333] hover:shadow-lg transition-shadow duration-300">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-16 h-16 text-[#845fbc] dark:text-[#a78bfa] animate-pulse">
                            <path d="M 9.25 8 L 9.5 6 L 12.5 6 L 13.5 2 L 14.5 6 H 16.5 C 18.5 6 19.5 7 19.5 9 C 19.5 11 18.5 12 16.5 12 L 15.5 13 V 22" />
                            <path d="M 15 8.5 h 0.01" strokeWidth={2.5} />
                            <path d="M 6.5 22 V 13 L 4.5 9 L 7.5 9 L 8.5 5 L 9.5 9 H 11.5 C 13.5 9 14.5 10 14.5 12 C 14.5 14 13.5 15 11.5 15 L 10.5 16 V 22" />
                            <path d="M 9.5 11.5 h 0.01" strokeWidth={2.5} />
                        </svg>
                    </div>
                </div>
                <h1 className="text-3xl font-bold font-heading text-gray-900 dark:text-white mb-3">Alpaca Collective</h1>
                <p className="text-gray-500 dark:text-gray-400 max-w-md mb-8">Connect your wallet to join the Participation Program and start earning loyalty rewards.</p>
                <button onClick={() => connectToExtension()} className="px-8 py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-bold font-heading rounded-xl transition-all shadow-lg">Connect Extension</button>
            </div>
        );
    }

    // --- Loading ---
    if (loading) {
        return (
            <div className="w-full min-h-screen bg-gray-50 dark:bg-[#121212] flex items-center justify-center transition-colors duration-300">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-10 h-10 border-4 border-[#845fbc] border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm text-gray-500 dark:text-gray-400 font-medium">Checking membership...</span>
                </div>
            </div>
        );
    }

    // --- Connected but not subscribed ---
    if (!subscribed) {
        return (
            <div className="w-full min-h-screen p-6 md:p-12 bg-gray-50 dark:bg-[#121212] transition-colors duration-300">
                <div className="max-w-3xl mx-auto animate-fade-in">
                    {/* Wallet banner */}
                    <div className="relative w-full bg-[#845fbc] rounded-[40px] p-10 mb-8 overflow-hidden shadow-2xl">
                        <div className="relative z-10">
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                <span className="text-xs font-bold font-heading uppercase tracking-widest text-purple-200">Wallet Connected</span>
                            </div>
                            <h2 className="text-2xl md:text-4xl font-mono font-bold text-white tracking-tight">
                                {shortenAddress(address || "")}
                            </h2>
                        </div>
                        <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3"></div>
                    </div>

                    {/* Join card */}
                    <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-10 text-center hover:shadow-lg transition-shadow duration-300">
                        <div className="relative inline-block mb-6">
                            <div className="absolute inset-0 bg-[#845fbc] blur-[30px] opacity-20 rounded-full"></div>
                            <div className="relative bg-gray-50 dark:bg-[#252525] p-6 rounded-2xl border border-gray-200 dark:border-[#333]">
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12 text-[#845fbc] dark:text-[#a78bfa]">
                                    <path d="M 9.25 8 L 9.5 6 L 12.5 6 L 13.5 2 L 14.5 6 H 16.5 C 18.5 6 19.5 7 19.5 9 C 19.5 11 18.5 12 16.5 12 L 15.5 13 V 22" />
                                    <path d="M 15 8.5 h 0.01" strokeWidth={2.5} />
                                    <path d="M 6.5 22 V 13 L 4.5 9 L 7.5 9 L 8.5 5 L 9.5 9 H 11.5 C 13.5 9 14.5 10 14.5 12 C 14.5 14 13.5 15 11.5 15 L 10.5 16 V 22" />
                                    <path d="M 9.5 11.5 h 0.01" strokeWidth={2.5} />
                                </svg>
                            </div>
                        </div>

                        <h2 className="text-2xl font-bold font-heading text-gray-900 dark:text-white mb-3">Join the Alpaca Collective</h2>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-8">
                            Enroll your wallet in the Participation Program. Your PACA stays in your wallet — hold to earn loyalty multipliers and protocol rewards.
                            {" "}Learn more in our{" "}
                            <a href="https://alpacadex.com/tokenomics" target="_blank" rel="noopener noreferrer" className="text-[#845fbc] dark:text-[#a78bfa] hover:underline">Tokenomics</a>.
                        </p>

                        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

                        <button
                            onClick={handleSubscribe}
                            disabled={actionLoading}
                            className="px-10 py-3.5 bg-[#845fbc] hover:bg-[#724bad] text-white font-bold font-heading rounded-xl transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {actionLoading ? "Joining..." : "Join the Collective"}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // --- Subscribed: show dashboard ---
    const stage = getMultiplierStage(data?.multiplier ?? 1);
    const daysToNext = data?.multiplier !== undefined && data.multiplier < MULTIPLIER_MAX
        ? getDaysToNextStep(data?.streakStartedAt ?? null)
        : null;
    const multiplierProgress = data ? ((data.multiplier - 1.0) / (MULTIPLIER_MAX - 1.0)) * 100 : 0;
    const memberSince = data?.joinedAt ? new Date(data.joinedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

    return (
        <div className="w-full min-h-screen p-6 md:p-12 bg-gray-50 dark:bg-[#121212] transition-colors duration-300">
            <div className="max-w-4xl mx-auto animate-fade-in">

                {/* Hero banner */}
                <div className="relative w-full bg-[#845fbc] rounded-[40px] p-10 mb-8 overflow-hidden shadow-2xl">
                    <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                        <div>
                            <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                <span className="text-xs font-bold font-heading uppercase tracking-widest text-purple-200">Collective Member</span>
                            </div>
                            <h2 className="text-2xl md:text-4xl font-mono font-bold text-white tracking-tight">
                                {shortenAddress(address || "")}
                            </h2>
                            <p className="text-sm text-purple-200 mt-1">Member since {memberSince}</p>
                        </div>
                        <button
                            onClick={() => navigator.clipboard.writeText(address || "")}
                            className="p-2 bg-white/10 hover:bg-white/20 rounded-xl transition-all"
                            title="Copy Address"
                        >
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                    </div>
                    <div className="absolute top-0 right-0 w-96 h-96 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/3"></div>
                </div>

                {/* Metrics row */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    {/* PACA Balance */}
                    <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-gray-200 dark:border-[#333] p-6 hover:shadow-lg transition-shadow duration-300">
                        <p className="text-[10px] font-black font-heading uppercase tracking-widest text-gray-500 mb-2">PACA Balance</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">{data?.balanceFormatted ?? "0"}</p>
                        <p className="text-xs text-gray-400 mt-1">Registered in program</p>
                    </div>

                    {/* Cycle Balance */}
                    <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-gray-200 dark:border-[#333] p-6 hover:shadow-lg transition-shadow duration-300">
                        <p className="text-[10px] font-black font-heading uppercase tracking-widest text-gray-500 mb-2">Cycle Balance</p>
                        <p className="text-2xl font-bold text-gray-900 dark:text-white">{data?.cycleBalance ? formatCycleBalance(data.cycleBalance) : "0"}</p>
                        <p className="text-xs text-gray-400 mt-1">Eligible for rewards this cycle</p>
                    </div>

                    {/* Status */}
                    <div className="bg-white dark:bg-[#1e1e1e] rounded-2xl border border-gray-200 dark:border-[#333] p-6 hover:shadow-lg transition-shadow duration-300">
                        <p className="text-[10px] font-black font-heading uppercase tracking-widest text-gray-500 mb-2">Cycle Status</p>
                        {data?.disqualified ? (
                            <>
                                <p className="text-2xl font-bold text-red-500">Disqualified</p>
                                <p className="text-xs text-gray-400 mt-1">Sold PACA this cycle</p>
                            </>
                        ) : (
                            <>
                                <p className="text-2xl font-bold text-green-500">Active</p>
                                <p className="text-xs text-gray-400 mt-1">Earning rewards this cycle</p>
                            </>
                        )}
                        {cycleCountdown && (
                            <p className="text-xs text-gray-400 mt-2">Cycle resets in <span className="font-semibold text-gray-600 dark:text-gray-300">{cycleCountdown}</span></p>
                        )}
                    </div>
                </div>

                {/* Loyalty multiplier card */}
                <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-8 mb-8 hover:shadow-lg transition-shadow duration-300">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-6">
                        <div>
                            <h3 className="text-sm font-black font-heading uppercase tracking-widest text-gray-500 mb-1">Loyalty Multiplier</h3>
                            <div className="flex items-baseline gap-3">
                                <span className="text-5xl font-black text-gray-900 dark:text-white">{(data?.multiplier ?? 1).toFixed(2)}x</span>
                                <span className={`text-sm font-bold font-heading uppercase tracking-wider ${stage.color}`}>{stage.label}</span>
                            </div>
                        </div>
                        {daysToNext !== null && data?.multiplier !== undefined && data.multiplier < MULTIPLIER_MAX && (
                            <div className="text-right">
                                <p className="text-xs text-gray-500 font-bold font-heading uppercase tracking-wider mb-1">Next step in</p>
                                <p className="text-2xl font-bold text-[#845fbc]">{daysToNext} <span className="text-sm font-medium text-gray-400">days</span></p>
                                <p className="text-xs text-gray-400">+{MULTIPLIER_STEP * 100}% boost</p>
                            </div>
                        )}
                        {data?.multiplier !== undefined && data.multiplier >= MULTIPLIER_MAX && (
                            <div className="bg-violet-50 dark:bg-violet-500/10 px-4 py-2 rounded-xl border border-violet-200 dark:border-violet-500/20">
                                <p className="text-sm font-bold text-violet-600 dark:text-violet-400">Max multiplier reached!</p>
                            </div>
                        )}
                    </div>

                    {/* Progress bar */}
                    <div className="w-full bg-gray-100 dark:bg-[#252525] rounded-full h-3 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-[#c084fc] to-[#845fbc] transition-all duration-1000 ease-out"
                            style={{ width: `${Math.min(multiplierProgress, 100)}%` }}
                        ></div>
                    </div>

                    {/* Step indicators */}
                    <div className="flex justify-between mt-3 text-[10px] font-bold font-heading text-gray-400 uppercase tracking-wider">
                        <span>1.00x</span>
                        <span>1.08x</span>
                        <span>1.16x</span>
                        <span>1.24x</span>
                        <span>1.32x</span>
                        <span>1.40x</span>
                    </div>
                </div>

                {/* Rewards received */}
                <div className="bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] p-8 mb-8 hover:shadow-lg transition-shadow duration-300">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                        <div>
                            <h3 className="text-sm font-black font-heading uppercase tracking-widest text-gray-500 mb-1">Rewards Received</h3>
                            {data?.payouts && data.payouts.totalCycles > 0 ? (
                                <p className="text-xs text-gray-400">Total payouts across {data.payouts.totalCycles} cycle{data.payouts.totalCycles !== 1 ? "s" : ""}</p>
                            ) : (
                                <p className="text-xs text-gray-400">Your reward payouts will appear here after each distribution cycle</p>
                            )}
                        </div>
                        {data?.payouts?.lastPayoutAt && (
                            <p className="text-xs text-gray-400">
                                Last payout:{" "}
                                <span className="font-semibold text-gray-600 dark:text-gray-300">
                                    {new Date(data.payouts.lastPayoutAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                                </span>
                            </p>
                        )}
                    </div>
                    {data?.payouts && Object.keys(data.payouts.totals).length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {Object.entries(data.payouts.totals)
                                .sort(([a], [b]) => (a === "KTA" ? -1 : b === "KTA" ? 1 : a.localeCompare(b)))
                                .map(([symbol, info]) => (
                                    <div key={symbol} className="bg-gray-50 dark:bg-[#252525] rounded-xl p-4 border border-gray-100 dark:border-[#333]">
                                        <p className="text-[10px] font-black font-heading uppercase tracking-widest text-gray-500 mb-1">{symbol}</p>
                                        <p className="text-lg font-bold text-gray-900 dark:text-white">{formatTokenTotal(info.total)}</p>
                                    </div>
                                ))}
                        </div>
                    ) : (
                        <div className="bg-gray-50 dark:bg-[#252525] rounded-xl p-6 border border-gray-100 dark:border-[#333] text-center">
                            <p className="text-sm text-gray-400 dark:text-gray-500">No rewards distributed yet</p>
                        </div>
                    )}
                </div>

                {/* Info + unsubscribe */}
                <div className="flex flex-col md:flex-row gap-4">
                    {/* How it works */}
                    <div className="flex-1 bg-white dark:bg-[#1e1e1e] rounded-2xl border border-gray-200 dark:border-[#333] p-6 hover:shadow-lg transition-shadow duration-300">
                        <h4 className="text-sm font-black font-heading uppercase tracking-widest text-gray-500 mb-4">How It Works</h4>
                        <ul className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
                            <li className="flex items-start gap-3">
                                <span className="w-5 h-5 rounded-full bg-green-100 dark:bg-green-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                                </span>
                                Hold PACA to grow your multiplier — +8% every 14 days
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="w-5 h-5 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <span className="w-2 h-2 rounded-full bg-red-500"></span>
                                </span>
                                Selling any PACA resets your multiplier to 1.00x
                            </li>
                            <li className="flex items-start gap-3">
                                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                    <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                                </span>
                                Buying more dilutes your multiplier (new tokens start at 1.00x)
                            </li>
                        </ul>
                        <a href="https://alpacadex.com/tokenomics" target="_blank" rel="noopener noreferrer" className="inline-block mt-4 text-sm font-semibold text-[#845fbc] dark:text-[#a78bfa] hover:underline">
                            Learn more about Tokenomics →
                        </a>
                    </div>

                    {/* Manage membership */}
                    <div className="md:w-72 bg-white dark:bg-[#1e1e1e] rounded-2xl border border-gray-200 dark:border-[#333] p-6 hover:shadow-lg transition-shadow duration-300 flex flex-col justify-between">
                        <div>
                            <h4 className="text-sm font-black font-heading uppercase tracking-widest text-gray-500 mb-2">Membership</h4>
                            <p className="text-xs text-gray-400 mb-6">
                                Leaving the Collective removes your wallet from the incentive program. Your multiplier progress will be lost.
                            </p>
                        </div>

                        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

                        <button
                            onClick={handleUnsubscribe}
                            disabled={actionLoading}
                            className="w-full px-4 py-2.5 bg-gray-100 hover:bg-red-50 dark:bg-[#252525] dark:hover:bg-red-500/10 text-gray-600 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 text-sm font-bold font-heading rounded-xl transition-all border border-gray-200 dark:border-[#333] hover:border-red-200 dark:hover:border-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {actionLoading ? "Leaving..." : "Leave Collective"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

function formatCycleBalance(raw: string): string {
    const decimals = 18;
    const str = raw.padStart(decimals + 1, "0");
    const whole = str.slice(0, str.length - decimals) || "0";
    const frac = str.slice(str.length - decimals, str.length - decimals + 2);
    return `${Number(whole).toLocaleString("en-US")}.${frac}`;
}

function formatTokenTotal(raw: string): string {
    const decimals = 18;
    if (!raw || raw === "0") return "0.00";
    const str = raw.padStart(decimals + 1, "0");
    const whole = str.slice(0, str.length - decimals) || "0";
    const frac = str.slice(str.length - decimals, str.length - decimals + 4);
    return `${Number(whole).toLocaleString("en-US")}.${frac}`;
}

export default AlpacaCollectivePage;

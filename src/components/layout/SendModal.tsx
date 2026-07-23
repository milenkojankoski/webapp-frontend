import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWallet } from '../../context/WalletContext';
import { TokenLogo } from '../common/TokenLogo';
import { logger } from '../../utils/logger';

const USERNAME_REGEX = /^[a-z0-9_]{2,24}$/;
const USERNAME_RESOLVE_URL = "https://usernames.keeta.xyz/api/resolve";

interface Contact {
    id: string;
    label: string;
    address?: { recipient?: string } | string;
}

const getContactAddress = (addr: any): string => {
    if (!addr) return '';
    if (typeof addr === 'string') return addr;
    if (addr.recipient) return addr.recipient;
    return '';
};

interface SendModalProps {
    isOpen: boolean;
    onClose: () => void;
    token: {
        address: string;
        symbol: string;
        decimals: number;
        amount: string; // Formatting: "1,234.56"
        rawBalance?: string; // Optional raw balance for validation
    } | null;
    initialRecipient?: string;
}

export const SendModal: React.FC<SendModalProps> = ({ isOpen, onClose, token, initialRecipient }) => {
    const { network, address } = useWallet();
    const [recipient, setRecipient] = useState("");
    const [amount, setAmount] = useState("");
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Username resolution state
    const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
    const [resolvedUsername, setResolvedUsername] = useState<string | null>(null);
    const [isResolving, setIsResolving] = useState(false);
    const [resolveError, setResolveError] = useState<string | null>(null);
    const resolveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Contacts picker state
    const [showContacts, setShowContacts] = useState(false);
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [contactsLoading, setContactsLoading] = useState(false);
    const [contactSearch, setContactSearch] = useState('');
    const contactsRef = useRef<HTMLDivElement>(null);

    const isAddress = (input: string) => input.startsWith("keeta_");
    const isUsername = (input: string) => !input.startsWith("keeta_") && USERNAME_REGEX.test(input);

    const resolveUsername = useCallback(async (username: string) => {
        setIsResolving(true);
        setResolveError(null);
        setResolvedAddress(null);
        setResolvedUsername(null);
        try {
            const res = await fetch(`${USERNAME_RESOLVE_URL}/${encodeURIComponent(username)}`);
            const data = await res.json();
            if (data.ok && data.account) {
                setResolvedAddress(data.account);
                setResolvedUsername(data.username || username);
            } else {
                setResolveError("Username not found");
            }
        } catch {
            setResolveError("Failed to resolve username");
        } finally {
            setIsResolving(false);
        }
    }, []);

    // Debounced username resolution
    useEffect(() => {
        if (resolveTimerRef.current) clearTimeout(resolveTimerRef.current);
        setResolvedAddress(null);
        setResolvedUsername(null);
        setResolveError(null);

        const trimmed = recipient.trim().toLowerCase();
        if (trimmed && isUsername(trimmed)) {
            setIsResolving(true);
            resolveTimerRef.current = setTimeout(() => resolveUsername(trimmed), 500);
        } else {
            setIsResolving(false);
        }

        return () => { if (resolveTimerRef.current) clearTimeout(resolveTimerRef.current); };
    }, [recipient, resolveUsername]);

    // The actual address to send to
    const effectiveRecipient = resolvedAddress || (isAddress(recipient.trim()) ? recipient.trim() : null);

    // Load contacts eagerly when modal opens (fresh each time)
    useEffect(() => {
        if (!isOpen) { setContacts([]); return; }
        if (!window.alpaca?.listContacts) return;

        setContactsLoading(true);
        window.alpaca.listContacts()
            .then(res => {
                const list = res?.contacts || [];
                logger.log("[SendModal] Loaded contacts:", list.length);
                setContacts(list);
            })
            .catch(err => console.error("[SendModal] Failed to load contacts:", err))
            .finally(() => setContactsLoading(false));
    }, [isOpen]);

    // Close contacts on outside click
    useEffect(() => {
        if (!showContacts) return;
        const handler = (e: MouseEvent) => {
            if (contactsRef.current && !contactsRef.current.contains(e.target as Node)) {
                setShowContacts(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [showContacts]);

    // Reset state when opening
    useEffect(() => {
        if (isOpen) {
            setRecipient(initialRecipient || "");
            setAmount("");
            setError(null);
            setIsSending(false);
            setResolvedAddress(null);
            setResolvedUsername(null);
            setResolveError(null);
            setIsResolving(false);
            setShowContacts(false);
            setContactSearch('');
        }
    }, [isOpen, token, initialRecipient]);

    if (!isOpen || !token) return null;

    const handleSend = async () => {
        setError(null);
        // Basic validation
        if (!recipient) return setError("Recipient address or username required");
        if (!effectiveRecipient) return setError(isResolving ? "Resolving username..." : resolveError || "Invalid recipient");
        if (!amount) return setError("Amount required");

        const currentBalance = parseFloat(token.amount.replace(/,/g, ''));
        const sendAmount = parseFloat(amount);
        if (isNaN(sendAmount) || sendAmount <= 0) return setError("Invalid amount");
        if (sendAmount > currentBalance) return setError("Insufficient balance");

        if (effectiveRecipient === address) return setError("Cannot send to yourself");

        setIsSending(true);

        try {
            if (!window.alpaca) throw new Error("Alpaca Wallet extension not found");

            // Convert amount to raw string (smallest unit) based on decimals
            let rawAmount = "0";
            if (token.decimals === 0) {
                rawAmount = amount.split('.')[0];
            } else {
                const [int, frac = ""] = amount.split(".");
                const padded = (frac || "").padEnd(token.decimals, "0").slice(0, token.decimals);
                rawAmount = `${int}${padded}`.replace(/^0+/, "") || "0";
            }

            const result = await window.alpaca.sendTransaction({
                type: 'SEND',
                params: {
                    network,
                    to: effectiveRecipient,
                    amount: rawAmount,
                    token: token.address
                }
            });

            if (!result) throw new Error("Transaction rejected");

            alert(`Transaction Sent!\nHash: ${result.txHash}`);
            onClose();

        } catch (e: any) {
            console.error("Send failed:", e);
            setError(e.message || "Transaction failed");
        } finally {
            setIsSending(false);
        }
    };

    const setMax = () => {
        // Strip commas from displayed balance
        setAmount(token.amount.replace(/,/g, ''));
    };

    const selectContact = (c: Contact) => {
        const addr = getContactAddress(c.address);
        if (addr) setRecipient(addr);
        setShowContacts(false);
        setContactSearch('');
    };

    const filteredContacts = contacts.filter(c => {
        if (!contactSearch.trim()) return true;
        const q = contactSearch.toLowerCase();
        return c.label.toLowerCase().includes(q) || getContactAddress(c.address).toLowerCase().includes(q);
    });

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/30 dark:bg-black/60 backdrop-blur-md transition-opacity"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-md bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-sm overflow-hidden animate-fade-in text-left">

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-md bg-gray-100 dark:bg-white/[0.06] hover:bg-gray-200 dark:hover:bg-white/[0.1] text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors z-10"
                >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>

                <div className="p-6 relative z-0">
                    <h3 className="text-[18px] font-semibold text-gray-900 dark:text-white mb-0.5">Send Assets</h3>
                    <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-5">Transfer tokens to an address, username, or contact</p>

                    {/* Asset Info */}
                    <div className="flex items-center gap-3 bg-gray-50 dark:bg-white/[0.02] p-3.5 rounded-xl border border-gray-200 dark:border-white/[0.08] mb-5">
                        <TokenLogo symbol={token.symbol} address={token.address} network={network} className="w-10 h-10" />
                        <div>
                            <div className="font-semibold text-[15px] text-gray-900 dark:text-white">{token.symbol}</div>
                            <div className="text-[12px] text-gray-400 dark:text-gray-500 font-mono">Available: {token.amount}</div>
                        </div>
                    </div>

                    {/* Inputs */}
                    <div className="space-y-4">
                        <div>
                            <label className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em] ml-0.5 mb-1.5 block">Recipient</label>
                            <div className="relative" ref={contactsRef}>
                                <input
                                    className={`w-full pl-3.5 pr-20 py-3 bg-gray-50 dark:bg-white/[0.04] border rounded-xl text-[13px] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#845fbc] focus:ring-1 focus:ring-[#845fbc]/40 transition-all ${resolvedAddress ? 'border-emerald-400 dark:border-emerald-500' : resolveError ? 'border-red-300 dark:border-red-500' : 'border-gray-200 dark:border-white/[0.08]'} ${isAddress(recipient.trim()) ? 'font-mono text-[12px]' : ''}`}
                                    placeholder="Username, address, or pick a contact"
                                    value={recipient}
                                    onChange={e => setRecipient(e.target.value)}
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                    {/* Contacts picker button */}
                                    <button
                                        type="button"
                                        onClick={() => setShowContacts(!showContacts)}
                                        className={`p-1.5 rounded-md transition-colors ${showContacts ? 'bg-[#845fbc]/10 text-[#845fbc] dark:text-[#a78bfa]' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06]'}`}
                                        title="Pick from contacts"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                                        </svg>
                                    </button>
                                    {/* Resolving spinner */}
                                    {isResolving && (
                                        <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    )}
                                    {/* Resolved checkmark */}
                                    {resolvedAddress && !isResolving && (
                                        <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                    )}
                                </div>

                                {/* Contacts dropdown */}
                                {showContacts && (
                                    <div className="absolute left-0 right-0 top-full mt-1 z-[90] rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] shadow-lg">
                                        {/* Search */}
                                        {contacts.length > 3 && (
                                            <div className="p-2.5 border-b border-gray-100 dark:border-white/[0.04]">
                                                <input type="text" value={contactSearch} onChange={e => setContactSearch(e.target.value)}
                                                    placeholder="Search contacts..." autoFocus
                                                    className="w-full px-2.5 py-1.5 rounded-md text-[12px] bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all" />
                                            </div>
                                        )}
                                        <div className="max-h-48 overflow-y-auto py-1">
                                            {contactsLoading ? (
                                                <div className="flex items-center justify-center gap-2 py-4 text-gray-400">
                                                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                                    <span className="text-[12px]">Loading...</span>
                                                </div>
                                            ) : contacts.length === 0 ? (
                                                <div className="py-4 px-3 text-center text-[12px] text-gray-400 dark:text-gray-500">No contacts saved yet</div>
                                            ) : filteredContacts.length === 0 ? (
                                                <div className="py-4 px-3 text-center text-[12px] text-gray-400 dark:text-gray-500">No matching contacts</div>
                                            ) : filteredContacts.map(c => {
                                                const addr = getContactAddress(c.address);
                                                return (
                                                    <button key={c.id} onClick={() => selectContact(c)}
                                                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors text-left">
                                                        <div className="w-8 h-8 rounded-full bg-[#845fbc]/10 flex items-center justify-center shrink-0">
                                                            <span className="text-[12px] font-semibold text-[#845fbc] dark:text-[#a78bfa]">{c.label.charAt(0).toUpperCase()}</span>
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">{c.label}</div>
                                                            <div className="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate">{addr ? `${addr.slice(0, 12)}...${addr.slice(-6)}` : 'No address'}</div>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                            {/* Resolved address display */}
                            {resolvedAddress && (
                                <div className="mt-1.5 ml-0.5 flex items-center gap-2">
                                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">@{resolvedUsername}</span>
                                    <span className="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate">{resolvedAddress.slice(0, 14)}...{resolvedAddress.slice(-6)}</span>
                                </div>
                            )}
                            {resolveError && !isResolving && (
                                <div className="mt-1.5 ml-0.5 text-[11px] text-red-500 dark:text-red-400">{resolveError}</div>
                            )}
                        </div>

                        <div>
                            <div className="flex justify-between ml-0.5 mb-1.5">
                                <label className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.08em]">Amount</label>
                                <button onClick={setMax} className="text-[11px] font-semibold text-[#845fbc] hover:text-[#a78bfa] transition-colors uppercase tracking-[0.08em]">
                                    Use Max
                                </button>
                            </div>
                            <div className="relative">
                                <input
                                    type="number"
                                    className="w-full pl-3.5 pr-16 py-3 bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] rounded-xl text-[18px] font-semibold text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-[#845fbc] focus:ring-1 focus:ring-[#845fbc]/40 transition-all"
                                    placeholder="0.00"
                                    value={amount}
                                    onChange={e => setAmount(e.target.value)}
                                />
                                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-gray-400 dark:text-gray-500 pointer-events-none">
                                    {token.symbol}
                                </div>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="mt-5 p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-[13px] font-medium rounded-xl border border-red-200 dark:border-red-500/20 text-center">
                            {error}
                        </div>
                    )}

                    <button
                        onClick={handleSend}
                        disabled={isSending || !amount || !effectiveRecipient || isResolving}
                        className="w-full mt-6 py-3.5 bg-[#845fbc] hover:bg-[#724bad] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-[14px] rounded-xl transition-colors"
                    >
                        {isSending ? (
                            <div className="flex items-center justify-center gap-2">
                                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                <span>Check Extension...</span>
                            </div>
                        ) : "Confirm Send"}
                    </button>

                    <div className="mt-3 text-center text-[11px] text-gray-400 dark:text-gray-500">
                        Transaction will be signed by your Alpaca Wallet extension.
                    </div>
                </div>
            </div>
        </div>
    );
};

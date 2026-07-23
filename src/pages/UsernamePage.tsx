import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useWallet } from '../context/WalletContext';
import { Client, lib } from '@keetanetwork/keetanet-client';
import { useKYCStatus } from '../components/common/KYCBadge';
import { SendModal } from '../components/layout/SendModal';
import { TokenLogo } from '../components/common/TokenLogo';
import { db, functions, authReady } from '../config/firebase';
import { collection, query, where, limit, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

const USERNAME_RESOLVE_URL = "https://usernames.keeta.xyz/api/resolve";
const USERNAME_REGEX = /^[a-z0-9_]{2,24}$/;

const Spinner: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
  <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
  </svg>
);

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-6 transition-colors ${className}`}>
    {children}
  </div>
);

const SectionLabel: React.FC<{ label: string }> = ({ label }) => (
  <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-3">
    {label}
  </div>
);

const getRecipient = (addr: any): string => {
  if (!addr) return '';
  if (typeof addr === 'string') return addr;
  if (addr.recipient) return addr.recipient;
  return '';
};

const contactColor = (str: string): string => {
  const colors = ['#845fbc', '#14b8a6', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#8b5cf6', '#10b981', '#f97316', '#6366f1'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const AccountPage: React.FC = () => {
  const { isConnected, address, network, balances } = useWallet();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // --- Profile Picture ---
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [profilePicLoading, setProfilePicLoading] = useState(true);
  const [profilePicSaving, setProfilePicSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isConnected || !address) return;
    const cacheKey = `alpaca_pp_${address}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) { setProfilePic(cached); setProfilePicLoading(false); }
    if (!window.alpaca?.getProfilePic) { setProfilePicLoading(false); return; }
    window.alpaca.getProfilePic(address).then((res) => {
      if (res?.hasIcon && res.dataUrl) {
        setProfilePic(res.dataUrl);
        localStorage.setItem(cacheKey, res.dataUrl);
      } else {
        setProfilePic(null);
        localStorage.removeItem(cacheKey);
      }
    }).catch(() => {}).finally(() => setProfilePicLoading(false));
  }, [isConnected, address]);

  const handleProfilePicUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) { setError("Image must be under 512 KB"); return; }
    if (!window.alpaca?.setProfilePic) { setError("Please update your Alpaca Wallet extension."); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setError(null); setSuccess(null); setProfilePicSaving(true);
      try {
        await window.alpaca!.setProfilePic!(dataUrl);
        setProfilePic(dataUrl);
        localStorage.setItem(`alpaca_pp_${address}`, dataUrl);
        setSuccess("Profile picture updated on-chain.");
      } catch (err: any) {
        setError(err.message || "Failed to upload picture");
      } finally { setProfilePicSaving(false); }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteProfilePic = async () => {
    if (!window.alpaca?.deleteProfilePic) { setError("Please update your Alpaca Wallet extension."); return; }
    setError(null); setSuccess(null); setProfilePicSaving(true);
    try {
      await window.alpaca.deleteProfilePic();
      setProfilePic(null);
      localStorage.removeItem(`alpaca_pp_${address}`);
      setSuccess("Profile picture removed.");
    } catch (err: any) {
      setError(err.message || "Failed to remove picture");
    } finally { setProfilePicSaving(false); }
  };

  // --- Profile ---
  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [accountDescription, setAccountDescription] = useState('');
  const [savedDisplayName, setSavedDisplayName] = useState('');
  const [savedFirstName, setSavedFirstName] = useState('');
  const [savedLastName, setSavedLastName] = useState('');
  const [savedDescription, setSavedDescription] = useState('');
  const [savedMetadata, setSavedMetadata] = useState<Record<string, any>>({});
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoSaving, setInfoSaving] = useState(false);
  const [isEditingProfile, setIsEditingProfile] = useState(false);

  const parseMetadata = (raw: string): Record<string, any> => {
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { /* ignore */ }
    try { return JSON.parse(atob(raw)); } catch { /* ignore */ }
    return {};
  };

  const profileCacheKey = `alpaca_profile_${address}_${network}`;
  const usernameCacheKey = `alpaca_username_${address}`;

  const applyProfileData = useCallback((name: string, desc: string, meta: Record<string, any>) => {
    setDisplayName(name);
    setFirstName(meta.firstName || '');
    setLastName(meta.lastName || '');
    setAccountDescription(desc);
    setSavedDisplayName(name);
    setSavedFirstName(meta.firstName || '');
    setSavedLastName(meta.lastName || '');
    setSavedDescription(desc);
    setSavedMetadata(meta);
  }, []);

  const fetchAccountInfo = useCallback(async () => {
    if (!address) return;
    try {
      const cached = localStorage.getItem(profileCacheKey);
      if (cached) {
        const c = JSON.parse(cached);
        applyProfileData(c.name || '', c.description || '', c.meta || {});
        setInfoLoading(false);
      }
    } catch { /* ignore */ }
    try {
      const readClient = await Client.fromNetwork(network as 'main' | 'test');
      const account = lib.Account.fromPublicKeyString(address);
      const state = await (readClient as any).getAccountInfo(account);
      const rawName = (state?.info?.name ?? '').toString();
      const rawDesc = (state?.info?.description ?? '').toString();
      const rawMeta = (state?.info?.metadata ?? '').toString();
      // Merge metadata from all fields — any field might contain JSON from earlier saves
      let meta: Record<string, any> = {};
      for (const raw of [rawMeta, rawName, rawDesc]) {
        if (raw.startsWith('{') || raw.startsWith('ey')) { // JSON or base64
          const parsed = parseMetadata(raw);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            meta = { ...meta, ...parsed };
          }
        }
      }
      // Only use non-JSON strings for name/description
      const name = rawName.startsWith('{') ? (meta.displayName || '') : rawName;
      const desc = rawDesc.startsWith('{') ? '' : rawDesc;
      applyProfileData(name, desc, meta);
      localStorage.setItem(profileCacheKey, JSON.stringify({ name, description: desc, meta }));
    } catch { /* ignore */ }
    finally { setInfoLoading(false); }
  }, [address, network, profileCacheKey, applyProfileData]);

  // --- Username ---
  const [currentUsername, setCurrentUsername] = useState<string | null>(null);
  const [usernameLoading, setUsernameLoading] = useState(true);
  const [usernameAction, setUsernameAction] = useState<'idle' | 'claiming' | 'releasing'>('idle');
  const [desiredUsername, setDesiredUsername] = useState('');
  const [availability, setAvailability] = useState<'available' | 'taken' | 'checking' | 'invalid' | null>(null);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCurrentUsername = useCallback(async () => {
    if (!address) return;
    try {
      const cached = localStorage.getItem(usernameCacheKey);
      if (cached) {
        const c = JSON.parse(cached);
        setCurrentUsername(c.username || null);
        setUsernameLoading(false);
      }
    } catch { /* ignore */ }
    try {
      const res = await fetch(`${USERNAME_RESOLVE_URL}/${encodeURIComponent(address)}`);
      const data = await res.json();
      const username = data.ok && data.username ? data.username : null;
      setCurrentUsername(username);
      localStorage.setItem(usernameCacheKey, JSON.stringify({ username }));
    } catch { setCurrentUsername(null); }
    finally { setUsernameLoading(false); }
  }, [address, usernameCacheKey]);

  // --- KYC ---
  const kycStatus = useKYCStatus(address ?? undefined, network as 'main' | 'test');

  // --- Wallet Info (Security & Preferences) ---
  const [walletInfo, setWalletInfo] = useState<{ accountCount: number; autoLockMinutes: number; extensionVersion: string } | null>(null);
  const [autoLockSaving, setAutoLockSaving] = useState(false);

  const AUTO_LOCK_OPTIONS = [
    { value: 1, label: '1 min' },
    { value: 5, label: '5 min' },
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 60, label: '1 hour' },
    { value: 0, label: 'Never' },
  ];

  const fetchWalletInfo = useCallback(async () => {
    if (!window.alpaca?.getWalletInfo) return;
    try {
      const info = await window.alpaca.getWalletInfo();
      setWalletInfo({ accountCount: info.accountCount, autoLockMinutes: info.autoLockMinutes, extensionVersion: info.extensionVersion });
    } catch { /* ignore — old extension */ }
  }, []);

  const handleAutoLockChange = async (minutes: number) => {
    if (!window.alpaca?.setAutoLock) return;
    setAutoLockSaving(true);
    try {
      await window.alpaca.setAutoLock(minutes);
      setWalletInfo(prev => prev ? { ...prev, autoLockMinutes: minutes } : null);
    } catch (e: any) { setError(e.message || "Failed to update auto-lock"); }
    finally { setAutoLockSaving(false); }
  };

  // --- Paca Collective ---
  const [collectiveStatus, setCollectiveStatus] = useState<{ subscribed: boolean; multiplier?: number; disqualified?: boolean } | null>(null);

  const fetchCollectiveStatus = useCallback(async () => {
    if (!address || !window.alpaca?.signMessage) return;
    try {
      const message = "ALPACA_COLLECTIVE_" + address;
      const result = await window.alpaca.signMessage(message);
      await authReady;
      const fn = httpsCallable(functions, "collectiveStatusCall");
      const res = await fn({ address, message, signature: result.signature });
      const data = res.data as any;
      setCollectiveStatus({ subscribed: !!data.subscribed, multiplier: data.multiplier, disqualified: data.disqualified });
    } catch { setCollectiveStatus(null); }
  }, [address]);

  // --- Contacts ---
  type Contact = { id: string; label: string; address?: any; rail?: string; createdAt?: string; updatedAt?: string };
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [contactSearch, setContactSearch] = useState('');
  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactAddress, setNewContactAddress] = useState('');
  const [contactSaving, setContactSaving] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sendPickerContactId, setSendPickerContactId] = useState<string | null>(null);
  const [sendToken, setSendToken] = useState<any>(null);
  const [sendRecipient, setSendRecipient] = useState<string>('');
  const [tokenPickerSearch, setTokenPickerSearch] = useState('');
  const sendPickerRef = useRef<HTMLDivElement>(null);
  const [tokenSymbolMap, setTokenSymbolMap] = useState<Record<string, string>>({});
  const contactsCacheKey = `alpaca_contacts_${address}_${network}`;

  // Fetch token symbols from Firestore pools (same approach as WalletPage)
  useEffect(() => {
    const fetchSymbols = async () => {
      const cacheKey = `tokenSymbols_${network}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.ts && Date.now() - parsed.ts < 2 * 60 * 1000) {
            setTokenSymbolMap(parsed.data);
            return;
          }
        }
      } catch { /* ignore */ }
      try {
        const poolsCol = network === 'test' ? 'pools_test' : 'pools';
        const q = query(collection(db, poolsCol), where("network", "==", network), limit(500));
        const snap = await getDocs(q);
        const map: Record<string, string> = {};
        snap.forEach(doc => {
          const d = doc.data();
          if (d.pairedToken && d.pairedTokenSymbol) {
            map[d.pairedToken] = d.pairedTokenSymbol;
          }
        });
        setTokenSymbolMap(map);
        localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: map }));
      } catch { /* ignore */ }
    };
    if (network) fetchSymbols();
  }, [network]);

  // Balances with resolved symbols
  const enrichedBalances = useMemo(() =>
    balances.map(b => ({
      ...b,
      symbol: tokenSymbolMap[b.address] || b.symbol,
    })),
    [balances, tokenSymbolMap]
  );

  // Close token picker on outside click
  useEffect(() => {
    if (!sendPickerContactId) return;
    const handler = (e: MouseEvent) => {
      if (sendPickerRef.current && !sendPickerRef.current.contains(e.target as Node)) {
        setSendPickerContactId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sendPickerContactId]);
  const [contactTags, setContactTags] = useState<Record<string, string | null>>({});

  // Resolve Keeta Tags for contacts in background
  const resolveContactTags = useCallback(async (list: Contact[]) => {
    const addresses = list.map(c => getRecipient(c.address)).filter(Boolean);
    if (!addresses.length) return;
    // Load cached tags
    const cacheKey = `alpaca_contact_tags_${address}_${network}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) setContactTags(JSON.parse(cached));
    } catch { /* ignore */ }
    // Resolve fresh (parallel, non-blocking)
    const results: Record<string, string | null> = {};
    await Promise.allSettled(
      addresses.map(async (addr) => {
        try {
          const res = await fetch(`${USERNAME_RESOLVE_URL}/${encodeURIComponent(addr)}`);
          const data = await res.json();
          results[addr] = data.ok && data.username ? data.username : null;
        } catch { results[addr] = null; }
      })
    );
    setContactTags(results);
    localStorage.setItem(cacheKey, JSON.stringify(results));
  }, [address, network]);

  const fetchContacts = useCallback(async () => {
    if (!address || !window.alpaca?.listContacts) { setContactsLoading(false); return; }
    try {
      const cached = localStorage.getItem(contactsCacheKey);
      if (cached) { setContacts(JSON.parse(cached)); setContactsLoading(false); }
    } catch { /* ignore */ }
    try {
      const res = await window.alpaca.listContacts();
      const list = res?.contacts || [];
      setContacts(list);
      localStorage.setItem(contactsCacheKey, JSON.stringify(list));
      resolveContactTags(list);
    } catch { /* ignore */ }
    finally { setContactsLoading(false); }
  }, [address, contactsCacheKey, resolveContactTags]);

  useEffect(() => {
    if (isConnected && address) {
      fetchAccountInfo();
      fetchCurrentUsername();
      fetchContacts();
      fetchCollectiveStatus();
      fetchWalletInfo();
    }
  }, [isConnected, address, network, fetchAccountInfo, fetchCurrentUsername, fetchContacts, fetchCollectiveStatus, fetchWalletInfo]);

  useEffect(() => {
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    setAvailability(null);
    const trimmed = desiredUsername.trim().toLowerCase();
    if (!trimmed) return;
    if (!USERNAME_REGEX.test(trimmed)) { setAvailability('invalid'); return; }
    setAvailability('checking');
    checkTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${USERNAME_RESOLVE_URL}/${encodeURIComponent(trimmed)}`);
        const data = await res.json();
        setAvailability(data.ok ? 'taken' : 'available');
      } catch { setAvailability(null); }
    }, 400);
    return () => { if (checkTimerRef.current) clearTimeout(checkTimerRef.current); };
  }, [desiredUsername]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 5000);
    return () => clearTimeout(t);
  }, [success]);

  // --- Handlers ---
  const handleSaveInfo = async () => {
    if (!window.alpaca?.setAccountInfo) { setError("Please update your Alpaca Wallet extension."); return; }
    setError(null); setSuccess(null); setInfoSaving(true);
    try {
      const meta = { ...savedMetadata, firstName: firstName.trim(), lastName: lastName.trim() };
      await window.alpaca.setAccountInfo(displayName.trim(), accountDescription.trim(), btoa(JSON.stringify(meta)));
      setSavedDisplayName(displayName.trim());
      setSavedFirstName(firstName.trim());
      setSavedLastName(lastName.trim());
      setSavedDescription(accountDescription.trim());
      setSavedMetadata(meta);
      localStorage.setItem(profileCacheKey, JSON.stringify({ name: displayName.trim(), description: accountDescription.trim(), meta }));
      setSuccess("Account info updated on-chain.");
    } catch (e: any) { setError(e.message || "Failed to update account info"); }
    finally { setInfoSaving(false); }
  };

  const handleClaim = async () => {
    if (!window.alpaca?.claimUsername) { setError("Please update your Alpaca Wallet extension."); return; }
    const trimmed = desiredUsername.trim().toLowerCase();
    if (!trimmed || availability !== 'available') return;
    setError(null); setSuccess(null); setUsernameAction('claiming');
    try {
      const result = await window.alpaca.claimUsername(trimmed);
      if (result.ok) {
        setCurrentUsername(result.username);
        setDesiredUsername('');
        localStorage.setItem(usernameCacheKey, JSON.stringify({ username: result.username }));
        setSuccess(`Keeta Tag ${result.username}$keeta.xyz claimed!`);
      }
    } catch (e: any) { setError(e.message || "Failed to claim username"); }
    finally { setUsernameAction('idle'); }
  };

  const handleRelease = async () => {
    if (!window.alpaca?.releaseUsername) { setError("Please update your Alpaca Wallet extension."); return; }
    if (!currentUsername) return;
    setError(null); setSuccess(null); setUsernameAction('releasing');
    try {
      const result = await window.alpaca.releaseUsername();
      if (result.ok) {
        setSuccess(`Keeta Tag ${currentUsername}$keeta.xyz released.`);
        setCurrentUsername(null);
        localStorage.setItem(usernameCacheKey, JSON.stringify({ username: null }));
      }
    } catch (e: any) { setError(e.message || "Failed to release username"); }
    finally { setUsernameAction('idle'); }
  };

  const handleAddContact = async () => {
    if (!window.alpaca?.createContact) { setError("Please update your Alpaca Wallet extension."); return; }
    const label = newContactName.trim();
    const addr = newContactAddress.trim();
    if (!label || !addr) return;
    setError(null); setSuccess(null); setContactSaving(true);
    try {
      const res = await window.alpaca.createContact(label, { recipient: addr });
      const created = res?.contact;
      if (created) {
        const updated = [...contacts, created];
        setContacts(updated);
        localStorage.setItem(contactsCacheKey, JSON.stringify(updated));
      }
      setNewContactName(''); setNewContactAddress(''); setShowAddContact(false);
      setSuccess("Contact added.");
    } catch (e: any) { setError(e.message || "Failed to add contact"); }
    finally { setContactSaving(false); }
  };

  const handleUpdateContact = async () => {
    if (!editingContact || !window.alpaca?.updateContact) return;
    const label = editLabel.trim();
    if (!label) return;
    setError(null); setSuccess(null); setContactSaving(true);
    try {
      const addr = editAddress.trim();
      const res = await window.alpaca.updateContact(editingContact.id, label, addr ? { recipient: addr } : undefined);
      const updatedContact = res?.contact || { ...editingContact, label, address: addr ? { recipient: addr } : editingContact.address };
      const updated = contacts.map(c => c.id === editingContact.id ? updatedContact : c);
      setContacts(updated);
      localStorage.setItem(contactsCacheKey, JSON.stringify(updated));
      setEditingContact(null);
      setSuccess("Contact updated.");
    } catch (e: any) { setError(e.message || "Failed to update contact"); }
    finally { setContactSaving(false); }
  };

  const handleDeleteContact = async (id: string) => {
    if (!window.alpaca?.deleteContact) return;
    setError(null); setDeletingId(id);
    try {
      await window.alpaca.deleteContact(id);
      const updated = contacts.filter(c => c.id !== id);
      setContacts(updated);
      localStorage.setItem(contactsCacheKey, JSON.stringify(updated));
      setSuccess("Contact removed.");
    } catch (e: any) { setError(e.message || "Failed to delete contact"); }
    finally { setDeletingId(null); }
  };

  const startEditContact = (c: Contact) => {
    setEditingContact(c);
    setEditLabel(c.label);
    setEditAddress(getRecipient(c.address));
  };

  const filteredContacts = contacts.filter(c => {
    if (!contactSearch.trim()) return true;
    const q = contactSearch.toLowerCase();
    return c.label.toLowerCase().includes(q) || getRecipient(c.address).toLowerCase().includes(q);
  });

  const infoChanged = displayName.trim() !== savedDisplayName || firstName.trim() !== savedFirstName || lastName.trim() !== savedLastName || accountDescription.trim() !== savedDescription;

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto mt-16 text-center">
        <h1 className="text-[28px] leading-tight font-semibold font-heading tracking-[-0.01em] text-gray-900 dark:text-white mb-2">Account</h1>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-8">Connect your wallet to manage your on-chain identity.</p>
        <Card>
          <div className="flex flex-col items-center gap-3 py-4">
            <svg className="w-10 h-10 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400 text-sm">Connect your Alpaca Wallet extension to get started.</p>
          </div>
        </Card>
      </div>
    );
  }

  // WIP: username claim/release will be wired into the UI
  void usernameAction; void handleClaim; void handleRelease;

  return (
    <div className="max-w-5xl mx-auto mt-8 pb-12 px-4">

      {/* Global feedback */}
      {error && (
        <div className="mb-5 p-3 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 text-sm font-medium rounded-xl border border-red-200 dark:border-red-500/20 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {error}
        </div>
      )}
      {success && (
        <div className="mb-5 p-3 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-sm font-medium rounded-xl border border-emerald-200 dark:border-emerald-500/20 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          {success}
        </div>
      )}

      {/* ═══ Profile Hero — no container, social media style ═══ */}
      <div className="mb-8">
        {infoLoading ? (
          <div className="flex items-center gap-5 py-8">
            <div className="w-28 h-28 rounded-full bg-gray-100 dark:bg-white/[0.04] animate-pulse shrink-0" />
            <div className="space-y-3 flex-1">
              <div className="h-7 w-48 bg-gray-100 dark:bg-white/[0.04] rounded-md animate-pulse" />
              <div className="h-4 w-32 bg-gray-100 dark:bg-white/[0.04] rounded-md animate-pulse" />
              <div className="h-4 w-64 bg-gray-100 dark:bg-white/[0.04] rounded-md animate-pulse" />
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-6">
            {/* Avatar */}
            <div className="shrink-0">
              <div className="relative group">
                {profilePicLoading ? (
                  <div className="w-28 h-28 rounded-full bg-gray-100 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] flex items-center justify-center">
                    <Spinner className="h-5 w-5 text-gray-400" />
                  </div>
                ) : profilePic ? (
                  <img src={profilePic} alt="Profile" className="w-28 h-28 rounded-full object-cover border-2 border-[#845fbc]/30 shadow-sm" />
                ) : (
                  <div className="w-28 h-28 rounded-full bg-[#845fbc]/10 border-2 border-[#845fbc]/20 flex items-center justify-center">
                    <span className="text-4xl font-semibold text-[#845fbc] dark:text-[#a78bfa]">
                      {(displayName || address || '?').charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                {!profilePicLoading && (
                  <button
                    onClick={() => profilePic ? handleDeleteProfilePic() : fileInputRef.current?.click()}
                    disabled={profilePicSaving}
                    className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer disabled:cursor-wait"
                  >
                    {profilePicSaving ? (
                      <Spinner className="h-5 w-5 text-white" />
                    ) : profilePic ? (
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                    ) : (
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" /></svg>
                    )}
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleProfilePicUpload} />
              </div>
            </div>

            {/* Identity info */}
            <div className="flex-1 min-w-0 pt-1">
              {/* Display name + badges */}
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white">
                  {savedDisplayName || 'Anonymous'}
                </h1>
                {currentUsername && (
                  <span className="px-2 py-0.5 rounded-md text-[12px] font-semibold text-[#845fbc] dark:text-[#a78bfa] bg-[#845fbc]/8 dark:bg-[#845fbc]/15">
                    @{currentUsername}$keeta.xyz
                  </span>
                )}
                {kycStatus.verified && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold text-teal-600 dark:text-teal-400 bg-teal-500/10">
                    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Verified
                  </span>
                )}
                {collectiveStatus?.subscribed && (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                    collectiveStatus.disqualified
                      ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
                      : (collectiveStatus.multiplier ?? 1) >= 1.40
                        ? 'text-violet-600 dark:text-violet-400 bg-violet-500/10'
                        : 'text-[#845fbc] dark:text-[#a78bfa] bg-[#845fbc]/10'
                  }`}>
                    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none"><path d="M8 2L9.5 6H14L10.5 9L12 14L8 11L4 14L5.5 9L2 6H6.5L8 2Z" fill="currentColor" /></svg>
                    {collectiveStatus.disqualified ? 'Collective (DQ)' : `Collective ${(collectiveStatus.multiplier ?? 1).toFixed(2)}x`}
                  </span>
                )}
              </div>

              {/* First + Last name */}
              {(savedFirstName || savedLastName) && (
                <div className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">
                  {[savedFirstName, savedLastName].filter(Boolean).join(' ')}
                </div>
              )}

              {/* Wallet address */}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[12px] font-mono text-gray-400 dark:text-gray-500">
                  {address?.slice(0, 14)}...{address?.slice(-6)}
                </span>
                <button onClick={() => { if (address) { navigator.clipboard.writeText(address); setSuccess("Address copied."); } }}
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
                </button>
              </div>

              {/* Bio */}
              {savedDescription && (
                <p className="text-[14px] text-gray-600 dark:text-gray-300 mt-3 max-w-xl leading-relaxed">
                  {savedDescription}
                </p>
              )}

              {/* Edit Profile toggle */}
              <button onClick={() => setIsEditingProfile(!isEditingProfile)}
                className="mt-4 px-3.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors border border-gray-200 dark:border-white/[0.08] text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.04]">
                {isEditingProfile ? 'Cancel Editing' : 'Edit Profile'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ═══ Profile Completeness ═══ */}
      {(() => {
        const steps = [
          { label: 'Profile Picture', done: !!profilePic },
          { label: 'Display Name', done: !!savedDisplayName },
          { label: 'Bio', done: !!savedDescription },
          { label: 'Keeta Tag', done: !!currentUsername },
          { label: 'KYC Verified', done: !!kycStatus.verified },
          { label: 'Contacts', done: contacts.length > 0 },
        ];
        const completed = steps.filter(s => s.done).length;
        const total = steps.length;
        if (completed >= total) return null;
        return (
          <div className="mb-6 px-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">
                Profile Completeness
              </span>
              <span className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">
                {completed}/{total}
              </span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 dark:bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#845fbc] rounded-full transition-all duration-500"
                style={{ width: `${(completed / total) * 100}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-2 mt-2.5">
              {steps.map(s => (
                <span
                  key={s.label}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors ${
                    s.done
                      ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                      : 'text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-white/[0.04]'
                  }`}
                >
                  {s.done ? (
                    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : (
                    <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" /></svg>
                  )}
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ═══ Edit Profile (collapsible) ═══ */}
      {isEditingProfile && (
        <Card className="mb-5">
          <SectionLabel label="Edit Profile" />
          <div className="space-y-3 max-w-xl">
            <div>
              <label className="text-[12px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Display Name</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={64} placeholder="How others see you"
                className="w-full px-3 py-2 rounded-md text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[12px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">First Name</label>
                <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} maxLength={64} placeholder="First name"
                  className="w-full px-3 py-2 rounded-md text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Last Name</label>
                <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} maxLength={64} placeholder="Last name"
                  className="w-full px-3 py-2 rounded-md text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all" />
              </div>
            </div>
            <div>
              <label className="text-[12px] font-medium text-gray-500 dark:text-gray-400 mb-1 block">Bio</label>
              <textarea value={accountDescription} onChange={e => setAccountDescription(e.target.value)} maxLength={256} rows={3} placeholder="Tell others about yourself..."
                className="w-full px-3 py-2 rounded-md text-sm bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all resize-none" />
              <div className="text-right text-[11px] text-gray-400 dark:text-gray-500 -mt-0.5">{accountDescription.length}/256</div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={async () => { await handleSaveInfo(); if (!error) setIsEditingProfile(false); }} disabled={infoSaving || !infoChanged}
                className="px-4 py-2 rounded-md text-[13px] font-semibold transition-colors bg-[#845fbc] hover:bg-[#724bad] text-white disabled:opacity-40 disabled:cursor-not-allowed">
                {infoSaving ? <span className="flex items-center gap-2"><Spinner className="h-4 w-4 text-white" /> Saving...</span> : 'Save to Chain'}
              </button>
              <button onClick={() => { setDisplayName(savedDisplayName); setFirstName(savedFirstName); setLastName(savedLastName); setAccountDescription(savedDescription); setIsEditingProfile(false); }}
                className="px-4 py-2 rounded-md text-[13px] font-semibold transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04]">
                Discard
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ═══ Cards row: Keeta Tag + KYC ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

        {/* Keeta Tag */}
        <Card>
          <SectionLabel label="Keeta Tag" />
          {usernameLoading ? (
            <div className="flex items-center gap-2 text-gray-400 py-2"><Spinner /> <span className="text-sm">Loading...</span></div>
          ) : currentUsername ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-[20px] font-semibold tracking-tight text-gray-900 dark:text-white">{currentUsername}<span className="text-gray-400 dark:text-gray-500">$keeta.xyz</span></div>
                  <div className="text-[12px] text-gray-400 dark:text-gray-500 font-mono mt-0.5">{address?.slice(0, 12)}...{address?.slice(-6)}</div>
                </div>
                <button disabled
                  title="Coming soon — Alpaca tag registry"
                  className="px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors bg-gray-100 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 cursor-not-allowed opacity-50">
                  Release
                </button>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">Release the current tag before claiming a new one.</p>
            </div>
          ) : (
            <div>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-3">Claim a unique tag linked to your wallet.</p>
              <div className="relative mb-2">
                <input type="text" value={desiredUsername} onChange={e => setDesiredUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} maxLength={24} placeholder="your_tag"
                  className={`w-full pl-3 pr-24 py-2 rounded-md text-sm bg-gray-50 dark:bg-white/[0.04] border text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all ${
                    availability === 'available' ? 'border-emerald-400 dark:border-emerald-500' :
                    availability === 'taken' || availability === 'invalid' ? 'border-red-300 dark:border-red-500' :
                    'border-gray-200 dark:border-white/[0.08]'
                  }`} />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  <span className="text-[12px] text-gray-400 dark:text-gray-500 font-medium pointer-events-none">$keeta.xyz</span>
                  {availability === 'checking' && <Spinner className="h-3.5 w-3.5 text-gray-400" />}
                  {availability === 'available' && <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  {availability === 'taken' && <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>}
                </div>
              </div>
              <div className="min-h-[16px] mb-2">
                {availability === 'available' && <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Available</p>}
                {availability === 'taken' && <p className="text-[11px] text-red-500 dark:text-red-400">Already taken</p>}
                {availability === 'invalid' && <p className="text-[11px] text-red-500 dark:text-red-400">2-24 chars: a-z, 0-9, _</p>}
              </div>
              <button disabled
                title="Coming soon — Alpaca tag registry"
                className="px-4 py-2 rounded-md text-[13px] font-semibold transition-colors bg-[#845fbc] text-white opacity-40 cursor-not-allowed">
                Claim Tag
              </button>
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2">Tag claiming is temporarily disabled — Alpaca tag registry coming soon.</p>
            </div>
          )}
        </Card>

        {/* KYC Verification */}
        <Card>
          <SectionLabel label="KYC Verification" />
          {kycStatus.loading ? (
            <div className="flex items-center gap-2 text-gray-400 py-2"><Spinner /> <span className="text-sm">Checking...</span></div>
          ) : kycStatus.verified ? (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-teal-500 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-white" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-teal-700 dark:text-teal-400">Verified</div>
                <div className="mt-1.5 space-y-1">
                  {kycStatus.issuer && <div className="flex items-center gap-2 text-[12px]"><span className="text-gray-400 dark:text-gray-500 w-14 shrink-0">Issuer</span><span className="text-gray-700 dark:text-gray-300 truncate">{kycStatus.issuer}</span></div>}
                  {kycStatus.issuedAt && <div className="flex items-center gap-2 text-[12px]"><span className="text-gray-400 dark:text-gray-500 w-14 shrink-0">Issued</span><span className="text-gray-700 dark:text-gray-300">{new Date(kycStatus.issuedAt).toLocaleDateString()}</span></div>}
                  {kycStatus.validUntil && <div className="flex items-center gap-2 text-[12px]"><span className="text-gray-400 dark:text-gray-500 w-14 shrink-0">Expires</span><span className="text-gray-700 dark:text-gray-300">{new Date(kycStatus.validUntil).toLocaleDateString()}</span></div>}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-white/[0.06] flex items-center justify-center shrink-0">
                <svg className="w-4.5 h-4.5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
              </div>
              <div>
                <div className="text-[14px] font-semibold text-gray-700 dark:text-gray-300">Not Verified</div>
                <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">Get verified via your wallet's KYC sharing feature.</p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ═══ Security & Preferences ═══ */}
      {walletInfo && (
        <Card className="mb-5">
          <SectionLabel label="Security & Preferences" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Extension Version */}
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Extension</div>
              <div className="text-[15px] font-semibold text-gray-900 dark:text-white">v{walletInfo.extensionVersion}</div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">Alpaca Wallet</div>
            </div>

            {/* Wallet Accounts */}
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Accounts</div>
              <div className="text-[15px] font-semibold text-gray-900 dark:text-white">{walletInfo.accountCount}</div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">Derived wallet{walletInfo.accountCount !== 1 ? 's' : ''}</div>
            </div>

            {/* Auto-Lock Timer */}
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Auto-Lock</div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {AUTO_LOCK_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleAutoLockChange(opt.value)}
                    disabled={autoLockSaving}
                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors border ${
                      walletInfo.autoLockMinutes === opt.value
                        ? 'bg-[#845fbc]/10 border-[#845fbc]/30 text-[#845fbc] dark:text-[#a78bfa]'
                        : 'border-gray-200 dark:border-white/[0.08] text-gray-500 dark:text-gray-400 hover:border-[#845fbc]/30 hover:text-[#845fbc] dark:hover:text-[#a78bfa]'
                    } disabled:opacity-50`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ═══ Contacts — full width ═══ */}
      <Card className="!p-0 overflow-visible">
        <div className="p-6 pb-0">
          <div className="flex items-center justify-between mb-4">
            <div>
              <SectionLabel label="Contacts" />
              <p className="text-[13px] text-gray-500 dark:text-gray-400 -mt-1">Encrypted address book synced across your devices.</p>
            </div>
            <button onClick={() => { setShowAddContact(true); setEditingContact(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors bg-[#845fbc] hover:bg-[#724bad] text-white shrink-0">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              Add
            </button>
          </div>

          {contacts.length > 3 && (
            <div className="relative mb-4">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8" /><path strokeLinecap="round" d="m21 21-4.35-4.35" /></svg>
              <input type="text" value={contactSearch} onChange={e => setContactSearch(e.target.value)} placeholder="Search contacts..."
                className="w-full pl-9 pr-3 py-2 rounded-md text-[13px] bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all" />
            </div>
          )}
        </div>

        {/* Add / Edit form */}
        {(showAddContact || editingContact) && (
          <div className="mx-6 mb-4 p-4 rounded-xl bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.06]">
            <div className="text-[12px] font-semibold text-gray-600 dark:text-gray-300 mb-3">{editingContact ? 'Edit Contact' : 'New Contact'}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input type="text" value={editingContact ? editLabel : newContactName} onChange={e => editingContact ? setEditLabel(e.target.value) : setNewContactName(e.target.value)} placeholder="Name" maxLength={64}
                className="w-full px-3 py-2 rounded-md text-[13px] bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all" />
              <input type="text" value={editingContact ? editAddress : newContactAddress} onChange={e => editingContact ? setEditAddress(e.target.value) : setNewContactAddress(e.target.value)} placeholder="Wallet address (keeta_...)"
                className="w-full px-3 py-2 rounded-md text-[13px] font-mono bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all" />
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button onClick={editingContact ? handleUpdateContact : handleAddContact} disabled={contactSaving || (editingContact ? !editLabel.trim() : !newContactName.trim() || !newContactAddress.trim())}
                className="px-3.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors bg-[#845fbc] hover:bg-[#724bad] text-white disabled:opacity-40 disabled:cursor-not-allowed">
                {contactSaving ? <span className="flex items-center gap-1.5"><Spinner className="h-3.5 w-3.5 text-white" /> Saving...</span> : editingContact ? 'Update' : 'Save'}
              </button>
              <button onClick={() => { setShowAddContact(false); setEditingContact(null); setNewContactName(''); setNewContactAddress(''); }}
                className="px-3.5 py-1.5 rounded-md text-[12px] font-semibold transition-colors text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04]">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Contact list */}
        {contactsLoading ? (
          <div className="flex items-center justify-center gap-2 text-gray-400 py-10">
            <Spinner /> <span className="text-sm">Loading contacts...</span>
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6">
            <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-white/[0.04] flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
            </div>
            <p className="text-[14px] font-semibold text-gray-700 dark:text-gray-300 mb-1">No contacts yet</p>
            <p className="text-[13px] text-gray-400 dark:text-gray-500 text-center max-w-xs">Add your first contact to build your encrypted address book.</p>
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="text-center py-8 px-6">
            <p className="text-[13px] text-gray-400 dark:text-gray-500">No contacts matching "{contactSearch}"</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 divide-gray-100 dark:divide-white/[0.04]">
            {filteredContacts.map((c) => {
              const recipient = getRecipient(c.address);
              const isDeleting = deletingId === c.id;
              const color = contactColor(c.id + c.label);
              const tag = recipient ? contactTags[recipient] : null;
              return (
                <div key={c.id}
                  className="group flex items-center gap-3.5 px-6 py-3.5 hover:bg-gray-50 dark:hover:bg-white/[0.02] transition-colors border-b sm:border-b-0 sm:border-r border-gray-100 dark:border-white/[0.04] last:border-0">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-[13px] font-semibold shrink-0" style={{ backgroundColor: color }}>
                    {c.label.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold text-gray-900 dark:text-white truncate">{c.label}</span>
                      {tag && (
                        <span className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-[#845fbc] dark:text-[#a78bfa] bg-[#845fbc]/8 dark:bg-[#845fbc]/15 shrink-0">
                          {tag}$keeta.xyz
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-gray-400 dark:text-gray-500 font-mono truncate mt-0.5">
                      {recipient ? `${recipient.slice(0, 12)}...${recipient.slice(-6)}` : 'No address'}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {/* Send */}
                    <div className="relative">
                      <button onClick={() => { setSendPickerContactId(sendPickerContactId === c.id ? null : c.id); setTokenPickerSearch(''); }}
                        className="p-1.5 rounded-md hover:bg-[#845fbc]/10 text-gray-400 hover:text-[#845fbc] dark:hover:text-[#a78bfa] transition-colors" title="Send tokens">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                      </button>
                      {sendPickerContactId === c.id && (
                        <div ref={sendPickerRef}
                          className="absolute right-0 top-full mt-1 z-[70] w-60 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] shadow-lg">
                          <div className="px-3 pt-2.5 pb-1.5 text-[10px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">
                            Send to {c.label}
                          </div>
                          {enrichedBalances.length > 3 && (
                            <div className="px-2.5 pb-1.5">
                              <input type="text" value={tokenPickerSearch} onChange={e => setTokenPickerSearch(e.target.value)}
                                placeholder="Search token..." autoFocus
                                className="w-full px-2.5 py-1.5 rounded-md text-[12px] bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all" />
                            </div>
                          )}
                          <div className="max-h-56 overflow-y-auto py-1">
                            {enrichedBalances.length === 0 ? (
                              <div className="px-3 py-3 text-[12px] text-gray-400 dark:text-gray-500 text-center">No tokens in wallet</div>
                            ) : (() => {
                              const q = tokenPickerSearch.toLowerCase().trim();
                              const filtered = enrichedBalances.filter(b => parseFloat(b.amount) > 0).filter(b =>
                                !q || b.symbol.toLowerCase().includes(q) || b.address.toLowerCase().includes(q)
                              );
                              return filtered.length === 0 ? (
                                <div className="px-3 py-3 text-[12px] text-gray-400 dark:text-gray-500 text-center">No matching tokens</div>
                              ) : filtered.map(b => (
                                <button key={b.address}
                                  onClick={() => {
                                    setSendPickerContactId(null);
                                    setSendRecipient(recipient);
                                    setSendToken({ address: b.address, symbol: b.symbol, decimals: b.decimals, amount: b.amount, rawBalance: b.rawBalance });
                                  }}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors text-left">
                                  <TokenLogo address={b.address} symbol={b.symbol} network={network} className="w-6 h-6" />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-[13px] font-semibold text-gray-900 dark:text-white">{b.symbol}</div>
                                    <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">{b.amount}</div>
                                  </div>
                                </button>
                              ));
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Copy */}
                    <button onClick={() => { navigator.clipboard.writeText(recipient); setSuccess("Address copied."); }}
                      className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Copy address">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" /></svg>
                    </button>
                    {/* Edit */}
                    <button onClick={() => { startEditContact(c); setShowAddContact(false); }}
                      className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-white/[0.06] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Edit">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                    </button>
                    {/* Delete */}
                    <button onClick={() => handleDeleteContact(c.id)} disabled={isDeleting}
                      className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-500/10 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors disabled:opacity-40" title="Delete">
                      {isDeleting ? <Spinner className="w-3.5 h-3.5 text-red-400" /> : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {contacts.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-100 dark:border-white/[0.04] bg-gray-50 dark:bg-white/[0.02]">
            <span className="text-[11px] text-gray-400 dark:text-gray-500 font-medium">
              {contacts.length} contact{contacts.length !== 1 ? 's' : ''}
              {contactSearch && filteredContacts.length !== contacts.length && ` (${filteredContacts.length} shown)`}
            </span>
          </div>
        )}
      </Card>

      {/* Send Modal — opened from contact token picker */}
      <SendModal
        isOpen={!!sendToken}
        onClose={() => { setSendToken(null); setSendRecipient(''); }}
        token={sendToken}
        initialRecipient={sendRecipient}
      />
    </div>
  );
};

export default AccountPage;

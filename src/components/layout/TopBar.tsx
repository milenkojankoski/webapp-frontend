import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useWallet } from '../../context/WalletContext';
import { useTheme } from '../common/ThemeContext';
import { Client, lib } from '@keetanetwork/keetanet-client';

// --- Route → Page Title mapping ---
const PAGE_TITLES: Record<string, string> = {
  '/': 'Market Overview',
  '/wallet': 'Wallet',
  '/account': 'Account',
  '/token-details': 'Token Details',
  '/liquidity': 'Liquidity',
  '/launchpad/sandbox': 'PacaLaunch',
  '/launchpad/create': 'Create Token',
  '/converter': 'Convert',
  '/bridge': 'Bridge',
  '/collective': 'Alpaca Collective',
  '/alpametric': 'AlpaMetric',
  '/finance/overview': 'Finance',
  '/rwa': 'Real World Assets',
  '/admin': 'Admin',
};

function usePageTitle(): string {
  const { pathname } = useLocation();
  // Exact match first
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  // Prefix match for nested routes
  const match = Object.entries(PAGE_TITLES)
    .filter(([k]) => k !== '/' && pathname.startsWith(k))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return match ? match[1] : '';
}

interface TopBarProps {
  onMobileMenuToggle?: () => void;
  isMobileMenuOpen?: boolean;
}

const TopBar: React.FC<TopBarProps> = ({ onMobileMenuToggle, isMobileMenuOpen }) => {
  const { isConnected, address, network, setNetwork, logout } = useWallet();
  const { isDarkMode, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const pageTitle = usePageTitle();

  // --- Profile dropdown state ---
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // --- Profile Picture ---
  const [profilePic, setProfilePic] = useState<string | null>(null);

  useEffect(() => {
    if (!isConnected || !address) { setProfilePic(null); return; }
    const cacheKey = `alpaca_pp_${address}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) setProfilePic(cached);
    if (!window.alpaca?.getProfilePic) return;
    window.alpaca.getProfilePic(address).then((res) => {
      if (res?.hasIcon && res.dataUrl) {
        setProfilePic(res.dataUrl);
        localStorage.setItem(cacheKey, res.dataUrl);
      } else {
        setProfilePic(null);
        localStorage.removeItem(cacheKey);
      }
    }).catch(() => {});
  }, [isConnected, address]);

  // --- On-chain profile info ---
  const [displayName, setDisplayName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');

  const parseMetadata = (raw: string): Record<string, any> => {
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { /* ignore */ }
    try { return JSON.parse(atob(raw)); } catch { /* ignore */ }
    return {};
  };

  const fetchProfileInfo = useCallback(async () => {
    if (!address || !network) return;
    const cacheKey = `alpaca_profile_${address}_${network}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const c = JSON.parse(cached);
        setDisplayName(c.name || '');
        setFirstName(c.meta?.firstName || '');
        setLastName(c.meta?.lastName || '');
        return;
      }
    } catch { /* ignore */ }
    try {
      const readClient = await Client.fromNetwork(network as 'main' | 'test');
      const account = lib.Account.fromPublicKeyString(address);
      const state = await (readClient as any).getAccountInfo(account);
      const rawName = (state?.info?.name ?? '').toString();
      const rawMeta = (state?.info?.metadata ?? '').toString();
      let meta: Record<string, any> = {};
      for (const raw of [rawName, rawMeta]) {
        if (raw.startsWith('{') || raw.startsWith('ey')) {
          const parsed = parseMetadata(raw);
          if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
            meta = { ...meta, ...parsed };
          }
        }
      }
      const name = rawName.startsWith('{') ? (meta.displayName || '') : rawName;
      setDisplayName(name);
      setFirstName(meta.firstName || '');
      setLastName(meta.lastName || '');
    } catch { /* ignore */ }
  }, [address, network]);

  useEffect(() => {
    if (isConnected && address) fetchProfileInfo();
    if (!isConnected) { setDisplayName(''); setFirstName(''); setLastName(''); }
  }, [isConnected, address, network, fetchProfileInfo]);

  // --- Close dropdown on outside click ---
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // --- Copy address ---
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const formatAddress = (addr: string) => `${addr.substring(0, 10)}...${addr.substring(addr.length - 6)}`;
  const fullName = [firstName, lastName].filter(Boolean).join(' ');

  return (
    <div className="sticky top-0 z-30 flex items-center justify-between h-12 px-4 md:px-6 bg-gray-50/80 dark:bg-[#121212]/80 backdrop-blur-md border-b border-gray-200/60 dark:border-white/[0.06]">

      {/* Left: Mobile hamburger + Page title */}
      <div className="flex items-center gap-3">
        {/* Mobile hamburger */}
        <button
          onClick={onMobileMenuToggle}
          className="md:hidden p-1.5 -ml-1 rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
        >
          {isMobileMenuOpen ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>

        {/* Page title */}
        {pageTitle && (
          <h1 className="text-[14px] font-semibold text-gray-800 dark:text-gray-200 tracking-tight">
            {pageTitle}
          </h1>
        )}
      </div>

      {/* Right: Controls cluster */}
      <div className="flex items-center gap-2">

        {/* Network pill */}
        <div className="flex p-0.5 bg-gray-100 dark:bg-white/[0.06] rounded-md border border-gray-200/80 dark:border-white/[0.06]">
          <button
            onClick={() => setNetwork('main')}
            className={`px-2.5 py-0.5 text-[11px] font-semibold rounded transition-all ${
              network === 'main'
                ? 'bg-white dark:bg-white/[0.12] text-[#845fbc] shadow-sm'
                : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
            }`}
          >
            Mainnet
          </button>
          <button
            onClick={() => setNetwork('test')}
            className={`px-2.5 py-0.5 text-[11px] font-semibold rounded transition-all ${
              network === 'test'
                ? 'bg-white dark:bg-white/[0.12] text-[#845fbc] shadow-sm'
                : 'text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300'
            }`}
          >
            Testnet
          </button>
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.06] transition-colors"
          title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDarkMode ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
            </svg>
          )}
        </button>

        {/* Profile avatar + dropdown */}
        {isConnected && (
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setOpen(!open)}
              className="w-7 h-7 rounded-full overflow-hidden border border-gray-200 dark:border-white/[0.1] hover:border-[#845fbc]/40 transition-colors focus:outline-none focus:ring-2 focus:ring-[#845fbc]/30"
            >
              {profilePic ? (
                <img src={profilePic} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-[#845fbc]/15 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-[#845fbc] dark:text-[#a78bfa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
              )}
            </button>

            {/* Dropdown */}
            {open && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] shadow-lg z-50 overflow-hidden">
                {/* Profile header */}
                <div className="px-5 pt-5 pb-4">
                  <div className="mb-3">
                    {profilePic ? (
                      <img src={profilePic} alt="" className="w-11 h-11 rounded-full object-cover border border-gray-200 dark:border-white/[0.08]" />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-[#845fbc]/15 border border-gray-200 dark:border-white/[0.08] flex items-center justify-center">
                        <svg className="w-5 h-5 text-[#845fbc] dark:text-[#a78bfa]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                    )}
                  </div>

                  {(displayName || fullName) && (
                    <div className="text-[15px] font-semibold text-gray-900 dark:text-white leading-snug">
                      {displayName || fullName}
                    </div>
                  )}
                  {displayName && fullName && (
                    <div className="text-[13px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {fullName}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span className="text-[12px] font-mono text-gray-400 dark:text-gray-500">
                      {formatAddress(address!)}
                    </span>
                    <button
                      onClick={handleCopy}
                      className="text-gray-400 hover:text-[#845fbc] dark:text-gray-500 dark:hover:text-[#a78bfa] transition-colors"
                      title="Copy address"
                    >
                      {copied ? (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="border-t border-gray-100 dark:border-white/[0.06]" />

                <div className="py-1.5">
                  <DropdownItem
                    label="Wallet"
                    onClick={() => { setOpen(false); navigate('/wallet'); }}
                    icon={<path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />}
                  />
                  <DropdownItem
                    label="Account"
                    onClick={() => { setOpen(false); navigate('/account'); }}
                    icon={<path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />}
                  />
                  <DropdownItem
                    label="Privacy"
                    onClick={() => { setOpen(false); window.open('https://docs.alpacadex.com/legal/privacy', '_blank'); }}
                    icon={<path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />}
                    external
                  />
                </div>

                <div className="border-t border-gray-100 dark:border-white/[0.06]" />

                <div className="py-1.5">
                  <DropdownItem
                    label="Disconnect"
                    onClick={() => { setOpen(false); logout(); }}
                    icon={<path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />}
                    danger
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DropdownItem: React.FC<{
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  external?: boolean;
  danger?: boolean;
}> = ({ label, onClick, icon, external, danger }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center justify-between px-5 py-2 text-[13px] transition-colors ${
      danger
        ? 'text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/[0.06]'
        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.03]'
    }`}
  >
    <div className="flex items-center gap-2.5">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        {icon}
      </svg>
      <span>{label}</span>
    </div>
    {external && (
      <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
      </svg>
    )}
  </button>
);

export default TopBar;

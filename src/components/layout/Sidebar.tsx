import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useWallet } from '../../context/WalletContext';

// --- HELPER COMPONENTS ---

const SocialLink: React.FC<{ href: string; icon: React.ReactNode }> = ({ href, icon }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="text-gray-400 hover:text-[#845fbc] dark:text-gray-500 dark:hover:text-[#a78bfa] transition-colors duration-200"
  >
    {icon}
  </a>
);

const SectionLabel: React.FC<{ label: string }> = ({ label }) => (
  <div className="px-3 pb-1 pt-4 text-[10px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">
    {label}
  </div>
);

const SectionDivider: React.FC = () => (
  <div className="mx-3 my-1.5 border-t border-gray-100 dark:border-white/[0.06]" />
);

const NavItem: React.FC<{ to: string; icon: React.ReactNode; label: string; onClick?: () => void }> = ({ to, icon, label, onClick }) => {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      end={to === '/'}
      className={({ isActive }) =>
        [
          'group relative flex items-center gap-2.5 px-3 py-[5px] rounded-md',
          'text-[13px] transition-colors',
          isActive
            ? 'font-semibold text-gray-900 dark:text-white'
            : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100/60 dark:text-gray-400 dark:hover:text-white dark:hover:bg-white/[0.04]',
        ].join(' ')
      }
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              aria-hidden
              className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r bg-[#845fbc]"
            />
          )}
          <span className="flex items-center justify-center shrink-0 w-4 h-4 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>
          <span className="truncate">{label}</span>
        </>
      )}
    </NavLink>
  );
};

const SidebarSearch: React.FC<{ onSearch?: () => void }> = ({ onSearch }) => {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/token-details?q=${encodeURIComponent(query.trim())}`);
      setQuery("");
      if (onSearch) onSearch();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="px-3 mb-2">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Address / ID..."
          className="w-full pl-8 pr-3 py-1.5 text-[13px] text-gray-500 bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 focus:bg-white transition-all placeholder-gray-400 dark:bg-white/[0.04] dark:border-white/[0.08] dark:text-gray-200 dark:placeholder-gray-500 dark:focus:bg-white/[0.06]"
        />
        <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
          <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>
    </form>
  );
};

// --- SIDEBAR CONTENT ---
interface SidebarContentProps {
  onLinkClick?: () => void;
}

const SidebarContent: React.FC<SidebarContentProps> = ({ onLinkClick }) => {
  const { isConnected, address, connectToExtension } = useWallet();
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [keetaTag, setKeetaTag] = useState<string | null>(null);

  const formatAddress = (addr: string) => {
    if (!addr) return "";
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  };

  // Fetch profile picture from extension
  useEffect(() => {
    if (!isConnected || !address || !window.alpaca?.getProfilePic) return;
    const cacheKey = `alpaca_pp_${address}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) setProfilePic(cached);
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

  // Fetch Keeta Tag
  useEffect(() => {
    if (!isConnected || !address) { setKeetaTag(null); return; }
    const cacheKey = `alpaca_tag_${address}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) setKeetaTag(cached);
    fetch(`https://usernames.keeta.xyz/api/resolve/${encodeURIComponent(address)}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok && data.username) {
          setKeetaTag(data.username);
          localStorage.setItem(cacheKey, data.username);
        } else {
          setKeetaTag(null);
          localStorage.removeItem(cacheKey);
        }
      })
      .catch(() => {});
  }, [isConnected, address]);

  return (
    <div className="flex flex-col h-full bg-white border-r border-gray-200 dark:bg-[#1a1a1a] dark:border-white/[0.08] transition-colors duration-300">

      {/* LOGO AREA */}
      <div className="px-5 pt-5 pb-4 flex items-baseline gap-2">
        <img
          src="/Alpaca-DEX-Icon.png"
          alt="AlpacaDex Logo"
          className="w-7 h-7 rounded-lg object-contain relative top-[2px]"
        />
        <span className="text-[19px] font-semibold tracking-tight text-gray-900 dark:text-white">
          Alpaca
        </span>
        <span className="text-[10px] uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500 font-medium">
          v1.3
        </span>
      </div>

      {/* CONNECT WALLET */}
      <div className="px-3 mb-3">
        {isConnected ? (
          <NavLink
            to="/wallet"
            onClick={onLinkClick}
            className="w-full py-2 px-3 rounded-md bg-[#845fbc]/10 border border-[#845fbc]/20 flex items-center gap-2.5 hover:bg-[#845fbc]/15 transition-colors"
          >
            {profilePic ? (
              <img src={profilePic} alt="" className="w-8 h-8 rounded-full object-cover border border-[#845fbc]/30 shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#845fbc]/20 border border-[#845fbc]/30 flex items-center justify-center shrink-0">
                <span className="text-sm font-semibold text-[#845fbc] dark:text-[#a78bfa]">
                  {(address || '?').charAt(6)?.toUpperCase() || '?'}
                </span>
              </div>
            )}
            <div className="min-w-0">
              {keetaTag ? (
                <div className="text-[13px] font-semibold text-gray-900 dark:text-white truncate">{keetaTag}<span className="text-gray-400 dark:text-gray-500 font-normal">$keeta.xyz</span></div>
              ) : (
                <div className="text-[13px] font-mono font-semibold text-gray-900 dark:text-white truncate">{formatAddress(address!)}</div>
              )}
            </div>
          </NavLink>
        ) : (
          <button
            onClick={() => connectToExtension()}
            className="w-full py-2 px-3 rounded-md font-semibold transition-all duration-200 flex items-center justify-center gap-2 text-[13px] bg-gray-900 text-gray-300 hover:bg-gray-800 hover:text-white dark:bg-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.12]"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
            <span>Connect Wallet</span>
          </button>
        )}
      </div>

      <SidebarSearch onSearch={onLinkClick} />

      {/* Navigation Links — 3 consolidated sections */}
      <nav className="flex-1 overflow-y-auto px-3 scrollbar-thin">

        {/* EXPLORE */}
        <SectionLabel label="Explore" />
        <ul className="flex flex-col">
          <li>
            <NavItem
              to="/"
              label="Market Overview"
              onClick={onLinkClick}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              }
            />
          </li>
          <li>
            <NavItem
              to="/launchpad/sandbox"
              label="PacaLaunch"
              onClick={onLinkClick}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
                </svg>
              }
            />
          </li>
          <li>
            <NavItem
              to="/liquidity"
              label="Liquidity"
              onClick={onLinkClick}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                </svg>
              }
            />
          </li>
        </ul>

        <SectionDivider />

        {/* TOOLS */}
        <SectionLabel label="Tools" />
        <ul className="flex flex-col">
          <li>
            <NavItem
              to="/converter"
              label="Convert"
              onClick={onLinkClick}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              }
            />
          </li>
          <li>
            <NavItem
              to="/bridge"
              label="Bridge"
              onClick={onLinkClick}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
              }
            />
          </li>
          <li>
            <NavItem
              to="/finance/overview"
              label="Finance"
              onClick={onLinkClick}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 0 0-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 0 1-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 0 0 3 15h-.75M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm3 0h.008v.008H18V10.5Zm-12 0h.008v.008H6V10.5Z" />
                </svg>
              }
            />
          </li>
        </ul>

        <SectionDivider />

        {/* COMMUNITY */}
        <SectionLabel label="Community" />
        <ul className="flex flex-col">
          <li>
            <NavItem
              to="/collective"
              label="Alpaca Collective"
              onClick={onLinkClick}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M 9.25 8 L 9.5 6 L 12.5 6 L 13.5 2 L 14.5 6 H 16.5 C 18.5 6 19.5 7 19.5 9 C 19.5 11 18.5 12 16.5 12 L 15.5 13 V 22" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M 15 8.5 h 0.01" strokeWidth={2.5} />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M 6.5 22 V 13 L 4.5 9 L 7.5 9 L 8.5 5 L 9.5 9 H 11.5 C 13.5 9 14.5 10 14.5 12 C 14.5 14 13.5 15 11.5 15 L 10.5 16 V 22" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M 9.5 11.5 h 0.01" strokeWidth={2.5} />
                </svg>
              }
            />
          </li>
          <li>
            <NavItem
              to="/alpametric"
              label="AlpaMetric"
              onClick={onLinkClick}
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v18h18" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
                </svg>
              }
            />
          </li>
        </ul>
      </nav>

      {/* Footer — social links only */}
      <div className="px-3 py-3 border-t border-gray-100 dark:border-white/[0.06]">
        <div className="flex items-center justify-between px-2">
          <SocialLink href="https://alpacadex.com" icon={<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A8.966 8.966 0 013 12c0-1.257.26-2.453.727-3.418" /></svg>} />
          <SocialLink href="https://x.com/AlpacaDex" icon={<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>} />
          <SocialLink href="https://discord.com/invite/kCfyemmDK8" icon={<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.419 0 1.334-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.419 0 1.334-.946 2.419-2.157 2.419z" /></svg>} />
          <SocialLink href="https://docs.alpacadex.com" icon={<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>} />
          <SocialLink href="https://apps.apple.com/us/app/alpaca-wallet/id6754289633" icon={<svg viewBox="0 0 384 512" width="14" height="14" fill="currentColor"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 52.3-11.4 69.5-34.3z" /></svg>} />
          <NavLink to="/android" className="text-gray-400 hover:text-[#845fbc] dark:text-gray-500 dark:hover:text-[#a78bfa] transition-colors duration-200"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A5.84 5.84 0 0012 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31A5.983 5.983 0 006 7h12c0-2.21-1.2-4.15-2.97-5.19-.01-.01 0-.35-.5.35zM10 5H9V4h1v1zm5 0h-1V4h1v1z" /></svg></NavLink>
        </div>
      </div>
    </div>
  );
};

// --- MAIN COMPONENT (WRAPPER) ---
interface SidebarProps {
  isMobileMenuOpen: boolean;
  onMobileMenuClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isMobileMenuOpen, onMobileMenuClose }) => {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-[248px] h-screen bg-white dark:bg-[#1a1a1a] fixed left-0 top-0 z-50">
        <SidebarContent />
      </aside>

      {/* Mobile Menu Overlay */}
      <div className={`md:hidden fixed inset-0 z-40 transition-opacity duration-300 ${isMobileMenuOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onMobileMenuClose}
        />

        {/* Sidebar Panel */}
        <div className={`absolute top-0 left-0 h-full w-[280px] bg-white dark:bg-[#1a1a1a] shadow-xl transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <SidebarContent onLinkClick={onMobileMenuClose} />
        </div>
      </div>
    </>
  );
};

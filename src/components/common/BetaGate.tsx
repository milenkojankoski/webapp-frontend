import React, { useEffect, useState } from 'react';
import { useWallet } from '../../context/WalletContext';
import { getTesterAccounts } from '../../config/firebase';

interface BetaGateProps {
  children: React.ReactNode;
  featureName?: string;
}

export const BetaGate: React.FC<BetaGateProps> = ({ children, featureName = 'This feature' }) => {
  const { address } = useWallet();
  const [access, setAccess] = useState<'loading' | 'granted' | 'denied'>('loading');

  useEffect(() => {
    let cancelled = false;
    getTesterAccounts().then(testers => {
      if (cancelled) return;
      if (address && testers.includes(address)) {
        setAccess('granted');
      } else {
        setAccess('denied');
      }
    });
    return () => { cancelled = true; };
  }, [address]);

  if (access === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-5 h-5 border-2 border-[#845fbc] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (access === 'granted') return <>{children}</>;

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-[#845fbc]/10 flex items-center justify-center mb-5">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 text-[#845fbc]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.84-3.38a1 1 0 010-1.72l5.84-3.38a1 1 0 011.16 0l5.84 3.38a1 1 0 010 1.72l-5.84 3.38a1 1 0 01-1.16 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 7.5l8.25 4.77 8.25-4.77M12 21.75V12.27" />
          </svg>
        </div>
        <h2 className="text-[22px] font-semibold tracking-tight text-gray-900 dark:text-white mb-2">
          Coming Soon
        </h2>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-4">
          {featureName} is currently in private beta and will be available to everyone shortly.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-50 dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#845fbc] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#845fbc]" />
          </span>
          <span className="text-[13px] font-medium text-gray-600 dark:text-gray-300">Under active development</span>
        </div>
      </div>
    </div>
  );
};

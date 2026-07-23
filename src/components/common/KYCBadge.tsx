import React, { useState, useEffect } from "react";
import { getKYCStatus, type KYCStatus } from "../../services/certificate";

/**
 * Hook to fetch KYC status for a creator address.
 * Returns { verified, issuer, validUntil, issuedAt, loading }.
 */
export function useKYCStatus(creatorAddress: string | undefined, network: "main" | "test") {
  const [status, setStatus] = useState<KYCStatus & { loading: boolean }>({
    verified: false,
    loading: !!creatorAddress,
  });

  useEffect(() => {
    if (!creatorAddress) {
      setStatus({ verified: false, loading: false });
      return;
    }

    let cancelled = false;
    setStatus(prev => ({ ...prev, loading: true }));

    getKYCStatus(creatorAddress, network).then(result => {
      if (!cancelled) setStatus({ ...result, loading: false });
    });

    return () => { cancelled = true; };
  }, [creatorAddress, network]);

  return status;
}

/**
 * Small checkmark badge overlay for token logos.
 * Renders a green circle with white checkmark at bottom-right of the parent.
 * Parent must have `relative` positioning.
 */
export const KYCCheckmark: React.FC<{ size?: number }> = ({ size = 14 }) => (
  <div
    className="absolute -bottom-0.5 -left-1 bg-teal-500 rounded-full flex items-center justify-center border-2 border-white dark:border-[#1e1e1e] z-10"
    style={{ width: size, height: size }}
    title="Creator KYC Verified"
  >
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className="text-white"
      style={{ width: size * 0.6, height: size * 0.6 }}
    >
      <path
        d="M3 8.5L6.5 12L13 4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </div>
);

/**
 * Inline KYC verified badge for detail panels.
 */
export const KYCVerifiedBadge: React.FC<{
  issuer?: string;
  validUntil?: string;
  issuedAt?: string;
  compact?: boolean;
}> = ({ issuer, validUntil, issuedAt, compact = false }) => {
  const validDate = validUntil ? new Date(validUntil) : null;
  const issuedDate = issuedAt ? new Date(issuedAt) : null;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 border border-teal-200/50 dark:border-teal-800/50">
        <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none">
          <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        KYC
      </span>
    );
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-800/30">
      <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0 mt-0.5">
        <svg className="w-4 h-4 text-white" viewBox="0 0 16 16" fill="none">
          <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold text-teal-700 dark:text-teal-400">Creator KYC Verified</div>
        {issuer && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">Issuer: {issuer}</div>
        )}
        <div className="flex gap-3 mt-1 text-[10px] text-gray-400 dark:text-gray-500">
          {issuedDate && <span>Issued: {issuedDate.toLocaleDateString()}</span>}
          {validDate && <span>Expires: {validDate.toLocaleDateString()}</span>}
        </div>
      </div>
    </div>
  );
};

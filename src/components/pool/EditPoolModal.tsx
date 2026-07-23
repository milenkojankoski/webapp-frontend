import React, { useState, useEffect } from "react";
import type { PoolData } from "../../types";
import { updatePool } from "../../services/pool";
import type { Network } from "../../services/pool";

interface EditPoolModalProps {
  pool: PoolData;
  onClose: () => void;
  onSaved: () => void;
}

export const EditPoolModal: React.FC<EditPoolModalProps> = ({ pool, onClose, onSaved }) => {
  const [description, setDescription] = useState(pool.description || "");
  const [website, setWebsite] = useState(pool.website || "");
  const [xAccount, setXAccount] = useState(pool.xAccount || "");
  const [discord, setDiscord] = useState(pool.discord || "");
  const [burnRate, setBurnRate] = useState(String((pool.liquidityFeeTokenBurnRate ?? 0) * 100));
  const [creatorFee, setCreatorFee] = useState(String((pool.creatorFee ?? 0) * 100));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const burnRateNum = parseFloat(burnRate) / 100;
      const creatorFeeNum = parseFloat(creatorFee) / 100;

      if (isNaN(burnRateNum) || burnRateNum < 0 || burnRateNum > 1) {
        throw new Error("Token Burn Rate must be between 0% and 100%");
      }
      if (isNaN(creatorFeeNum) || creatorFeeNum < 0 || creatorFeeNum > 0.05) {
        throw new Error("Creator Fee must be between 0% and 5%");
      }

      const result = await updatePool({
        poolId: pool.poolId,
        network: (pool.network || "main") as Network,
        liquidityFeeTokenBurnRate: burnRateNum,
        creatorFee: creatorFeeNum,
        description,
        website,
        xAccount,
        discord,
      });

      if (!result.updated) {
        throw new Error(result.error || "Failed to update pool");
      }

      setSuccess(true);
      setTimeout(() => {
        onSaved();
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-lg bg-white dark:bg-[#1a1a1a] rounded-xl border border-gray-200 dark:border-white/[0.08] shadow-xl overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/[0.08] flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-gray-900 dark:text-white">
            Edit {pool.pairedTokenSymbol} Pool
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Description */}
          <div>
            <label className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md text-[13px] py-2 px-3 border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 outline-none resize-none"
            />
          </div>

          {/* Website */}
          <div>
            <label className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1.5">Website</label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded-md text-[13px] py-2 px-3 border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 outline-none"
            />
          </div>

          {/* X / Twitter */}
          <div>
            <label className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1.5">X / Twitter</label>
            <input
              type="text"
              value={xAccount}
              onChange={(e) => setXAccount(e.target.value)}
              placeholder="@handle or full URL"
              className="w-full rounded-md text-[13px] py-2 px-3 border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 outline-none"
            />
          </div>

          {/* Discord */}
          <div>
            <label className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1.5">Discord</label>
            <input
              type="text"
              value={discord}
              onChange={(e) => setDiscord(e.target.value)}
              placeholder="Invite link or server ID"
              className="w-full rounded-md text-[13px] py-2 px-3 border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 outline-none"
            />
          </div>

          {/* Fee fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1.5">Token Burn Rate</label>
              <div className="relative">
                <input
                  type="number"
                  value={burnRate}
                  onChange={(e) => setBurnRate(e.target.value)}
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-full rounded-md text-[13px] py-2 px-3 pr-8 border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[13px]">%</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">% of liquidity fee used to burn paired token</p>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1.5">Creator Fee</label>
              <div className="relative">
                <input
                  type="number"
                  value={creatorFee}
                  onChange={(e) => setCreatorFee(e.target.value)}
                  min="0"
                  max="5"
                  step="0.1"
                  className="w-full rounded-md text-[13px] py-2 px-3 pr-8 border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 outline-none"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-[13px]">%</span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">Per-trade fee sent to creator wallet (0-5%)</p>
            </div>
          </div>

          {/* Error / Success */}
          {error && (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 text-red-600 dark:text-red-400 text-[13px]">
              {error}
            </div>
          )}
          {success && (
            <div className="p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 text-emerald-600 dark:text-emerald-400 text-[13px]">
              Pool updated successfully!
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 dark:border-white/[0.08] flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md text-[13px] font-semibold text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/[0.04] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || success}
            className="px-5 py-2 rounded-md text-[13px] font-semibold bg-[#845fbc] hover:bg-[#724bad] text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Signing..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

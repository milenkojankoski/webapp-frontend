import React, { useState, useReducer, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ref, uploadBytes } from "firebase/storage";
import { useWallet } from "../../context/WalletContext";
import {
  createPool,
  activatePool,
  getFundraisePreview,
  BASE_TOKEN,
  type PoolMode,
  type BondingCurve,
  type CreatePoolRequest,
  type FundraisePreviewResponse,
} from "../../services/pool";
import { storage } from "../../config/firebase";
import { formatAmount18, formatNumber, formatCurrency, parseRawAmount } from "../../utils/formatters";
import { PriceChart, type ChartDataPoint } from "../charts/BondingCurveChart";
import { calculateSpotPrice } from "../../utils/launchpadMath";

// ─── Form state ─────────────────────────────────────────────────────────────

interface FormState {
  // Step 1 — Token metadata
  name: string;
  symbol: string;
  description: string;
  website: string;
  xAccount: string;
  discord: string;
  // Step 2 — Launch configuration
  mode: PoolMode;
  supply: string;
  publicAllocation: string;
  liquidityFee: string;
  creatorFee: string;
  liquidityFeeTokenBurnRate: string;
  // Fundraise-specific
  liquidityGoal: string;
  teamGoal: string;
  curve: BondingCurve;
  listingPremiumPercentage: string;
  endDate: string; // datetime-local string (YYYY-MM-DDTHH:mm)
  launchThreshold: string;
  // Liquidity-specific
  initialLiquidityAmount: string;
}

type FormAction =
  | { type: "SET_FIELD"; field: keyof FormState; value: string }
  | { type: "SET_MODE"; mode: PoolMode };

const initialState: FormState = {
  name: "",
  symbol: "",
  description: "",
  website: "",
  xAccount: "",
  discord: "",
  mode: "provideLiquidity",
  supply: "1000000000",
  publicAllocation: "80",
  liquidityFee: "0.3",
  creatorFee: "0",
  liquidityFeeTokenBurnRate: "0",
  liquidityGoal: "3000",
  teamGoal: "0",
  curve: "sigmoid",
  listingPremiumPercentage: "20",
  endDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
  launchThreshold: "50",
  initialLiquidityAmount: "100",
};

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "SET_MODE":
      return { ...state, mode: action.mode };
    default:
      return state;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function addCommas(v: string): string {
  const [int, frac] = v.split(".");
  const formatted = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${formatted}.${frac}` : formatted;
}

function stripCommas(v: string): string {
  return v.replace(/,/g, "");
}

function toRaw(humanAmount: string, decimals: number): string {
  try {
    const parts = humanAmount.split(".");
    const intPart = parts[0] || "0";
    const fracPart = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
    return BigInt(intPart + fracPart).toString();
  } catch {
    return "0";
  }
}

/** Rescale all raw-amount strings in a preview from one decimal precision to another. */
function rescalePreview(
  prev: FundraisePreviewResponse,
  targetDecimals: number,
  sourceDecimals: number = 18,
): FundraisePreviewResponse {
  if (sourceDecimals === targetDecimals) return prev;
  const factor = BigInt(10) ** BigInt(Math.abs(sourceDecimals - targetDecimals));
  const rescale = (v: string): string => {
    try {
      return sourceDecimals > targetDecimals
        ? (BigInt(v) / factor).toString()
        : (BigInt(v) * factor).toString();
    } catch { return v; }
  };
  return {
    ...prev,
    fundraiseSupply: rescale(prev.fundraiseSupply),
    poolSupply: rescale(prev.poolSupply),
    startPrice: rescale(prev.startPrice),
    finalSalePrice: rescale(prev.finalSalePrice),
    listingPrice: rescale(prev.listingPrice),
    avgPrice: rescale(prev.avgPrice),
    expectedTotalRaise: rescale(prev.expectedTotalRaise),
    teamFunds: rescale(prev.teamFunds),
    platformFee: rescale(prev.platformFee),
    platformTokenSupplyAmount: rescale(prev.platformTokenSupplyAmount),
    liquidityGoalMet: rescale(prev.liquidityGoalMet),
    listingMarketCap: rescale(prev.listingMarketCap),
    listingLiquidity: rescale(prev.listingLiquidity),
  };
}

const IMAGE_SIZES = [
  { name: "tiny", width: 48, height: 48, quality: 1.0 },
  { name: "small", width: 150, height: 150, quality: 1.0 },
  { name: "web", width: 124, height: 124, quality: 0.7 },
  { name: "big", width: 540, height: 540, quality: 1.0 },
];

function resizeImage(file: File, width: number, height: number, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not supported"));
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Failed to resize image"))),
        "image/jpeg",
        quality
      );
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Failed to load image"));
    };
    img.src = URL.createObjectURL(file);
  });
}

async function uploadTokenImages(file: File, tokenAddress: string, network: "main" | "test") {
  const prefix = network === "main" ? "keetaMain" : "keetaTest";
  for (const size of IMAGE_SIZES) {
    const blob = await resizeImage(file, size.width, size.height, size.quality);
    const storageRef = ref(storage, `${prefix}_${tokenAddress}_${size.name}.jpeg`);
    await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
  }
}

// ─── Section wrapper ────────────────────────────────────────────────────────

const SectionCard: React.FC<{
  number: number;
  title: string;
  enabled: boolean;
  complete: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ number, title, enabled, complete, children, className = "" }) => (
  <div className={`rounded-xl border transition-all duration-300 ${
    enabled
      ? "bg-white/80 dark:bg-[#1a1a1a]/80 border-gray-200/50 dark:border-white/[0.08]"
      : "bg-gray-50/50 dark:bg-white/[0.01] border-gray-200/30 dark:border-white/[0.04] opacity-40 pointer-events-none select-none"
  } ${className}`}>
    <div className="flex items-center gap-3 px-6 pt-5 pb-4 border-b border-gray-100 dark:border-white/[0.04]">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
        complete
          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
          : enabled
            ? "bg-[#845fbc] text-white"
            : "bg-gray-100 dark:bg-white/[0.04] text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-white/[0.08]"
      }`}>
        {complete ? "✓" : number}
      </div>
      <h2 className={`text-[15px] font-semibold transition-colors ${
        enabled ? "text-gray-900 dark:text-white" : "text-gray-400 dark:text-gray-500"
      }`}>
        {title}
      </h2>
    </div>
    <div className="p-6 md:p-8">{children}</div>
  </div>
);

// ─── Shared input component ─────────────────────────────────────────────────

const Field: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  required?: boolean;
  suffix?: string;
  hint?: string;
  numeric?: boolean;
  onBlur?: () => void;
}> = ({ label, value, onChange, onBlur, placeholder, type = "text", required, suffix, hint, numeric }) => (
  <div className="group">
    <label className="block text-[13px] font-medium text-gray-600 dark:text-gray-400 mb-1.5 transition-colors group-focus-within:text-[#845fbc] dark:group-focus-within:text-[#b794f4]">
      {label}
      {required && <span className="text-rose-500 ml-1.5">*</span>}
    </label>
    <div className="relative">
      <input
        type={type}
        value={numeric ? addCommas(value) : value}
        onChange={(e) => onChange(numeric ? stripCommas(e.target.value) : e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className="w-full px-4 py-3 bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.08] rounded-md text-gray-800 dark:text-white text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 placeholder-gray-400 dark:placeholder-gray-500 transition-all"
      />
      {suffix && (
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-gray-400 dark:text-gray-500">
          {suffix}
        </span>
      )}
    </div>
    {hint && <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">{hint}</p>}
  </div>
);

// ─── Small helper components ────────────────────────────────────────────────

const SummarySection: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="p-5 rounded-xl bg-white/50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.08]">
    <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#845fbc] dark:text-[#b794f4] mb-4 flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-[#845fbc]"></span>
      {title}
    </h3>
    <div className="space-y-3">{children}</div>
  </div>
);

const SummaryRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between text-sm items-center">
    <span className="text-gray-500 dark:text-gray-400 font-medium">{label}</span>
    <span className="text-gray-900 dark:text-white font-semibold">{value}</span>
  </div>
);

// ─── Main form component ────────────────────────────────────────────────────

export const CreatePoolForm: React.FC = () => {
  const navigate = useNavigate();
  const { isConnected, address, network, connectToExtension, balances } = useWallet();
  const [form, dispatch] = useReducer(formReducer, initialState);
  const [preview, setPreview] = useState<FundraisePreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [tokenImage, setTokenImage] = useState<File | null>(null);
  const [tokenImagePreview, setTokenImagePreview] = useState<string | null>(null);
  const tokenImageInputRef = useRef<HTMLInputElement>(null);
  const [imageDragging, setImageDragging] = useState(false);

  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const baseToken = BASE_TOKEN[network];

  const ktaBalance = useMemo(() => {
    const entry = balances.find((b) => b.address === baseToken.address);
    return entry ? parseFloat(entry.amount) : 0;
  }, [balances, baseToken.address]);
  const maxLiquidity = Math.max(ktaBalance - 1, 0);

  // Derived: Launch Supply = Total Supply * (Public Allocation / 100)
  const launchKontingent = useMemo(() => {
    const supply = parseFloat(form.supply) || 0;
    const alloc = parseFloat(form.publicAllocation) || 0;
    return String(Math.floor(supply * (alloc / 100)));
  }, [form.supply, form.publicAllocation]);

  const set = useCallback(
    (field: keyof FormState) => (value: string) =>
      dispatch({ type: "SET_FIELD", field, value }),
    []
  );

  const handleImageSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTokenImage(file);
    const url = URL.createObjectURL(file);
    setTokenImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  const removeImage = useCallback(() => {
    setTokenImage(null);
    setTokenImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (tokenImageInputRef.current) tokenImageInputRef.current.value = "";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setImageDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    setTokenImage(file);
    const url = URL.createObjectURL(file);
    setTokenImagePreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, []);

  // ─── Fundraise preview (debounced) ──────────────────────────────────────

  const fetchPreview = useCallback(async () => {
    if (form.mode !== "fundRaising") return;
    // Preview backend always operates in 18-decimal precision (no decimals param sent)
    const PREVIEW_DECIMALS = 18;
    const rawSupply = toRaw(form.supply, PREVIEW_DECIMALS);
    const rawLaunchK = toRaw(launchKontingent, PREVIEW_DECIMALS);
    const rawLiqGoal = toRaw(form.liquidityGoal, PREVIEW_DECIMALS);
    const rawTeamGoal = toRaw(form.teamGoal, PREVIEW_DECIMALS);

    if (!rawSupply || rawSupply === "0" || !rawLaunchK || rawLaunchK === "0" || !rawLiqGoal || rawLiqGoal === "0") return;

    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await getFundraisePreview(
        {
          launchKontingent: rawLaunchK,
          totalSupply: rawSupply,
          liquidityGoal: rawLiqGoal,
          teamGoal: rawTeamGoal,
          bondingCurve: form.curve,
          listingPremiumPercentage: parseFloat(form.listingPremiumPercentage) / 100,
        },
      );
      if (result.error) {
        setPreviewError(result.error);
        setPreview(null);
      } else {
        setPreview(result);
      }
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed");
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [form, baseToken]);

  useEffect(() => {
    if (form.mode !== "fundRaising") return;
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(fetchPreview, 800);
    return () => clearTimeout(previewTimer.current);
  }, [
    form.mode, form.supply, launchKontingent,
    form.liquidityGoal, form.teamGoal, form.curve,
    form.listingPremiumPercentage, fetchPreview,
  ]);

  // ─── Chart data from preview ────────────────────────────────────────────

  const PREVIEW_DEC = 18;
  const PREVIEW_SCALE = 10 ** PREVIEW_DEC;

  const previewParsed = useMemo(() => {
    if (!preview) return null;
    return {
      fundraiseSupply: parseRawAmount(preview.fundraiseSupply, PREVIEW_DEC),
      poolSupply: parseRawAmount(preview.poolSupply, PREVIEW_DEC),
      startPrice: parseRawAmount(preview.startPrice, PREVIEW_DEC),
      listingPrice: parseRawAmount(preview.listingPrice, PREVIEW_DEC),
      expectedTotalRaise: parseRawAmount(preview.expectedTotalRaise, PREVIEW_DEC),
      listingMarketCap: parseRawAmount(preview.listingMarketCap, PREVIEW_DEC),
      teamFunds: parseRawAmount(preview.teamFunds, PREVIEW_DEC),
      platformFee: parseRawAmount(preview.platformFee, PREVIEW_DEC),
      liquidityGoalMet: parseRawAmount(preview.liquidityGoalMet, PREVIEW_DEC),
      liquidityRatio: preview.liquidityRatio,
    };
  }, [preview]);

  const chartData = useMemo((): ChartDataPoint[] => {
    if (!previewParsed || previewParsed.fundraiseSupply <= 0) return [];
    const { fundraiseSupply, startPrice, expectedTotalRaise } = previewParsed;
    const points = 100;
    const data: ChartDataPoint[] = [];
    for (let i = 0; i <= points; i++) {
      const progress = i / points;
      const tokensSold = fundraiseSupply * progress;
      let price = startPrice;
      try {
        const priceBig = calculateSpotPrice(
          form.curve,
          BigInt(Math.floor(startPrice * PREVIEW_SCALE)),
          BigInt(Math.floor(expectedTotalRaise)),
          BigInt(Math.floor(fundraiseSupply)),
          BigInt(Math.floor(tokensSold)),
          PREVIEW_DEC,
        );
        price = Number(priceBig) / PREVIEW_SCALE;
      } catch { /* fallback to startPrice */ }
      data.push({ tokensSold, price });
    }
    return data;
  }, [previewParsed, form.curve]);

  // ─── Validation ─────────────────────────────────────────────────────────

  const step1Valid = form.name.trim().length > 0 && form.symbol.trim().length > 0 && tokenImage !== null;

  const step2Valid =
    parseFloat(form.supply) > 0 &&
    (form.mode === "provideLiquidity"
      ? parseFloat(form.initialLiquidityAmount) > 0
      : preview !== null && !previewError);

  // ─── Create & activate flow ─────────────────────────────────────────────

  const handleCreate = async () => {
    if (!window.alpaca) {
      setCreateError("Alpaca wallet extension not detected. Please install it and refresh.");
      return;
    }

    if (!isConnected || !address) {
      setCreateError("Please connect your wallet first.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    setStatusMessage(null);

    try {
      // 1. Create pool via cloud function
      setStatusMessage("Creating pool...");
      const rawSupply = toRaw(form.supply, baseToken.decimals);
      const rawLaunchK = toRaw(launchKontingent, baseToken.decimals);
      const rawLiqGoal = toRaw(form.liquidityGoal, baseToken.decimals);
      const rawTeamGoal = toRaw(form.teamGoal, baseToken.decimals);

      const createReq: CreatePoolRequest = {
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        description: form.description.trim(),
        supply: rawSupply,
        network,
        creator: address,
        liquidityFee: parseFloat(form.liquidityFee) / 100,
        creatorFee: parseFloat(form.creatorFee) / 100,
        creatorSupplyOwnership: (100 - parseFloat(form.publicAllocation)) / 100,
        liquidityFeeTokenBurnRate: parseFloat(form.liquidityFeeTokenBurnRate) / 100,
        version: 1,
        baseToken: baseToken.address,
        baseTokenSymbol: baseToken.symbol,
        baseTokenName: baseToken.name,
        baseTokenDecimals: baseToken.decimals,
        mode: form.mode,
        fundRaise:
          form.mode === "fundRaising"
            ? {
              launchKontingent: rawLaunchK,
              liquidityGoal: rawLiqGoal,
              teamGoal: rawTeamGoal,
              duration: Math.max(Math.floor((new Date(form.endDate).getTime() - Date.now()) / 1000), 3 * 86400),
              curve: form.curve,
              listingPremiumPercentage: parseFloat(form.listingPremiumPercentage) / 100,
              launchThreshold: parseFloat(form.launchThreshold) / 100,
            }
            : null,
        fundraisePreview: form.mode === "fundRaising" && preview
          ? rescalePreview(preview, baseToken.decimals)
          : null,
        website: form.website.trim(),
        xAccount: form.xAccount.trim(),
        discord: form.discord.trim(),
      };

      const pool = await createPool(createReq);

      // 2. Sign fee block via wallet extension
      setStatusMessage("Sign the fee transaction in your wallet...");
      const feeResult = await window.alpaca.signTransaction({
        type: "FUND",
        params: {
          to: pool.feeAccount,
          token: baseToken.address,
          amount: pool.platformSetupFee,
          network,
        },
      });

      if (typeof feeResult === "string") {
        throw new Error("Unexpected wallet response format. Please update your Alpaca extension.");
      }

      // 3. Sign liquidity block (liquidity mode only)
      let liquidityResult: { base64: string; hash: string } | null = null;
      if (form.mode === "provideLiquidity") {
        setStatusMessage("Sign the liquidity transaction in your wallet...");
        const rawLiquidity = toRaw(form.initialLiquidityAmount, baseToken.decimals);
        const liqResult = await window.alpaca.signTransaction({
          type: "FUND",
          params: {
            to: pool.address,
            token: baseToken.address,
            amount: rawLiquidity,
            network,
            previous: feeResult.hash,
          },
        });
        if (typeof liqResult === "string") {
          throw new Error("Unexpected wallet response format. Please update your Alpaca extension.");
        }
        liquidityResult = liqResult;
      }

      // 4. Activate pool via cloud function
      setStatusMessage("Activating pool...");
      const activation = await activatePool(
        {
          poolId: pool.id,
          network,
          feeBlock: feeResult.base64,
          liquidityBlock: liquidityResult?.base64 ?? null,
        },
      );

      if (!activation.activated) {
        throw new Error(activation.error || "Pool activation failed");
      }

      // 5. Upload token image if provided
      if (tokenImage && activation.pairedToken) {
        setStatusMessage("Uploading token image...");
        try {
          await uploadTokenImages(tokenImage, activation.pairedToken, network);
        } catch (imgErr) {
          console.error("Image upload failed:", imgErr);
          // Don't block navigation — pool was created successfully
        }
      }

      // 6. Navigate to pool
      navigate(`/token-details?q=${pool.id}`);
    } catch (err) {
      console.error("Create pool error:", err);
      setCreateError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
      setStatusMessage(null);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center animate-fade-in">
        {/* Illustration */}
        <div className="relative mb-8 group">
          <div className="relative bg-white dark:bg-[#1a1a1a] p-8 rounded-xl shadow-xl border border-gray-200 dark:border-white/[0.08] transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-16 h-16 text-[#845fbc] dark:text-[#a78bfa] animate-bounce-slow">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
        </div>

        <h1 className="text-[28px] font-semibold tracking-[-0.01em] text-gray-800 dark:text-gray-200 mb-3">
          Create Token & Pool
        </h1>

        <p className="text-lg text-gray-500 dark:text-gray-400 max-w-md mb-8">
          Connect your wallet to launch a new token on the Keeta ecosystem.
        </p>

        <button
          onClick={() => connectToExtension()}
          className="inline-flex items-center gap-2 px-6 py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md shadow-sm transition-all duration-300"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col items-center gap-5 pb-16">

      {/* ─── SECTION 1: Token Info ─── */}
      <SectionCard number={1} title="Token Info" enabled={true} complete={step1Valid} className="w-full max-w-7xl">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left column — Core fields */}
          <div className="lg:col-span-4 space-y-4">
            <Field label="Token Name" value={form.name} onChange={set("name")} placeholder="e.g. Alpaca Gold" required />
            <Field label="Token Symbol" value={form.symbol} onChange={set("symbol")} placeholder="e.g. AGLD" required />
            <Field label="Description" value={form.description} onChange={set("description")} placeholder="A brief description of your token" />
          </div>

          {/* Middle column — Links */}
          <div className="lg:col-span-4 space-y-4">
            <Field label="Website" value={form.website} onChange={set("website")} placeholder="https://..." />
            <Field label="X (Twitter) Account" value={form.xAccount} onChange={set("xAccount")} placeholder="x.com/alpacadex" />
            <Field label="Discord" value={form.discord} onChange={set("discord")} placeholder="https://discord.gg/..." />
          </div>

          {/* Right column — Token Image (drag & drop) */}
          <div className="lg:col-span-4">
            <label className="block text-[13px] font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              Token Image<span className="text-rose-500 ml-1.5">*</span>
            </label>
            <input
              ref={tokenImageInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              className="hidden"
            />
            <div
              onDragOver={(e) => { e.preventDefault(); setImageDragging(true); }}
              onDragLeave={() => setImageDragging(false)}
              onDrop={handleDrop}
              onClick={() => !tokenImagePreview && tokenImageInputRef.current?.click()}
              className={`relative rounded-xl border-2 border-dashed transition-all duration-200 ${
                tokenImagePreview
                  ? "border-[#845fbc]/20 bg-gray-50/50 dark:bg-white/[0.01] p-4"
                  : imageDragging
                    ? "border-[#845fbc] bg-[#845fbc]/5 dark:bg-[#845fbc]/10 p-6 cursor-pointer"
                    : "border-gray-300 dark:border-white/[0.08] hover:border-[#845fbc] hover:bg-gray-50/50 dark:hover:bg-white/[0.01] p-6 cursor-pointer"
              }`}
            >
              {tokenImagePreview ? (
                <div className="flex items-center gap-4">
                  <img
                    src={tokenImagePreview}
                    alt="Token preview"
                    className="w-20 h-20 rounded-full object-cover border-2 border-[#845fbc]/30 flex-shrink-0"
                  />
                  <div className="flex flex-col gap-1.5 min-w-0">
                    <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate">{tokenImage?.name}</p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); tokenImageInputRef.current?.click(); }}
                        className="text-[12px] text-[#845fbc] hover:text-[#9b75d6] font-medium transition"
                      >
                        Change
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeImage(); }}
                        className="text-[12px] text-red-400 hover:text-red-300 font-medium transition"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className={`w-8 h-8 transition-colors ${imageDragging ? "text-[#845fbc]" : "text-gray-400 dark:text-gray-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <div>
                    <p className={`text-[13px] font-medium transition-colors ${imageDragging ? "text-[#845fbc]" : "text-gray-600 dark:text-gray-400"}`}>
                      {imageDragging ? "Drop image here" : "Drag & drop or click to upload"}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">Square image recommended</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ─── SECTION 2: Launch Configuration ─── */}
      <div className={`w-full max-w-7xl transition-all duration-300 ${!step1Valid ? "opacity-40 pointer-events-none select-none" : ""}`}>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Left — Inputs */}
          <div className="lg:col-span-4 flex flex-col">
            <SectionCard number={2} title="Launch Configuration" enabled={step1Valid} complete={step1Valid && step2Valid} className="flex-grow flex flex-col [&>div:last-child]:flex-grow [&>div:last-child]:flex [&>div:last-child]:flex-col">
              <div className="space-y-4 flex-grow flex flex-col">
                {/* Mode toggle */}
                <div>
                  <label className="block text-[13px] font-medium text-gray-600 dark:text-gray-400 mb-2">Launch Mode</label>
                  <div className="flex bg-gray-200/50 dark:bg-[#121212] rounded-md p-1 border border-gray-200 dark:border-white/[0.08]">
                    <button
                      onClick={() => dispatch({ type: "SET_MODE", mode: "fundRaising" })}
                      className={`flex-1 px-4 py-2.5 text-sm font-bold rounded-md transition-all duration-300 ${form.mode === "fundRaising" ? "bg-white dark:bg-white/[0.04] text-[#845fbc] dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                    >
                      Fundraise
                    </button>
                    <button
                      onClick={() => dispatch({ type: "SET_MODE", mode: "provideLiquidity" })}
                      className={`flex-1 px-4 py-2.5 text-sm font-bold rounded-md transition-all duration-300 ${form.mode === "provideLiquidity" ? "bg-white dark:bg-white/[0.04] text-[#845fbc] dark:text-white shadow-sm" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                        }`}
                    >
                      Provide Liquidity
                    </button>
                  </div>
                </div>

                {/* Common fields */}
                <Field label="Total Supply" value={form.supply} onChange={set("supply")} placeholder="1000000000" hint="Total number of tokens to create" numeric />
                <Field label="Public Allocation" value={form.publicAllocation} onChange={set("publicAllocation")} suffix="%" hint="Percentage of total supply available to the public (0-100)" numeric />
                <Field label="Liquidity Fee" value={form.liquidityFee} onChange={set("liquidityFee")} suffix="%" hint="Fee charged on each trade (0-100)" numeric />
                <Field label="Creator Fee" value={form.creatorFee} onChange={set("creatorFee")} suffix="%" hint="Per-trade fee sent to creator wallet (0-5%)" numeric />
                <Field label="Token Burn Rate" value={form.liquidityFeeTokenBurnRate} onChange={set("liquidityFeeTokenBurnRate")} suffix="%" hint="Percentage of fee used to burn paired token (0-100)" numeric />

                {/* Divider */}
                <div className="border-t border-gray-100 dark:border-white/[0.04] my-1" />

                {/* Fundraise fields */}
                {form.mode === "fundRaising" && (
                  <>
                    <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#845fbc] dark:text-[#b794f4] flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#845fbc]"></span>
                      Fundraise Settings
                    </h3>
                    <div>
                      <label className="block text-[13px] font-medium text-gray-600 dark:text-gray-400 mb-1.5">Launch Supply</label>
                      <div className="w-full px-4 py-3 bg-gray-100/60 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.08] rounded-md text-gray-800 dark:text-white text-sm font-medium font-mono">
                        {Number(launchKontingent).toLocaleString()}
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">Calculated from Total Supply &times; Public Allocation</p>
                    </div>
                    <Field
                      label="Liquidity Pool Goal"
                      value={form.liquidityGoal}
                      onChange={set("liquidityGoal")}
                      onBlur={() => {
                        const val = parseFloat(form.liquidityGoal);
                        if (isNaN(val) || val < 3000) {
                          set("liquidityGoal")("3000");
                        }
                      }}
                      suffix={baseToken.symbol}
                      hint="Target base token liquidity for the pool (min 3,000)"
                      numeric
                    />
                    <Field label="Team Goal" value={form.teamGoal} onChange={set("teamGoal")} suffix={baseToken.symbol} hint="Additional funds for the team (optional)" numeric />

                    <div>
                      <label className="block text-[13px] font-medium text-gray-600 dark:text-gray-400 mb-2">Bonding Curve</label>
                      <div className="flex gap-2.5">
                        {([
                          {
                            value: "fixed" as BondingCurve, label: "Static", icon: (
                              <svg viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-5 h-3.5">
                                <line x1="2" y1="8" x2="22" y2="8" />
                              </svg>
                            )
                          },
                          {
                            value: "sigmoid" as BondingCurve, label: "Balanced", icon: (
                              <svg viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-5 h-3.5">
                                <path d="M2 14 C6 14, 8 2, 12 2 S18 14, 22 2" />
                              </svg>
                            )
                          },
                          {
                            value: "exponential" as BondingCurve, label: "Rapid", icon: (
                              <svg viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="w-5 h-3.5">
                                <path d="M2 14 Q10 13, 16 8 T22 1" />
                              </svg>
                            )
                          },
                        ]).map((c) => (
                          <button
                            key={c.value}
                            onClick={() => dispatch({ type: "SET_FIELD", field: "curve", value: c.value })}
                            className={`flex-1 px-3 py-2.5 text-sm font-semibold rounded-md border transition-all duration-300 flex items-center justify-center gap-2 ${form.curve === c.value
                              ? "border-[#845fbc] bg-[#845fbc]/10 text-[#845fbc] dark:text-[#b794f4] shadow-sm"
                              : "border-gray-200 dark:border-white/[0.08] bg-white/40 dark:bg-white/[0.02] text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600"
                              }`}
                          >
                            {c.icon}
                            {c.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <Field label="Listing Premium" value={form.listingPremiumPercentage} onChange={set("listingPremiumPercentage")} suffix="%" hint="Price premium at DEX listing vs final sale price" numeric />

                    {/* End Date & Time picker */}
                    <div className="group">
                      <label className="block text-[13px] font-medium text-gray-600 dark:text-gray-400 mb-1.5 transition-colors group-focus-within:text-[#845fbc] dark:group-focus-within:text-[#b794f4]">
                        End Date & Time
                      </label>
                      <input
                        type="datetime-local"
                        value={form.endDate}
                        min={new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16)}
                        onChange={(e) => set("endDate")(e.target.value)}
                        className="w-full px-4 py-3 bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/[0.08] rounded-md text-gray-800 dark:text-white text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-all [color-scheme:dark]"
                      />
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5">When the fundraise ends (minimum 3 days from now)</p>
                    </div>

                    <Field label="Launch Threshold" value={form.launchThreshold} onChange={set("launchThreshold")} suffix="%" hint="Minimum percentage of goal required to launch" numeric />
                  </>
                )}

                {/* Liquidity fields */}
                {form.mode === "provideLiquidity" && (
                  <>
                    <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#845fbc] dark:text-[#b794f4] flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#845fbc]"></span>
                      Liquidity Settings
                    </h3>
                    <Field
                      label="Initial Liquidity"
                      value={form.initialLiquidityAmount}
                      onChange={(v) => {
                        const num = parseFloat(v);
                        if (!isNaN(num) && num > maxLiquidity) {
                          set("initialLiquidityAmount")(String(maxLiquidity));
                        } else {
                          set("initialLiquidityAmount")(v);
                        }
                      }}
                      suffix={baseToken.symbol}
                      hint={`Max ${addCommas(maxLiquidity.toFixed(2))} ${baseToken.symbol} (wallet balance minus 1 ${baseToken.symbol} for fees)`}
                      numeric
                    />
                  </>
                )}
              </div>
            </SectionCard>
          </div>

          {/* Right — Fundraise Preview */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            {form.mode === "fundRaising" && (
              <>
                {/* HUD cards */}
                <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] px-4 py-3 rounded-xl shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Liquidity Goal</p>
                    <p className="text-[18px] font-semibold tracking-tight mt-0.5 text-gray-900 dark:text-white">{formatCurrency(parseFloat(form.liquidityGoal))}</p>
                  </div>
                  <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] px-4 py-3 rounded-xl shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Total Raise</p>
                    <p className="text-[18px] font-semibold tracking-tight mt-0.5 text-gray-900 dark:text-white">{previewParsed ? formatCurrency(previewParsed.expectedTotalRaise) : '—'}</p>
                  </div>
                  <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] px-4 py-3 rounded-xl shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Listing Price</p>
                    <p className="text-[18px] font-semibold tracking-tight text-[#14b8a6] mt-0.5">{previewParsed ? `${previewParsed.listingPrice.toFixed(6)} ${baseToken.symbol}` : '—'}</p>
                  </div>
                  <div className="bg-white dark:bg-[#1a1a1a] border border-[#845fbc]/20 dark:border-white/[0.08] px-4 py-3 rounded-xl ring-1 ring-[#845fbc]/10 shadow-sm">
                    <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Listing MCap</p>
                    <p className="text-[18px] font-semibold tracking-tight text-[#845fbc] mt-0.5">{previewParsed ? formatCurrency(previewParsed.listingMarketCap) : '—'}</p>
                  </div>
                </div>

                {/* Chart */}
                <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-4 rounded-xl flex flex-col flex-grow min-h-[250px]">
                  <div className="flex justify-between items-center mb-3">
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-[#845fbc]"></span>Bonding Curve Simulation</h2>
                    <span className="px-3 py-1 bg-gray-100 dark:bg-white/5 rounded-md text-[10px] text-gray-500 border border-gray-200 dark:border-white/[0.06]">
                      {previewLoading ? 'Calculating...' : 'Real-time Preview'}
                    </span>
                  </div>
                  <div className="flex-grow w-full relative">
                    {previewLoading && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex items-center gap-3 text-sm text-[#845fbc] font-medium animate-pulse">
                          <div className="w-5 h-5 rounded-full border-2 border-[#845fbc]/30 border-t-[#845fbc] animate-spin"></div>
                          Calculating optimal trajectory...
                        </div>
                      </div>
                    )}
                    {previewError && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-sm font-medium text-rose-500 bg-rose-500/10 p-3 rounded-lg border border-rose-500/20">{previewError}</p>
                      </div>
                    )}
                    {chartData.length > 0 && !previewError && (
                      <PriceChart data={chartData} curveType={form.curve} listingPrice={previewParsed!.listingPrice} />
                    )}
                    {!previewLoading && !preview && !previewError && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 italic">Configure launch settings to simulate outcome.</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stats Grid */}
                {previewParsed && !previewError && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] px-4 py-3 rounded-xl shadow-sm">
                      <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2">Token Distribution</h3>
                      <div className="space-y-1.5 font-mono text-xs">
                        <div className="flex justify-between items-center text-gray-600 dark:text-white/80"><span>Launch (Sale)</span><span className="text-gray-900 dark:text-white font-bold">{formatNumber(previewParsed.fundraiseSupply)}</span></div>
                        <div className="flex justify-between items-center text-gray-600 dark:text-white/80"><span>Liquidity (Pool)</span><span className="text-gray-900 dark:text-white font-bold">{formatNumber(previewParsed.poolSupply)}</span></div>
                      </div>
                    </div>
                    <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] px-4 py-3 rounded-xl shadow-sm">
                      <h3 className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2">Cash Flow</h3>
                      <div className="space-y-1.5 font-mono text-xs">
                        <div className="flex justify-between items-center"><span className="text-gray-600 dark:text-gray-400">Team Payout</span><span className="text-[#845fbc] font-bold">{formatCurrency(previewParsed.teamFunds)}</span></div>
                        <div className="flex justify-between items-center"><span className="text-gray-600 dark:text-gray-400">Locked in LP</span><span className="text-teal-600 dark:text-teal-400 font-bold">{formatCurrency(previewParsed.liquidityGoalMet)}</span></div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {form.mode === "provideLiquidity" && (
              <div className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-white/[0.08] p-6 rounded-xl flex items-center justify-center min-h-[200px]">
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">Preview is available for Fundraise mode.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── SECTION 3: Review & Create ─── */}
      <SectionCard number={3} title="Review & Launch" enabled={step1Valid && step2Valid} complete={false} className="w-full max-w-7xl">
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <SummarySection title="Token">
              {tokenImagePreview && (
                <div className="flex justify-center mb-3">
                  <img src={tokenImagePreview} alt="Token" className="w-16 h-16 rounded-full object-cover border-2 border-[#845fbc]/30" />
                </div>
              )}
              <SummaryRow label="Name" value={form.name} />
              <SummaryRow label="Symbol" value={form.symbol.toUpperCase()} />
              {form.description && <SummaryRow label="Description" value={form.description} />}
              {form.website && <SummaryRow label="Website" value={form.website} />}
              {form.xAccount && <SummaryRow label="X Account" value={form.xAccount} />}
              {form.discord && <SummaryRow label="Discord" value={form.discord} />}
            </SummarySection>

            <SummarySection title="Configuration">
              <SummaryRow label="Network" value={network === "main" ? "Mainnet" : "Testnet"} />
              <SummaryRow label="Mode" value={form.mode === "fundRaising" ? "Fundraise" : "Provide Liquidity"} />
              <SummaryRow label="Total Supply" value={Number(form.supply).toLocaleString()} />
              <SummaryRow label="Public Allocation" value={`${form.publicAllocation}%`} />
              <SummaryRow label="Creator Ownership" value={`${100 - parseFloat(form.publicAllocation)}%`} />
              <SummaryRow label="Liquidity Fee" value={`${form.liquidityFee}%`} />
              <SummaryRow label="Creator Fee" value={`${form.creatorFee}%`} />
              <SummaryRow label="Token Burn Rate" value={`${form.liquidityFeeTokenBurnRate}%`} />
            </SummarySection>

            {form.mode === "fundRaising" && preview && (
              <SummarySection title="Fundraise Details">
                <SummaryRow label="Launch Supply" value={Number(launchKontingent).toLocaleString()} />
                <SummaryRow label="Liquidity Pool Goal" value={`${form.liquidityGoal} ${baseToken.symbol}`} />
                <SummaryRow label="Team Goal" value={`${form.teamGoal} ${baseToken.symbol}`} />
                <SummaryRow label="Curve" value={{ fixed: "Static", sigmoid: "Balanced", exponential: "Rapid" }[form.curve]} />
                <SummaryRow label="Listing Premium" value={`${form.listingPremiumPercentage}%`} />
                <SummaryRow label="End Date" value={new Date(form.endDate).toLocaleString(undefined, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })} />
                <SummaryRow label="Launch Threshold" value={`${form.launchThreshold}%`} />
                <SummaryRow label="Listing Price" value={`${formatAmount18(preview.listingPrice)} ${baseToken.symbol}`} />
                <SummaryRow label="Listing Market Cap" value={`${formatAmount18(preview.listingMarketCap)} ${baseToken.symbol}`} />
              </SummarySection>
            )}

            {form.mode === "provideLiquidity" && (
              <SummarySection title="Liquidity Details">
                <SummaryRow label="Initial Liquidity" value={`${form.initialLiquidityAmount} ${baseToken.symbol}`} />
              </SummarySection>
            )}
          </div>

          {createError && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {createError}
            </div>
          )}

          {statusMessage && (
            <div className="p-3 rounded-lg bg-[#845fbc]/10 border border-[#845fbc]/30 text-[#a78bfa] text-sm animate-pulse">
              {statusMessage}
            </div>
          )}

          <div className="flex justify-end pt-4">
            <button
              onClick={handleCreate}
              disabled={creating || !step1Valid || !step2Valid}
              className="px-8 py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold tracking-wide rounded-md transition-all duration-300 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed uppercase text-sm"
            >
              {creating ? "Deploying..." : "Launch Pool"}
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
};

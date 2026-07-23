import React, { useState, useEffect, useRef, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../config/firebase";
import { logger } from "../../utils/logger";

const KYC_SIGN_PREFIX = "ALPACA_KYC_";

type Step =
  | "info"
  | "processing"
  | "success"
  | "no-cert"
  | "error"
  | "already-shared"
  | "get-verified"
  | "country-select"
  | "verification-redirect"
  | "verification-polling";

interface KYCSharingModalProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  network: "main" | "test";
}

const countryNames = new Intl.DisplayNames(["en"], { type: "region" });

export const KYCSharingModal: React.FC<KYCSharingModalProps> = ({
  isOpen,
  onClose,
  address,
  network,
}) => {
  const [step, setStep] = useState<Step>("info");
  const [error, setError] = useState<string>("");
  const [sharingStatus, setSharingStatus] = useState<any>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);

  // KYC verification state
  const [countries, setCountries] = useState<string[]>([]);
  const [filteredCountries, setFilteredCountries] = useState<string[]>([]);
  const [countrySearch, setCountrySearch] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [verificationURL, setVerificationURL] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount or modal close
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // Also clear polling when modal closes
  useEffect(() => {
    if (!isOpen && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [isOpen]);

  // Filter countries based on search
  useEffect(() => {
    if (!countrySearch.trim()) {
      setFilteredCountries(countries);
      return;
    }
    const query = countrySearch.toLowerCase();
    setFilteredCountries(
      countries.filter((code) => {
        const name = countryNames.of(code)?.toLowerCase() || "";
        return name.includes(query) || code.toLowerCase().includes(query);
      })
    );
  }, [countrySearch, countries]);

  // Check if already shared on open
  useEffect(() => {
    if (!isOpen || !address) return;
    setStep("info");
    setError("");
    setCheckingStatus(true);
    setCountrySearch("");
    setSelectedCountry("");

    checkExistingStatus().finally(() => setCheckingStatus(false));
  }, [isOpen, address, network]);

  async function checkExistingStatus() {
    try {
      if (!window.alpaca?.signMessage) return;

      const message = KYC_SIGN_PREFIX + address;
      const { signature } = await window.alpaca.signMessage(message);

      const fn = httpsCallable(functions, "kycStatusCall");
      const result = await fn({ address, message, signature, network });
      const data = result.data as any;

      if (data.ok && data.shared) {
        setSharingStatus(data);
        setStep("already-shared");
      }
    } catch {
      // Not shared yet, stay on info step
    }
  }

  async function handleShare() {
    setStep("processing");
    setError("");

    try {
      if (!window.alpaca?.shareKYC || !window.alpaca?.signMessage) {
        throw new Error(
          "Wallet extension not found or outdated. Please update your Alpaca Wallet."
        );
      }

      // 1. Ask extension to read certificate and create sharable blob
      const kycResult = await window.alpaca.shareKYC();

      if (!kycResult.hasCertificate) {
        setStep("no-cert");
        return;
      }

      // 2. Sign ownership message
      const message = KYC_SIGN_PREFIX + address;
      const { signature } = await window.alpaca.signMessage(message);

      // 3. Send to backend
      const fn = httpsCallable(functions, "kycShareCall");
      const response = await fn({
        address,
        message,
        signature,
        network,
        container: kycResult.container,
        transportSeed: kycResult.transportSeed,
      });

      const data = response.data as any;
      if (data.ok) {
        setStep("success");
      } else {
        throw new Error(data.error || "Failed to share KYC data.");
      }
    } catch (err: any) {
      console.error("[KYC] Share failed:", err);
      setError(err.message || "Something went wrong.");
      setStep("error");
    }
  }

  async function handleRevoke() {
    setStep("processing");
    setError("");

    try {
      if (!window.alpaca?.signMessage) {
        throw new Error("Wallet extension not found.");
      }

      const message = KYC_SIGN_PREFIX + address;
      const { signature } = await window.alpaca.signMessage(message);

      const fn = httpsCallable(functions, "kycRevokeCall");
      await fn({ address, message, signature, network });

      setSharingStatus(null);
      setStep("info");
    } catch (err: any) {
      setError(err.message || "Failed to revoke.");
      setStep("error");
    }
  }

  // --- Get Verified flow ---

  async function handleGetVerified() {
    // Check if extension supports KYC verification
    if (typeof window.alpaca?.getKYCCountries !== "function") {
      // Old extension — fall back to external link
      window.open("https://wallet.keeta.com/certificate", "_blank");
      return;
    }

    setStep("get-verified");

    setError("");

    try {
      const result = await window.alpaca.getKYCCountries();
      setCountries(result.countries);
      setFilteredCountries(result.countries);

      setStep("country-select");
    } catch (err: any) {
      console.error("[KYC] Failed to get countries:", err);
      setError(err.message || "Failed to load supported countries.");

      setStep("error");
    }
  }

  async function handleStartVerification() {
    if (!selectedCountry) return;

    setStep("processing");
    setError("");

    try {
      const result = await window.alpaca!.startKYCVerification([
        selectedCountry,
      ]);
      setVerificationURL(result.webURL);
      window.open(result.webURL, "_blank");
      setStep("verification-redirect");
    } catch (err: any) {
      console.error("[KYC] Start verification failed:", err);
      setError(err.message || "Failed to start verification.");
      setStep("error");
    }
  }

  const startPolling = useCallback(() => {
    setStep("verification-polling");
    setError("");

    // Clear any existing interval
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    let attempts = 0;
    const MAX_ATTEMPTS = 120; // 6 minutes at 3s intervals

    pollingRef.current = setInterval(async () => {
      attempts++;

      if (attempts > MAX_ATTEMPTS) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setError("Verification timed out. Please try again.");
        setStep("error");
        return;
      }

      try {
        const result = await window.alpaca!.checkKYCVerification();

        if (result.status === "completed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;

          // Certificate published on-chain! Now auto-trigger share flow
          handleShare();
        }
        // status === 'pending' — keep polling
      } catch (err: any) {
        // If the error is "No active verification found", the service worker restarted
        if (err.message?.includes("No active verification")) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setError(
            "Connection to wallet was lost. Please restart the verification."
          );
          setStep("error");
          return;
        }
        // Other errors — keep trying
        logger.warn("[KYC] Poll error:", err.message);
      }
    }, 3000);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-white dark:bg-[#1e1e1e] rounded-3xl border border-gray-200 dark:border-[#333] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-[#333]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-teal-500 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-bold font-heading text-gray-900 dark:text-white">
              {step === "country-select" || step === "get-verified"
                ? "Get Verified"
                : step === "verification-redirect" ||
                  step === "verification-polling"
                  ? "Verification"
                  : "KYC Data Sharing"}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-[#333] rounded-xl transition-colors"
          >
            <svg
              className="w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {checkingStatus ? (
            <div className="flex flex-col items-center py-8">
              <div className="w-8 h-8 border-2 border-[#845fbc] border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Checking status...
              </p>
            </div>
          ) : step === "info" ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                Share your verified identity information with Alpaca DEX. This
                data is extracted directly from your on-chain KYC certificate
                — no manual input needed.
              </p>

              <div className="bg-gray-50 dark:bg-[#252525] rounded-2xl p-4 mb-4">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 mb-3">
                  Information shared
                </p>
                <div className="space-y-2">
                  {[
                    { label: "Full Name", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" },
                    { label: "Email Address", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
                    { label: "Date of Birth", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
                    { label: "Country & Nationality", icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064" },
                    { label: "ID Document Details", icon: "M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15A2.25 2.25 0 002.25 6.75v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" },
                  ].map(({ label, icon }) => (
                    <div
                      key={label}
                      className="flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300"
                    >
                      <svg
                        className="w-4 h-4 text-teal-500 flex-shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d={icon}
                        />
                      </svg>
                      {label}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/30 rounded-2xl p-4 mb-6">
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  Your data is cryptographically proven to come from your KYC
                  certificate. Alpaca stores this securely and encrypted. You
                  can revoke access at any time.
                </p>
              </div>

              <button
                onClick={handleShare}
                className="w-full py-3 bg-teal-500 hover:bg-teal-600 text-white font-bold rounded-2xl transition-all"
              >
                Share KYC Data
              </button>
            </>
          ) : step === "already-shared" ? (
            <>
              <div className="flex flex-col items-center py-4 mb-4">
                <div className="w-14 h-14 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mb-3">
                  <svg
                    className="w-7 h-7 text-teal-500"
                    viewBox="0 0 16 16"
                    fill="none"
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
                <p className="text-sm font-bold text-gray-900 dark:text-white">
                  KYC Data Already Shared
                </p>
                {sharingStatus?.issuer && (
                  <p className="text-xs text-gray-500 mt-1">
                    Issuer: {sharingStatus.issuer}
                  </p>
                )}
                {sharingStatus?.sharedAt && (
                  <p className="text-xs text-gray-400 mt-1">
                    Shared on{" "}
                    {new Date(sharingStatus.sharedAt).toLocaleDateString()}
                  </p>
                )}
              </div>

              <button
                onClick={handleRevoke}
                className="w-full py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 font-bold rounded-2xl transition-all border border-red-500/20"
              >
                Revoke KYC Sharing
              </button>
            </>
          ) : step === "processing" ? (
            <div className="flex flex-col items-center py-8">
              <div className="w-10 h-10 border-2 border-[#845fbc] border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Processing...
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                Please confirm in your wallet extension
              </p>
            </div>
          ) : step === "success" ? (
            <>
              <div className="flex flex-col items-center py-6 mb-4">
                <div className="w-16 h-16 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-teal-500"
                    viewBox="0 0 16 16"
                    fill="none"
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
                <p className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                  KYC Data Shared
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                  Your verified identity data has been securely shared with
                  Alpaca DEX. You can revoke this at any time.
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-full py-3 bg-gray-200 hover:bg-gray-300 dark:bg-[#333] dark:hover:bg-[#444] text-gray-700 dark:text-white font-bold rounded-2xl transition-all"
              >
                Done
              </button>
            </>
          ) : step === "no-cert" ? (
            <>
              <div className="flex flex-col items-center py-6 mb-4">
                <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-amber-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                </div>
                <p className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                  No KYC Certificate Found
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                  Your wallet doesn't have a KYC certificate yet. Complete
                  identity verification to get certified and share your data
                  with Alpaca.
                </p>
              </div>
              <button
                onClick={handleGetVerified}
                className="w-full py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-bold rounded-2xl transition-all"
              >
                Get Verified
              </button>
              <button
                onClick={onClose}
                className="w-full py-3 mt-3 bg-gray-200 hover:bg-gray-300 dark:bg-[#333] dark:hover:bg-[#444] text-gray-700 dark:text-white font-bold rounded-2xl transition-all"
              >
                Cancel
              </button>
            </>
          ) : step === "get-verified" ? (
            <div className="flex flex-col items-center py-8">
              <div className="w-10 h-10 border-2 border-[#845fbc] border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Loading supported countries...
              </p>
            </div>
          ) : step === "country-select" ? (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                Select the country that matches your government-issued ID to
                begin identity verification.
              </p>

              {/* Search input */}
              <div className="relative mb-3">
                <svg
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                <input
                  type="text"
                  value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                  placeholder="Search country..."
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 dark:bg-[#252525] border border-gray-200 dark:border-[#333] rounded-xl text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#845fbc]/50"
                />
              </div>

              {/* Country list */}
              <div className="max-h-60 overflow-y-auto rounded-xl border border-gray-200 dark:border-[#333] mb-4">
                {filteredCountries.length === 0 ? (
                  <p className="p-4 text-sm text-gray-400 text-center">
                    No countries found
                  </p>
                ) : (
                  filteredCountries.map((code) => (
                    <button
                      key={code}
                      onClick={() => setSelectedCountry(code)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${selectedCountry === code
                        ? "bg-[#845fbc]/10 text-[#845fbc] dark:text-[#a78bfa]"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#252525]"
                        }`}
                    >
                      <span className="font-medium">
                        {countryNames.of(code) || code}
                      </span>
                      {selectedCountry === code && (
                        <svg
                          className="w-4 h-4 ml-auto text-[#845fbc] dark:text-[#a78bfa]"
                          viewBox="0 0 16 16"
                          fill="none"
                        >
                          <path
                            d="M3 8.5L6.5 12L13 4"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  ))
                )}
              </div>

              <button
                onClick={handleStartVerification}
                disabled={!selectedCountry}
                className={`w-full py-3 font-bold rounded-2xl transition-all ${selectedCountry
                  ? "bg-[#845fbc] hover:bg-[#724bad] text-white"
                  : "bg-gray-200 dark:bg-[#333] text-gray-400 cursor-not-allowed"
                  }`}
              >
                Continue
              </button>
              <button
                onClick={() => setStep("no-cert")}
                className="w-full py-3 mt-3 bg-gray-200 hover:bg-gray-300 dark:bg-[#333] dark:hover:bg-[#444] text-gray-700 dark:text-white font-bold rounded-2xl transition-all"
              >
                Back
              </button>
            </>
          ) : step === "verification-redirect" ? (
            <>
              <div className="flex flex-col items-center py-6 mb-4">
                <div className="w-16 h-16 rounded-full bg-[#845fbc]/10 flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-[#845fbc]"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                    />
                  </svg>
                </div>
                <p className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                  Complete Verification
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
                  A verification page has opened in a new tab. Complete the
                  identity check there, then come back and click the button
                  below.
                </p>
              </div>

              <a
                href={verificationURL}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-xs text-[#845fbc] dark:text-[#a78bfa] hover:underline mb-4"
              >
                Open verification page again
              </a>

              <button
                onClick={startPolling}
                className="w-full py-3 bg-teal-500 hover:bg-teal-600 text-white font-bold rounded-2xl transition-all"
              >
                I've Completed Verification
              </button>
              <button
                onClick={onClose}
                className="w-full py-3 mt-3 bg-gray-200 hover:bg-gray-300 dark:bg-[#333] dark:hover:bg-[#444] text-gray-700 dark:text-white font-bold rounded-2xl transition-all"
              >
                Cancel
              </button>
            </>
          ) : step === "verification-polling" ? (
            <div className="flex flex-col items-center py-8">
              <div className="w-10 h-10 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Checking for certificate...
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 text-center">
                Waiting for your KYC certificate to be issued and published
                on-chain. This may take a moment.
              </p>
            </div>
          ) : step === "error" ? (
            <>
              <div className="flex flex-col items-center py-6 mb-4">
                <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/20 flex items-center justify-center mb-4">
                  <svg
                    className="w-8 h-8 text-red-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
                <p className="text-lg font-bold text-gray-900 dark:text-white mb-1">
                  Something Went Wrong
                </p>
                <p className="text-sm text-red-500 dark:text-red-400 text-center">
                  {error}
                </p>
              </div>
              <button
                onClick={() => setStep("info")}
                className="w-full py-3 bg-gray-200 hover:bg-gray-300 dark:bg-[#333] dark:hover:bg-[#444] text-gray-700 dark:text-white font-bold rounded-2xl transition-all"
              >
                Try Again
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};

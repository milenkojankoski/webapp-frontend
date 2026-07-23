import { httpsCallable } from "firebase/functions";
import { doc, setDoc, Timestamp } from "firebase/firestore";
import { db, functions, authReady } from "../config/firebase";

// Bridge API endpoints (same as extension constants)
const BRIDGE_API = {
  main: "https://evm-anchor.keeta.com/api",
  test: "https://inout-test.dev2.api.keeta.com/api",
};

const CHAIN_LOCATIONS = {
  keetaMain: "chain:keeta:21378",
  keetaTest: "chain:keeta:1413829460",
  baseMain: "chain:evm:8453",
  baseTest: "chain:evm:84532",
};

// FX anchor endpoints — proxied through our Cloud Function (fxAnchorProxyCall)
// to avoid CORS issues. The iOS app hits these directly; the browser cannot.

// Known bridge asset addresses on Keeta side
export const BRIDGE_ASSETS: Record<string, Record<string, string>> = {
  main: {
    KTA: "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg",
    USDC: "keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna",
    EURC: "keeta_apblhar4ncp3ln62wrygsn73pt3houuvj7ic47aarnolpcu67oqn4xqcji3au",
    cbBTC: "keeta_apyez4az5r6shtblf3qtzirmikq3tghb5svrmmrltdkxgnnzzhlstby3cuscc",
  },
  test: {
    KTA: "keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52",
    USDC: "keeta_apna75yhhvnv4ei7ape55hndk4yepno7a7i2mhtiwahiygixjcnmvswxhnmnk",
  },
};

// Bridge routes for KTA purchase (stablecoin intermediary → KTA via FX anchor)
export interface BridgeRoute {
  fiatCurrency: string;
  intermediate: string; // "USDC" | "EURC"
  coinbaseAsset: string;
  coinbaseNetwork: string;
}

export const KTA_BRIDGE_ROUTES: BridgeRoute[] = [
  { fiatCurrency: "USD", intermediate: "USDC", coinbaseAsset: "USDC", coinbaseNetwork: "base" },
  { fiatCurrency: "EUR", intermediate: "EURC", coinbaseAsset: "EURC", coinbaseNetwork: "base" },
];

// Buyable tokens
export interface BuyableToken {
  id: string;
  name: string;
  subtitle: string;
  network: string;
  bridgeRoutes: BridgeRoute[] | null; // null = direct purchase (stablecoin), non-null = needs FX swap
}

export const BUYABLE_TOKENS: BuyableToken[] = [
  {
    id: "kta",
    name: "KTA",
    subtitle: "Native Keeta token",
    network: "keeta",
    bridgeRoutes: KTA_BRIDGE_ROUTES,
  },
  {
    id: "usdc",
    name: "USDC",
    subtitle: "USD on Base",
    network: "base",
    bridgeRoutes: null,
  },
  {
    id: "eurc",
    name: "EURC",
    subtitle: "EUR on Base",
    network: "base",
    bridgeRoutes: null,
  },
];

// ── FX Anchor types ────────────────────────────────────────────────

export interface FxEstimate {
  request: { from: string; to: string; amount: string; affinity: string };
  convertedAmount: string; // raw BigInt string (optimistic mid-rate)
  convertedAmountBound: string | null; // raw BigInt string (guaranteed lower bound)
  expectedCost: {
    min: string;
    max: string;
    token: string;
  };
  account: string; // anchor/pool address
}

// ── Pending KTA purchase tracking ──────────────────────────────────

export interface PendingKtaPurchase {
  id: string;
  walletAddress: string;
  network: "main" | "test";
  route: BridgeRoute;
  fiatAmount: number;
  depositAddress: string;
  createdAt: number; // epoch ms
  state: "awaitingDeposit" | "swapping" | "completed" | "failed";
  lastError?: string;
}

const PENDING_STORAGE_KEY = "alpaca_pending_kta_purchases";

export function loadPendingPurchases(): PendingKtaPurchase[] {
  try {
    const raw = localStorage.getItem(PENDING_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function savePendingPurchases(purchases: PendingKtaPurchase[]) {
  localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(purchases));
}

export function addPendingPurchase(purchase: PendingKtaPurchase) {
  const all = loadPendingPurchases();
  all.push(purchase);
  savePendingPurchases(all);
}

export function updatePendingPurchase(id: string, update: Partial<PendingKtaPurchase>) {
  const all = loadPendingPurchases();
  const idx = all.findIndex(p => p.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...update };
    savePendingPurchases(all);
  }
}

export function removePendingPurchase(id: string) {
  const all = loadPendingPurchases().filter(p => p.id !== id);
  savePendingPurchases(all);
}

// ── In-memory cache for deposit addresses ──────────────────────────

const addressCache: Record<string, string> = {};

/**
 * Fetches a persistent Base chain deposit address that auto-bridges to the user's Keeta wallet.
 */
export async function getBaseDepositAddress(
  walletAddress: string,
  network: "main" | "test",
  asset: string
): Promise<string> {
  const cacheKey = `${walletAddress}_${network}_${asset}`;
  if (addressCache[cacheKey]) return addressCache[cacheKey];

  const bridgeApi = BRIDGE_API[network];
  const sourceLocation = network === "main" ? CHAIN_LOCATIONS.baseMain : CHAIN_LOCATIONS.baseTest;
  const destinationLocation = network === "main" ? CHAIN_LOCATIONS.keetaMain : CHAIN_LOCATIONS.keetaTest;
  const assetAddress = BRIDGE_ASSETS[network]?.[asset];

  if (!assetAddress) {
    throw new Error(`Asset ${asset} not available on ${network}`);
  }

  const response = await fetch(`${bridgeApi}/createPersistentForwarding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceLocation,
      asset: assetAddress,
      account: walletAddress,
      destinationAddress: walletAddress,
      destinationLocation,
    }),
  });

  if (!response.ok) {
    throw new Error(`Bridge API returned ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok || !data.address) {
    throw new Error(data.error || "Failed to get deposit address");
  }

  addressCache[cacheKey] = data.address;
  return data.address;
}

/**
 * Creates a Coinbase onramp session and returns the payment URL.
 */
export async function createOnRampSession(
  baseAddress: string,
  assets: string[],
  redirectUrl?: string,
  presetCryptoAmount?: number,
  defaultAsset?: string,
  defaultNetwork?: string
): Promise<{ token: string; url: string }> {
  await authReady;

  const fn = httpsCallable<
    {
      addresses: { address: string; blockchains: string[] }[];
      assets: string[];
      redirectUrl?: string;
      presetCryptoAmount?: number;
      defaultAsset?: string;
      defaultNetwork?: string;
    },
    { token: string; url: string }
  >(functions, "createCoinbaseWebOnRampSessionCall");

  const result = await fn({
    addresses: [{ address: baseAddress, blockchains: [defaultNetwork || "base"] }],
    assets,
    redirectUrl,
    presetCryptoAmount,
    defaultAsset,
    defaultNetwork,
  });

  return result.data;
}

// ── FX Anchor ──────────────────────────────────────────────────────

/**
 * Convert a value that may be hex (0x...) or decimal string to a decimal BigInt string.
 */
function toDecimalString(value: string): string {
  if (value.startsWith("0x") || value.startsWith("0X")) {
    return BigInt(value).toString();
  }
  return value;
}

/**
 * Proxy a request to the KeetaNet FX anchor via our Cloud Function.
 * The browser can't hit the FX anchor directly (CORS), so we relay through
 * fxAnchorProxyCall which forwards the request server-side.
 */
async function fxAnchorProxy(
  network: "main" | "test",
  operation: "getEstimate" | "createExchange" | "getExchangeStatus",
  payload: Record<string, unknown>
): Promise<any> {
  await authReady;
  const fn = httpsCallable(functions, "fxAnchorProxyCall");
  const result = await fn({ network, operation, payload });
  return (result.data as any);
}

/**
 * Get an unsigned estimate from the KeetaNet FX anchor (USDC/EURC → KTA).
 * Used for UI previews. Proxied through our Cloud Function to avoid CORS.
 */
export async function getFxEstimate(
  network: "main" | "test",
  fromToken: string,
  toToken: string,
  rawAmount: string
): Promise<FxEstimate> {
  const data = await fxAnchorProxy(network, "getEstimate", {
    request: {
      from: fromToken,
      to: toToken,
      amount: rawAmount,
      affinity: "from",
    },
  });

  if (!data.ok) {
    throw new Error(data.error || "FX estimate failed");
  }

  const est = data.estimate;

  // Normalize hex → decimal for display
  return {
    request: est.request,
    convertedAmount: toDecimalString(est.convertedAmount),
    convertedAmountBound: est.convertedAmountBound ? toDecimalString(est.convertedAmountBound) : null,
    expectedCost: {
      min: toDecimalString(est.expectedCost.min),
      max: toDecimalString(est.expectedCost.max),
      token: est.expectedCost.token,
    },
    account: est.account || null,
  };
}

/**
 * Submit a signed swap block to the KeetaNet FX anchor for execution.
 * Same unsigned flow as the iOS app. Proxied through our Cloud Function.
 */
export async function createFxExchange(
  network: "main" | "test",
  fromToken: string,
  toToken: string,
  rawAmount: string,
  blockBase64: string
): Promise<string> {
  const data = await fxAnchorProxy(network, "createExchange", {
    request: {
      request: {
        from: fromToken,
        to: toToken,
        amount: rawAmount,
        affinity: "from",
      },
      block: blockBase64,
    },
  });

  if (!data.ok) {
    throw new Error(data.error || "FX exchange failed");
  }

  return data.exchangeID;
}

/**
 * Check the user's on-chain balance for a specific token.
 * Uses the wallet extension's getBalance method.
 */
export async function getTokenBalance(
  tokenAddress: string
): Promise<string> {
  if (!window.alpaca) throw new Error("Wallet extension not detected");

  const result = await window.alpaca.getBalance(tokenAddress);
  if ("balance" in result) return result.balance;
  return "0";
}

/**
 * Poll the FX anchor for exchange completion status (via Alpaca API proxy).
 * Returns the status string ("pending", "completed", etc.).
 */
export async function getFxExchangeStatus(
  network: "main" | "test",
  exchangeId: string
): Promise<string> {
  const data = await fxAnchorProxy(network, "getExchangeStatus", { id: exchangeId });
  return data.status || "unknown";
}

/**
 * Poll exchange status until completed or deadline reached.
 * Calls onComplete when the anchor confirms the swap.
 */
export function watchExchangeUntilComplete(
  network: "main" | "test",
  exchangeId: string,
  onComplete: () => void,
  pollIntervalMs = 4000,
  deadlineMs = 120000
): () => void {
  let stopped = false;
  const start = Date.now();

  const poll = async () => {
    if (stopped) return;
    if (Date.now() - start > deadlineMs) return;

    try {
      const status = await getFxExchangeStatus(network, exchangeId);
      if (status.toLowerCase() === "completed") {
        onComplete();
        return;
      }
    } catch {
      // Bail on first failure — anchor errors are typically permanent
      return;
    }

    if (!stopped) {
      setTimeout(poll, pollIntervalMs);
    }
  };

  setTimeout(poll, pollIntervalMs);

  return () => { stopped = true; };
}

/**
 * Record a completed on-ramp purchase to Firestore for audit/tracking.
 * Writes directly to the onramp_purchases collection (same pattern as iOS).
 * Non-blocking — errors are logged but don't break the flow.
 */
export async function recordOnRampPurchase(purchase: {
  id: string;
  accountPublicKey: string;
  network: string;
  intermediateAsset: string;
  fiatCurrency: string;
  fiatAmount: number;
  depositAmount: string;
  ktaAmountRaw: string;
  exchangeId: string;
  createdAt: number;
  completedAt: number;
}): Promise<void> {
  try {
    await authReady;
    const collectionName = purchase.network === "test" ? "onramp_purchases_test" : "onramp_purchases";
    const docRef = doc(db, collectionName, purchase.id);
    await setDoc(docRef, {
      ...purchase,
      createdAt: Timestamp.fromMillis(purchase.createdAt),
      completedAt: Timestamp.fromMillis(purchase.completedAt),
    });
  } catch (err) {
    console.error("Failed to record on-ramp purchase (non-blocking):", err);
  }
}

/**
 * Prune stale pending purchases that never saw a deposit.
 * Removes entries older than ttlMs that are still in awaitingDeposit state.
 */
export function pruneStuckPendingPurchases(ttlMs = 10 * 60 * 1000) {
  const all = loadPendingPurchases();
  const cutoff = Date.now() - ttlMs;
  const filtered = all.filter(p => !(p.state === "awaitingDeposit" && p.createdAt < cutoff));
  if (filtered.length !== all.length) {
    savePendingPurchases(filtered);
  }
  return filtered;
}

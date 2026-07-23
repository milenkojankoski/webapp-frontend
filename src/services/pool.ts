import { httpsCallable } from "firebase/functions";
import { functions, authReady } from "../config/firebase";

// ─── Base token constants ───────────────────────────────────────────────────

export const BASE_TOKEN = {
  main: {
    address: "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg",
    symbol: "KTA",
    name: "Keeta",
    decimals: 18,
  },
  test: {
    address: "keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52",
    symbol: "KTA",
    name: "Keeta",
    decimals: 9,
  },
} as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export type Network = "main" | "test";
export type PoolMode = "fundRaising" | "provideLiquidity";
export type BondingCurve = "sigmoid" | "exponential" | "fixed";

export interface FundRaiseConfig {
  launchKontingent: string;
  liquidityGoal: string;
  teamGoal: string;
  duration: number; // seconds
  curve: BondingCurve;
  listingPremiumPercentage: number;
  launchThreshold: number;
}

export interface FundraisePreviewRequest {
  launchKontingent: string;
  totalSupply: string;
  liquidityGoal: string;
  teamGoal: string;
  bondingCurve: BondingCurve;
  listingPremiumPercentage: number;
}

export interface FundraisePreviewResponse {
  fundraiseSupply: string;
  poolSupply: string;
  startPrice: string;
  finalSalePrice: string;
  listingPrice: string;
  avgPrice: string;
  expectedTotalRaise: string;
  teamFunds: string;
  platformFee: string;
  platformTokenSupplyAmount: string;
  liquidityGoalMet: string;
  curve: string;
  splitPercentage: number;
  listingMarketCap: string;
  listingLiquidity: string;
  liquidityRatio: number;
  ok?: boolean;
  error?: string;
}

export interface CreatePoolRequest {
  name: string;
  symbol: string;
  description: string;
  supply: string;
  network: Network;
  creator: string;
  liquidityFee: number;
  creatorFee: number;
  creatorSupplyOwnership: number;
  liquidityFeeTokenBurnRate: number;
  version: number;
  baseToken: string;
  baseTokenSymbol: string;
  baseTokenName: string;
  baseTokenDecimals: number;
  mode: PoolMode;
  fundRaise: FundRaiseConfig | null;
  fundraisePreview: FundraisePreviewResponse | null;
  website: string;
  xAccount: string;
  discord: string;
}

export interface CreatePoolResponse {
  id: string;
  mode: PoolMode;
  address: string;
  feeAccount: string;
  platformSetupFee: string;
  baseToken: string;
  network: Network;
  active: boolean;
  [key: string]: unknown;
}

export interface ActivatePoolRequest {
  poolId: string;
  network: Network;
  feeBlock: string; // base64
  liquidityBlock: string | null; // base64, only for liquidity mode
}

export interface ActivatePoolResponse {
  activated: boolean;
  pairedToken?: string;
  error?: string;
}

// ─── Callable wrappers ─────────────────────────────────────────────────────

export async function createPool(
  data: CreatePoolRequest
): Promise<CreatePoolResponse> {
  const fn = httpsCallable<CreatePoolRequest, CreatePoolResponse>(
    functions,
    "createNewPoolCall"
  );
  const result = await fn(data);
  return result.data;
}

export async function activatePool(
  data: ActivatePoolRequest
): Promise<ActivatePoolResponse> {
  const fn = httpsCallable<ActivatePoolRequest, ActivatePoolResponse>(
    functions,
    "activateNewPoolCall"
  );
  const result = await fn(data);
  return result.data;
}

export async function getFundraisePreview(
  data: FundraisePreviewRequest
): Promise<FundraisePreviewResponse> {
  const fn = httpsCallable<FundraisePreviewRequest, FundraisePreviewResponse>(
    functions,
    "fundraisePreviewCall"
  );
  const result = await fn(data);
  return result.data;
}

// ─── Pool Update ──────────────────────────────────────────────────────────────

export interface UpdatePoolFields {
  poolId: string;
  network: Network;
  liquidityFeeTokenBurnRate: number;
  creatorFee?: number;
  description: string;
  website: string;
  xAccount: string;
  discord: string;
}

export interface UpdatePoolResponse {
  updated: boolean;
  pairedToken?: string;
  error?: string;
}

export async function updatePool(
  fields: UpdatePoolFields
): Promise<UpdatePoolResponse> {
  if (!window.alpaca?.signMessage) {
    throw new Error("Wallet extension not available or does not support signMessage");
  }

  const payload = { ...fields, created: new Date().toISOString() };
  const jsonStr = JSON.stringify(payload);

  // Sign the raw JSON string — extension signs UTF-8 bytes
  const { signature, address } = await window.alpaca.signMessage(jsonStr);

  // Base64-encode the same JSON string (verifyData decodes base64 → same bytes)
  const binary = btoa(unescape(encodeURIComponent(jsonStr)));

  const fnName = fields.network === "main" ? "updatePoolCall" : "updateTestPoolCall";
  await authReady;
  const fn = httpsCallable<
    { account: string; binary: string; signature: string },
    UpdatePoolResponse
  >(functions, fnName);

  const result = await fn({ account: address, binary, signature });
  return result.data;
}

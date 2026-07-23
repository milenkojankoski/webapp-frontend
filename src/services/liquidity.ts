import { httpsCallable } from "firebase/functions";
import { functions, authReady } from "../config/firebase";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../config/firebase";
import type { Network } from "./pool";

// ── Types ──────────────────────────────────────────────────────────────────

export interface WithdrawQuoteRequest {
  poolId: string;
  lpAmount: string;
}

export interface WithdrawQuoteResponse {
  amountBase: string;
  amountPaired: string;
  amountBaseConverted: number;
  lpAmount: string;
  totalLpSupply: string;
  sharePercent: number;
  baseToken: string;
  pairedToken: string;
  baseTokenSymbol: string;
  pairedTokenSymbol: string;
  burnAddress: string;
  lpTokenAddress: string;
}

// ── Withdraw quote ─────────────────────────────────────────────────────────

export async function getWithdrawQuote(
  data: WithdrawQuoteRequest,
  network: Network
): Promise<WithdrawQuoteResponse> {
  await authReady;
  const fnName = network === "test"
    ? "liquidityWithdrawTestQuoteCall"
    : "liquidityWithdrawQuoteCall";
  const fn = httpsCallable<WithdrawQuoteRequest, WithdrawQuoteResponse>(functions, fnName);
  const result = await fn(data);
  return result.data;
}

// ── Write pending deposit doc ──────────────────────────────────────────────

export async function submitLiquidityDeposit(
  poolId: string,
  network: Network,
  params: {
    type: "zap" | "dual";
    sender: string;
    block: string;           // base64 signed FUND block
    feeBlock: string;        // base64 signed fee block (network fee KTA to pool)
    amountIn?: string;       // for zap: raw KTA amount
    amountBase?: string;     // for dual: raw base amount
    amountPaired?: string;   // for dual: raw paired amount
    maxSlippagePct?: number; // for zap slippage guard
  }
): Promise<string> {
  const colName = network === "test" ? "pools_test" : "pools";
  const liqCol = collection(db, colName, poolId, "liquidity_pending");
  const liqRef = doc(liqCol);

  const data: Record<string, unknown> = {
    id: liqRef.id,
    sender: params.sender,
    type: params.type,
    block: params.block,
    feeBlock: params.feeBlock,
    status: "pending",
    createdAt: serverTimestamp(),
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 min expiry
  };

  if (params.type === "zap") {
    data.amountIn = params.amountIn;
    data.maxSlippagePct = params.maxSlippagePct ?? 5;
  } else {
    data.amountBase = params.amountBase;
    data.amountPaired = params.amountPaired;
  }

  await setDoc(liqRef, data);
  return liqRef.id;
}

// ── Write pending withdrawal doc ───────────────────────────────────────────

export async function submitLiquidityWithdrawal(
  poolId: string,
  network: Network,
  params: {
    sender: string;
    block: string;       // base64 signed FUND block (LP send to burn address)
    feeBlock: string;    // base64 signed fee block (network fee KTA to pool)
    lpAmount: string;    // raw LP token amount
  }
): Promise<string> {
  const colName = network === "test" ? "pools_test" : "pools";
  const withdrawCol = collection(db, colName, poolId, "liquidity_withdraw_pending");
  const withdrawRef = doc(withdrawCol);

  await setDoc(withdrawRef, {
    id: withdrawRef.id,
    sender: params.sender,
    block: params.block,
    feeBlock: params.feeBlock,
    lpAmount: params.lpAmount,
    status: "pending",
    createdAt: serverTimestamp(),
  });

  return withdrawRef.id;
}

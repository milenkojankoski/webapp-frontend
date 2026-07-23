import type { ReactNode } from "react";


export type StatsTimeFrame = "5m" | "1h" | "6h" | "24h";
export type ChartTimeFrame = "1h" | "1d" | "1w" | "1m" | "1y";
export type ChartType = "area" | "candle";

export interface PoolStats {
  vol5m?: string; vol1h?: string; vol6h?: string; vol24h?: string;
  buys5m?: string; buys1h?: string; buys6h?: string; buys24h?: string;
  sells5m?: string; sells1h?: string; sells6h?: string; sells24h?: string;
  buyers5m?: string; sellers5m?: string; traders5m?: string;
  buyers1h?: string; sellers1h?: string; traders1h?: string;
  buyers6h?: string; sellers6h?: string; traders6h?: string;
  buyers24h?: string; sellers24h?: string; traders24h?: string;
  priceChange24h?: string | number;
  ath?: string;
}

export interface FundRaiseData {
  launchKontingent: string;
  fundraiseSupply: string;
  poolSupply: string;
  startSalePrice: string;
  finalSalePrice: string;
  liquidityGoal: string;
  expectedTotalRaise: string;
  raised: string;
  tokensSold: string;
  teamGoal: string;
  platformFee: string;
  curve: string;
  premiumPercentage: number;
  tradingStartPrice: string;
}

export interface PoolData {
  poolId: string;
  address: string;
  pairedTokenSymbol: string;
  baseTokenSymbol: string;
  pairedTokenName: string;
  baseTokenName: string;
  tokenomicsUrl: string;
  totalSupply: string;
  creatorSupplyOwnership: string;
  marketCap?: string;
  stats?: PoolStats;
  baseToken?: string;
  pairedToken?: string;
  price?: string;
  tokenDecimals?: number;
  pairedTokenDecimals?: number;
  baseTokenDecimals?: number;
  mode?: string;
  network?: "main" | "test";
  fundRaise?: FundRaiseData;
  baseTokenAmount?: string;
  pairedTokenAmount?: string;
  description?: string;
  website?: string;
  xAccount?: string;
  discord?: string;
  creator?: string;
  creatorFee?: number;
  liquidityFeeTokenBurnRate?: number;
}

export interface SearchResult {
  id: string;
  address: string;
  pairedTokenSymbol: string;
}

export interface ChartPoint {
  timestamp: number;
  price: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
}

export interface ChartDataResult {
  poolId: string;
  tf: ChartTimeFrame;
  series: ChartPoint[];
}

export interface TransactionData {
  sendAmount?: string; sendToken?: string;
  receiveAmount?: string; receiveToken?: string;
  sendSymbol?: string; receiveSymbol?: string;
  account?: string; amount?: string;
  recipient?: string; token?: string;
  trader?: string;
}

export interface Transaction {
  type: 'SWAP' | 'SEND' | 'UNKNOWN';
  hash: string;
  timestamp: number;
  data: TransactionData;
}

export type StatValue = string | number | ReactNode;
export type StatRow = [label: string | ReactNode, value: StatValue] |
[label: string | ReactNode, value: StatValue, colorClass: string];
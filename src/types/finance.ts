export interface TransactionRecord {
  id: string;
  timestamp: number;
  type: 'trade' | 'send' | 'receive' | 'swap' | 'distribution' | 'conversion';
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  decimalsIn: number;
  decimalsOut: number;
  symbolIn: string;
  symbolOut: string;
  priceUsd?: number;
  poolId?: string;
}

export interface CurrencyBalance {
  token: string;
  symbol: string;
  balance: string;
  decimals: number;
  valueInHome: number;
  fxRate: number;
}

export interface FinanceStatement {
  period: string;
  type: 'monthly' | 'annual';
  openingBalance: CurrencyBalance[];
  closingBalance: CurrencyBalance[];
  transactions: TransactionRecord[];
  generatedAt: number;
}

export interface TaxReport {
  year: number;
  jurisdiction: string;
  costBasisMethod: 'fifo' | 'lifo' | 'hifo';
  realizedGains: string;
  realizedLosses: string;
  netGainLoss: string;
  shortTermGains: string;
  longTermGains: string;
  totalFeesPaid: string;
  transactions: TaxableEvent[];
}

export interface TaxableEvent {
  date: number;
  type: 'buy' | 'sell' | 'swap';
  asset: string;
  amount: string;
  costBasis: string;
  proceeds: string;
  gainLoss: string;
  holdingPeriod: 'short' | 'long';
}

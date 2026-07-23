/**
 * Tax calculator — FIFO, LIFO, HIFO cost basis tracking.
 *
 * Works with trade records from BigQuery. Each BUY creates a "lot" (tokens acquired
 * at a cost in base token). Each SELL disposes of lots using the chosen method.
 * Gain/Loss = proceeds - cost basis (both in base token terms, e.g. KTA).
 */

export type CostBasisMethod = 'fifo' | 'lifo' | 'hifo';

export interface TradeRecord {
  timestamp: string;
  poolId: string;
  tradeType: string;
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
  baseToken: string;
  pairedToken: string;
  newPrice: string;
  baseDecimals: number;
  tradeId: string;
}

export interface TaxableEvent {
  date: string;
  timestamp: number;
  type: 'sell';
  token: string;
  amount: number;
  costBasis: number;      // in base token (KTA)
  proceeds: number;       // in base token (KTA)
  gainLoss: number;       // proceeds - costBasis
  holdingPeriod: 'short' | 'long';
  tradeId: string;
}

interface Lot {
  amount: number;
  costPerUnit: number;  // base token per token unit
  acquiredAt: number;   // epoch ms
  tradeId: string;
}

export interface TaxSummary {
  totalRealizedGains: number;
  totalRealizedLosses: number;
  netGainLoss: number;
  shortTermGains: number;
  shortTermLosses: number;
  longTermGains: number;
  longTermLosses: number;
  totalTrades: number;
  totalSells: number;
  totalBuys: number;
  events: TaxableEvent[];
}

const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function parseAmount(raw: string, decimals: number): number {
  if (!raw || raw === '0') return 0;
  try {
    return Number(BigInt(raw)) / Math.pow(10, decimals);
  } catch {
    return parseFloat(raw) || 0;
  }
}

/**
 * Calculate tax events from a list of trade records.
 * Trades MUST be sorted chronologically (oldest first).
 */
export function calculateTaxReport(
  trades: TradeRecord[],
  method: CostBasisMethod
): TaxSummary {
  // Group lots by paired token address (each pool's paired token is a separate asset)
  const lotPools = new Map<string, Lot[]>();
  const events: TaxableEvent[] = [];
  let totalBuys = 0;
  let totalSells = 0;

  // Sort chronologically (oldest first) — trades come from BQ ordered DESC
  const sorted = [...trades].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  for (const trade of sorted) {
    const isBuy = trade.tradeType === 'buy';
    const decimals = trade.baseDecimals || 18;
    const ts = trade.timestamp ? new Date(trade.timestamp).getTime() : 0;

    if (isBuy) {
      // BUY: spending base token (amountIn) to acquire paired token (amountOut)
      const baseSpent = parseAmount(trade.amountIn, decimals);
      const tokensAcquired = parseAmount(trade.amountOut, decimals);
      totalBuys++;

      if (tokensAcquired <= 0) continue;

      const costPerUnit = baseSpent / tokensAcquired;
      const token = trade.pairedToken;

      if (!lotPools.has(token)) lotPools.set(token, []);
      lotPools.get(token)!.push({
        amount: tokensAcquired,
        costPerUnit,
        acquiredAt: ts,
        tradeId: trade.tradeId,
      });
    } else {
      // SELL: spending paired token (amountIn) to receive base token (amountOut)
      const tokensDisposed = parseAmount(trade.amountIn, decimals);
      const baseReceived = parseAmount(trade.amountOut, decimals);
      totalSells++;

      if (tokensDisposed <= 0) continue;

      const token = trade.pairedToken;
      const lots = lotPools.get(token) || [];

      // Select lots based on method
      const orderedLots = selectLots(lots, method);

      let remaining = tokensDisposed;
      let totalCostBasis = 0;
      let earliestAcquired = ts;

      while (remaining > 0 && orderedLots.length > 0) {
        const lot = orderedLots[0];
        const used = Math.min(remaining, lot.amount);
        totalCostBasis += used * lot.costPerUnit;
        if (lot.acquiredAt < earliestAcquired) earliestAcquired = lot.acquiredAt;

        lot.amount -= used;
        remaining -= used;

        if (lot.amount <= 0.000000001) {
          orderedLots.shift();
        }
      }

      // If we sold more than we had lots for, the excess has zero cost basis
      const holdingMs = ts - earliestAcquired;
      const holdingPeriod: 'short' | 'long' = holdingMs >= ONE_YEAR_MS ? 'long' : 'short';

      events.push({
        date: trade.timestamp ? new Date(trade.timestamp).toLocaleDateString() : '',
        timestamp: ts,
        type: 'sell',
        token,
        amount: tokensDisposed,
        costBasis: totalCostBasis,
        proceeds: baseReceived,
        gainLoss: baseReceived - totalCostBasis,
        holdingPeriod,
        tradeId: trade.tradeId,
      });

      // Update the lot pool (remove fully consumed lots)
      lotPools.set(token, lots.filter(l => l.amount > 0.000000001));
    }
  }

  // Aggregate
  let totalRealizedGains = 0;
  let totalRealizedLosses = 0;
  let shortTermGains = 0;
  let shortTermLosses = 0;
  let longTermGains = 0;
  let longTermLosses = 0;

  for (const e of events) {
    if (e.gainLoss >= 0) {
      totalRealizedGains += e.gainLoss;
      if (e.holdingPeriod === 'short') shortTermGains += e.gainLoss;
      else longTermGains += e.gainLoss;
    } else {
      totalRealizedLosses += Math.abs(e.gainLoss);
      if (e.holdingPeriod === 'short') shortTermLosses += Math.abs(e.gainLoss);
      else longTermLosses += Math.abs(e.gainLoss);
    }
  }

  return {
    totalRealizedGains,
    totalRealizedLosses,
    netGainLoss: totalRealizedGains - totalRealizedLosses,
    shortTermGains,
    shortTermLosses,
    longTermGains,
    longTermLosses,
    totalTrades: sorted.length,
    totalSells,
    totalBuys,
    events,
  };
}

function selectLots(lots: Lot[], method: CostBasisMethod): Lot[] {
  switch (method) {
    case 'fifo':
      // First In, First Out — already in order (oldest first)
      return lots;
    case 'lifo':
      // Last In, First Out — reverse order
      return [...lots].reverse();
    case 'hifo':
      // Highest In, First Out — highest cost per unit first (minimizes gains)
      return [...lots].sort((a, b) => b.costPerUnit - a.costPerUnit);
  }
}

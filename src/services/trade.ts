// src/services/trade.ts

export interface QuoteResponse {
  amountIn: string;
  amountOut: string;
  amountOutRaw: string;
  minAmountOut: string;
  rate: string;
  poolAddress: string;
  estimatedFees: string;
  originalQuote: any;
}

const toRawAmount = (amount: string, decimals: number = 18): string => {
  if (!amount) return "0";
  try {
    const [integer, fraction = ""] = amount.split(".");
    const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
    return `${integer}${paddedFraction}`.replace(/^0+/, "") || "0";
  } catch (e) { return "0"; }
};

const fromRawAmount = (raw: string, decimals: number = 18): string => {
  if (!raw || raw === "0") return "0";
  try {
    const str = raw.padStart(decimals + 1, "0");
    const integer = str.slice(0, str.length - decimals);
    const fraction = str.slice(str.length - decimals).replace(/0+$/, "");
    return fraction ? `${integer}.${fraction}` : integer;
  } catch (e) { return "0"; }
};

export const TradeService = {
  getQuote: async (
    network: 'main' | 'test',
    tokenIn: string,
    tokenOut: string,
    amountIn: string,
    decimalsIn: number = 18,
    decimalsOut: number = 18
  ): Promise<QuoteResponse> => {

    // ✅ FIX: Dynamic Base URL
    // Development: Use "/api" (Vite Proxy handles CORS)
    // Production: Use "https://api.alpacadex.com" directly (Backend handles CORS)
    const isDev = import.meta.env.MODE === 'development';
    const baseUrl = isDev ? "/api" : "https://api.alpacadex.com";

    // Use '/quote' to ensure we get the cryptographic signature needed for swapping
    const endpoint = network === 'main' ? '/quote' : '/test-quote';

    const amountRaw = toRawAmount(amountIn, decimalsIn);

    const body = {
      request: {
        from: tokenIn,
        to: tokenOut,
        amount: amountRaw,
        affinity: 'from'
      },
      baseTokenDecimals: decimalsIn,
      pairedTokenDecimals: decimalsOut,
      network
    };

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const raw = await res.json();

    if (!res.ok || (raw.ok === false && raw.error)) {
      throw new Error(raw.error || `Quote failed: ${res.statusText}`);
    }

    // Handle response wrapping (getQuote returns { quote: ... })
    const data = raw.quote || raw.estimate || raw;

    if (!data || !data.request) {
      throw new Error("Invalid quote response from server");
    }

    // Handle Hexadecimal (0x...) vs Decimal strings
    let amountOutRaw = data.convertedAmount || "0";
    if (amountOutRaw.startsWith("0x")) {
      amountOutRaw = BigInt(amountOutRaw).toString();
    }

    const amountOutHuman = fromRawAmount(amountOutRaw, 18);
    const rate = Number(amountOutHuman) / Number(amountIn);

    return {
      amountIn,
      amountOut: amountOutHuman,
      amountOutRaw,
      minAmountOut: amountOutRaw,
      rate: isNaN(rate) ? "0" : rate.toString(),
      // Backend now returns 'account' in the quote, which is the pool address
      poolAddress: data.account || "Unknown",
      // Quote uses 'cost', Estimate uses 'expectedCost'
      estimatedFees: BigInt(data.cost?.amount || data.expectedCost?.min || "0").toString(),
      originalQuote: data
    };
  },

  submitTrade: async (
    network: 'main' | 'test',
    payload: {
      network: string;
      swapBlock: string;
      originalQuote: any;
      tokenIn: { address: string; decimals: number };
      tokenOut: { address: string; decimals: number };
    }
  ) => {
    // ✅ FIX: Dynamic Base URL here too
    const isDev = import.meta.env.MODE === 'development';
    const baseUrl = isDev ? "/api" : "https://api.alpacadex.com";

    const endpoint = network === 'main' ? '/create-exchange' : '/create-test-exchange';

    const feeToken = payload.originalQuote.request?.affinity === 'from' ? payload.tokenIn.address : payload.tokenOut.address;

    // Patch decimals into the quote object for final verification
    const patchedQuote = { ...payload.originalQuote };
    patchedQuote.baseTokenDecimals = payload.tokenIn.decimals;
    patchedQuote.pairedTokenDecimals = payload.tokenOut.decimals;
    patchedQuote.baseToken = payload.tokenIn.address;
    patchedQuote.pairedToken = payload.tokenOut.address;

    const body = {
      request: {
        quote: patchedQuote,
        block: payload.swapBlock,
        fxFeeToken: feeToken
      }
    };

    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Swap failed");

    return json;
  }
};
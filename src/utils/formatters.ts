export function formatAmount18(rawStr: string | number, decimals: number = 18): string {
  try {
    if (!rawStr) return "0";
    const raw = BigInt(rawStr); // Convert number or string to BigInt
    const INT_DECIMALS = decimals;
    const DISPLAY_DECIMALS = 9;

    // Handle case where specific decimals < DISPLAY_DECIMALS to avoid negative exponent
    if (INT_DECIMALS < DISPLAY_DECIMALS) {
      // If decimals are small (e.g. 6), just format directly
      const val = Number(raw) / (10 ** INT_DECIMALS);
      return val.toLocaleString(undefined, { maximumFractionDigits: DISPLAY_DECIMALS });
    }

    const DECIMAL_FACTOR = BigInt(10) ** BigInt(DISPLAY_DECIMALS);
    const factor = BigInt(10) ** BigInt(INT_DECIMALS - DISPLAY_DECIMALS);
    const rounded = (raw + factor / BigInt(2)) / factor;

    // Calculate integer and fractional parts
    const intPart = rounded / DECIMAL_FACTOR;
    const fracPartBig = rounded % DECIMAL_FACTOR;
    const fracPart = fracPartBig.toString().padStart(DISPLAY_DECIMALS, "0");

    // Format integer part with commas
    const intFormatted = intPart.toLocaleString();

    // Trim trailing zeros in fractional part for cleaner display
    const cleanFrac = fracPart.replace(/0+$/, '');

    return cleanFrac ? `${intFormatted}.${cleanFrac}` : intFormatted;
  } catch (e) {
    console.error("Format Error", e);
    return "-";
  }
}

export const parseFormattedPrice = (priceStr: string | undefined): number => {
  if (!priceStr) return 0;
  const formatted = formatAmount18(priceStr);
  const val = parseFloat(formatted.replace(/,/g, ""));
  return Number.isNaN(val) ? 0 : val;
};

export const shortenAddress = (address: string): string => {
  if (!address || address.length < 10) return address;
  return `${address.substring(0, 10)}...${address.substring(address.length - 4)}`;
};

export const formatAxisNumber = (num: number): string => {
  if (num === 0) return "0";
  if (num < 0.000001) return num.toExponential(2);
  if (num < 1) return num.toPrecision(4);
  if (num >= 1000) return (num / 1000).toFixed(1) + "k";
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

export const formatDateLabel = (timestamp: number, timeframeDiff: number): string => {
  const date = new Date(timestamp);
  if (timeframeDiff < 172800000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

// --- Launchpad / Shared Number Formatters ---

export const formatNumber = (num: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);

export const formatCurrency = (num: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'KTA', maximumFractionDigits: 6 }).format(num);

export const parseRawAmount = (raw: string | undefined, decimals: number = 9): number => {
  if (!raw) return 0;
  const val = parseFloat(raw.replace(/,/g, ''));
  if (isNaN(val)) return 0;
  return val / Math.pow(10, decimals);
};


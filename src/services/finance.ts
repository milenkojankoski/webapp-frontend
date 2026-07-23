import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { cacheGet, cacheSet } from './cache';
import { formatAmount18 } from '../utils/formatters';
import type { WalletBalance } from './wallet';

// --- Fiat token addresses (Bivo on-chain fiat, mainnet only) ---
const FIAT_TOKENS: Record<string, string> = {
  "keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc": "USD",
  "keeta_aozyboy42uks7ticj72awfhpdxwqqfcowezxcew6ecaz5afdt7q2ffycxim4u": "CAD",
  "keeta_anjsvaiiycybwhixlalcpwuvobvmpll4lh24td5qipccegmvfi7c2qdcqnlgu": "AED",
  "keeta_anutgo4o3yp5tvc6wjt4vzsehjbn7t2wylpxmam4d4ojtdkjj2yca2qoinfcs": "EUR",
  "keeta_aojfknc74dabtg72mdhijtszdlv7gi3ht2xp2wrfmdagkthi4n7rulb5e54ss": "GBP",
  "keeta_apbn7f34cdq62d7iw4ui6sbfaz7fcqdit354wfaotu5zw6d6xfef5vluhdaos": "HKD",
  "keeta_aowqb2hvkak7frntfbtde27bdmqvxancrja7ndh24m66ahkbrzeda3crqh3vg": "JPY",
  "keeta_amb3hbd5gbhaorl4y2ddl3xn2q4eyi6dqkn5fpug6diz26v2awsdqhkivmyza": "MXN",
  "keeta_ao44m7r4utf2vvytsfijermgkstnkka6rp44eahrekvp4cmj5g2orzm3blrvc": "CNY",
};

// Stablecoins pegged 1:1 to USD
const STABLECOIN_TOKENS: Record<string, string> = {
  "keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna": "USDC",
  "keeta_apna75yhhvnv4ei7ape55hndk4yepno7a7i2mhtiwahiygixjcnmvswxhnmnk": "USDC",
};

export interface FxRates {
  [currency: string]: number;
}

export interface BalanceWithValue {
  symbol: string;
  address: string;
  amount: string;
  rawBalance: string;
  decimals: number;
  valueUsd: number;
  isFiat: boolean;
  fiatCurrency?: string;
}

export const FinanceService = {

  getKtaPriceUsd: async (): Promise<number> => {
    const cached = cacheGet<number>('finance_kta_usd', 60_000);
    if (cached !== undefined) return cached;

    try {
      const snap = await getDoc(doc(db, 'platform_stats', 'metrics'));
      const price = snap.exists() ? (snap.data().ktaPriceUSD || 0) : 0;
      cacheSet('finance_kta_usd', price);
      return price;
    } catch {
      return 0;
    }
  },

  getFxRates: async (): Promise<FxRates> => {
    const cached = cacheGet<FxRates>('finance_fx_rates', 5 * 60_000);
    if (cached) return cached;

    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      const data = await res.json();
      if (data.rates) {
        cacheSet('finance_fx_rates', data.rates);
        return data.rates;
      }
    } catch { /* fall through */ }

    return { USD: 1 };
  },

  isFiatToken: (address: string): boolean => {
    return address in FIAT_TOKENS;
  },

  isStablecoin: (address: string): boolean => {
    return address in STABLECOIN_TOKENS;
  },

  getFiatCurrency: (address: string): string | undefined => {
    return FIAT_TOKENS[address];
  },

  classifyBalances: (balances: WalletBalance[]): { fiat: WalletBalance[]; crypto: WalletBalance[] } => {
    const fiat: WalletBalance[] = [];
    const crypto: WalletBalance[] = [];
    for (const b of balances) {
      if (FIAT_TOKENS[b.address]) {
        fiat.push(b);
      } else {
        crypto.push(b);
      }
    }
    return { fiat, crypto };
  },

  /**
   * Estimate USD value for a single balance.
   * - Fiat tokens: use FX rate (e.g. 100 EUR * USD/EUR rate)
   * - USDC: 1:1 with USD
   * - KTA: use ktaPriceUsd
   * - Other tokens: pool price (in KTA) * KTA/USD price
   *
   * @param marketData - pool data keyed by token address (from Firestore pools collection)
   */
  estimateUsdValue: (
    balance: WalletBalance,
    ktaPriceUsd: number,
    fxRates: FxRates,
    marketData?: Record<string, any>
  ): number => {
    const amount = parseFloat(balance.amount.replace(/,/g, ''));
    if (isNaN(amount) || amount === 0) return 0;

    // Fiat tokens — convert via FX rate
    const fiatCurrency = FIAT_TOKENS[balance.address];
    if (fiatCurrency) {
      const rate = fxRates[fiatCurrency];
      return rate ? amount / rate : 0;
    }

    // Stablecoins — 1:1 USD
    if (STABLECOIN_TOKENS[balance.address]) {
      return amount;
    }

    // KTA
    if (balance.symbol === 'KTA' || balance.symbol === 'KEETA') {
      return amount * ktaPriceUsd;
    }

    // Other tokens — look up pool price (raw BigInt string priced in base token)
    if (marketData && ktaPriceUsd > 0) {
      const market = marketData[balance.address];
      if (market?.price) {
        const baseDecimals = market.baseTokenDecimals ?? 18;
        const priceInKta = parseFloat(formatAmount18(market.price, baseDecimals).replace(/,/g, ''));
        if (priceInKta > 0) {
          return amount * priceInKta * ktaPriceUsd;
        }
      }
    }

    return 0;
  },

  getHomeCurrency: (): string => {
    return localStorage.getItem('finance_home_currency') || 'USD';
  },

  setHomeCurrency: (currency: string): void => {
    localStorage.setItem('finance_home_currency', currency);
  },

  convertUsdTo: (usdAmount: number, targetCurrency: string, fxRates: FxRates): number => {
    if (targetCurrency === 'USD') return usdAmount;
    const rate = fxRates[targetCurrency];
    return rate ? usdAmount * rate : usdAmount;
  },
};

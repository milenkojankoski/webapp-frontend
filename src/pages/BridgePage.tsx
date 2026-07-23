import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useWallet } from '../context/WalletContext';
import BridgeBackground from '../components/common/CloudBackground';
import {
  getTokenBalance,
  getBaseDepositAddress,
  BRIDGE_ASSETS,
} from '../services/bridge';
import { formatAmount18 } from '../utils/formatters';
import { getKYCStatus } from '../services/certificate';
import { logger } from '../utils/logger';

// ── Bivo fiat conversion constants ──────────────────────────────────────────
const BIVO_PROVIDER_ID = 'bivo-anchor.keeta.com';
const USD_KEETA_ADDRESS = 'keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc';

// Bivo uses shorthand asset IDs ($USDC, $USD, $EUR, etc.), not full Keeta token addresses
const BIVO_ASSET_IDS: Record<string, string> = {
  'keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna': '$USDC',
  'keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc': '$USD',
  'keeta_anutgo4o3yp5tvc6wjt4vzsehjbn7t2wylpxmam4d4ojtdkjj2yca2qoinfcs': '$EUR',
  'keeta_aojfknc74dabtg72mdhijtszdlv7gi3ht2xp2wrfmdagkthi4n7rulb5e54ss': '$GBP',
  'keeta_aozyboy42uks7ticj72awfhpdxwqqfcowezxcew6ecaz5afdt7q2ffycxim4u': '$CAD',
  'keeta_aowqb2hvkak7frntfbtde27bdmqvxancrja7ndh24m66ahkbrzeda3crqh3vg': '$JPY',
  'keeta_apbn7f34cdq62d7iw4ui6sbfaz7fcqdit354wfaotu5zw6d6xfef5vluhdaos': '$HKD',
  'keeta_amb3hbd5gbhaorl4y2ddl3xn2q4eyi6dqkn5fpug6diz26v2awsdqhkivmyza': '$MXN',
  'keeta_ao44m7r4utf2vvytsfijermgkstnkka6rp44eahrekvp4cmj5g2orzm3blrvc': '$CNY',
  'keeta_anjsvaiiycybwhixlalcpwuvobvmpll4lh24td5qipccegmvfi7c2qdcqnlgu': '$AED',
};

const toBivoAssetId = (keetaAddr: string) => BIVO_ASSET_IDS[keetaAddr] || keetaAddr;

const FIAT_DESTINATIONS = [
  { id: 'fiat:USD', label: 'USD', symbol: '$USD', tokenAddress: 'keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc', decimals: 2 },
  { id: 'fiat:EUR', label: 'EUR', symbol: '$EUR', tokenAddress: 'keeta_anutgo4o3yp5tvc6wjt4vzsehjbn7t2wylpxmam4d4ojtdkjj2yca2qoinfcs', decimals: 2 },
  { id: 'fiat:GBP', label: 'GBP', symbol: '$GBP', tokenAddress: 'keeta_aojfknc74dabtg72mdhijtszdlv7gi3ht2xp2wrfmdagkthi4n7rulb5e54ss', decimals: 2 },
  { id: 'fiat:CAD', label: 'CAD', symbol: '$CAD', tokenAddress: 'keeta_aozyboy42uks7ticj72awfhpdxwqqfcowezxcew6ecaz5afdt7q2ffycxim4u', decimals: 2 },
  { id: 'fiat:JPY', label: 'JPY', symbol: '$JPY', tokenAddress: 'keeta_aowqb2hvkak7frntfbtde27bdmqvxancrja7ndh24m66ahkbrzeda3crqh3vg', decimals: 0 },
  { id: 'fiat:HKD', label: 'HKD', symbol: '$HKD', tokenAddress: 'keeta_apbn7f34cdq62d7iw4ui6sbfaz7fcqdit354wfaotu5zw6d6xfef5vluhdaos', decimals: 2 },
  { id: 'fiat:MXN', label: 'MXN', symbol: '$MXN', tokenAddress: 'keeta_amb3hbd5gbhaorl4y2ddl3xn2q4eyi6dqkn5fpug6diz26v2awsdqhkivmyza', decimals: 2 },
  { id: 'fiat:CNY', label: 'CNY', symbol: '$CNY', tokenAddress: 'keeta_ao44m7r4utf2vvytsfijermgkstnkka6rp44eahrekvp4cmj5g2orzm3blrvc', decimals: 2 },
  { id: 'fiat:AED', label: 'AED', symbol: '$AED', tokenAddress: 'keeta_anjsvaiiycybwhixlalcpwuvobvmpll4lh24td5qipccegmvfi7c2qdcqnlgu', decimals: 2 },
] as const;

const isFiatDestination = (id: string) => id.startsWith('fiat:');
const getFiatInfo = (id: string) => FIAT_DESTINATIONS.find(f => f.id === id) ?? null;

// KeetaNet FX Anchor — external service for USDC/EURC ↔ KTA swaps
// Proxied through the wallet extension (browser can't hit api.kta-fx.com directly — SSL cert issue)
const FX_ANCHOR_BASE: Record<string, string> = {
  main: 'https://api.kta-fx.com/api',
  test: 'https://demo-fx-anchor.test.keeta.com/api',
};

function toDecimalString(v: string | number): string {
  if (typeof v === 'number') return v.toString();
  if (typeof v === 'string' && v.startsWith('0x')) return BigInt(v).toString();
  return v;
}

async function fxAnchorCall(network: 'main' | 'test', operation: string, payload: any) {
  const base = FX_ANCHOR_BASE[network];
  const url = `${base}/${operation}`;
  if (window.alpaca?.fxProxy) {
    return window.alpaca.fxProxy(url, payload);
  }
  // Fallback: direct fetch (may fail due to SSL/CORS)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function fxEstimate(
  network: 'main' | 'test',
  from: string,
  to: string,
  rawAmount: string
) {
  const data = await fxAnchorCall(network, 'getEstimate', {
    request: { from, to, amount: rawAmount, affinity: 'from' },
  });
  if (!data.ok) throw new Error(data.error || 'FX estimate failed');
  const est = data.estimate;
  return {
    ...est,
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

async function fxCreateExchange(
  network: 'main' | 'test',
  from: string,
  to: string,
  rawAmount: string,
  blockBase64: string
) {
  const data = await fxAnchorCall(network, 'createExchange', {
    request: {
      request: { from, to, amount: rawAmount, affinity: 'from' },
      block: blockBase64,
    },
  });
  if (!data.ok) throw new Error(data.error || 'FX exchange failed');
  return data;
}

// Map chain location strings to human-readable labels
const CHAIN_LABELS: Record<string, string> = {
  'chain:evm:1': 'Ethereum',
  'chain:evm:8453': 'Base',
  'chain:evm:42161': 'Arbitrum',
  'chain:evm:43114': 'Avalanche',
  'chain:evm:137': 'Polygon',
  'chain:evm:56': 'BNB Chain',
  'chain:evm:10': 'Optimism',
  'chain:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'Solana',
  'chain:solana:mainnet': 'Solana',
  'chain:bitcoin:mainnet': 'Bitcoin',
  'chain:bitcoin:f9beb4d9': 'Bitcoin',
  'chain:tron:mainnet': 'Tron',
  'chain:litecoin:mainnet': 'Litecoin',
  'chain:dogecoin:mainnet': 'Dogecoin',
};

// Native token name per chain
const NATIVE_TOKEN_LABELS: Record<string, string> = {
  'chain:evm:1': 'ETH',
  'chain:evm:8453': 'ETH',
  'chain:evm:42161': 'ETH',
  'chain:evm:137': 'POL',
  'chain:evm:43114': 'AVAX',
  'chain:evm:56': 'BNB',
  'chain:evm:10': 'ETH',
};

// Well-known EVM token contract addresses → symbol
const EVM_TOKEN_LABELS: Record<string, string> = {
  '0x0000000000000000000000000000000000000000': 'NATIVE',
  // Ethereum
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 'USDC',
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': 'USDT',
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 'WETH',
  '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf': 'cbBTC',
  '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8': 'PYUSD',
  '0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD': 'EURC',
  '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c': 'EURC', // Ethereum EURC
  // Base
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 'USDC',
  '0x940181a94A35A4569E4529A3CDfB74e38FD98631': 'AERO',
  '0xc0634090F2Fe6c6d75e61Be2b949464aBB498973': 'DEGEN',
  '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42': 'BRETT',
  // Arbitrum
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': 'USDC',
  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9': 'USDT',
  '0x912CE59144191C1204E64559FE8253a0e49E6548': 'ARB',
  '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': 'WBTC',
  // Polygon
  '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359': 'USDC',
  '0xc2132D05D31c914a87C6611C10748AEb04B58e8F': 'USDT',
  '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619': 'WETH',
  '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6': 'WBTC',
  '0x172370d5Cd63279eFa6d502DAB29171933a610AF': 'CRV',
  '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39': 'LINK',
  '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590': 'STG',
  // Avalanche
  '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E': 'USDC',
  '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7': 'USDT',
  '0x1C20E891Bab6b1727d14Da358FAe2984Ed9B59EB': 'TUS',
  // Optimism
  '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85': 'USDC',
  '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58': 'USDT',
  '0x68f180fcCe6836688e9084f035309E29Bf0A2095': 'WBTC',
  '0x4200000000000000000000000000000000000006': 'WETH',
  '0x4200000000000000000000000000000000000042': 'OP',
};

// Solana token mint addresses → symbol
const SOLANA_TOKEN_LABELS: Record<string, string> = {
  'native': 'SOL',
  '11111111111111111111111111111111': 'SOL',
  'So11111111111111111111111111111111111111112': 'SOL',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': 'PYUSD',
  'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr': 'EURC',
};

// Keeta token addresses → symbol
const KEETA_TOKEN_LABELS: Record<string, string> = {
  'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg': 'KTA',
  'keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna': 'USDC',
  'keeta_apblhar4ncp3ln62wrygsn73pt3houuvj7ic47aarnolpcu67oqn4xqcji3au': 'EURC',
  'keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc': 'USD',
  'keeta_apyez4az5r6shtblf3qtzirmikq3tghb5svrmmrltdkxgnnzzhlstby3cuscc': 'cbBTC',
};

// Decimals per token address (for converting human-readable → raw units)
const NATIVE_TOKEN_DECIMALS: Record<string, number> = {
  'chain:evm:1': 18,
  'chain:evm:8453': 18,
  'chain:evm:42161': 18,
  'chain:evm:137': 18,
  'chain:evm:43114': 18,
  'chain:evm:56': 18,
  'chain:evm:10': 18,
  'chain:tron:mainnet': 6,
  'chain:solana:mainnet': 9,
  'chain:bitcoin:mainnet': 8,
  'chain:bitcoin:f9beb4d9': 8,
  'chain:litecoin:mainnet': 8,
  'chain:litecoin:fbc0b6db': 8,
  'chain:dogecoin:mainnet': 8,
  'chain:dogecoin:c0c0c0c0': 8,
};

const EVM_TOKEN_DECIMALS: Record<string, number> = {
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': 6,
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': 6,
  '0x6c3ea9036406852006290770BEdFcAbA0e23A0e8': 6,
  '0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD': 6,
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913': 6,
  '0xaf88d065e77c8cC2239327C5EDb3A432268e5831': 6,
  '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9': 6,
  '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359': 6,
  '0xc2132D05D31c914a87C6611C10748AEb04B58e8F': 6,
  '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E': 6,
  '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7': 6,
  '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': 18,
  '0x940181a94A35A4569E4529A3CDfB74e38FD98631': 18,
  '0x912CE59144191C1204E64559FE8253a0e49E6548': 18,
  '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619': 18,
  '0x172370d5Cd63279eFa6d502DAB29171933a610AF': 18,
  '0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39': 18,
  '0x2F6F07CDcf3588944Bf4C42aC74ff24bF56e7590': 18,
  '0x1C20E891Bab6b1727d14Da358FAe2984Ed9B59EB': 18,
  '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf': 8,
  '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f': 8,
  '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6': 8,
  '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c': 6, // EURC on Ethereum
  '0xc0634090F2Fe6c6d75e61Be2b949464aBB498973': 18, // DEGEN on Base
  '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42': 18, // BRETT on Base
  // Optimism
  '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85': 6,  // USDC
  '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58': 6,  // USDT
  '0x68f180fcCe6836688e9084f035309E29Bf0A2095': 8,  // WBTC
  '0x4200000000000000000000000000000000000006': 18, // WETH
  '0x4200000000000000000000000000000000000042': 18, // OP
};

const SOLANA_TOKEN_DECIMALS: Record<string, number> = {
  'native': 9,
  '11111111111111111111111111111111': 9,
  'So11111111111111111111111111111111111111112': 9,
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 6,
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 6,
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo': 6,
  'HzwqbKZw8HxMN6bF2yFZNrht3c2iXXzpKcFu7uBEDKtr': 6,
};

const TRON_TOKEN_DECIMALS: Record<string, number> = {
  'native': 6,  // TRX
  'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': 6,  // USDT
  'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8': 6,  // USDC
};

const SHORTHAND_DECIMALS: Record<string, number> = {
  '$USDT': 6,
  '$USDC': 6,
  '$EURC': 6,
  '$PYUSD': 6,
};

function getTokenDecimals(assetId: string, chainLocation: string): number {
  // Native tokens: 'native' or chain-specific like 'bitcoin:native', 'litecoin:native', 'dogecoin:native'
  if (assetId === 'native' || assetId.endsWith(':native')) {
    return NATIVE_TOKEN_DECIMALS[chainLocation] ?? 18;
  }
  if (assetId.startsWith('$')) {
    return SHORTHAND_DECIMALS[assetId] ?? 6;
  }
  if (assetId.startsWith('evm:')) {
    const addr = assetId.slice(4);
    if (addr.toLowerCase() === '0x0000000000000000000000000000000000000000') {
      return NATIVE_TOKEN_DECIMALS[chainLocation] ?? 18;
    }
    return evmDecimalsLookup(addr) ?? 18;
  }
  if (assetId.startsWith('solana:')) {
    const mint = assetId.slice(7);
    return SOLANA_TOKEN_DECIMALS[mint] ?? 9;
  }
  if (assetId.startsWith('tron:')) {
    const addr = assetId.slice(5);
    return TRON_TOKEN_DECIMALS[addr] ?? 6;
  }
  const KEETA_TOKEN_DECIMALS: Record<string, number> = {
    'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg': 18, // KTA
    'keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna': 6,  // USDC
    'keeta_apblhar4ncp3ln62wrygsn73pt3houuvj7ic47aarnolpcu67oqn4xqcji3au': 6,  // EURC
    'keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc': 2,  // USD (on-chain fiat)
    'keeta_apyez4az5r6shtblf3qtzirmikq3tghb5svrmmrltdkxgnnzzhlstby3cuscc': 8,  // cbBTC
  };
  return KEETA_TOKEN_DECIMALS[assetId] ?? 18;
}

function toRawAmount(humanAmount: string, decimals: number): string {
  const parts = humanAmount.split('.');
  const whole = parts[0] || '0';
  let frac = parts[1] || '';
  if (frac.length > decimals) frac = frac.slice(0, decimals);
  frac = frac.padEnd(decimals, '0');
  const raw = whole + frac;
  return raw.replace(/^0+/, '') || '0';
}

function fromRawAmount(rawAmount: string, decimals: number): string {
  if (!rawAmount || rawAmount === '0') return '0';
  const raw = rawAmount.replace(/^0+/, '') || '0';
  if (decimals === 0) return raw;
  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

const KEETA_LOCATIONS = ['chain:keeta:21378', 'chain:keeta:1413829460'];

// Case-insensitive EVM address lookup (provider may return lowercase, maps use checksummed)
function evmLabelLookup(addr: string): string | undefined {
  const direct = EVM_TOKEN_LABELS[addr];
  if (direct) return direct;
  const lower = addr.toLowerCase();
  for (const [key, val] of Object.entries(EVM_TOKEN_LABELS)) {
    if (key.toLowerCase() === lower) return val;
  }
  return undefined;
}

function evmDecimalsLookup(addr: string): number | undefined {
  const direct = EVM_TOKEN_DECIMALS[addr];
  if (direct !== undefined) return direct;
  const lower = addr.toLowerCase();
  for (const [key, val] of Object.entries(EVM_TOKEN_DECIMALS)) {
    if (key.toLowerCase() === lower) return val;
  }
  return undefined;
}

// Shorthand IDs ($USDT, $PYUSD) and Tron tokens
const SHORTHAND_LABELS: Record<string, string> = {
  '$USDT': 'USDT',
  '$PYUSD': 'PYUSD',
  '$USDC': 'USDC',
  '$EURC': 'EURC',
};

const TRON_TOKEN_LABELS: Record<string, string> = {
  'native': 'TRX',
  'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t': 'USDT',
  'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8': 'USDC',
};

function getTokenLabel(assetId: string, chainLocation: string, providerName?: string): string {
  // $-prefixed shorthand (e.g. $USDT, $PYUSD)
  if (assetId.startsWith('$')) {
    return SHORTHAND_LABELS[assetId] || assetId.slice(1);
  }
  if (assetId.startsWith('evm:')) {
    const addr = assetId.slice(4);
    const label = evmLabelLookup(addr);
    if (label === 'NATIVE') return NATIVE_TOKEN_LABELS[chainLocation] || 'ETH';
    if (label) return label;
    if (providerName) return providerName;
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }
  if (assetId.startsWith('solana:')) {
    const mint = assetId.slice(7);
    return SOLANA_TOKEN_LABELS[mint] || providerName || mint.slice(0, 6) + '...';
  }
  if (assetId.startsWith('tron:')) {
    const addr = assetId.slice(5);
    return TRON_TOKEN_LABELS[addr] || providerName || addr.slice(0, 6) + '...';
  }
  if (assetId.startsWith('keeta_')) {
    return KEETA_TOKEN_LABELS[assetId] || providerName || 'Token';
  }
  // Chain-native tokens: 'bitcoin:native' → 'BTC', 'litecoin:native' → 'LTC', etc.
  if (assetId.endsWith(':native')) {
    const chain = assetId.split(':')[0];
    const CHAIN_NATIVE_LABELS: Record<string, string> = {
      bitcoin: 'BTC', litecoin: 'LTC', dogecoin: 'DOGE',
    };
    return CHAIN_NATIVE_LABELS[chain] || providerName || chain.toUpperCase();
  }
  return providerName || assetId.slice(0, 10) + '...';
}

interface BridgeRoute {
  providerID: string;
  fromLocation: string;
  fromAssetId: string;
  toLocation: string;
  toAssetId: string;
  fromTokenLabel: string;
  toTokenLabel: string;
  chainLabel: string;
}

type BridgeStep = 'configure' | 'quote' | 'instructions' | 'polling' | 'fx-swapping' | 'fiat-converting' | 'complete';

// KTA token address on Keeta mainnet — routes targeting this get routed through USDC
const KTA_TOKEN_ADDRESS = 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg';
// Preferred USDC intermediary on Keeta for FX routing
const USDC_KEETA_ADDRESS = 'keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna';

function isKtaDestination(route: BridgeRoute): boolean {
  return route.toAssetId === KTA_TOKEN_ADDRESS;
}

/** Find a USDC route with the same source chain + source token. */
function findUsdcRoute(allRoutes: BridgeRoute[], sourceRoute: BridgeRoute): BridgeRoute | null {
  const matches = allRoutes.filter(r =>
    r.fromLocation === sourceRoute.fromLocation &&
    r.fromAssetId === sourceRoute.fromAssetId &&
    r.toAssetId === USDC_KEETA_ADDRESS
  );
  // Prefer changenow-staging over other providers
  return matches.find(r => r.providerID === 'changenow-staging') || matches[0] || null;
}

interface QuoteData {
  receiveAmount: string;
  receiveLabel: string;
  sendAmount: string;
  sendLabel: string;
  feeAmount: string;
  feeLabel: string;
  type: string;
  // KTA routing fields (when bridging through USDC → KTA)
  isKtaRouted?: boolean;
  intermediateAmount?: string;  // USDC amount from bridge
  ktaAmount?: string;           // KTA amount from FX estimate
  ktaFee?: string;              // FX anchor fee
  // Fiat routing fields (when bridging through USDC → Bivo → fiat)
  isFiatRouted?: boolean;
  fiatCurrency?: string;        // e.g. 'USD', 'EUR'
  bivoReceiveAmount?: string;   // final fiat amount from Bivo simulation
  bivoFee?: string;             // Bivo fee estimate
  bivoSteps?: number;           // 1 (USDC→USD) or 2 (USDC→USD→EUR)
}

interface TransferInstructions {
  transferId: string;
  instructions: any[];
}

interface TransactionStatus {
  id: string;
  status: string;
  from: { location: string; value: string };
  to: { location: string; value: string };
  fee: { value: string } | null;
  createdAt: string;
  updatedAt: string;
  additionalTransferDetails?: { type: 'markdown' | 'plaintext'; content: string };
}

function extractRoutes(providers: any[]): BridgeRoute[] {
  const routes: BridgeRoute[] = [];
  const seen = new Set<string>();

  // On-chain fiat asset IDs from the keeta provider (e.g. $USD, $EUR)
  const FIAT_ASSET_PREFIXES = ['$USD', '$EUR', '$GBP', '$CHF', '$JPY', '$CAD', '$AUD'];
  const isFiatAsset = (id: string) => FIAT_ASSET_PREFIXES.some(p => id === p || id.startsWith(p + '.'));

  for (const provider of providers) {
    // changenow-staging: include all routes
    // keeta provider: only include on-chain fiat routes (e.g. $USD, $EUR)
    const isChangeNow = provider.providerID === 'changenow-staging';
    const isKeeta = provider.providerID === 'keeta';
    if (!isChangeNow && !isKeeta) continue;
    const assets = provider.supportedAssets || [];
    for (const assetEntry of assets) {
      const paths = assetEntry.paths || [];
      for (const path of paths) {
        const pair = path.pair;
        if (!pair || pair.length < 2) continue;

        const [side0, side1] = pair;
        let fromSide: any = null;
        let toSide: any = null;

        if (KEETA_LOCATIONS.includes(side1.location) && !KEETA_LOCATIONS.includes(side0.location)) {
          fromSide = side0;
          toSide = side1;
        } else if (KEETA_LOCATIONS.includes(side0.location) && !KEETA_LOCATIONS.includes(side1.location)) {
          fromSide = side1;
          toSide = side0;
        } else {
          continue;
        }

        if (!fromSide.location?.startsWith('chain:')) continue;

        // From keeta provider, only include on-chain fiat routes
        if (isKeeta && !isFiatAsset(fromSide.id) && !isFiatAsset(toSide.id)) continue;

        // Skip routes where initiateTransfer is explicitly unsupported (e.g. persistent-forwarding-only)
        const inboundRails = fromSide.rails?.inbound;
        if (Array.isArray(inboundRails)) {
          const allDisabled = inboundRails.every((r: any) =>
            typeof r === 'object' && r.supportedOperations?.initiateTransfer === false
          );
          if (inboundRails.length > 0 && allDisabled) continue;
        }

        const key = `${provider.providerID}:${fromSide.location}:${fromSide.id}:${toSide.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Provider may include symbol/name/ticker on each pair side — use as fallback
        const fromName = fromSide.symbol || fromSide.name || fromSide.ticker || path.symbol || path.name || assetEntry.symbol || assetEntry.name;
        const toName = toSide.symbol || toSide.name || toSide.ticker;


        routes.push({
          providerID: provider.providerID,
          fromLocation: fromSide.location,
          fromAssetId: fromSide.id,
          toLocation: toSide.location,
          toAssetId: toSide.id,
          fromTokenLabel: getTokenLabel(fromSide.id, fromSide.location, fromName),
          toTokenLabel: getTokenLabel(toSide.id, toSide.location, toName),
          chainLabel: CHAIN_LABELS[fromSide.location] || fromSide.location,
        });
      }
    }
  }

  return routes;
}

function formatAddress(addr: any): string {
  if (typeof addr === 'string') return addr;
  if (addr?.recipient) return addr.recipient;
  if (addr?.address) return addr.address;
  return JSON.stringify(addr);
}

/**
 * Build the best QR code value for a deposit address based on chain type.
 * - EVM chains: EIP-681 `ethereum:` URI with optional token contract + amount
 * - Bitcoin/Litecoin/Dogecoin: BIP-21 `bitcoin:`/`litecoin:`/`dogecoin:` URI with amount
 * - Solana/Tron/other: plain address (universally scannable)
 */
function buildDepositQrValue(
  address: string,
  chainLocation: string,
  assetId: string,
  rawValue?: string,
  decimals?: number,
): string {
  const addr = formatAddress(address);
  const humanAmount = rawValue && decimals != null ? fromRawAmount(rawValue, decimals) : undefined;

  // EVM chains — EIP-681
  if (chainLocation.startsWith('chain:evm:')) {
    const chainId = chainLocation.split(':')[2];
    const isNativeToken = assetId.startsWith('evm:') &&
      assetId.slice(4) === '0x0000000000000000000000000000000000000000';

    if (isNativeToken) {
      // Native ETH/POL/AVAX/BNB: ethereum:<address>@<chainId>?value=<wei>
      const chainSuffix = chainId && chainId !== '1' ? `@${chainId}` : '';
      const query = rawValue && rawValue !== '0' ? `?value=${rawValue}` : '';
      return `ethereum:${addr}${chainSuffix}${query}`;
    } else {
      // ERC-20 token: ethereum:<contractAddress>@<chainId>/transfer?address=<recipient>&uint256=<rawAmount>
      const contractAddress = assetId.startsWith('evm:') ? assetId.slice(4) : assetId;
      const chainSuffix = chainId && chainId !== '1' ? `@${chainId}` : '';
      const params = [`address=${addr}`];
      if (rawValue && rawValue !== '0') params.push(`uint256=${rawValue}`);
      return `ethereum:${contractAddress}${chainSuffix}/transfer?${params.join('&')}`;
    }
  }

  // Bitcoin — BIP-21
  if (chainLocation.startsWith('chain:bitcoin:')) {
    const query = humanAmount ? `?amount=${humanAmount}` : '';
    return `bitcoin:${addr}${query}`;
  }

  // Litecoin — BIP-21 style
  if (chainLocation.startsWith('chain:litecoin:')) {
    const query = humanAmount ? `?amount=${humanAmount}` : '';
    return `litecoin:${addr}${query}`;
  }

  // Dogecoin — BIP-21 style
  if (chainLocation.startsWith('chain:dogecoin:')) {
    const query = humanAmount ? `?amount=${humanAmount}` : '';
    return `dogecoin:${addr}${query}`;
  }

  // Solana, Tron, others — plain address (most universally compatible)
  return addr;
}

function parseQuoteFromInstructions(instructions: any[], route: BridgeRoute): QuoteData | null {
  if (!instructions || instructions.length === 0) return null;
  const instr = instructions[0];

  const sendDecimals = getTokenDecimals(route.fromAssetId, route.fromLocation);
  // Anchor returns receive/fee amounts in the destination token's native decimals
  const receiveDecimals = getTokenDecimals(route.toAssetId, route.toLocation);

  let feeAmount = '0';
  let feeLabel = route.toTokenLabel;
  if (instr.assetFee) {
    const fee = typeof instr.assetFee === 'object' ? instr.assetFee : { total: instr.assetFee };
    const feePricedIn = fee.totalPricedIn || route.toAssetId;
    feeLabel = getTokenLabel(feePricedIn, route.toLocation);
    feeAmount = fromRawAmount(String(fee.total), receiveDecimals);
  }

  return {
    sendAmount: fromRawAmount(String(instr.value || '0'), sendDecimals),
    sendLabel: route.fromTokenLabel,
    receiveAmount: fromRawAmount(String(instr.totalReceiveAmount || '0'), receiveDecimals),
    receiveLabel: route.toTokenLabel,
    feeAmount,
    feeLabel,
    type: instr.type || '',
  };
}

const Spinner: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ── Chain & token icons for BridgeSelector ──────────────────────────────────
// Trust Wallet open-source CDN (jsDelivr) — reliable, free, no API key needed
const TW = 'https://cdn.jsdelivr.net/gh/trustwallet/assets@master/blockchains';

const CHAIN_ICON_URLS: Record<string, string> = {
  'chain:evm:1':     `${TW}/ethereum/info/logo.png`,
  'chain:evm:8453':  `${TW}/base/info/logo.png`,
  'chain:evm:42161': `${TW}/arbitrum/info/logo.png`,
  'chain:evm:43114': `${TW}/avalanchec/info/logo.png`,
  'chain:evm:137':   `${TW}/polygon/info/logo.png`,
  'chain:evm:56':    `${TW}/smartchain/info/logo.png`,
  'chain:evm:10':    `${TW}/optimism/info/logo.png`,
  'chain:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': `${TW}/solana/info/logo.png`,
  'chain:solana:mainnet': `${TW}/solana/info/logo.png`,
  'chain:bitcoin:mainnet': `${TW}/bitcoin/info/logo.png`,
  'chain:bitcoin:f9beb4d9': `${TW}/bitcoin/info/logo.png`,
  'chain:tron:mainnet':    `${TW}/tron/info/logo.png`,
  'chain:litecoin:mainnet': `${TW}/litecoin/info/logo.png`,
  'chain:dogecoin:mainnet': `${TW}/dogecoin/info/logo.png`,
};

// Fallback colors for chain letter icons (used if CDN image fails to load)
const CHAIN_COLORS: Record<string, string> = {
  'chain:evm:1': '#627EEA', 'chain:evm:8453': '#0052FF', 'chain:evm:42161': '#28A0F0',
  'chain:evm:43114': '#E84142', 'chain:evm:137': '#8247E5', 'chain:evm:56': '#F0B90B',
  'chain:evm:10': '#FF0420', 'chain:solana:mainnet': '#9945FF', 'chain:bitcoin:mainnet': '#F7931A',
  'chain:tron:mainnet': '#FF0013', 'chain:litecoin:mainnet': '#345D9D', 'chain:dogecoin:mainnet': '#C2A633',
};

// Token logos: local PNGs for Keeta-native, Trust Wallet CDN for external tokens (by Ethereum contract address)
const TOKEN_LOGO_URLS: Record<string, string> = {
  // Local / Firebase Storage
  'USDC': '/usdc.png',
  'EURC': '/eurc.png',
  'cbBTC': '/cbbtc.png',
  'KTA':  `https://firebasestorage.googleapis.com/v0/b/kta-liquidity-pool.firebasestorage.app/o/${encodeURIComponent('keetaMain_keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg_small.jpeg')}?alt=media`,
  // Trust Wallet CDN (Ethereum mainnet contract addresses)
  'ETH':   `${TW}/ethereum/info/logo.png`,
  'WETH':  `${TW}/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png`,
  'USDT':  `${TW}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png`,
  'WBTC':  `${TW}/ethereum/assets/0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f/logo.png`,
  'LINK':  `${TW}/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png`,
  'PYUSD': `${TW}/ethereum/assets/0x6c3ea9036406852006290770BEdFcAbA0e23A0e8/logo.png`,
  'ARB':   `${TW}/arbitrum/info/logo.png`,
  'BNB':   `${TW}/smartchain/info/logo.png`,
  'SOL':   `${TW}/solana/info/logo.png`,
  'BTC':   `${TW}/bitcoin/info/logo.png`,
  'TRX':   `${TW}/tron/info/logo.png`,
  'AVAX':  `${TW}/avalanchec/info/logo.png`,
  'POL':   `${TW}/polygon/info/logo.png`,
  'DOGE':  `${TW}/dogecoin/info/logo.png`,
  'LTC':   `${TW}/litecoin/info/logo.png`,
  'AERO':  `${TW}/base/assets/0x940181a94A35A4569E4529A3CDfB74e38FD98631/logo.png`,
  'DEGEN': `${TW}/base/assets/0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed/logo.png`,
  'BRETT': `${TW}/base/assets/0x532f27101965dd16442E59d40670FaF5eBB142E4/logo.png`,
  'OP':    `${TW}/optimism/info/logo.png`,
  'CRV':   `${TW}/ethereum/assets/0xD533a949740bb3306d119CC777fa900bA034cd52/logo.png`,
  'STG':   `${TW}/ethereum/assets/0xAf5191B0De278C7286d6C7CC6ab6BB8A73bA2Cd6/logo.png`,
  'TUS':   `${TW}/avalanchec/assets/0xf693248F96Fe03422FEa95aC0aFbBBc4a8FdD172/logo.png`,
};

const TOKEN_FALLBACK_COLORS: Record<string, string> = {
  'KTA': '#845fbc', 'ETH': '#627EEA', 'BTC': '#F7931A', 'SOL': '#9945FF',
  'USDT': '#26A17B', 'BNB': '#F0B90B', 'TRX': '#FF0013', 'AVAX': '#E84142',
  'DOGE': '#C2A633', 'LTC': '#345D9D',
};

const FIAT_FLAGS: Record<string, string> = {
  'USD': 'us', 'EUR': 'eu', 'GBP': 'gb', 'CAD': 'ca',
  'JPY': 'jp', 'HKD': 'hk', 'MXN': 'mx', 'CNY': 'cn', 'AED': 'ae',
};

function getChainIcon(location: string, label: string): { icon?: string; iconFallback?: string; iconColor?: string } {
  const url = CHAIN_ICON_URLS[location];
  if (url) return { icon: url, iconFallback: label.charAt(0), iconColor: CHAIN_COLORS[location] || '#845fbc' };
  return { iconFallback: label.charAt(0), iconColor: '#845fbc' };
}

function getTokenIcon(label: string): { icon?: string; iconFallback?: string; iconColor?: string } {
  const cleanLabel = label.replace('$', '');
  const logoUrl = TOKEN_LOGO_URLS[cleanLabel];
  if (logoUrl) return { icon: logoUrl, iconFallback: cleanLabel.charAt(0), iconColor: TOKEN_FALLBACK_COLORS[cleanLabel] || '#845fbc' };
  const flag = FIAT_FLAGS[cleanLabel];
  if (flag) return { icon: `https://flagcdn.com/w80/${flag}.png`, iconFallback: cleanLabel.charAt(0), iconColor: '#845fbc' };
  return { iconFallback: cleanLabel.charAt(0), iconColor: TOKEN_FALLBACK_COLORS[cleanLabel] || '#845fbc' };
}

// ── Bridge Selector (combobox dropdown) ─────────────────────────────────────
interface BridgeSelectorOption {
  id: string;
  label: string;
  subtitle?: string;
  group?: string;
  icon?: string;        // URL to icon image
  iconFallback?: string; // single letter/emoji fallback when no icon URL
  iconColor?: string;    // bg color for letter fallback circle
  disabled?: boolean;    // greyed out, not selectable
  badge?: string;        // small badge text (e.g. "coming soon")
}

interface BridgeSelectorProps {
  options: BridgeSelectorOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const BridgeSelector: React.FC<BridgeSelectorProps> = ({ options, value, onChange, placeholder = 'Select...', disabled }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find(o => o.id === value);
  const selectedLabel = selected?.label || '';

  const OptionIcon: React.FC<{ opt: BridgeSelectorOption; size?: string }> = ({ opt, size = 'w-5 h-5' }) => {
    const [imgFailed, setImgFailed] = useState(false);
    if (opt.icon && !imgFailed) {
      return <img src={opt.icon} alt="" className={`${size} rounded-full object-cover shrink-0`} onError={() => setImgFailed(true)} />;
    }
    if (opt.iconFallback) {
      return (
        <div className={`${size} rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0`} style={{ backgroundColor: opt.iconColor || '#845fbc' }}>
          {opt.iconFallback}
        </div>
      );
    }
    return null;
  };

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen && inputRef.current) inputRef.current.focus();
  }, [isOpen]);

  const filtered = options.filter(o => {
    const q = search.toLowerCase();
    return o.label.toLowerCase().includes(q) ||
      (o.subtitle || '').toLowerCase().includes(q) ||
      (o.group || '').toLowerCase().includes(q);
  });

  // Build grouped structure for rendering
  const grouped: { group: string | undefined; items: BridgeSelectorOption[] }[] = [];
  let currentGroup: string | symbol = Symbol();
  for (const opt of filtered) {
    const g = opt.group;
    if (g !== currentGroup || grouped.length === 0) {
      grouped.push({ group: g, items: [] });
      currentGroup = g ?? Symbol();
    }
    grouped[grouped.length - 1].items.push(opt);
  }

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setSearch('');
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md text-[13px] border transition-colors outline-none ${
          isOpen
            ? 'border-[#845fbc]/40 ring-1 ring-[#845fbc]/40'
            : 'border-gray-200 dark:border-white/[0.08] hover:border-gray-300 dark:hover:border-white/[0.12]'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} bg-white dark:bg-white/[0.04]`}
      >
        <span className={`truncate flex items-center gap-2 ${value ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
          {selected && <OptionIcon opt={selected} />}
          {value ? selectedLabel : placeholder}
        </span>
        <svg className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] shadow-lg overflow-hidden">
          {/* Search input */}
          {options.length > 5 && (
            <div className="p-2 border-b border-gray-100 dark:border-white/[0.04]">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  ref={inputRef}
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-md text-[13px] border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 transition-colors"
                />
              </div>
            </div>
          )}

          {/* Options list */}
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[13px] text-gray-400 dark:text-gray-500">No results</div>
            ) : (
              grouped.map((section, si) => (
                <div key={si}>
                  {section.group && (
                    <div className="px-3 pt-2.5 pb-1 text-[10px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 select-none">
                      {section.group}
                    </div>
                  )}
                  {section.items.map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => !opt.disabled && handleSelect(opt.id)}
                      disabled={opt.disabled}
                      className={`w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2 ${
                        opt.disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : opt.id === value
                            ? 'bg-[#845fbc]/8 text-[#845fbc] font-semibold'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/[0.02]'
                      }`}
                    >
                      <OptionIcon opt={opt} />
                      <div className="flex flex-col min-w-0">
                        <span className="truncate">{opt.label}</span>
                        {opt.subtitle && (
                          <span className={`text-[11px] truncate ${opt.id === value ? 'text-[#845fbc]/60' : 'text-gray-400 dark:text-gray-500'}`}>
                            {opt.subtitle}
                          </span>
                        )}
                      </div>
                      {opt.badge && (
                        <span className="ml-auto shrink-0 px-1.5 py-0.5 rounded-md text-[9px] font-semibold uppercase tracking-[0.06em] border border-gray-200 dark:border-white/[0.08] text-gray-400 dark:text-gray-500">
                          {opt.badge}
                        </span>
                      )}
                      {!opt.badge && opt.id === value && (
                        <svg className="w-3.5 h-3.5 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const BridgePage: React.FC = () => {
  const { isConnected, address } = useWallet();

  const [step, setStep] = useState<BridgeStep>('configure');
  const [error, setError] = useState('');
  const [routes, setRoutes] = useState<BridgeRoute[]>([]);
  const [selectedChain, setSelectedChain] = useState('');
  const [selectedFromToken, setSelectedFromToken] = useState('');
  const [selectedToToken, setSelectedToToken] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [transfer, setTransfer] = useState<TransferInstructions | null>(null);
  const [txStatus, setTxStatus] = useState<TransactionStatus | null>(null);
  const [copied, setCopied] = useState('');
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [initiating, setInitiating] = useState(false);
  const [fxSwapStatus, setFxSwapStatus] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const exchangeWatcherRef = useRef<(() => void) | null>(null);
  // For KTA routing: the actual USDC route used with ChangeNow
  const ktaUsdcRouteRef = useRef<BridgeRoute | null>(null);
  // For fiat routing: info about the Bivo conversion leg(s)
  const fiatRouteRef = useRef<{ usdcRoute: BridgeRoute; fiat: typeof FIAT_DESTINATIONS[number] } | null>(null);

  // KYC status for keeta provider fiat routes
  const [isKycVerified, setIsKycVerified] = useState<boolean | null>(null);
  // Bivo KYC onboarding: tracks whether KYC has been shared with Bivo specifically
  const [bivoKycShared, setBivoKycShared] = useState<boolean>(false);
  const [bivoKycSharing, setBivoKycSharing] = useState<boolean>(false);
  const [bivoKycError, setBivoKycError] = useState<string>('');

  // Base persistent deposit address
  const [baseDepositAddress, setBaseDepositAddress] = useState<string | null>(null);
  const [loadingBaseAddress, setLoadingBaseAddress] = useState(false);
  const [baseAddressError, setBaseAddressError] = useState('');
  const [baseCopied, setBaseCopied] = useState(false);
  const BASE_CHAIN_LOCATION = 'chain:evm:8453';
  // Synthetic from-token IDs for Base persistent deposit tokens (not from ChangeNow)
  const BASE_DEPOSIT_TOKENS = ['base-deposit:USDC', 'base-deposit:KTA', 'base-deposit:EURC', 'base-deposit:cbBTC'];
  const isBaseDepositToken = BASE_DEPOSIT_TOKENS.includes(selectedFromToken);

  // Check KYC status when wallet connects
  useEffect(() => {
    if (!address) { setIsKycVerified(null); setBivoKycShared(false); return; }
    getKYCStatus(address, 'main').then(status => setIsKycVerified(status.verified)).catch(() => setIsKycVerified(false));
    // Check cached Bivo KYC status
    try {
      const cached = sessionStorage.getItem(`alpaca_bivo_kyc_${address}`);
      if (cached === 'true') setBivoKycShared(true);
    } catch {}
  }, [address]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (exchangeWatcherRef.current) exchangeWatcherRef.current();
    };
  }, []);

  // Unique chains — only show chains we have labels for, plus Base for persistent deposits
  const chains = useMemo(() => {
    const chainMap = new Map<string, string>();
    const chainTokens = new Map<string, Set<string>>();
    for (const r of routes) {
      // Skip chains we don't have a proper name for (obscure/unsupported networks)
      if (!CHAIN_LABELS[r.fromLocation]) continue;
      if (!chainMap.has(r.fromLocation)) {
        chainMap.set(r.fromLocation, r.chainLabel);
        chainTokens.set(r.fromLocation, new Set());
      }
      chainTokens.get(r.fromLocation)!.add(r.fromTokenLabel);
    }
    if (routes.length > 0 && !chainMap.has(BASE_CHAIN_LOCATION)) {
      chainMap.set(BASE_CHAIN_LOCATION, 'Base');
      chainTokens.set(BASE_CHAIN_LOCATION, new Set(['USDC', 'EURC', 'KTA', 'cbBTC']));
    }
    return Array.from(chainMap.entries()).map(([location, label]) => ({
      location,
      label,
      tokens: Array.from(chainTokens.get(location) || []).join(', '),
    }));
  }, [routes]);

  // Unique source tokens for selected chain
  const fromTokens = useMemo(() => {
    if (!selectedChain) return [];
    const tokens: { id: string; label: string }[] = [];
    // Add persistent deposit tokens when Base is selected
    if (selectedChain === BASE_CHAIN_LOCATION) {
      tokens.push(
        { id: 'base-deposit:USDC', label: 'USDC' },
        { id: 'base-deposit:EURC', label: 'EURC' },
        { id: 'base-deposit:KTA', label: 'KTA' },
        { id: 'base-deposit:cbBTC', label: 'cbBTC' },
      );
    }
    const tokenMap = new Map<string, string>();
    for (const r of routes) {
      if (r.fromLocation === selectedChain && !tokenMap.has(r.fromAssetId)) {
        tokenMap.set(r.fromAssetId, r.fromTokenLabel);
      }
    }
    tokens.push(...Array.from(tokenMap.entries()).map(([id, label]) => ({ id, label })));
    return tokens;
  }, [routes, selectedChain]);

  // Unique destination tokens for selected chain + source token (with groups for BridgeSelector)
  const toTokens = useMemo((): BridgeSelectorOption[] => {
    if (!selectedChain || !selectedFromToken) return [];
    const tokenMap = new Map<string, string>();
    for (const r of routes) {
      if (r.fromLocation === selectedChain && r.fromAssetId === selectedFromToken && !tokenMap.has(r.toAssetId)) {
        tokenMap.set(r.toAssetId, r.toTokenLabel);
      }
    }
    const tokens: BridgeSelectorOption[] = Array.from(tokenMap.entries()).map(([id, label]) => ({ id, label, group: 'Crypto', ...getTokenIcon(label) }));

    // Add fiat destinations if a USDC route exists for this source
    const hasUsdcRoute = routes.some(r =>
      r.fromLocation === selectedChain &&
      r.fromAssetId === selectedFromToken &&
      r.toAssetId === USDC_KEETA_ADDRESS
    );
    if (hasUsdcRoute) {
      for (const fiat of FIAT_DESTINATIONS) {
        tokens.push({ id: fiat.id, label: fiat.symbol, group: 'On-Chain Fiat', disabled: true, badge: 'coming soon', ...getTokenIcon(fiat.label) });
      }
    }

    return tokens;
  }, [routes, selectedChain, selectedFromToken]);

  // Selected route from chain + fromToken + toToken
  const selectedRoute = useMemo(() => {
    if (!selectedChain || !selectedFromToken || !selectedToToken) return null;

    // For fiat destinations, build a synthetic route from the USDC route
    if (isFiatDestination(selectedToToken)) {
      const fiat = getFiatInfo(selectedToToken);
      const usdcMatches = routes.filter(r =>
        r.fromLocation === selectedChain &&
        r.fromAssetId === selectedFromToken &&
        r.toAssetId === USDC_KEETA_ADDRESS
      );
      const usdcRoute = usdcMatches.find(r => r.providerID === 'changenow-staging') || usdcMatches[0];
      if (!usdcRoute || !fiat) return null;
      return {
        ...usdcRoute,
        toAssetId: fiat.tokenAddress,
        toTokenLabel: fiat.symbol,
        toLocation: 'chain:keeta:21378',
      };
    }

    const matches = routes.filter(r =>
      r.fromLocation === selectedChain &&
      r.fromAssetId === selectedFromToken &&
      r.toAssetId === selectedToToken
    );
    // Prefer changenow-staging over other providers (e.g. keeta/bridge which may require KYC)
    return matches.find(r => r.providerID === 'changenow-staging') || matches[0] || null;
  }, [routes, selectedChain, selectedFromToken, selectedToToken]);

  // Is the selected route a keeta-provider fiat route or a fiat destination?
  const isFiatRoute = selectedRoute?.providerID === 'keeta' || isFiatDestination(selectedToToken);
  const needsOnChainKyc = isFiatRoute && isKycVerified === false;
  const needsBivoKyc = isFiatRoute && isKycVerified === true && !bivoKycShared;
  const needsKyc = needsOnChainKyc; // blocks the form entirely (no cert on chain)

  // The selected Base deposit token symbol (e.g. 'USDC', 'cbBTC')
  const baseDepositSymbol = isBaseDepositToken ? selectedFromToken.split(':')[1] : null;

  // Fetch Base persistent deposit address when a Base deposit token is selected
  // Each token gets its own deposit address, so re-fetch when the token changes
  useEffect(() => {
    if (!isBaseDepositToken || !address || !baseDepositSymbol) return;

    // Check cache first (persistent deposit addresses never change)
    const cached = getCachedBaseAddr(address, baseDepositSymbol);
    if (cached) {
      setBaseDepositAddress(cached);
      setLoadingBaseAddress(false);
      setBaseAddressError('');
      return;
    }

    setBaseDepositAddress(null);
    setLoadingBaseAddress(true);
    setBaseAddressError('');

    const fetchBase = async () => {
      try {
        const addr = await getBaseDepositAddress(address, 'main', baseDepositSymbol);
        setBaseDepositAddress(addr);
        setCachedBaseAddr(address, baseDepositSymbol, addr);
      } catch (err: any) {
        setBaseAddressError(err.message || 'Failed to load Base deposit address');
      } finally {
        setLoadingBaseAddress(false);
      }
    };
    fetchBase();
  }, [isBaseDepositToken, address, baseDepositSymbol]);

  const handleCopyBase = () => {
    if (!baseDepositAddress) return;
    navigator.clipboard.writeText(baseDepositAddress);
    setBaseCopied(true);
    setTimeout(() => setBaseCopied(false), 2000);
  };

  // ── Cache helpers ──────────────────────────────────────────────────────────
  const ROUTES_CACHE_KEY = 'alpaca_bridge_routes';
  const ROUTES_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  const BASE_ADDR_CACHE_PREFIX = 'alpaca_bridge_baseaddr_';

  const getCachedRoutes = (): BridgeRoute[] | null => {
    try {
      const raw = sessionStorage.getItem(ROUTES_CACHE_KEY);
      if (!raw) return null;
      const { routes: cached, ts } = JSON.parse(raw);
      if (Date.now() - ts > ROUTES_CACHE_TTL) { sessionStorage.removeItem(ROUTES_CACHE_KEY); return null; }
      return cached;
    } catch { return null; }
  };

  const setCachedRoutes = (r: BridgeRoute[]) => {
    try { sessionStorage.setItem(ROUTES_CACHE_KEY, JSON.stringify({ routes: r, ts: Date.now() })); } catch {}
  };

  const getCachedBaseAddr = (wallet: string, symbol: string): string | null => {
    try { return sessionStorage.getItem(`${BASE_ADDR_CACHE_PREFIX}${wallet}_${symbol}`); } catch { return null; }
  };

  const setCachedBaseAddr = (wallet: string, symbol: string, addr: string) => {
    try { sessionStorage.setItem(`${BASE_ADDR_CACHE_PREFIX}${wallet}_${symbol}`, addr); } catch {}
  };

  const applyRoutes = (discovered: BridgeRoute[]) => {
    setRoutes(discovered);
    const firstChain = discovered[0]?.fromLocation || '';
    setSelectedChain(firstChain);
    const firstFromToken = discovered.find(r => r.fromLocation === firstChain)?.fromAssetId || '';
    setSelectedFromToken(firstFromToken);
    const firstToToken = discovered.find(r => r.fromLocation === firstChain && r.fromAssetId === firstFromToken)?.toAssetId || '';
    setSelectedToToken(firstToToken);
  };

  const fetchProviders = useCallback(async () => {
    if (!window.alpaca?.bridgeGetProviders) {
      setError('Please update Alpaca Wallet extension to use Bridge');
      return;
    }
    setLoadingProviders(true);
    setError('');
    setRoutes([]);
    setSelectedChain('');
    setSelectedFromToken('');
    setSelectedToToken('');

    // Try cache first
    const cached = getCachedRoutes();
    if (cached && cached.length > 0) {
      applyRoutes(cached);
      setLoadingProviders(false);
      return;
    }

    try {
      const result = await window.alpaca.bridgeGetProviders({});
      if (!result.providers || result.providers.length === 0) {
        setError('No bridge providers available yet.');
        return;
      }
      const discovered = extractRoutes(result.providers);
      if (discovered.length === 0) {
        setError('No bridge routes to Keeta found.');
        return;
      }
      setCachedRoutes(discovered);
      applyRoutes(discovered);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch bridge providers');
    } finally {
      setLoadingProviders(false);
    }
  }, []);

  useEffect(() => {
    if (isConnected && address) fetchProviders();
  }, [isConnected, address, fetchProviders]);

  // Auto-select first from token when chain changes
  useEffect(() => {
    if (fromTokens.length > 0 && !fromTokens.find(t => t.id === selectedFromToken)) {
      setSelectedFromToken(fromTokens[0].id);
    }
  }, [fromTokens, selectedFromToken]);

  // Auto-select first enabled to token when from token changes
  useEffect(() => {
    if (toTokens.length > 0 && !toTokens.find(t => t.id === selectedToToken && !t.disabled)) {
      const firstEnabled = toTokens.find(t => !t.disabled);
      if (firstEnabled) setSelectedToToken(firstEnabled.id);
    }
  }, [toTokens, selectedToToken]);

  const buildTransferParams = (routeOverride?: BridgeRoute) => {
    const route = routeOverride || selectedRoute;
    if (!route || !address || !amount) return null;
    const decimals = getTokenDecimals(route.fromAssetId, route.fromLocation);
    const rawValue = toRawAmount(amount, decimals);
    return {
      providerID: route.providerID,
      asset: { from: route.fromAssetId, to: route.toAssetId },
      from: { location: route.fromLocation },
      to: { location: route.toLocation, recipient: address },
      value: rawValue,
    };
  };

  const handleShareBivoKyc = async () => {
    if (!window.alpaca?.bridgeShareKYC) {
      setBivoKycError('Please update your Alpaca Wallet extension to share KYC with Bivo.');
      return;
    }
    setBivoKycSharing(true);
    setBivoKycError('');
    try {
      const result = await window.alpaca.bridgeShareKYC(BIVO_PROVIDER_ID);
      if (result.shared) {
        setBivoKycShared(true);
        // Cache so we don't re-share every session
        try { sessionStorage.setItem(`alpaca_bivo_kyc_${address}`, 'true'); } catch {}
      } else {
        setBivoKycError(result.reason === 'no_certificate'
          ? 'No KYC certificate found. Please complete KYC verification first.'
          : 'Failed to share KYC with Bivo.');
      }
    } catch (err: any) {
      setBivoKycError(err.message || 'Failed to share KYC with Bivo');
    } finally {
      setBivoKycSharing(false);
    }
  };

  const handleGetQuote = async () => {
    if (!selectedRoute) return;

    const isFiatDest = isFiatDestination(selectedToToken);
    const fiatInfo = isFiatDest ? getFiatInfo(selectedToToken) : null;
    const ktaRouted = !isFiatDest && isKtaDestination(selectedRoute);

    // For fiat and KTA routing, find the USDC route for the ChangeNow leg
    const usdcRoute = (ktaRouted || isFiatDest) ? findUsdcRoute(routes, selectedRoute) : null;
    const effectiveRoute = (usdcRoute && (ktaRouted || isFiatDest)) ? usdcRoute : selectedRoute;
    const params = buildTransferParams(effectiveRoute);
    if (!params) return;

    // Store routing info for execution phase
    ktaUsdcRouteRef.current = (ktaRouted && usdcRoute) ? usdcRoute : null;
    fiatRouteRef.current = (isFiatDest && usdcRoute && fiatInfo) ? { usdcRoute, fiat: fiatInfo } : null;

    setSimulating(true);
    setError('');
    setQuote(null);

    try {
      if (!window.alpaca?.bridgeSimulateTransfer) {
        await handleInitiateTransfer();
        return;
      }

      // Get ChangeNow quote (for USDC route if KTA/fiat-routed)
      const result = await window.alpaca.bridgeSimulateTransfer(params);
      const parsed = parseQuoteFromInstructions(result.instructions, effectiveRoute);
      if (!parsed) throw new Error('No quote data returned');

      if (isFiatDest && fiatInfo) {
        // ── Fiat-routed: get Bivo simulation for USDC → fiat ──
        const usdcRaw = result.instructions?.[0]?.totalReceiveAmount;
        if (!usdcRaw) throw new Error('No USDC amount from bridge quote');

        const isUsd = fiatInfo.tokenAddress === USD_KEETA_ADDRESS;

        // Try Bivo simulate — if it fails (e.g. KYC not shared, server error),
        // fall back to an estimated 1:1 conversion (USDC ≈ USD stablecoin)
        let finalReceive: string;
        let totalBivoFee: string;
        let bivoSteps: number;
        let bivoEstimated = false;

        try {
          // Step 1: USDC → $USD via Bivo
          const bivoSim1 = await window.alpaca.bridgeSimulateTransfer({
            providerID: BIVO_PROVIDER_ID,
            asset: { from: toBivoAssetId(USDC_KEETA_ADDRESS), to: toBivoAssetId(USD_KEETA_ADDRESS) },
            from: { location: 'chain:keeta:21378' },
            to: { location: 'chain:keeta:21378', recipient: address! },
            value: String(usdcRaw),
          });
          const usdInstr = bivoSim1.instructions?.[0];
          const usdReceive = usdInstr?.totalReceiveAmount || '0';
          const usdFeeTotal = typeof usdInstr?.assetFee === 'object' ? usdInstr.assetFee.total : (usdInstr?.assetFee || '0');

          finalReceive = usdReceive;
          totalBivoFee = usdFeeTotal;
          bivoSteps = 1;

          if (!isUsd) {
            // Step 2: $USD → target fiat via Bivo
            bivoSteps = 2;
            const bivoSim2 = await window.alpaca.bridgeSimulateTransfer({
              providerID: BIVO_PROVIDER_ID,
              asset: { from: toBivoAssetId(USD_KEETA_ADDRESS), to: toBivoAssetId(fiatInfo.tokenAddress) },
              from: { location: 'chain:keeta:21378' },
              to: { location: 'chain:keeta:21378', recipient: address! },
              value: String(usdReceive),
            });
            const fiatInstr = bivoSim2.instructions?.[0];
            finalReceive = fiatInstr?.totalReceiveAmount || '0';
            const fiatFee = typeof fiatInstr?.assetFee === 'object' ? fiatInstr.assetFee.total : (fiatInstr?.assetFee || '0');
            totalBivoFee = String(BigInt(usdFeeTotal) + BigInt(fiatFee));
          }
        } catch (bivoErr: any) {
          // Bivo simulate failed — fall back to estimated conversion
          logger.warn('Bivo simulate failed, using estimate:', bivoErr.message);
          bivoEstimated = true;
          bivoSteps = isUsd ? 1 : 2;

          if (isUsd) {
            // USDC → USD is ~1:1 — we can estimate reliably
            const usdcHuman = Number(usdcRaw) / 1e6;
            const estimatedFeeRate = 0.0005; // ~0.05%
            const estimatedReceive = usdcHuman * (1 - estimatedFeeRate);
            finalReceive = String(Math.floor(estimatedReceive * 100)); // USD has 2 decimals
            totalBivoFee = '0';
          } else {
            // Non-USD fiat — we don't know the FX rate, show USDC amount instead
            // The actual conversion will happen at Bivo's live rate during execution
            finalReceive = '0';
            totalBivoFee = '0';
          }
        }

        const fiatReceiveFormatted = finalReceive === '0' && bivoEstimated
          ? `~${parsed.receiveAmount} USDC`  // non-USD: show USDC amount, fiat rate determined at execution
          : fromRawAmount(String(finalReceive), fiatInfo.decimals) + (bivoEstimated ? ' (est.)' : '');

        setQuote({
          ...parsed,
          receiveAmount: fiatReceiveFormatted,
          receiveLabel: finalReceive === '0' && bivoEstimated ? '' : fiatInfo.symbol,
          isFiatRouted: true,
          fiatCurrency: fiatInfo.label,
          intermediateAmount: parsed.receiveAmount,
          bivoReceiveAmount: fiatReceiveFormatted,
          bivoFee: bivoEstimated ? 'rate at execution' : fromRawAmount(String(totalBivoFee), 2),
          bivoSteps,
        });
      } else if (ktaRouted && usdcRoute) {
        // ── KTA-routed: existing USDC→KTA via FX anchor ──
        const usdcRaw = result.instructions?.[0]?.totalReceiveAmount;
        if (!usdcRaw) throw new Error('No USDC amount from bridge quote');

        const fromToken = BRIDGE_ASSETS.main?.USDC || USDC_KEETA_ADDRESS;
        const toToken = BRIDGE_ASSETS.main?.KTA || KTA_TOKEN_ADDRESS;
        const ktaDecimals = 18;
        const est = await fxEstimate('main', fromToken, toToken, String(usdcRaw));

        setQuote({
          ...parsed,
          receiveAmount: formatAmount18(est.convertedAmount, ktaDecimals),
          receiveLabel: 'KTA',
          isKtaRouted: true,
          intermediateAmount: parsed.receiveAmount,
          ktaAmount: formatAmount18(est.convertedAmount, ktaDecimals),
          ktaFee: formatAmount18(est.expectedCost?.max || '0', ktaDecimals),
        });
      } else {
        setQuote(parsed);
      }
      setStep('quote');
    } catch (err: any) {
      if (err.message?.includes('does not support simulateTransfer')) {
        setSimulating(false);
        await handleInitiateTransfer();
        return;
      }
      setError(err.message || 'Failed to get quote');
    } finally {
      setSimulating(false);
    }
  };

  const handleInitiateTransfer = async () => {
    // For KTA/fiat-routed transfers, use the USDC route with ChangeNow
    const effectiveRoute = fiatRouteRef.current?.usdcRoute || ktaUsdcRouteRef.current || selectedRoute;
    const params = buildTransferParams(effectiveRoute || undefined);
    if (!params) return;

    setInitiating(true);
    setError('');

    try {
      if (!window.alpaca?.bridgeInitiateTransfer) {
        throw new Error('Please update Alpaca Wallet extension to use Bridge');
      }
      const result = await window.alpaca.bridgeInitiateTransfer(params);
      setTransfer({
        transferId: result.transferId,
        instructions: result.instructions || [],
      });
      setStep('instructions');
    } catch (err: any) {
      setError(err.message || 'Failed to initiate transfer');
    } finally {
      setInitiating(false);
    }
  };

  // Execute FX swap: USDC on Keeta → KTA via external FX anchor
  const fxSwapRunningRef = useRef(false);
  const executeFxSwap = async () => {
    if (fxSwapRunningRef.current) return;
    fxSwapRunningRef.current = true;
    setStep('fx-swapping');
    setFxSwapStatus('USDC received! Getting conversion rate...');

    try {
      const fromToken = BRIDGE_ASSETS.main?.USDC || USDC_KEETA_ADDRESS;
      const toToken = BRIDGE_ASSETS.main?.KTA || KTA_TOKEN_ADDRESS;

      // Use the bridged USDC amount from transfer instructions, NOT the full wallet balance
      const bridgedAmount = transfer?.instructions?.[0]?.totalReceiveAmount;
      const usdcAmount = bridgedAmount ? String(bridgedAmount) : await getTokenBalance(fromToken);
      if (!usdcAmount || usdcAmount === '0') {
        throw new Error('No USDC amount found — bridge may still be processing');
      }

      // Get fresh FX estimate for bridged amount
      setFxSwapStatus('Preparing swap...');
      const est = await fxEstimate('main', fromToken, toToken, usdcAmount);

      const minAmountOut = est.convertedAmountBound || est.convertedAmount;

      // Sign swap block via extension
      if (!window.alpaca) throw new Error('Wallet extension not detected');

      setFxSwapStatus('Please approve the swap in your wallet...');
      const swapBlock = await window.alpaca.signTransaction({
        type: 'SWAP',
        poolAddress: est.account,
        tokenIn: fromToken,
        tokenOut: toToken,
        amountIn: usdcAmount,
        minAmountOut,
        estimatedFees: est.expectedCost.max,
        feeToken: est.expectedCost.token,
      });

      const blockBase64 = typeof swapBlock === 'string' ? swapBlock : swapBlock.base64;

      // Submit to FX anchor
      setFxSwapStatus('Converting USDC to KTA...');
      await fxCreateExchange('main', fromToken, toToken, usdcAmount, blockBase64);

      setStep('complete');
    } catch (err: any) {
      console.error('FX swap failed:', err);
      setError(`Bridge completed (USDC received), but KTA swap failed: ${err.message}. You can swap manually on the DEX.`);
      setStep('configure');
    } finally {
      fxSwapRunningRef.current = false;
    }
  };

  // Execute a single Bivo conversion step: send tokens, wait for completion
  const executeBivoStep = async (fromToken: string, toToken: string, rawAmount: string): Promise<string> => {
    if (!window.alpaca?.bridgeInitiateTransfer || !address) throw new Error('Wallet not connected');

    // 1. Initiate transfer with Bivo (uses shorthand asset IDs)
    const initResult = await window.alpaca.bridgeInitiateTransfer({
      providerID: BIVO_PROVIDER_ID,
      asset: { from: toBivoAssetId(fromToken), to: toBivoAssetId(toToken) },
      from: { location: 'chain:keeta:21378' },
      to: { location: 'chain:keeta:21378', recipient: address },
      value: rawAmount,
    });

    const instr = initResult.instructions?.[0];
    if (!instr?.sendToAddress) throw new Error('No deposit address from Bivo');

    // 2. Send tokens to Bivo's address
    setFxSwapStatus('Please approve the transfer in your wallet...');
    await window.alpaca.sendTransaction({
      type: 'SEND',
      to: instr.sendToAddress,
      token: fromToken,
      amount: String(instr.value),
    });

    // 3. Poll for completion
    setFxSwapStatus('Processing conversion...');
    await new Promise<void>((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const result = await window.alpaca!.bridgeGetStatus({
            providerID: BIVO_PROVIDER_ID,
            transferId: initResult.transferId,
          });
          const s = (result.transaction?.status || '').toLowerCase();
          if (['completed', 'complete', 'settled', 'finished'].includes(s)) {
            clearInterval(interval);
            resolve();
          } else if (['failed', 'error', 'expired', 'refunded'].includes(s)) {
            clearInterval(interval);
            reject(new Error(`Bivo conversion ${s}`));
          }
        } catch (e) {
          logger.warn('Bivo poll error:', e);
        }
      }, 5000);
      // Timeout after 10 minutes
      setTimeout(() => { clearInterval(interval); reject(new Error('Bivo conversion timed out')); }, 600000);
    });

    return initResult.transferId;
  };

  // Execute Bivo fiat conversion: USDC → $USD (→ optional $target)
  const executeBivoConversion = async () => {
    setStep('fiat-converting');
    const fiatRef = fiatRouteRef.current;
    if (!fiatRef) return;
    const { fiat } = fiatRef;

    try {
      setFxSwapStatus('USDC received! Converting to $USD...');

      // Get USDC balance
      const usdcBalance = await getTokenBalance(USDC_KEETA_ADDRESS);
      if (!usdcBalance || usdcBalance === '0') {
        throw new Error('No USDC balance found — bridge may still be processing');
      }

      // Step 1: USDC → $USD
      await executeBivoStep(USDC_KEETA_ADDRESS, USD_KEETA_ADDRESS, usdcBalance);

      // Step 2: If target is not USD, convert $USD → target fiat
      if (fiat.tokenAddress !== USD_KEETA_ADDRESS) {
        setFxSwapStatus(`Converting $USD to ${fiat.symbol}...`);
        const usdBalance = await getTokenBalance(USD_KEETA_ADDRESS);
        if (!usdBalance || usdBalance === '0') {
          throw new Error('No $USD balance found — conversion may still be processing');
        }
        await executeBivoStep(USD_KEETA_ADDRESS, fiat.tokenAddress, usdBalance);
      }

      setStep('complete');
    } catch (err: any) {
      logger.error('Bivo conversion failed:', err);
      setError(`Bridge completed (USDC received), but fiat conversion failed: ${err.message}. Your USDC is safe in your wallet.`);
      setStep('configure');
    }
  };

  const startPolling = () => {
    const effectiveRoute = fiatRouteRef.current?.usdcRoute || ktaUsdcRouteRef.current || selectedRoute;
    if (!effectiveRoute || !transfer) return;
    setStep('polling');

    pollRef.current = setInterval(async () => {
      try {
        if (!window.alpaca?.bridgeGetStatus) return;
        const result = await window.alpaca.bridgeGetStatus({
          providerID: effectiveRoute.providerID,
          transferId: transfer.transferId,
        });
        const tx = result.transaction;
        if (tx) {
          setTxStatus({
            id: tx.id || transfer.transferId,
            status: tx.status || 'pending',
            from: tx.from || { location: '', value: '' },
            to: tx.to || { location: '', value: '' },
            fee: tx.fee || null,
            createdAt: tx.createdAt || '',
            updatedAt: tx.updatedAt || '',
            additionalTransferDetails: (tx as any).additionalTransferDetails || undefined,
          });
          const status = (tx.status || '').toLowerCase();
          if (['completed', 'complete', 'settled', 'finished'].includes(status)) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
            // If fiat-routed, trigger Bivo conversion; if KTA-routed, trigger FX swap; otherwise done
            if (fiatRouteRef.current) {
              executeBivoConversion();
            } else if (ktaUsdcRouteRef.current) {
              executeFxSwap();
            } else {
              setStep('complete');
            }
          } else if (['failed', 'error', 'expired', 'refunded'].includes(status)) {
            if (pollRef.current) clearInterval(pollRef.current);
            setError(`Transfer ${status}`);
            setStep('configure');
          }
        }
      } catch (err: any) {
        console.error('Poll error:', err);
      }
    }, 5000);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const resetBridge = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (exchangeWatcherRef.current) exchangeWatcherRef.current();
    ktaUsdcRouteRef.current = null;
    fiatRouteRef.current = null;
    setStep('configure');
    setTransfer(null);
    setTxStatus(null);
    setQuote(null);
    setAmount('');
    setError('');
    setFxSwapStatus('');
  };

  if (!isConnected) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 relative">
        <BridgeBackground />
        <div className="text-center relative z-10">
          <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white mb-3">
            Bridge
          </h1>
          <p className="text-[15px] text-gray-500 dark:text-gray-400 mb-8">
            Bridge crypto from other chains to Keeta — or convert to on-chain fiat (USD, EUR, GBP, CAD)
          </p>
          <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-8">
            <p className="text-[15px] text-gray-500 dark:text-gray-400">
              Connect your Alpaca Wallet to start bridging
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 relative">
      <BridgeBackground />
      {/* Header */}
      <div className="mb-6 relative z-10">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white">
          Bridge
        </h1>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">
          Bridge crypto from other chains to Keeta — or convert to on-chain fiat (USD, EUR, GBP, CAD)
        </p>
      </div>

      {/* Configure step */}
      {step === 'configure' && (
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-6 relative z-10">

          {loadingProviders && (
            <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-gray-500 dark:text-gray-400">
              <Spinner />
              Discovering bridge routes...
            </div>
          )}

          {!loadingProviders && routes.length > 0 && (
            <>
              {/* Chain selector */}
              <div className="mb-5">
                <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2 block">
                  From Chain
                </label>
                <BridgeSelector
                  options={chains.map(c => ({ id: c.location, label: c.label, subtitle: c.tokens, ...getChainIcon(c.location, c.label) }))}
                  value={selectedChain}
                  onChange={(loc) => { setSelectedChain(loc); setSelectedFromToken(''); setSelectedToToken(''); setError(''); setQuote(null); }}
                  placeholder="Select chain..."
                />
              </div>

              {/* Base persistent deposit address — shown when a deposit token (USDC/EURC/KTA) is selected on Base */}
              {selectedChain === BASE_CHAIN_LOCATION && isBaseDepositToken && (
                <div className="mb-5 p-4 rounded-md border border-[#0052FF]/20 bg-[#0052FF]/5 dark:bg-[#0052FF]/10">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-[#0052FF] flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
                    </div>
                    <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Direct Deposit — {baseDepositSymbol}</span>
                  </div>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 mb-4">
                    Send {baseDepositSymbol} on <span className="text-[#0052FF] font-medium">Base</span> to the address below. It will be automatically bridged to your Keeta wallet.
                  </p>

                  {loadingBaseAddress ? (
                    <div className="flex items-center justify-center gap-2 py-4 text-[13px] text-gray-500 dark:text-gray-400">
                      <Spinner />
                      Loading deposit address...
                    </div>
                  ) : baseAddressError ? (
                    <div className="py-3 text-center">
                      <p className="text-[13px] text-red-600 dark:text-red-400 mb-3">{baseAddressError}</p>
                      <button
                        onClick={() => { setBaseDepositAddress(null); setBaseAddressError(''); }}
                        className="px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors bg-[#0052FF]/10 hover:bg-[#0052FF] text-[#0052FF] hover:text-white"
                      >
                        Retry
                      </button>
                    </div>
                  ) : baseDepositAddress ? (
                    <div>
                      <div className="flex items-start gap-4">
                        {/* QR code */}
                        <div className="shrink-0 rounded-xl bg-white p-2.5 shadow-sm ring-1 ring-gray-200 dark:ring-white/[0.08]">
                          <QRCodeSVG value={baseDepositAddress} size={100} />
                        </div>

                        <div className="flex-1 min-w-0">
                          {/* Address */}
                          <div
                            onClick={handleCopyBase}
                            className="group flex items-center justify-between px-3 py-2 rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] cursor-pointer transition-colors hover:border-[#0052FF]/40"
                          >
                            <span className="font-mono text-[11px] text-gray-600 dark:text-gray-400 truncate mr-2">
                              {baseDepositAddress}
                            </span>
                            <div className="w-6 h-6 flex items-center justify-center rounded-md bg-gray-100 dark:bg-white/[0.04] group-hover:bg-[#0052FF] group-hover:text-white transition-colors text-gray-500 shrink-0">
                              {baseCopied ? (
                                <svg className="h-3 w-3 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                              ) : (
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                              )}
                            </div>
                          </div>
                          <p className="text-[11px] text-gray-500 dark:text-gray-500 mt-2">
                            Permanent address — tokens sent here auto-bridge to Keeta.
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Source token selector */}
              {selectedChain && (
                <div className="mb-5">
                  <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2 block">
                    Send
                  </label>
                  <BridgeSelector
                    options={fromTokens.map(t => ({ id: t.id, label: t.label, ...getTokenIcon(t.label) }))}
                    value={selectedFromToken}
                    onChange={(id) => { setSelectedFromToken(id); setSelectedToToken(''); setError(''); setQuote(null); }}
                    placeholder="Select token..."
                    disabled={fromTokens.length === 0}
                  />
                </div>
              )}

              {/* Destination token selector — hidden for Base deposit tokens */}
              {!isBaseDepositToken && selectedFromToken && (
                <div className="mb-5">
                  <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2 block">
                    Receive on Keeta
                  </label>
                  <BridgeSelector
                    options={toTokens}
                    value={selectedToToken}
                    onChange={(id) => { setSelectedToToken(id); setError(''); setQuote(null); }}
                    placeholder="Select destination..."
                    disabled={toTokens.length === 0}
                  />
                </div>
              )}

              {/* KYC required prompt for keeta provider fiat routes */}
              {!isBaseDepositToken && needsKyc && (
                <div className="mb-5 p-4 rounded-xl border border-amber-300/30 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/5">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-amber-800 dark:text-amber-300 mb-1">Identity Verification Required</p>
                      <p className="text-[13px] text-amber-700 dark:text-amber-400/80 mb-3">
                        On-chain fiat conversions require a verified KYC certificate on the Keeta network.
                      </p>
                      <a
                        href="/wallet"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-amber-600 hover:bg-amber-700 text-white transition-colors"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                        Go to Wallet &rarr; KYC
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* Bivo KYC onboarding — shown when user has on-chain cert but hasn't shared with Bivo */}
              {!isBaseDepositToken && needsBivoKyc && (
                <div className="mb-5 p-4 rounded-xl border border-teal-300/30 dark:border-teal-500/20 bg-teal-50 dark:bg-teal-500/5">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-teal-100 dark:bg-teal-500/10 flex items-center justify-center shrink-0 mt-0.5">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-teal-600 dark:text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-[14px] font-semibold text-teal-800 dark:text-teal-300 mb-1">Connect with Bivo</p>
                      <p className="text-[13px] text-teal-700 dark:text-teal-400/80 mb-3">
                        Fiat conversions are powered by Bivo Inc. Share your KYC certificate with Bivo to enable on-chain fiat. This is a one-time step.
                      </p>
                      {bivoKycError && (
                        <p className="text-[12px] text-red-600 dark:text-red-400 mb-2">{bivoKycError}</p>
                      )}
                      <button
                        onClick={handleShareBivoKyc}
                        disabled={bivoKycSharing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold bg-teal-600 hover:bg-teal-700 text-white transition-colors disabled:opacity-50"
                      >
                        {bivoKycSharing ? (
                          <><Spinner className="h-3 w-3" /> Sharing...</>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                            </svg>
                            Share KYC with Bivo
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Destination wallet, amount, quote — hidden for Base deposit tokens and KYC-gated fiat routes */}
              {!isBaseDepositToken && !needsKyc && !needsBivoKyc && (
                <>
                  <div className="mb-5">
                    <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2 block">
                      To Account
                    </label>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02]">
                      <span className="text-[13px] font-semibold text-gray-900 dark:text-white">Keeta</span>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500 ml-auto font-mono">
                        {address?.slice(0, 10)}...{address?.slice(-6)}
                      </span>
                    </div>
                  </div>

                  <div className="mb-5">
                    <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2 block">
                      Amount {selectedRoute ? `(${selectedRoute.fromTokenLabel})` : ''}
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) => { setAmount(e.target.value); setQuote(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && selectedRoute && amount && !simulating) handleGetQuote(); }}
                      placeholder="0.00"
                      className="w-full px-3 py-2 rounded-md text-[14px] border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-1 focus:ring-[#845fbc]/40 focus:border-[#845fbc]/40 outline-none transition-colors"
                    />
                  </div>

                  {error && (
                    <div className="mb-4 p-3 rounded-md border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10">
                      <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>
                    </div>
                  )}

                  <button
                    onClick={handleGetQuote}
                    disabled={!selectedRoute || !amount || simulating}
                    className="w-full py-2.5 rounded-md text-[14px] font-semibold transition-colors bg-[#845fbc] hover:bg-[#7250a8] text-white disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {simulating ? (
                      <span className="flex items-center justify-center gap-2">
                        <Spinner />
                        Getting quote...
                      </span>
                    ) : (
                      'Get Quote'
                    )}
                  </button>
                </>
              )}
            </>
          )}

          {!loadingProviders && routes.length === 0 && (
            <div className="py-6 text-center">
              {error ? (
                <p className="text-[13px] text-red-600 dark:text-red-400 mb-4">{error}</p>
              ) : (
                <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">No bridge routes discovered.</p>
              )}
              <button
                onClick={fetchProviders}
                className="px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors bg-[#845fbc]/10 hover:bg-[#845fbc] text-[#845fbc] hover:text-white"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      )}

      {/* Quote step */}
      {step === 'quote' && quote && selectedRoute && (
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-6 relative z-10">
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-4">
            Bridge Quote
          </h2>

          <div className="p-4 rounded-md border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02] mb-4">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">You Send</span>
                <span className="text-[14px] font-semibold text-gray-900 dark:text-white">{quote.sendAmount} {quote.sendLabel}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">From</span>
                <span className="text-[13px] text-gray-600 dark:text-gray-400">{selectedRoute.chainLabel}</span>
              </div>
              <div className="border-t border-gray-200 dark:border-white/[0.08]" />
              {quote.isKtaRouted && quote.intermediateAmount && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Bridge to Keeta</span>
                    <span className="text-[13px] text-gray-600 dark:text-gray-400">{quote.intermediateAmount} USDC</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Auto-swap via FX</span>
                    <span className="text-[13px] text-gray-600 dark:text-gray-400">USDC → KTA</span>
                  </div>
                  <div className="border-t border-gray-200 dark:border-white/[0.08]" />
                </>
              )}
              {quote.isFiatRouted && quote.intermediateAmount && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Bridge to Keeta</span>
                    <span className="text-[13px] text-gray-600 dark:text-gray-400">{quote.intermediateAmount} USDC</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Auto-convert via Bivo</span>
                    <span className="text-[13px] text-gray-600 dark:text-gray-400">
                      USDC → {quote.bivoSteps === 2 ? `$USD → ${quote.receiveLabel}` : quote.receiveLabel}
                    </span>
                  </div>
                  <div className="border-t border-gray-200 dark:border-white/[0.08]" />
                </>
              )}
              <div className="flex justify-between items-center">
                <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">You Receive</span>
                <span className="text-[14px] font-semibold text-emerald-600 dark:text-emerald-400">{quote.receiveAmount} {quote.receiveLabel}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">To</span>
                <span className="text-[13px] text-gray-600 dark:text-gray-400">Keeta</span>
              </div>
              <div className="border-t border-gray-200 dark:border-white/[0.08]" />
              <div className="flex justify-between items-center">
                <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Bridge Fee</span>
                <span className="text-[13px] text-gray-500 dark:text-gray-400">{quote.feeAmount} {quote.feeLabel}</span>
              </div>
              {quote.isFiatRouted && quote.bivoFee && (
                <div className="flex justify-between items-center">
                  <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">Conversion Fee</span>
                  <span className="text-[13px] text-gray-500 dark:text-gray-400">{quote.bivoFee} USD</span>
                </div>
              )}
              {quote.isKtaRouted && quote.ktaFee && (
                <div className="flex justify-between items-center">
                  <span className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500">FX Swap Fee</span>
                  <span className="text-[13px] text-gray-500 dark:text-gray-400">{quote.ktaFee} KTA</span>
                </div>
              )}
            </div>
          </div>

          {quote.isKtaRouted && (
            <div className="mb-4 p-3 rounded-md border border-[#845fbc]/20 bg-[#845fbc]/5">
              <p className="text-[12px] text-[#845fbc] dark:text-[#a78bfa]">
                Routed via USDC for better rates. Your {quote.sendLabel} will be bridged to USDC on Keeta, then automatically swapped to KTA.
              </p>
            </div>
          )}
          {quote.isFiatRouted && (
            <div className="mb-4 p-3 rounded-md border border-teal-500/20 bg-teal-500/5">
              <p className="text-[12px] text-teal-700 dark:text-teal-400">
                Your {quote.sendLabel} will be bridged to USDC on Keeta via ChangeNOW, then automatically converted to {quote.receiveLabel} via Bivo.
                {quote.bivoSteps === 2 && ' (USDC → $USD → ' + quote.receiveLabel + ')'}
              </p>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-md border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10">
              <p className="text-[13px] text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleInitiateTransfer}
              disabled={initiating}
              className="flex-1 py-2.5 rounded-md text-[14px] font-semibold transition-colors bg-[#845fbc] hover:bg-[#7250a8] text-white disabled:opacity-40"
            >
              {initiating ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner />
                  Confirming...
                </span>
              ) : (
                'Confirm Bridge'
              )}
            </button>
            <button
              onClick={() => { setStep('configure'); setQuote(null); setError(''); }}
              className="px-4 py-2.5 rounded-md text-[13px] font-semibold transition-colors border border-gray-200 dark:border-white/[0.08] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.02]"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {/* Instructions step */}
      {step === 'instructions' && transfer && (
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-6 relative z-10">
          <div className="mb-4">
            <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#845fbc] mb-1">Action Required</p>
            <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white">
              Send Your Deposit
            </h2>
          </div>

          <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">
            Send the exact amount to the deposit address below from your {selectedRoute?.chainLabel} wallet, then click "I've Sent the Deposit".
          </p>

          {transfer.instructions.length > 0 ? (
            transfer.instructions.map((instr: any, idx: number) => {
              // For KTA/fiat-routed transfers, instructions are from the USDC bridge leg — use USDC route decimals
              const instrRoute = ktaUsdcRouteRef.current || fiatRouteRef.current?.usdcRoute || selectedRoute;
              const sendDecimals = instrRoute ? getTokenDecimals(instrRoute.fromAssetId, instrRoute.fromLocation) : 18;
              const receiveDecimals = instrRoute ? getTokenDecimals(instrRoute.toAssetId, instrRoute.toLocation) : 18;

              let feeDisplay = null;
              if (instr.assetFee && instrRoute) {
                const fee = typeof instr.assetFee === 'object' ? instr.assetFee : { total: instr.assetFee };
                const feePricedIn = fee.totalPricedIn || instrRoute.toAssetId;
                const feeLabel = getTokenLabel(feePricedIn, instrRoute.toLocation);
                feeDisplay = { amount: fromRawAmount(String(fee.total), receiveDecimals), label: feeLabel };
              }

              return (
                <div key={idx} className="mb-4 p-4 rounded-md border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02]">
                  {/* Deposit address — prominent, with QR code */}
                  {instr.sendToAddress && (
                    <div className="mb-4">
                      <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2">
                        Deposit Address ({selectedRoute?.chainLabel})
                      </p>
                      <div className="p-3 rounded-md bg-white dark:bg-white/[0.04] border border-gray-200 dark:border-white/[0.08]">
                        <div className="flex items-start gap-4">
                          {/* QR code */}
                          <div className="shrink-0 rounded-xl bg-white p-3 shadow-sm ring-1 ring-gray-200 dark:ring-white/[0.08]">
                            <QRCodeSVG
                              value={buildDepositQrValue(
                                instr.sendToAddress,
                                selectedRoute?.fromLocation || '',
                                selectedRoute?.fromAssetId || '',
                                instr.value ? String(instr.value) : undefined,
                                selectedRoute ? getTokenDecimals(selectedRoute.fromAssetId, selectedRoute.fromLocation) : undefined,
                              )}
                              size={112}
                              level="M"
                              includeMargin={false}
                              className="rounded-md"
                            />
                            <p className="mt-1.5 text-center text-[9px] font-medium tracking-wide text-gray-400 uppercase">
                              Scan to deposit
                            </p>
                          </div>
                          {/* Address text + copy */}
                          <div className="min-w-0 flex-1 flex flex-col justify-between self-stretch">
                            <code className="text-[13px] text-gray-900 dark:text-white break-all font-mono block">
                              {formatAddress(instr.sendToAddress)}
                            </code>
                            <button
                              onClick={() => copyToClipboard(formatAddress(instr.sendToAddress), 'address')}
                              className="mt-2 self-start px-3 py-1 rounded-md text-[11px] font-semibold bg-[#845fbc]/10 text-[#845fbc] hover:bg-[#845fbc]/20 transition-colors"
                            >
                              {copied === 'address' ? 'Copied!' : 'Copy Address'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Summary flow: Send → Receive */}
                  {instr.value && instrRoute && (
                    <div className="flex items-center gap-3">
                      {/* Send */}
                      <div className="flex-1 p-3 rounded-lg border border-[#845fbc]/20 bg-[#845fbc]/5">
                        <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-[#845fbc] mb-0.5">Send</p>
                        <p className="text-[15px] font-semibold text-[#845fbc]">
                          {fromRawAmount(String(instr.value), sendDecimals)}
                        </p>
                        <p className="text-[11px] text-[#845fbc]/70">{instrRoute.fromTokenLabel}</p>
                      </div>

                      {/* Arrow + fee */}
                      <div className="flex flex-col items-center gap-0.5 shrink-0">
                        <svg className="w-5 h-5 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                        </svg>
                        {feeDisplay && (
                          <p className="text-[9px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                            Fee: {feeDisplay.amount} {feeDisplay.label}
                          </p>
                        )}
                      </div>

                      {/* Receive */}
                      {instr.totalReceiveAmount && (
                        <div className="flex-1 p-3 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02]">
                          <p className="text-[10px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-0.5">Receive</p>
                          <p className="text-[15px] font-semibold text-gray-900 dark:text-white">
                            {fromRawAmount(String(instr.totalReceiveAmount), receiveDecimals)}
                          </p>
                          <p className="text-[11px] text-gray-500 dark:text-gray-400">{instrRoute.toTokenLabel}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {instr.depositMessage && (
                    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-white/[0.08]">
                      <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-1">Memo / Message</p>
                      <code className="text-[12px] text-gray-900 dark:text-white break-all font-mono">
                        {typeof instr.depositMessage === 'string' ? instr.depositMessage : JSON.stringify(instr.depositMessage)}
                      </code>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="mb-4 p-4 rounded-md border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02]">
              <p className="text-[13px] text-gray-500 dark:text-gray-400">
                Transfer ID: <span className="font-mono">{transfer.transferId}</span>
              </p>
            </div>
          )}

          {/* Final receive amount after auto-conversion (KTA or fiat routed) */}
          {quote && (quote.isKtaRouted || quote.isFiatRouted) && (
            <div className="mb-4 p-3 rounded-xl border border-[#845fbc]/20 dark:border-[#845fbc]/30 bg-[#845fbc]/5 dark:bg-[#845fbc]/10">
              <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#845fbc] dark:text-[#a78bfa] mb-1">
                Final Amount (after auto-conversion)
              </p>
              <p className="text-[15px] font-semibold text-[#6b4a9e] dark:text-[#c4b5fd]">
                {quote.receiveAmount} {quote.receiveLabel}
              </p>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">
                USDC will be bridged to Keeta first, then automatically converted to {quote.receiveLabel || 'your selected token'}.
              </p>
            </div>
          )}

          <div className="mb-4 p-3 rounded-md border border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10">
            <p className="text-[12px] text-amber-700 dark:text-amber-300">
              Send the exact amount shown above. Sending a different amount may cause the transfer to fail or be delayed.
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={startPolling}
              className="flex-1 py-2.5 rounded-md text-[14px] font-semibold transition-colors bg-[#845fbc] hover:bg-[#7250a8] text-white"
            >
              I've Sent the Deposit
            </button>
            <button
              onClick={resetBridge}
              className="px-4 py-2.5 rounded-md text-[13px] font-semibold transition-colors border border-gray-200 dark:border-white/[0.08] text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.02]"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Polling step */}
      {step === 'polling' && (
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-6 text-center relative z-10">
          <Spinner className="h-8 w-8 text-[#845fbc] mx-auto mb-4" />
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-2">
            {fiatRouteRef.current ? 'Bridging USDC to Keeta' : ktaUsdcRouteRef.current ? 'Bridging USDC to Keeta' : 'Waiting for Confirmation'}
          </h2>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">
            {fiatRouteRef.current
              ? `Waiting for USDC to arrive on Keeta. Fiat conversion to ${fiatRouteRef.current.fiat.symbol} will start automatically.`
              : ktaUsdcRouteRef.current
              ? 'Waiting for USDC to arrive on Keeta. KTA swap will start automatically.'
              : 'Monitoring the bridge for your deposit...'
            }
          </p>

          {txStatus && (
            <div className="mt-4 p-4 rounded-md bg-gray-50 dark:bg-white/[0.02] border border-gray-100 dark:border-white/[0.04] text-left">
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-0.5">Status</p>
                  <p className="font-semibold text-amber-600 dark:text-amber-400">{txStatus.status}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-0.5">Transfer ID</p>
                  <p className="text-gray-600 dark:text-gray-400 truncate">{txStatus.id}</p>
                </div>
              </div>
              {txStatus.additionalTransferDetails?.content && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-white/[0.04] text-[12px] text-gray-500 dark:text-gray-400"
                  dangerouslySetInnerHTML={{
                    __html: txStatus.additionalTransferDetails.type === 'markdown'
                      ? txStatus.additionalTransferDetails.content
                          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-[#845fbc] hover:underline">$1</a>')
                          .replace(/\n/g, '<br/>')
                      : txStatus.additionalTransferDetails.content.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
                  }}
                />
              )}
            </div>
          )}

          <button
            onClick={resetBridge}
            className="mt-4 px-4 py-2 rounded-md text-[12px] font-semibold transition-colors border border-gray-200 dark:border-white/[0.08] text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.02]"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Fiat Converting step (fiat-routed: bridge done, now converting via Bivo) */}
      {step === 'fiat-converting' && (
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-6 text-center relative z-10">
          <Spinner className="h-8 w-8 text-teal-500 mx-auto mb-4" />
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-2">
            Converting to {quote?.receiveLabel || 'Fiat'}
          </h2>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">
            {fxSwapStatus || 'Converting via Bivo...'}
          </p>

          <div className="mt-2 p-3 rounded-md bg-teal-500/5 border border-teal-500/10">
            <p className="text-[11px] text-teal-700 dark:text-teal-400">
              Bridge complete — USDC received on Keeta. Now converting to {quote?.receiveLabel || 'fiat'} via Bivo.
            </p>
          </div>
        </div>
      )}

      {/* FX Swapping step (KTA-routed: bridge done, now swapping USDC→KTA) */}
      {step === 'fx-swapping' && (
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-6 text-center relative z-10">
          <Spinner className="h-8 w-8 text-[#845fbc] mx-auto mb-4" />
          <h2 className="text-[15px] font-semibold text-gray-900 dark:text-white mb-2">
            Converting to KTA
          </h2>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-4">
            {fxSwapStatus || 'Swapping USDC to KTA via FX anchor...'}
          </p>

          <div className="mt-2 p-3 rounded-md bg-[#845fbc]/5 border border-[#845fbc]/10">
            <p className="text-[11px] text-[#845fbc] dark:text-[#a78bfa]">
              Bridge complete — USDC received on Keeta. Now converting to KTA.
            </p>
          </div>
        </div>
      )}

      {/* Complete step */}
      {step === 'complete' && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10 p-6 relative z-10">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-emerald-600 dark:text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <h2 className="text-[15px] font-semibold text-emerald-700 dark:text-emerald-300">
              {quote?.isFiatRouted ? 'Bridge & Conversion Complete' : quote?.isKtaRouted ? 'Bridge & Swap Complete' : 'Bridge Complete'}
            </h2>
          </div>

          <p className="text-[13px] text-emerald-600 dark:text-emerald-400 mb-4">
            {quote?.isFiatRouted
              ? `Your tokens have been bridged and converted to ${quote.receiveLabel}. Check your wallet for the updated balance.`
              : quote?.isKtaRouted
              ? 'Your tokens have been bridged and converted to KTA. Check your wallet for the updated balance.'
              : 'Your tokens have been bridged to Keeta and should appear in your wallet shortly.'
            }
          </p>

          {txStatus && (
            <div className="p-3 rounded-md bg-white/50 dark:bg-white/[0.04] border border-emerald-200 dark:border-emerald-500/10">
              <div className="grid grid-cols-2 gap-3 text-[13px]">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-0.5">Sent</p>
                  <p className="text-gray-900 dark:text-white font-semibold">{txStatus.from.value}</p>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-0.5">Received</p>
                  <p className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    {quote?.isFiatRouted ? `${quote.receiveAmount} ${quote.receiveLabel}` : quote?.isKtaRouted ? `${quote.receiveAmount} KTA` : txStatus.to.value}
                  </p>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={resetBridge}
            className="mt-4 w-full py-2.5 rounded-md text-[14px] font-semibold transition-colors bg-[#845fbc] hover:bg-[#7250a8] text-white"
          >
            Bridge Again
          </button>
        </div>
      )}

      {/* How it works */}
      <div className="mt-6 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-5 relative z-10">
        <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white mb-3">How it works</h3>
        <ol className="space-y-2 text-[13px] text-gray-500 dark:text-gray-400">
          <li className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-[#845fbc]/10 text-[#845fbc] text-[11px] font-semibold flex items-center justify-center">1</span>
            Select a source chain, token, and the token you want to receive on Keeta
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-[#845fbc]/10 text-[#845fbc] text-[11px] font-semibold flex items-center justify-center">2</span>
            Enter the amount and review the quote with fees before confirming
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-[#845fbc]/10 text-[#845fbc] text-[11px] font-semibold flex items-center justify-center">3</span>
            Send the exact amount to the deposit address from your external wallet
          </li>
          <li className="flex gap-2">
            <span className="shrink-0 w-5 h-5 rounded-full bg-[#845fbc]/10 text-[#845fbc] text-[11px] font-semibold flex items-center justify-center">4</span>
            The bridge processes your deposit and delivers tokens to your Keeta wallet
          </li>
        </ol>
        <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
          Powered by Keeta Asset Movement Anchors via ChangeNOW and Bivo Inc.
          <br />
          Third-party exchange by ChangeNOW. Fiat conversion by Bivo Inc. (NMLS #2572288). Subject to their respective{' '}
          <a href="https://changenow.io/terms-of-use" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">Terms</a>{' & '}
          <a href="https://changenow.io/privacy-policy" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-600 dark:hover:text-gray-300">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
};

export default BridgePage;

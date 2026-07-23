import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '../context/WalletContext';
import ParticleNetwork from '../components/common/ParticleNetwork';

import { formatAmount18 } from '../utils/formatters';

// ── Token definitions ────────────────────────────────────────────────────────

interface ConvertToken {
  symbol: string;
  label: string;
  address: Record<string, string>; // network → keeta address
  decimals: Record<string, number>; // network → decimals
  type: 'crypto' | 'fiat';
}

const CONVERT_TOKENS: ConvertToken[] = [
  {
    symbol: 'KTA', label: 'Keeta', type: 'crypto',
    address: {
      main: 'keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg',
      test: 'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52',
    },
    decimals: { main: 18, test: 9 },
  },
  {
    symbol: 'USDC', label: 'USD Coin', type: 'crypto',
    address: {
      main: 'keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna',
      test: 'keeta_apna75yhhvnv4ei7ape55hndk4yepno7a7i2mhtiwahiygixjcnmvswxhnmnk',
    },
    decimals: { main: 6, test: 6 },
  },
  {
    symbol: 'EURC', label: 'Euro Coin', type: 'crypto',
    address: {
      main: 'keeta_apblhar4ncp3ln62wrygsn73pt3houuvj7ic47aarnolpcu67oqn4xqcji3au',
    },
    decimals: { main: 6 },
  },
  {
    symbol: '$USD', label: 'US Dollar', type: 'fiat',
    address: { main: 'keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc' },
    decimals: { main: 2 },
  },
  {
    symbol: '$EUR', label: 'Euro', type: 'fiat',
    address: { main: 'keeta_anutgo4o3yp5tvc6wjt4vzsehjbn7t2wylpxmam4d4ojtdkjj2yca2qoinfcs' },
    decimals: { main: 2 },
  },
  {
    symbol: '$GBP', label: 'British Pound', type: 'fiat',
    address: { main: 'keeta_aojfknc74dabtg72mdhijtszdlv7gi3ht2xp2wrfmdagkthi4n7rulb5e54ss' },
    decimals: { main: 2 },
  },
  {
    symbol: '$CAD', label: 'Canadian Dollar', type: 'fiat',
    address: { main: 'keeta_aozyboy42uks7ticj72awfhpdxwqqfcowezxcew6ecaz5afdt7q2ffycxim4u' },
    decimals: { main: 2 },
  },
  {
    symbol: '$JPY', label: 'Japanese Yen', type: 'fiat',
    address: { main: 'keeta_aowqb2hvkak7frntfbtde27bdmqvxancrja7ndh24m66ahkbrzeda3crqh3vg' },
    decimals: { main: 0 },
  },
  {
    symbol: '$HKD', label: 'Hong Kong Dollar', type: 'fiat',
    address: { main: 'keeta_apbn7f34cdq62d7iw4ui6sbfaz7fcqdit354wfaotu5zw6d6xfef5vluhdaos' },
    decimals: { main: 2 },
  },
  {
    symbol: '$MXN', label: 'Mexican Peso', type: 'fiat',
    address: { main: 'keeta_amb3hbd5gbhaorl4y2ddl3xn2q4eyi6dqkn5fpug6diz26v2awsdqhkivmyza' },
    decimals: { main: 2 },
  },
  {
    symbol: '$CNY', label: 'Chinese Yuan', type: 'fiat',
    address: { main: 'keeta_ao44m7r4utf2vvytsfijermgkstnkka6rp44eahrekvp4cmj5g2orzm3blrvc' },
    decimals: { main: 2 },
  },
  {
    symbol: '$AED', label: 'UAE Dirham', type: 'fiat',
    address: { main: 'keeta_anjsvaiiycybwhixlalcpwuvobvmpll4lh24td5qipccegmvfi7c2qdcqnlgu' },
    decimals: { main: 2 },
  },
];

// ── Conversion routing ───────────────────────────────────────────────────────

type ConvertMethod = 'fx' | 'bivo' | null;

// Bivo uses full Keeta token addresses for on-chain fiat assets (confirmed from metadata)
// No shorthand mapping needed — pass the keeta address directly

const BIVO_PROVIDER_ID = 'bivo-anchor.keeta.com';
const KEETA_LOCATION = 'chain:keeta:21378';

// FX anchor base URLs
const FX_ANCHOR_BASE: Record<string, string> = {
  main: 'https://api.kta-fx.com/api',
  test: 'https://demo-fx-anchor.test.keeta.com/api',
};

function getConvertMethod(from: ConvertToken, to: ConvertToken): ConvertMethod {
  const fxTokens = ['KTA', 'USDC', 'EURC'];
  // FX anchor: any pair of KTA/USDC/EURC
  if (fxTokens.includes(from.symbol) && fxTokens.includes(to.symbol) && from.symbol !== to.symbol) {
    return 'fx';
  }
  // Bivo: on-chain fiat ↔ on-chain fiat (e.g. $USD → $EUR, $EUR → $USD)
  // Note: Bivo does NOT support USDC — only on-chain fiat tokens
  if (from.type === 'fiat' && to.type === 'fiat' && from.symbol !== to.symbol) return 'bivo';
  return null;
}

function getValidToTokens(from: ConvertToken, network: string): ConvertToken[] {
  return CONVERT_TOKENS.filter(t => {
    if (t.symbol === from.symbol) return false;
    if (!t.address[network]) return false;
    return getConvertMethod(from, t) !== null;
  });
}

// ── FX anchor helpers ────────────────────────────────────────────────────────

function toDecimalString(v: string | number): string {
  if (typeof v === 'number') return v.toString();
  if (typeof v === 'string' && v.startsWith('0x')) return BigInt(v).toString();
  return v;
}

async function fxAnchorCall(network: string, operation: string, payload: any) {
  const base = FX_ANCHOR_BASE[network];
  const url = `${base}/${operation}`;
  if (window.alpaca?.fxProxy) {
    return window.alpaca.fxProxy(url, payload);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

interface FxEstimateResult {
  convertedAmount: string;
  convertedAmountBound: string | null;
  expectedCost: { min: string; max: string; token: string };
  account: string;
}

async function fxGetEstimate(
  network: string, from: string, to: string, rawAmount: string
): Promise<FxEstimateResult> {
  const data = await fxAnchorCall(network, 'getEstimate', {
    request: { from, to, amount: rawAmount, affinity: 'from' },
  });
  if (!data.ok) throw new Error(data.error || 'FX estimate failed');
  const est = data.estimate;
  return {
    convertedAmount: toDecimalString(est.convertedAmount),
    convertedAmountBound: est.convertedAmountBound ? toDecimalString(est.convertedAmountBound) : null,
    expectedCost: {
      min: toDecimalString(est.expectedCost.min),
      max: toDecimalString(est.expectedCost.max),
      token: est.expectedCost.token,
    },
    account: est.account || '',
  };
}

async function fxCreateExchange(
  network: string, from: string, to: string, rawAmount: string, blockBase64: string
) {
  const data = await fxAnchorCall(network, 'createExchange', {
    request: {
      request: { from, to, amount: rawAmount, affinity: 'from' },
      block: blockBase64,
    },
  });
  if (!data.ok) throw new Error(data.error || 'FX exchange failed');
  return data.exchangeID as string;
}

// ── Amount helpers ───────────────────────────────────────────────────────────

function toRawAmount(humanAmount: string, decimals: number): string {
  const num = parseFloat(humanAmount);
  if (isNaN(num) || num <= 0) return '0';
  const [whole, frac = ''] = num.toString().split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole + paddedFrac).toString();
}

// ── State machine ────────────────────────────────────────────────────────────

type ConvertStep = 'form' | 'executing' | 'success' | 'error';

const ConverterPage: React.FC = () => {
  const { isConnected, address, network } = useWallet();

  // Available tokens for this network
  const availableTokens = CONVERT_TOKENS.filter(t => t.address[network]);

  // Form state
  const [fromSymbol, setFromSymbol] = useState('USDC');
  const [toSymbol, setToSymbol] = useState('KTA');
  const [amount, setAmount] = useState('');
  const [walletBalance, setWalletBalance] = useState<string | null>(null);

  // Estimate state
  const [estimate, setEstimate] = useState<FxEstimateResult | null>(null);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  // Execution state
  const [step, setStep] = useState<ConvertStep>('form');
  const [execStatus, setExecStatus] = useState('');
  const [execError, setExecError] = useState('');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fromToken = availableTokens.find(t => t.symbol === fromSymbol) || availableTokens[0];
  const validToTokens = fromToken ? getValidToTokens(fromToken, network) : [];
  const toToken = validToTokens.find(t => t.symbol === toSymbol) || validToTokens[0];

  const convertMethod = fromToken && toToken ? getConvertMethod(fromToken, toToken) : null;

  // When from changes, ensure to is valid
  useEffect(() => {
    if (toToken && toToken.symbol !== toSymbol) {
      setToSymbol(toToken.symbol);
    }
    if (!toToken && validToTokens.length > 0) {
      setToSymbol(validToTokens[0].symbol);
    }
  }, [fromSymbol, network]);

  // Fetch wallet balance for the from token
  useEffect(() => {
    setWalletBalance(null);
    if (!isConnected || !fromToken?.address[network] || !window.alpaca) return;
    window.alpaca.getBalance(fromToken.address[network]).then(res => {
      if ('balance' in res) setWalletBalance(res.balance);
    }).catch(() => {});
  }, [isConnected, fromSymbol, network]);

  // Fetch estimate on amount change (debounced)
  const fetchEstimate = useCallback(async () => {
    if (!fromToken || !toToken || !amount) {
      setEstimate(null);
      return;
    }
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      setEstimate(null);
      return;
    }

    const fromAddr = fromToken.address[network];
    const toAddr = toToken.address[network];
    if (!fromAddr || !toAddr) return;

    setEstimateLoading(true);
    setEstimateError(null);

    try {
      if (convertMethod === 'fx') {
        const rawAmount = toRawAmount(amount, fromToken.decimals[network]);
        const est = await fxGetEstimate(network, fromAddr, toAddr, rawAmount);
        setEstimate(est);
      } else if (convertMethod === 'bivo') {
        // For Bivo, use bridgeSimulateTransfer via extension
        if (!window.alpaca?.bridgeSimulateTransfer) {
          throw new Error('Wallet extension required for fiat conversions');
        }
        const rawAmount = toRawAmount(amount, fromToken.decimals[network]);

        // Bivo uses full Keeta addresses for on-chain fiat tokens
        const sim = await window.alpaca.bridgeSimulateTransfer({
          providerID: BIVO_PROVIDER_ID,
          asset: [fromAddr, toAddr],
          from: { location: KEETA_LOCATION },
          to: { location: KEETA_LOCATION, recipient: address! },
          value: rawAmount,
        });
        const inst = sim.instructions?.[0];
        const receiveAmount = inst?.totalReceiveAmount || inst?.value || '0';
        setEstimate({
          convertedAmount: receiveAmount,
          convertedAmountBound: null,
          expectedCost: {
            min: typeof inst?.assetFee === 'string' ? inst.assetFee : (inst?.assetFee as any)?.total || '0',
            max: typeof inst?.assetFee === 'string' ? inst.assetFee : (inst?.assetFee as any)?.total || '0',
            token: fromToken.symbol,
          },
          account: '',
        });
      }
    } catch (err: any) {
      console.error('Estimate failed:', err);
      setEstimate(null);
      setEstimateError(err?.message || 'Failed to get estimate');
    } finally {
      setEstimateLoading(false);
    }
  }, [amount, fromToken, toToken, convertMethod, network, address]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setEstimate(null);
    setEstimateError(null);
    if (!amount || parseFloat(amount) <= 0) return;
    debounceRef.current = setTimeout(fetchEstimate, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [amount, fromSymbol, toSymbol, network, fetchEstimate]);

  // ── Execute conversion ─────────────────────────────────────────────────────

  const handleConvert = async () => {
    if (!fromToken || !toToken || !estimate || !address) return;

    const fromAddr = fromToken.address[network];
    const toAddr = toToken.address[network];
    if (!fromAddr || !toAddr || !window.alpaca) return;

    setStep('executing');
    setExecError('');

    try {
      const rawAmount = toRawAmount(amount, fromToken.decimals[network]);

      if (convertMethod === 'fx') {
        // 1. Sign swap block
        setExecStatus('Signing transaction...');
        const minAmountOut = estimate.convertedAmountBound || estimate.convertedAmount;

        const swapBlock = await window.alpaca.signTransaction({
          type: 'SWAP',
          poolAddress: estimate.account,
          tokenIn: fromAddr,
          tokenOut: toAddr,
          amountIn: rawAmount,
          minAmountOut,
          estimatedFees: estimate.expectedCost.max,
          feeToken: estimate.expectedCost.token,
        });

        const blockBase64 = typeof swapBlock === 'string' ? swapBlock : swapBlock.base64;

        // 2. Submit to FX anchor
        setExecStatus('Submitting to network...');
        const exchangeId = await fxCreateExchange(network, fromAddr, toAddr, rawAmount, blockBase64);

        // 3. Poll for completion
        setExecStatus('Waiting for confirmation...');
        await pollFxExchange(network, exchangeId);

        setStep('success');

      } else if (convertMethod === 'bivo') {
        await executeBivoTransfer(fromAddr, toAddr, rawAmount);
        setStep('success');
      }
    } catch (err: any) {
      console.error('Conversion failed:', err);
      setExecError(err?.message || 'Conversion failed');
      setStep('error');
    }
  };

  const executeBivoTransfer = async (fromAddr: string, toAddr: string, rawAmount: string) => {
    if (!window.alpaca || !address) throw new Error('Wallet not connected');

    // 1. Initiate transfer with Bivo (uses full Keeta addresses)
    setExecStatus('Initiating transfer...');
    const transfer = await window.alpaca.bridgeInitiateTransfer({
      providerID: BIVO_PROVIDER_ID,
      asset: [fromAddr, toAddr],
      from: { location: KEETA_LOCATION },
      to: { location: KEETA_LOCATION, recipient: address },
      value: rawAmount,
    });

    const instruction = transfer.instructions?.[0];
    if (!instruction?.sendToAddress) throw new Error('No deposit address received');

    // 2. Send tokens to Bivo's address
    setExecStatus('Sending tokens...');
    await window.alpaca.sendTransaction({
      type: 'SEND',
      to: instruction.sendToAddress,
      amount: instruction.value || rawAmount,
      token: fromAddr,
    });

    // 3. Poll for completion
    setExecStatus('Waiting for confirmation...');
    await pollBivoTransfer(transfer.transferId);
  };

  const pollFxExchange = (network: string, exchangeId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 30; // 2 minutes at 4s intervals
      const poll = async () => {
        attempts++;
        try {
          const data = await fxAnchorCall(network, `getExchangeStatus/${exchangeId}`, {});
          const status = (data?.status || '').toLowerCase();
          if (status === 'completed') { resolve(); return; }
          if (status === 'failed' || status === 'error') { reject(new Error('Exchange failed')); return; }
        } catch { /* continue polling */ }
        if (attempts >= maxAttempts) { resolve(); return; } // assume success after timeout
        setTimeout(poll, 4000);
      };
      setTimeout(poll, 3000);
    });
  };

  const pollBivoTransfer = (transferId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 30;
      const poll = async () => {
        attempts++;
        try {
          if (!window.alpaca) { reject(new Error('Extension lost')); return; }
          const result = await window.alpaca.bridgeGetStatus({
            providerID: BIVO_PROVIDER_ID,
            transferId,
          });
          console.log('[Converter] Bivo status poll:', JSON.stringify(result.transaction?.status), result.transaction);
          const status = result.transaction?.status?.toLowerCase();
          if (status === 'completed' || status === 'settled') { resolve(); return; }
          if (status === 'failed' || status === 'rejected') { reject(new Error('Transfer failed')); return; }
        } catch (pollErr) { console.warn('[Converter] Bivo status poll error:', pollErr); }
        if (attempts >= maxAttempts) { resolve(); return; }
        setTimeout(poll, 4000);
      };
      setTimeout(poll, 3000);
    });
  };

  const handleSwapDirection = () => {
    // Only swap if reverse direction is valid
    if (toToken && getConvertMethod(toToken, fromToken) !== null) {
      const newFrom = toSymbol;
      const newTo = fromSymbol;
      setFromSymbol(newFrom);
      setToSymbol(newTo);
      setAmount('');
      setEstimate(null);
    }
  };

  const handleSetMax = () => {
    if (!walletBalance || !fromToken) return;
    const formatted = formatAmount18(walletBalance, fromToken.decimals[network]);
    setAmount(formatted.replace(/,/g, ''));
  };

  const resetForm = () => {
    setStep('form');
    setAmount('');
    setEstimate(null);
    setEstimateError(null);
    setExecError('');
  };

  // Format the estimated output for display
  const formattedOutput = estimate && toToken
    ? formatAmount18(estimate.convertedAmount, toToken.decimals[network])
    : null;

  const formattedFee = estimate && fromToken && estimate.expectedCost.max !== '0'
    ? formatAmount18(estimate.expectedCost.max, fromToken.decimals[network])
    : null;

  const canConvert = isConnected && estimate && !estimateLoading && amount && parseFloat(amount) > 0;
  const reverseValid = toToken && fromToken && getConvertMethod(toToken, fromToken) !== null;

  const methodLabel = convertMethod === 'fx' ? 'Keeta FX Anchor'
    : convertMethod === 'bivo' ? 'Bivo'
    : '';

  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-8 py-8 relative">
      <ParticleNetwork />

      {/* Page Header */}
      <div className="mb-8 max-w-lg mx-auto relative z-10">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.01em] text-gray-900 dark:text-white">
          Convert
        </h1>
        <p className="text-[15px] text-gray-500 dark:text-gray-400 mt-1">
          Swap tokens and convert to on-chain fiat currencies
        </p>
      </div>

      {/* Main Card */}
      <div className="max-w-lg mx-auto relative z-10">
        <div className="rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-6 transition-colors">

          {step === 'form' && (
            <>
              {/* From */}
              <div className="mb-3">
                <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2 block">
                  From
                </label>
                <div className="rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] focus-within:ring-1 focus-within:ring-[#845fbc]/40 focus-within:border-[#845fbc]/40 transition-all">
                  {/* Input row */}
                  <div className="flex items-center">
                    <input
                      type="number"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="any"
                      className="flex-1 min-w-0 px-4 py-3 bg-transparent text-gray-900 dark:text-white text-[18px] font-mono focus:outline-none"
                    />
                    {isConnected && walletBalance && fromToken && (
                      <button
                        onClick={handleSetMax}
                        className="px-2 py-1 mr-1 rounded text-[10px] uppercase tracking-[0.06em] font-semibold bg-[#845fbc]/10 text-[#845fbc] hover:bg-[#845fbc]/20 transition-colors flex-shrink-0"
                      >
                        Max
                      </button>
                    )}
                    <select
                      value={fromSymbol}
                      onChange={e => {
                        setFromSymbol(e.target.value);
                        setAmount('');
                        setEstimate(null);
                      }}
                      className="px-3 py-3 bg-transparent text-gray-900 dark:text-white text-[14px] font-semibold focus:outline-none border-l border-gray-200 dark:border-white/[0.08] min-w-[100px]"
                    >
                      <optgroup label="Crypto">
                        {availableTokens.filter(t => t.type === 'crypto').map(t => (
                          <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                        ))}
                      </optgroup>
                      <optgroup label="On-Chain Fiat — Coming Soon">
                        {availableTokens.filter(t => t.type === 'fiat').map(t => (
                          <option key={t.symbol} value={t.symbol} disabled>{t.symbol.replace('$', '')} ({t.label})</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  {/* Balance row */}
                  {isConnected && fromToken && (
                    <div className="px-4 pb-2.5 -mt-1">
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">
                        Balance:{' '}
                        {walletBalance !== null ? (
                          <span className="text-gray-500 dark:text-gray-400 font-medium">
                            {formatAmount18(walletBalance, fromToken.decimals[network])} {fromToken.symbol}
                          </span>
                        ) : (
                          <span className="text-gray-400 dark:text-gray-500">loading...</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Swap direction */}
              <div className="flex justify-center my-2">
                <button
                  onClick={handleSwapDirection}
                  disabled={!reverseValid}
                  className="p-2 rounded-md border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] hover:bg-gray-50 dark:hover:bg-white/[0.04] transition-colors text-[#845fbc] disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </button>
              </div>

              {/* To */}
              <div className="mb-4">
                <label className="text-[11px] uppercase tracking-[0.08em] font-semibold text-gray-400 dark:text-gray-500 mb-2 block">
                  To
                </label>
                <div className="flex gap-2">
                  <div className="flex-1 px-4 py-3 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.02] text-[18px] font-mono min-h-[50px] flex items-center">
                    {estimateLoading ? (
                      <span className="text-gray-400 text-[14px]">Calculating...</span>
                    ) : formattedOutput ? (
                      <span className="text-gray-900 dark:text-white">{formattedOutput}</span>
                    ) : (
                      <span className="text-gray-400">0.00</span>
                    )}
                  </div>
                  <select
                    value={toSymbol}
                    onChange={e => {
                      setToSymbol(e.target.value);
                      setEstimate(null);
                    }}
                    className="px-3 py-3 rounded-lg border border-gray-200 dark:border-white/[0.08] bg-gray-50 dark:bg-white/[0.04] text-gray-900 dark:text-white text-[14px] font-semibold focus:outline-none focus:ring-1 focus:ring-[#845fbc]/40 min-w-[100px]"
                  >
                    {validToTokens.length > 0 ? (
                      <>
                        {/* Crypto group */}
                        {validToTokens.filter(t => t.type === 'crypto').length > 0 && (
                          <optgroup label="Crypto">
                            {validToTokens.filter(t => t.type === 'crypto').map(t => (
                              <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
                            ))}
                          </optgroup>
                        )}
                        {/* Fiat group — selectable tokens */}
                        {validToTokens.filter(t => t.type === 'fiat').length > 0 && (
                          <optgroup label="On-Chain Fiat">
                            {validToTokens.filter(t => t.type === 'fiat').map(t => (
                              <option key={t.symbol} value={t.symbol}>{t.symbol.replace('$', '')} ({t.label})</option>
                            ))}
                          </optgroup>
                        )}
                        {/* Fiat tokens not in validToTokens — greyed out coming soon */}
                        {(() => {
                          const validFiatSymbols = new Set(validToTokens.filter(t => t.type === 'fiat').map(t => t.symbol));
                          const comingSoonFiat = availableTokens.filter(t => t.type === 'fiat' && !validFiatSymbols.has(t.symbol));
                          if (comingSoonFiat.length === 0) return null;
                          return (
                            <optgroup label="On-Chain Fiat — Coming Soon">
                              {comingSoonFiat.map(t => (
                                <option key={t.symbol} value={t.symbol} disabled>{t.symbol.replace('$', '')} ({t.label})</option>
                              ))}
                            </optgroup>
                          );
                        })()}
                      </>
                    ) : (
                      <>
                        <option disabled>No pairs available</option>
                        <optgroup label="On-Chain Fiat — Coming Soon">
                          {availableTokens.filter(t => t.type === 'fiat').map(t => (
                            <option key={t.symbol} value={t.symbol} disabled>{t.symbol.replace('$', '')} ({t.label})</option>
                          ))}
                        </optgroup>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {/* Rate info */}
              {(estimate || estimateError) && (
                <div className="bg-gray-50 dark:bg-white/[0.02] rounded-lg p-3 mb-4 space-y-1.5">
                  {estimateError && (
                    <p className="text-[12px] text-amber-600 dark:text-amber-400">{estimateError}</p>
                  )}
                  {formattedFee && (
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-gray-500">Network fee</span>
                      <span className="text-gray-900 dark:text-white font-medium font-mono">
                        {formattedFee} {estimate?.expectedCost.token ? CONVERT_TOKENS.find(t => t.address[network] === estimate.expectedCost.token)?.symbol || '' : ''}
                      </span>
                    </div>
                  )}
                  {methodLabel && (
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-gray-500">Via</span>
                      <span className="text-gray-900 dark:text-white font-medium">{methodLabel}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Convert button */}
              {!isConnected ? (
                <p className="text-center text-[13px] text-gray-500 dark:text-gray-400 py-3">
                  Connect your wallet to convert tokens
                </p>
              ) : convertMethod === null && fromToken && toToken ? (
                <p className="text-center text-[13px] text-gray-400 py-3">
                  No conversion route available for this pair
                </p>
              ) : (
                <button
                  onClick={handleConvert}
                  disabled={!canConvert}
                  className="w-full py-3 bg-[#845fbc] hover:bg-[#724bad] text-white font-semibold rounded-md text-[13px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Convert {fromToken?.symbol} to {toToken?.symbol}
                </button>
              )}

              {convertMethod && (
                <p className="mt-3 text-center text-[11px] text-gray-400">
                  {convertMethod === 'fx'
                    ? 'Converted via the Keeta FX anchor. Rate is variable.'
                    : 'Converted via Bivo. Requires KYC verification.'}
                </p>
              )}
            </>
          )}

          {/* Executing */}
          {step === 'executing' && (
            <div className="py-10 text-center">
              <svg className="animate-spin h-8 w-8 mx-auto text-[#845fbc] mb-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <p className="text-[13px] text-gray-700 dark:text-gray-300 font-semibold mb-2">Converting...</p>
              <p className="text-[12px] text-gray-500 dark:text-gray-400">{execStatus}</p>
            </div>
          )}

          {/* Success */}
          {step === 'success' && (
            <div className="py-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-[15px] font-semibold text-gray-900 dark:text-white mb-2">Conversion Complete</p>
              <p className="text-[13px] text-gray-500 dark:text-gray-400 mb-5">
                Your {toToken?.symbol} has been delivered to your wallet.
              </p>
              <button
                onClick={resetForm}
                className="px-6 py-2 bg-[#845fbc] hover:bg-[#724bad] text-white text-[13px] font-semibold rounded-md transition-colors"
              >
                Convert More
              </button>
            </div>
          )}

          {/* Error */}
          {step === 'error' && (
            <div className="py-8 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-100 dark:bg-red-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-[13px] text-red-500 dark:text-red-400 mb-4">{execError}</p>
              <button
                onClick={resetForm}
                className="px-6 py-2 bg-[#845fbc]/8 hover:bg-[#845fbc] text-[#845fbc] hover:text-white text-[12px] font-semibold rounded-md transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Supported pairs info */}
        <div className="mt-6 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1a1a1a] p-5 transition-colors">
          <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white mb-3">Supported Conversions</h3>
          <div className="space-y-2 text-[12px] text-gray-500 dark:text-gray-400">
            <div className="flex items-start gap-2">
              <span className="text-[#845fbc] mt-0.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
              </span>
              <span><strong>USDC, EURC, KTA</strong> — swap between any pair via Keeta FX Anchor</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-[#845fbc] mt-0.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </span>
              <span><strong>$USD ↔ $EUR, $GBP, $CAD, $JPY</strong> and more — on-chain fiat conversions via Bivo (KYC required)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConverterPage;

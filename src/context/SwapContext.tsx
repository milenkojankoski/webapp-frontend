import React, { createContext, useContext, useState, type ReactNode } from 'react';

// Define the Token Type used in the Swap Modal
export interface SwapToken {
  address: string;
  symbol: string;
  decimals: number;
}

interface SwapContextType {
  isSwapOpen: boolean;
  openSwap: (tokenIn?: SwapToken, tokenOut?: SwapToken, fundRaising?: boolean) => void;
  closeSwap: () => void;
  defaultTokenIn: SwapToken;
  defaultTokenOut: SwapToken;
  isFundRaising: boolean;
}

const SwapContext = createContext<SwapContextType | null>(null);

// Default KTA Token (Adjust address/symbol if needed)
const KTA_TOKEN: SwapToken = { address: 'KTA', symbol: 'KTA', decimals: 18 };

export const SwapProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [defaultTokenIn, setDefaultTokenIn] = useState<SwapToken>(KTA_TOKEN);
  const [defaultTokenOut, setDefaultTokenOut] = useState<SwapToken>(KTA_TOKEN);
  const [isFundRaising, setIsFundRaising] = useState(false);

  const openSwap = (inToken?: SwapToken, outToken?: SwapToken, fundRaising?: boolean) => {
    if (inToken) setDefaultTokenIn(inToken);
    if (outToken) setDefaultTokenOut(outToken);
    setIsFundRaising(fundRaising ?? false);
    setIsSwapOpen(true);
  };

  const closeSwap = () => setIsSwapOpen(false);

  return (
    <SwapContext.Provider value={{ isSwapOpen, openSwap, closeSwap, defaultTokenIn, defaultTokenOut, isFundRaising }}>
      {children}
    </SwapContext.Provider>
  );
};

export const useSwap = () => {
  const context = useContext(SwapContext);
  if (!context) throw new Error("useSwap must be used within a SwapProvider");
  return context;
};
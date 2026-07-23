import React, { createContext, useContext, useState, useEffect, type ReactNode, useCallback, useRef } from 'react';
import { WalletService, type WalletBalance } from '../services/wallet';
import { getAdminAccounts } from '../config/firebase';
import { setAdminMode, logger } from '../utils/logger';

interface WalletContextType {
  isConnected: boolean;
  isLoading: boolean;
  address: string | null;
  network: 'main' | 'test';
  balances: WalletBalance[];
  connectToExtension: (silent?: boolean) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  setNetwork: (net: 'main' | 'test') => void;
}

const WalletContext = createContext<WalletContextType | null>(null);

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetworkState] = useState<'main' | 'test'>('main');
  const [balances, setBalances] = useState<WalletBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Refs to keep current values accessible in event callbacks without stale closures
  const addressRef = useRef(address);
  const networkRef = useRef(network);
  addressRef.current = address;
  networkRef.current = network;

  const refreshBalances = useCallback(async (currentAddress: string, currentNetwork: 'main' | 'test') => {
    try {
      const newBalances = await WalletService.getBalances(currentAddress, currentNetwork);
      setBalances(newBalances);
    } catch (e) {
      console.error("Failed to fetch balances:", e);
    }
  }, []);

  // Use useCallback to prevent unnecessary re-renders of components consuming this function
  const connectToExtension = useCallback(async (silent: boolean = false) => {
    // If silent and extension is missing, just exit without annoyance
    if (!window.alpaca) {
      if (!silent) {
        const confirm = window.confirm(
          "Alpaca Wallet not detected.\n\n" +
          "• If you haven't installed it yet, install it from the Chrome Web Store:\n" +
          "  https://chromewebstore.google.com/detail/alpaca-wallet/npjlkfdlbkfgofoihjagcbcbpdmegabj\n\n" +
          "• If it's already installed, make sure the extension is enabled and your wallet is unlocked, then refresh the page.\n\n" +
          "Click OK to open the Chrome Web Store.\n" +
          "Visit alpacadex.com to learn more."
        );
        if (confirm) window.open("https://chromewebstore.google.com/detail/alpaca-wallet/npjlkfdlbkfgofoihjagcbcbpdmegabj", "_blank");
      }
      return;
    }

    setIsLoading(true);
    try {
      const response = await window.alpaca.connect();
      logger.log("connect() response:", response);
      if (response && response.connected) {
        setAddress(response.address);
        localStorage.setItem("is_wallet_connected", "true");
        await refreshBalances(response.address, network);
      }
    } catch (error: any) {
      console.error("Connection failed:", error);
      // Only show alerts if the user manually triggered the connection
      if (!silent) {
        alert("Connection failed: " + String(error?.message ?? error));
      }
    } finally {
      setIsLoading(false);
    }
  }, [network, refreshBalances]);

  // Handle auto-reconnection on page load
  useEffect(() => {
    const wasConnected = localStorage.getItem("is_wallet_connected");

    if (wasConnected === "true") {
      // Small delay to ensure extension has finished injecting into window
      const timeout = setTimeout(() => {
        connectToExtension(true);
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [connectToExtension]);

  // ── Extension event listeners (reactive account/network/disconnect) ──
  useEffect(() => {
    if (!window.alpaca?.on) return;

    const handleAccountChanged = (data: any) => {
      const newAddress = data?.address;
      if (newAddress && newAddress !== addressRef.current) {
        logger.log("[WalletContext] accountChanged:", newAddress);
        setAddress(newAddress);
        refreshBalances(newAddress, networkRef.current);
      }
    };

    const handleNetworkChanged = (data: any) => {
      const newNet = data?.network;
      if (newNet && (newNet === 'main' || newNet === 'test') && newNet !== networkRef.current) {
        logger.log("[WalletContext] networkChanged:", newNet);
        setNetworkState(newNet);
        if (addressRef.current) {
          refreshBalances(addressRef.current, newNet);
        }
      }
    };

    const handleDisconnect = () => {
      logger.log("[WalletContext] disconnect event");
      setAddress(null);
      setBalances([]);
      localStorage.removeItem("is_wallet_connected");
    };

    window.alpaca.on('accountChanged', handleAccountChanged);
    window.alpaca.on('networkChanged', handleNetworkChanged);
    window.alpaca.on('disconnect', handleDisconnect);

    return () => {
      if (window.alpaca?.off) {
        window.alpaca.off('accountChanged', handleAccountChanged);
        window.alpaca.off('networkChanged', handleNetworkChanged);
        window.alpaca.off('disconnect', handleDisconnect);
      }
    };
  }, [refreshBalances]);

  const logout = () => {
    setAddress(null);
    setBalances([]);
    localStorage.removeItem("is_wallet_connected");
    window.location.reload();
  };

  const refresh = async () => {
    if (address) await refreshBalances(address, network);
  };

  const setNetwork = (net: 'main' | 'test') => {
    setNetworkState(net);
    if (address) refreshBalances(address, net);
  };

  // Toggle admin logging based on connected wallet
  useEffect(() => {
    if (!address) { setAdminMode(false); return; }
    getAdminAccounts().then(admins => setAdminMode(admins.includes(address)));
  }, [address]);

  useEffect(() => {
    if (!address) return;
    const interval = setInterval(() => refreshBalances(address, network), 30000);
    return () => clearInterval(interval);
  }, [address, network, refreshBalances]);

  return (
    <WalletContext.Provider value={{
      isConnected: !!address,
      isLoading,
      address,
      network,
      balances,
      connectToExtension,
      logout,
      refresh,
      setNetwork
    }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within a WalletProvider");
  return context;
};

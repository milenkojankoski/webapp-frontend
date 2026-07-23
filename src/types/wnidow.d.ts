export { };

interface AlpacaContact {
  id: string;
  label: string;
  address?: { recipient?: string } | string;
  rail?: string;
  createdAt?: string;
  updatedAt?: string;
}

declare global {
  interface Window {
    alpaca?: {
      isAlpaca: boolean;
      version: string;
      connect: () => Promise<{ address: string; connected: boolean }>;
      disconnect: () => Promise<{ disconnected: boolean }>;
      getNetwork: () => Promise<{ network: string }>;
      isConnected: () => Promise<{ connected: boolean; address: string | null }>;
      signTransaction: (tx: any) => Promise<string | { base64: string; hash: string }>;
      sendTransaction: (tx: any) => Promise<{ txHash: string }>;
      signMessage: (message: string) => Promise<{ signature: string; address: string }>;
      getBalance: (tokenAddress?: string) => Promise<
        { address: string; network: string; tokenAddress: string; balance: string } |
        { address: string; network: string; balances: { tokenAddress: string; balance: string }[] }
      >;
      shareKYC: () => Promise<
        { hasCertificate: false; address: string; network: string } |
        { hasCertificate: true; container: string; transportSeed: string; address: string; network: string }
      >;
      getKYCCountries: () => Promise<{ countries: string[] }>;
      startKYCVerification: (countryCodes: string[]) => Promise<{ verificationId: string; webURL: string }>;
      checkKYCVerification: () => Promise<{ status: 'pending' | 'completed' | 'error'; hasCertificate?: boolean; error?: string }>;
      setAccountInfo: (name: string, description: string, metadata?: string) => Promise<{ ok: boolean }>;
      claimUsername: (username: string) => Promise<{ ok: boolean; username: string }>;
      releaseUsername: () => Promise<{ ok: boolean }>;
      getProfilePic: (address?: string) => Promise<{ hasIcon: boolean; dataUrl?: string; mimeType?: string }>;
      setProfilePic: (dataUrl: string) => Promise<{ ok: boolean }>;
      deleteProfilePic: () => Promise<{ ok: boolean }>;
      listContacts: () => Promise<{ contacts: AlpacaContact[] }>;
      createContact: (label: string, address: { recipient: string }, rail?: string) => Promise<{ contact: AlpacaContact }>;
      updateContact: (id: string, label: string, address?: { recipient: string }) => Promise<{ contact: AlpacaContact }>;
      deleteContact: (id: string) => Promise<{ ok: boolean }>;
      getWalletInfo: () => Promise<{ accountCount: number; activeIndex: number; autoLockMinutes: number; network: string; extensionVersion: string }>;
      setAutoLock: (minutes: number) => Promise<{ ok: boolean; autoLockMinutes: number }>;

      // Bridge (Asset Movement)
      bridgeGetProviders: (params?: {
        asset?: any;
        from?: string;
        to?: string;
        rail?: string | string[];
      }) => Promise<{
        providers: Array<{
          providerID: string;
          supportedAssets: Array<{
            asset: any;
            paths: Array<{
              pair: [any, any];
              kycProviders?: string[];
            }>;
          }>;
        }>;
        network: string;
      }>;
      bridgeSimulateTransfer: (params: {
        providerID: string;
        asset: any;
        from: { location: string };
        to: { location: string; recipient: string };
        value: string;
        allowedRails?: string[];
      }) => Promise<{
        instructions: Array<{
          type: string;
          sendToAddress?: string;
          value: string;
          tokenAddress?: string;
          tokenMintAddress?: string;
          location?: any;
          assetFee: string | { total: string; totalPricedIn?: string; lineItems: any[] };
          totalReceiveAmount?: string;
        }>;
        network: string;
      }>;
      bridgeInitiateTransfer: (params: {
        providerID: string;
        asset: any;
        from: { location: string };
        to: { location: string; recipient: string };
        value: string;
        allowedRails?: string[];
      }) => Promise<{
        transferId: string;
        instructions: Array<{
          type: string;
          sendToAddress: string;
          value: string;
          tokenAddress?: string;
          tokenMintAddress?: string;
          location?: any;
          assetFee: string | { total: string; totalPricedIn?: string; lineItems: any[] };
          totalReceiveAmount?: string;
        }>;
        network: string;
      }>;
      bridgeGetStatus: (params: {
        providerID: string;
        transferId: string;
      }) => Promise<{
        transaction: {
          id: string;
          status: string;
          asset: any;
          from: { location: string; value: string; transactions: any };
          to: { location: string; value: string; transactions: any };
          fee: { asset: any; value: string } | null;
          createdAt: string;
          updatedAt: string;
        };
        network: string;
      }>;
      bridgeShareKYC: (providerID: string) => Promise<{ shared: boolean; reason?: string }>;
      publishCertificate: (certificatePem: string) => Promise<{ ok: boolean; hash: string }>;
      fxProxy: (url: string, body: any) => Promise<any>;
      on: (eventName: 'accountChanged' | 'networkChanged' | 'disconnect', callback: (data: any) => void) => void;
      off: (eventName: 'accountChanged' | 'networkChanged' | 'disconnect', callback: (data: any) => void) => void;
    };
  }
}
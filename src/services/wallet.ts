import { UserClient, Client, lib } from '@keetanetwork/keetanet-client';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import { cacheGet, cacheSet } from './cache';
import { logger } from '../utils/logger';

if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

export interface WalletBalance {
  symbol: string;
  name: string;
  address: string;
  amount: string;
  rawBalance: string;
  decimals: number;
}

export interface WalletTransaction {
  type: 'SWAP' | 'SEND' | 'RECEIVE' | 'UNKNOWN';
  hash: string;
  timestamp: number;
  counterparty: string; // Will hold "To: ..." or "From: ..."
  blockAuthor?: string; // Address of the account that authored this block
  swapCounterparty?: string; // For swaps: the other party (e.g. trader when querying pool history)
  external?: string; // Optional on-chain external field (e.g. "PD-..." for collective payouts)
  tokenIn?: { symbol: string; decimals: number; address: string; amount: string };
  tokenOut?: { symbol: string; decimals: number; address: string; amount: string };
}

let _activeSigner: any | null = null;

// --- HELPERS ---

const formatBigInt = (amountStr: string, decimals: number): string => {
  try {
    if (!amountStr || amountStr === "0") return "0";
    if (decimals === 0) return amountStr;
    let str = amountStr.padStart(decimals + 1, '0');
    const integerPart = str.slice(0, str.length - decimals);
    const fractionalPart = str.slice(str.length - decimals);
    const cleanFraction = fractionalPart.replace(/0+$/, '');
    return cleanFraction ? `${integerPart}.${cleanFraction}` : integerPart;
  } catch (e) {
    return "0";
  }
};

const extractAddress = (obj: any): string => {
  if (!obj) return "";
  if (typeof obj === 'string') return obj;
  if (typeof obj.get === 'function') return obj.get();
  if (obj.publicKeyString) {
    if (typeof obj.publicKeyString.get === 'function') return obj.publicKeyString.get();
    return obj.publicKeyString.toString();
  }
  const str = obj.toString();
  return str === '[object Object]' ? "" : str;
};

const getNetworkId = (network: 'main' | 'test'): bigint => {
  switch (network) {
    case 'test': return BigInt(0x54455354);
    case 'main': return BigInt(0x5382);
    default: return BigInt(0x5382);
  }
};

export const WalletService = {

  initClient: async (seedPhrase: string, network: 'main' | 'test' = 'main'): Promise<{ client: UserClient; address: string; network: 'main' | 'test' }> => {
    if (!bip39.validateMnemonic(seedPhrase)) {
      logger.warn("Mnemonic validation failed, attempting SDK derivation anyway.");
    }
    const seed = await lib.Account.seedFromPassphrase(seedPhrase);
    const account = lib.Account.fromSeed(seed, 0);
    if (!account) throw new Error("Failed to derive account from seed");

    _activeSigner = account;

    const client = await UserClient.fromNetwork(network, account);
    const addressStr = extractAddress(account.publicKeyString);

    logger.log(`Wallet Initialized on [${network.toUpperCase()}]:`, addressStr);
    return { client, address: addressStr, network };
  },

  generateNewPhrase: (): string => {
    return bip39.generateMnemonic(256);
  },

  getBalances: async (address: string, network: 'main' | 'test'): Promise<WalletBalance[]> => {
    try {
      const readClient = await Client.fromNetwork(network);
      const clientAny = readClient as any;
      const accountIdentifier = lib.Account.fromPublicKeyString(address);
      const rawBalances = await clientAny.getAllBalances(accountIdentifier);

      if (!rawBalances || !Array.isArray(rawBalances)) return [];

      const enhancedBalances: WalletBalance[] = await Promise.all(rawBalances.map(async (item: any) => {
        const addr = extractAddress(item.token);
        const meta = await WalletService.getTokenMetadata(addr, network);
        return {
          symbol: meta.symbol,
          name: meta.symbol,
          address: addr,
          rawBalance: item.balance?.toString() || "0",
          decimals: meta.decimals,
          amount: formatBigInt(item.balance?.toString() || "0", meta.decimals)
        };
      }));
      return enhancedBalances;
    } catch (error) {
      return [];
    }
  },

  getTokenMetadata: async (tokenAddress: string, network: 'main' | 'test'): Promise<{ decimals: number, symbol: string }> => {
    if (tokenAddress === "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg") {
      return { decimals: 18, symbol: "KTA" };
    }
    if (tokenAddress === "keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52") {
      return { decimals: 9, symbol: "KTA" };
    }

    // Token metadata is immutable — cache for 30 minutes
    const cacheKey = `tokenMeta_${network}_${tokenAddress}`;
    const cached = cacheGet<{ decimals: number; symbol: string }>(cacheKey, 30 * 60 * 1000);
    if (cached) return cached;

    try {
      const readClient = await Client.fromNetwork(network);
      const clientAny = readClient as any;
      const tokenIdentifier = lib.Account.fromPublicKeyString(tokenAddress);
      const rawInfo = await clientAny.getAccountInfo(tokenIdentifier);

      let decimals = network === 'test' ? 9 : 18;
      let symbol = tokenAddress.substring(0, 6).toUpperCase();

      const accountInfo = rawInfo.info || rawInfo;

      if (accountInfo) {
        if (accountInfo.decimals !== undefined) decimals = Number(accountInfo.decimals);
        if (accountInfo.metadata) {
          try {
            const metaRaw = accountInfo.metadata.toString();
            let metaJson;
            try { metaJson = JSON.parse(atob(metaRaw)); } catch { metaJson = JSON.parse(metaRaw); }

            if (metaJson) {
              if (metaJson.symbol) symbol = metaJson.symbol;
              if (metaJson.decimalPlaces !== undefined) decimals = Number(metaJson.decimalPlaces);
              else if (metaJson.decimals !== undefined) decimals = Number(metaJson.decimals);
            }
          } catch (e) { }
        }
      }
      const result = { decimals, symbol };
      cacheSet(cacheKey, result);
      return result;
    } catch (error) {
      return { decimals: network === 'test' ? 9 : 18, symbol: "UNK" };
    }
  },

  /**
   * ✅ NEW: Unified Transaction Logic
   * Maps everything to "TRANSACTION" or "SWAP" to avoid incorrect Send/Receive labeling.
   */
  getWalletHistory: async (address: string, network: 'main' | 'test'): Promise<WalletTransaction[]> => {
    try {
      logger.log("Fetching wallet history...");
      const client = await Client.fromNetwork(network);
      const account = lib.Account.fromPublicKeyString(address);

      const history = await client.getHistory(account, { depth: 100 });

      if (!history || !Array.isArray(history)) return [];

      const transactions: WalletTransaction[] = [];
      const metadataCache: Record<string, { decimals: number, symbol: string }> = {};

      const getMeta = async (addr: string) => {
        if (metadataCache[addr]) return metadataCache[addr];
        const meta = await WalletService.getTokenMetadata(addr, network);
        metadataCache[addr] = meta;
        return meta;
      };

      for (const item of history) {
        if (!item.voteStaple || !item.voteStaple.blocks) continue;
        const staple = item.voteStaple;

        const rawTs = staple.timestamp ? staple.timestamp() : Date.now();
        const timestamp = rawTs instanceof Date ? rawTs.getTime() : (typeof rawTs === 'number' ? rawTs : Date.now());

        for (const block of staple.blocks) {
          if (!block.operations) continue;

          const hash = block.hash.toString();
          const ops = block.operations;

          // Determine if this block was authored by us or someone else
          const blockAuthor = extractAddress(block.account);
          const isOurBlock = blockAuthor === address;

          // 1. Detect SWAP (must have both SEND and RECEIVE ops)
          const sendOp = ops.find((op: any) => op.type === 0 || op.type === 'SEND') as any;
          const receiveOp = ops.find((op: any) => op.type === 7 || op.type === 'RECEIVE') as any;

          if (ops.length >= 2 && sendOp && receiveOp) {
            const tokenInOp = sendOp;
            const tokenOutOp = receiveOp;

            const tokenInAddr = extractAddress(tokenInOp.token);
            const tokenOutAddr = extractAddress(tokenOutOp.token);

            const metaIn = await getMeta(tokenInAddr);
            const metaOut = await getMeta(tokenOutAddr);

            // Extract the swap counterparty (the other side of the trade)
            // SEND op has `to`, RECEIVE op has `from`
            const sendTo = extractAddress(tokenInOp.to);
            const receiveFrom = extractAddress(tokenOutOp.from);
            const swapTrader = isOurBlock
              ? (sendTo || receiveFrom || "")
              : blockAuthor;

            const swapExternal = tokenInOp.external?.toString?.() || tokenInOp.external || undefined;

            transactions.push({
              type: 'SWAP',
              hash: hash,
              timestamp: timestamp,
              counterparty: "Pool Interaction",
              blockAuthor: blockAuthor,
              swapCounterparty: swapTrader,
              external: swapExternal,
              tokenIn: {
                symbol: metaIn.symbol,
                decimals: metaIn.decimals,
                address: tokenInAddr,
                amount: formatBigInt(tokenInOp.amount?.toString() || "0", metaIn.decimals)
              },
              tokenOut: {
                symbol: metaOut.symbol,
                decimals: metaOut.decimals,
                address: tokenOutAddr,
                amount: formatBigInt(tokenOutOp.amount?.toString() || "0", metaOut.decimals)
              }
            });
            continue;
          }

          // 2. Process individual operations (single op OR multi-op non-swap blocks like batch payouts)
          for (const op of ops) {
            const opAny = op as any;
            const tokenAddr = extractAddress(opAny.token);
            const meta = await getMeta(tokenAddr);

            const to = extractAddress(opAny.to);
            const from = extractAddress(opAny.from);

            // Determine direction from the user's perspective:
            // - Our block + SEND op = we sent something
            // - Someone else's block + SEND op to us = we received something
            // - Our block + RECEIVE op = we received something
            // - Someone else's block + RECEIVE op from us = we sent something
            const opIsSend = opAny.type === 0 || opAny.type === 'SEND';
            let isIncoming: boolean;

            if (isOurBlock) {
              isIncoming = !opIsSend;
            } else {
              isIncoming = opIsSend;
            }

            // For multi-op blocks (batch payouts), only show ops relevant to this wallet
            if (ops.length > 1) {
              if (isIncoming && opIsSend && to !== address) continue;
              if (isIncoming && !opIsSend && from !== address) continue;
              if (!isIncoming && opIsSend && to === address) continue;
            }

            let label = "";
            if (isIncoming) {
              label = from ? `From: ${from}` : (blockAuthor && !isOurBlock ? `From: ${blockAuthor}` : "Unknown");
            } else {
              label = to ? `To: ${to}` : "Unknown";
            }

            const externalField = opAny.external?.toString?.() || opAny.external || undefined;

            transactions.push({
              type: isIncoming ? 'RECEIVE' : 'SEND',
              hash: hash,
              timestamp: timestamp,
              counterparty: label,
              blockAuthor: blockAuthor,
              external: externalField,
              tokenIn: {
                symbol: meta.symbol,
                decimals: meta.decimals,
                address: tokenAddr,
                amount: formatBigInt(opAny.amount?.toString() || "0", meta.decimals)
              }
            });
          }
        }
      }
      return transactions.sort((a, b) => b.timestamp - a.timestamp);
    } catch (e) {
      console.error("History fetch error:", e);
      return [];
    }
  },

  sendTransaction: async (
    network: 'main' | 'test',
    recipientAddress: string,
    tokenAddress: string,
    amountHuman: string,
    decimals: number
  ): Promise<string> => {
    if (!_activeSigner) throw new Error("Wallet not unlocked");
    if (!recipientAddress || recipientAddress.length < 10) throw new Error("Invalid address");

    let rawAmount = "0";
    if (decimals === 0) {
      rawAmount = amountHuman.split('.')[0];
    } else {
      const [int, frac = ""] = amountHuman.split(".");
      const padded = frac.padEnd(decimals, "0").slice(0, decimals);
      rawAmount = `${int}${padded}`.replace(/^0+/, "") || "0";
    }

    if (BigInt(rawAmount) <= 0n) throw new Error("Amount must be greater than 0");

    const userClient = await UserClient.fromNetwork(network, _activeSigner);

    let previousHash;
    try {
      const head = await userClient.head();
      previousHash = head || lib.Block.NO_PREVIOUS;
    } catch {
      previousHash = lib.Block.NO_PREVIOUS;
    }

    const networkId = getNetworkId(network);
    const builder = new lib.Block.Builder();
    builder.account = _activeSigner;
    builder.previous = previousHash;
    builder.signer = _activeSigner;
    builder.network = networkId;

    builder.addOperation(new lib.Block.Operation.SEND({
      type: lib.Block.OperationType.SEND,
      to: lib.Account.fromPublicKeyString(recipientAddress),
      amount: BigInt(rawAmount),
      token: lib.Account.fromPublicKeyString(tokenAddress) as any
    }));

    const block = await builder.seal();

    logger.log("Publishing send block...", block.hash.toString());

    if (typeof (userClient as any).transmit === 'function') {
      await (userClient as any).transmit([block]);
    } else if ((userClient as any).client && typeof (userClient as any).client.transmit === 'function') {
      await (userClient as any).client.transmit([block]);
    } else {
      const client = await Client.fromNetwork(network);
      await (client as any).transmit([block]);
    }

    return block.hash.toString();
  },

  constructSwapBlock: async (
    seedPhraseOrNull: string | null,
    network: 'main' | 'test',
    poolAddress: string,
    tokenInAddress: string,
    tokenOutAddress: string,
    amountIn: string,
    minAmountOut: string,
    feeAmount: string,
    feeTokenAddress: string
  ): Promise<string> => {

    if (!tokenInAddress || tokenInAddress.length < 10) throw new Error("Invalid Input Token Address");

    let account;
    if (seedPhraseOrNull) {
      const seed = await lib.Account.seedFromPassphrase(seedPhraseOrNull);
      account = lib.Account.fromSeed(seed, 0);
    } else if (_activeSigner) {
      account = _activeSigner;
    } else {
      throw new Error("Wallet not unlocked. Please re-login.");
    }

    const userClient = await UserClient.fromNetwork(network, account);

    let previousHash: any;
    try {
      const head = await userClient.head();
      previousHash = head || lib.Block.NO_PREVIOUS;
    } catch (e) {
      previousHash = lib.Block.NO_PREVIOUS;
    }

    const networkId = getNetworkId(network);
    const builder = new lib.Block.Builder();
    builder.account = account;
    builder.previous = previousHash;
    builder.signer = account;
    builder.network = networkId;

    const poolGeneric = lib.Account.fromPublicKeyString(poolAddress);
    const tokenInGeneric = lib.Account.fromPublicKeyString(tokenInAddress);
    const tokenOutGeneric = lib.Account.fromPublicKeyString(tokenOutAddress);

    const isPayingInFeeToken = (tokenInAddress === feeTokenAddress);
    let finalAmountIn = BigInt(amountIn);

    if (isPayingInFeeToken && feeAmount) {
      finalAmountIn = finalAmountIn + BigInt(feeAmount);
    }

    builder.addOperation(new lib.Block.Operation.SEND({
      type: lib.Block.OperationType.SEND,
      to: poolGeneric,
      amount: finalAmountIn,
      token: tokenInGeneric as any
    }));

    builder.addOperation(new lib.Block.Operation.RECEIVE({
      type: lib.Block.OperationType.RECEIVE,
      from: poolGeneric,
      amount: BigInt(minAmountOut),
      token: tokenOutGeneric as any
    }));

    if (!isPayingInFeeToken && feeAmount && feeAmount !== "0") {
      builder.addOperation(new lib.Block.Operation.SEND({
        type: lib.Block.OperationType.SEND,
        to: poolGeneric,
        amount: BigInt(feeAmount),
        token: lib.Account.fromPublicKeyString(feeTokenAddress) as any
      }));
    }

    const block = await builder.seal();
    return Buffer.from(block.toBytes()).toString('base64');
  },

  broadcastBlock: async (signedBlockBase64: string, network: 'main' | 'test'): Promise<string> => {
    try {
      const blockBytes = Buffer.from(signedBlockBase64, 'base64');
      const block = new lib.Block(blockBytes);

      const client = await Client.fromNetwork(network);
      // Cast to any to access transmit on the underlying client if needed, or directly
      await (client as any).transmit([block]);

      return block.hash.toString();
    } catch (e: any) {
      console.error("Broadcast failed:", e);
      throw new Error(e.message || "Failed to broadcast transaction");
    }
  },

  getTokenHolders: async (tokenAddress: string, network: 'main' | 'test', poolAddress?: string, creatorAddress?: string): Promise<{ address: string; balance: bigint }[]> => {
    try {
      const client = await Client.fromNetwork(network);
      // const tokenAccount = lib.Account.fromPublicKeyString(tokenAddress);

      const balanceMap: Record<string, bigint> = {};

      if (poolAddress) {
        const poolAccount = lib.Account.fromPublicKeyString(poolAddress);

        // Deep Scan Loop: Fetch history in chunks of 2000, up to 10k items or end of chain
        let currentStartBlock: string | undefined = undefined;
        // Total depth target: 10,000 (5 iterations of 2000)
        // Adjust iterations as needed for performance vs accuracy
        for (let i = 0; i < 5; i++) {
          // Fetch deep history from POOL (where the volume is)
          // If currentStartBlock is set, we fetch history STARTING from that block (going backwards)
          const history = await client.getHistory(poolAccount, { depth: 2000, startBlocksHash: currentStartBlock });

          if (!history || !Array.isArray(history) || history.length === 0) break;

          let lastBlockHash: string | undefined;

          for (const item of history) {
            if (!item.voteStaple || !item.voteStaple.blocks) continue;

            for (const block of item.voteStaple.blocks) {
              // Track last block hash for pagination
              lastBlockHash = block.hash.toString();

              if (!block.operations) continue;

              for (const op of block.operations) {
                const opAny = op as any;
                const type = opAny.type;
                const opToken = extractAddress(opAny.token);

                // Only care about the token we are tracking
                if (opToken !== tokenAddress) continue;

                const amount = BigInt(opAny.amount?.toString() || "0");

                // Case 1: POOL RECEIVES TOKEN (User SELLS)
                if (type === 2 || type === 'RECEIVE') {
                  const sender = extractAddress(opAny.from);
                  if (sender) {
                    balanceMap[sender] = (balanceMap[sender] || 0n) - amount;
                  }
                }

                // Case 2: POOL SENDS TOKEN (User BUYS)
                if (type === 0 || type === 'SEND') {
                  const recipient = extractAddress(opAny.to);
                  if (recipient) {
                    balanceMap[recipient] = (balanceMap[recipient] || 0n) + amount;
                  }
                }
              }
            }
          }

          // If we got fewer items than requested, we likely hit the end of history
          if (history.length < 2000) break;

          // Set startBlock for next iteration to continue scan
          // NOTE: If getHistory includes startBlock, we might re-process it. Ideally next iteration should exclude it.
          // But standard simple pagination often re-includes. We can check/skip in loop if needed, but for balance summing it's mostly fine if idempotent or if we update pointer correctly (like previous block logic).
          // Actually, getHistory(startBlock) usually starts *at* startBlock.
          // Check if lastBlockHash changed to avoid infinite loop
          if (lastBlockHash === currentStartBlock) break;
          currentStartBlock = lastBlockHash;
        }
      }

      // Add Creator Balance (Initial Supply / Holding)
      // Since creator might not have interacted with pool yet, or just provided liquidity
      if (creatorAddress) {
        try {
          // Try to fetch actual ledger balance for creator if possible
          // Client.getBalance(account, token)
          const creatorBalance = await client.getBalance(lib.Account.fromPublicKeyString(creatorAddress), tokenAddress);
          if (creatorBalance > 0n) {
            balanceMap[creatorAddress] = creatorBalance;
          }
        } catch (e) {
          logger.warn("Failed to fetch creator balance", e);
        }
      }

      // Filter out small/negative balances and format
      return Object.entries(balanceMap)
        .filter(([_, balance]) => balance > 0n)
        .map(([address, balance]) => ({ address, balance }))
        .sort((a, b) => (b.balance > a.balance ? 1 : -1))
        .slice(0, 10);

    } catch (e) {
      console.error("Failed to fetch token holders:", e);
      return [];
    }
  }
};
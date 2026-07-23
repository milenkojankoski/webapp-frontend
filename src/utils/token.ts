export interface TokenDisplayData {
    displaySymbol: string;
    displayDecimals: number;
    currencySymbol: string;
    logoAddress: string;
    pairedTokenDecimals?: number;
    baseTokenDecimals?: number;
}

const KTA_ADDRESS_MAINNET = "keeta_anqdilpazdekdu4acw65fj7smltcp26wbrildkqtszqvverljpwpezmd44ssg";
const KTA_ADDRESS_TESTNET = "keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52";

// Known bridge assets (stablecoins bridged from Base to Keeta)
const BRIDGE_TOKENS: Record<string, { symbol: string; decimals: Record<string, number> }> = {
    "keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna": { symbol: "USDC", decimals: { main: 18, test: 9 } },
    "keeta_apblhar4ncp3ln62wrygsn73pt3houuvj7ic47aarnolpcu67oqn4xqcji3au": { symbol: "EURC", decimals: { main: 18, test: 9 } },
    "keeta_apna75yhhvnv4ei7ape55hndk4yepno7a7i2mhtiwahiygixjcnmvswxhnmnk": { symbol: "USDC", decimals: { main: 18, test: 9 } },
    "keeta_apyez4az5r6shtblf3qtzirmikq3tghb5svrmmrltdkxgnnzzhlstby3cuscc": { symbol: "cbBTC", decimals: { main: 18, test: 9 } },
    // Fiat-backed tokens (Bivo anchor)
    "keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc": { symbol: "USD", decimals: { main: 18 } },
    "keeta_aozyboy42uks7ticj72awfhpdxwqqfcowezxcew6ecaz5afdt7q2ffycxim4u": { symbol: "CAD", decimals: { main: 18 } },
    "keeta_anjsvaiiycybwhixlalcpwuvobvmpll4lh24td5qipccegmvfi7c2qdcqnlgu": { symbol: "AED", decimals: { main: 18 } },
    "keeta_anutgo4o3yp5tvc6wjt4vzsehjbn7t2wylpxmam4d4ojtdkjj2yca2qoinfcs": { symbol: "EUR", decimals: { main: 18 } },
    "keeta_aojfknc74dabtg72mdhijtszdlv7gi3ht2xp2wrfmdagkthi4n7rulb5e54ss": { symbol: "GBP", decimals: { main: 18 } },
    "keeta_apbn7f34cdq62d7iw4ui6sbfaz7fcqdit354wfaotu5zw6d6xfef5vluhdaos": { symbol: "HKD", decimals: { main: 18 } },
    "keeta_aowqb2hvkak7frntfbtde27bdmqvxancrja7ndh24m66ahkbrzeda3crqh3vg": { symbol: "JPY", decimals: { main: 18 } },
    "keeta_amb3hbd5gbhaorl4y2ddl3xn2q4eyi6dqkn5fpug6diz26v2awsdqhkivmyza": { symbol: "MXN", decimals: { main: 18 } },
    "keeta_ao44m7r4utf2vvytsfijermgkstnkka6rp44eahrekvp4cmj5g2orzm3blrvc": { symbol: "CNY", decimals: { main: 18 } },
};

/**
 * centralized logic to determine how a token should be displayed.
 * Handles Testnet/Mainnet differences and Base vs. Quote token logic.
 *
 * @param token The token object (from Firestore or Wallet)
 * @param network "main" or "test"
 * @param isWalletPage If true, applies specific logic for Wallet Page display (where we iterate over balances)
 */
export function getTokenDisplayData(token: any, network: string): TokenDisplayData {
    // 1. Identify if it's KTA (Base Token)
    const isKTA =
        token.symbol === "KTA" ||
        token.symbol === "KEETA" ||
        token.address === KTA_ADDRESS_MAINNET ||
        token.address === KTA_ADDRESS_TESTNET;

    if (isKTA) {
        const decimals = network === "test" ? 9 : 18;
        return {
            displaySymbol: "KTA",
            displayDecimals: decimals,
            currencySymbol: "KTA",
            logoAddress: network === "test" ? KTA_ADDRESS_TESTNET : KTA_ADDRESS_MAINNET,
            pairedTokenDecimals: decimals,
            baseTokenDecimals: decimals
        };
    }

    // 1b. Known bridge assets (USDC, EURC)
    const bridgeToken = BRIDGE_TOKENS[token.address];
    if (bridgeToken) {
        const decimals = bridgeToken.decimals[network] ?? 18;
        return {
            displaySymbol: bridgeToken.symbol,
            displayDecimals: decimals,
            currencySymbol: "KTA",
            logoAddress: token.address,
            pairedTokenDecimals: decimals,
            baseTokenDecimals: network === "test" ? 9 : 18
        };
    }

    // 2. Identify if it's a "Pool" object (from HomePage/TokenDetails) or a "Wallet Asset" (from WalletPage)
    // WalletPage 'token' has { address, symbol, amount, decimals? } and we look up 'marketData' separately.
    // But here we assume 'token' passed in HAS the market data merged or is the market data object itself.

    // Scenario A: HomePage/TokenDetails (token is the Pool document data)
    // It has: baseToken, pairedToken, baseTokenSymbol, pairedTokenSymbol, etc.
    // And standard token decimals: tokenDecimals, pairedTokenDecimals, baseTokenDecimals.

    // Scenario B: WalletPage (token is the asset balance + market data)
    // We expect the caller to pass usage-ready data.

    // Let's standardize interpretation:
    // We prioritize "baseTokenDecimals" (the Pool's base token) for formatting.
    // If that's missing, we fall back to "tokenDecimals" (legacy field).
    // If that's missing, default to 18.

    // Use ?? to ensure 0 is treated as valid number, not falsy
    const baseDecimals = token.baseTokenDecimals ?? token.tokenDecimals;
    const pairedDecimals = token.pairedTokenDecimals;

    const displayDecimals = baseDecimals ?? 18;

    // Currency Symbol is what the token is priced IN.
    // Usually "KTA" or the base token symbol if it's a pair. 
    // In our context:
    // - HomePage: displays Price in Quote Currency (KTA). 
    // - WalletPage: displays Value in KTA.
    // The "baseTokenSymbol" from the Pool is usually the Quote Currency (e.g. KTA).
    // The "pairedTokenSymbol" is the Asset Symbol (e.g. ALPA).

    const currencySymbol = token.baseTokenSymbol || "KTA"; // Default to KTA

    // Display Symbol: The name of the token itself.
    // If it's a Pool object, 'symbol' or 'pairedTokenSymbol' is the Asset.
    const displaySymbol = token.pairedTokenSymbol || token.symbol || "Unknown";

    // Logo Address: The address of the token (Asset).
    // If it's a Pool object, 'pairedToken' is the Asset address.
    const logoAddress = token.pairedToken || token.address || "";

    return {
        displaySymbol,
        displayDecimals: Number(displayDecimals),
        currencySymbol,
        logoAddress,
        pairedTokenDecimals: pairedDecimals !== undefined ? Number(pairedDecimals) : undefined,
        baseTokenDecimals: baseDecimals !== undefined ? Number(baseDecimals) : undefined
    };
}

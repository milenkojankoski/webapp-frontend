import React, { useState, useEffect } from "react";
import { logger } from '../../utils/logger';

interface TokenLogoProps {
  address: string;
  symbol: string;
  network: "main" | "test";
  className?: string;
}

const BUCKET_NAME = "kta-liquidity-pool.firebasestorage.app";

// Known bridge assets with local logos (stored in public/)
const BRIDGE_TOKEN_LOGOS: Record<string, string> = {
  "keeta_amnkge74xitii5dsobstldatv3irmyimujfjotftx7plaaaseam4bntb7wnna": "/usdc.png",  // USDC mainnet
  "keeta_apna75yhhvnv4ei7ape55hndk4yepno7a7i2mhtiwahiygixjcnmvswxhnmnk": "/usdc.png",  // USDC testnet
  "keeta_apblhar4ncp3ln62wrygsn73pt3houuvj7ic47aarnolpcu67oqn4xqcji3au": "/eurc.png",  // EURC mainnet
  "keeta_apyez4az5r6shtblf3qtzirmikq3tghb5svrmmrltdkxgnnzzhlstby3cuscc": "/cbbtc.png", // cbBTC mainnet
};

// Fiat-backed token logos — country flags via flagcdn.com
const FIAT_TOKEN_FLAGS: Record<string, string> = {
  "keeta_aonxxqry6rknxyb6c5q2ybxk2gt776xlchhcohhyla5kqvinnaduevuxyx3tc": "us",  // USD
  "keeta_aozyboy42uks7ticj72awfhpdxwqqfcowezxcew6ecaz5afdt7q2ffycxim4u": "ca",  // CAD
  "keeta_anjsvaiiycybwhixlalcpwuvobvmpll4lh24td5qipccegmvfi7c2qdcqnlgu": "ae",  // AED
  "keeta_anutgo4o3yp5tvc6wjt4vzsehjbn7t2wylpxmam4d4ojtdkjj2yca2qoinfcs": "eu",  // EUR
  "keeta_aojfknc74dabtg72mdhijtszdlv7gi3ht2xp2wrfmdagkthi4n7rulb5e54ss": "gb",  // GBP
  "keeta_apbn7f34cdq62d7iw4ui6sbfaz7fcqdit354wfaotu5zw6d6xfef5vluhdaos": "hk",  // HKD
  "keeta_aowqb2hvkak7frntfbtde27bdmqvxancrja7ndh24m66ahkbrzeda3crqh3vg": "jp",  // JPY
  "keeta_amb3hbd5gbhaorl4y2ddl3xn2q4eyi6dqkn5fpug6diz26v2awsdqhkivmyza": "mx",  // MXN
  "keeta_ao44m7r4utf2vvytsfijermgkstnkka6rp44eahrekvp4cmj5g2orzm3blrvc": "cn",  // CNY
};

export const TokenLogo: React.FC<TokenLogoProps> = ({ address, symbol, network, className = "w-8 h-8" }) => {
  const [error, setError] = useState(false);

  // Check for known bridge tokens first (local logos)
  const bridgeLogo = BRIDGE_TOKEN_LOGOS[address];
  // Check for fiat-backed tokens (country flags)
  const fiatFlag = FIAT_TOKEN_FLAGS[address];

  // Construct the filename based on the user's convention
  // Pattern: keetaMain_ADDRESS_tiny.jpeg
  const prefix = network === "main" ? "keetaMain" : "keetaTest";
  const fileName = `${prefix}_${address}_small.jpeg`;

  // Construct the Firebase Public URL
  // We must encodeURIComponent the filename because it contains special chars like "_"
  const imageUrl = bridgeLogo
    || (fiatFlag ? `https://flagcdn.com/w80/${fiatFlag}.png` : null)
    || `https://firebasestorage.googleapis.com/v0/b/${BUCKET_NAME}/o/${encodeURIComponent(fileName)}?alt=media`;

  if (error) {
    logger.log("Failed to load:", imageUrl);
  }

  // Reset error state if address changes (e.g. pagination or filtering)
  useEffect(() => {
    setError(false);
  }, [address, network]);

  if (error) {
    // FALLBACK: The existing "Letter in Circle" design
    return (
      <div className={`${className} rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 border border-purple-200 flex items-center justify-center text-xs font-bold text-[#845fbc] mr-3`}>
        {symbol.substring(0, 1).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={imageUrl}
      alt={symbol}
      className={`${className} rounded-full border border-gray-200 object-cover mr-3`}
      onError={() => setError(true)} // If 404 or fail, switch to fallback
    />
  );
};
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getRemoteConfig, fetchAndActivate, getString } from "firebase/remote-config";

const firebaseConfig = {
    apiKey: "AIzaSyB1QMml0sDOrul9zfrw1NvgCaFtuLIUb6w",
    authDomain: "kta-liquidity-pool.firebaseapp.com",
    projectId: "kta-liquidity-pool",
    storageBucket: "kta-liquidity-pool.firebasestorage.app",
    messagingSenderId: "288439037545",
    appId: "1:288439037545:web:e86609c2b6ae37c7ab7cf8",
    measurementId: "G-WRPQFPXV3P"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);
const auth = getAuth(app);

// The "Turnstile" - Gives the user a valid ID so Rules pass
export const authReady = signInAnonymously(auth).catch((error) => console.error("Auth Error", error));

// Remote Config
const remoteConfig = getRemoteConfig(app);
remoteConfig.settings.minimumFetchIntervalMillis = 5 * 60 * 1000; // 5 min cache

function parseAccountList(raw: string): string[] {
  if (!raw) return [];
  if (raw.trimStart().startsWith("[")) return JSON.parse(raw);
  return raw.split(",").map(a => a.trim()).filter(Boolean);
}

let testerAccountsCache: string[] | undefined;
let adminAccountsCache: string[] | undefined;
let remoteConfigReady: Promise<boolean> | undefined;

function ensureRemoteConfig(): Promise<boolean> {
  if (!remoteConfigReady) {
    remoteConfigReady = fetchAndActivate(remoteConfig).catch(() => false);
  }
  return remoteConfigReady;
}

export async function getTesterAccounts(): Promise<string[]> {
  if (testerAccountsCache !== undefined) return testerAccountsCache;
  try {
    await ensureRemoteConfig();
    testerAccountsCache = parseAccountList(getString(remoteConfig, "TESTER_ACCOUNTS"));
    return testerAccountsCache;
  } catch (err) {
    console.error("Remote Config fetch error:", err);
    return [];
  }
}

export async function getAdminAccounts(): Promise<string[]> {
  if (adminAccountsCache !== undefined) return adminAccountsCache;
  try {
    await ensureRemoteConfig();
    adminAccountsCache = parseAccountList(getString(remoteConfig, "ADMIN_ACCOUNTS"));
    return adminAccountsCache;
  } catch (err) {
    console.error("Remote Config fetch error:", err);
    return [];
  }
}
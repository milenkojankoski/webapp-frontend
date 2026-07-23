/**
 * Gated logger — only outputs when the connected wallet is in ADMIN_ACCOUNTS.
 * Services and components use `logger.log()` instead of `console.log()`.
 */

let adminMode = false;

export function setAdminMode(enabled: boolean) {
  adminMode = enabled;
}

export const logger = {
  log: (...args: any[]) => { if (adminMode) console.log(...args); },
  warn: (...args: any[]) => { if (adminMode) console.warn(...args); },
  debug: (...args: any[]) => { if (adminMode) console.debug(...args); },
  // console.error always shows — real errors should never be hidden
  error: console.error.bind(console),
};

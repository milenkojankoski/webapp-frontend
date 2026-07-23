import { UserClient, lib } from '@keetanetwork/keetanet-client';

export interface KYCStatus {
  verified: boolean;
  issuer?: string;
  validUntil?: string;
  issuedAt?: string;
}

// In-memory cache to avoid repeated network calls
const cache = new Map<string, { data: KYCStatus; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getKYCStatus(
  address: string,
  network: 'main' | 'test'
): Promise<KYCStatus> {
  const cacheKey = `${network}_${address}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;

  try {
    const account = lib.Account.fromPublicKeyString(address);
    const client = await UserClient.fromNetwork(network, null, { account });
    const response = await client.getCertificates();

    if (!response || response.length === 0) {
      const result: KYCStatus = { verified: false };
      cache.set(cacheKey, { data: result, ts: Date.now() });
      return result;
    }

    // Sort by issuance date (newest first)
    const sorted = response.sort(
      (a: any, b: any) => b.certificate.notBefore.valueOf() - a.certificate.notBefore.valueOf()
    );

    const cert = sorted[0].certificate;
    const now = new Date();
    const notAfter = cert.notAfter ? new Date(cert.notAfter) : null;
    const isValid = notAfter ? notAfter > now : true;

    // issuerDN can be an array of { name, value } objects or a string
    let issuerStr: string | undefined;
    if (cert.issuerDN) {
      if (typeof cert.issuerDN === 'string') {
        issuerStr = cert.issuerDN;
      } else if (Array.isArray(cert.issuerDN)) {
        issuerStr = (cert.issuerDN as { name: string; value: string }[])
          .map(entry => entry.value || entry.name)
          .join(', ');
      }
    }

    const result: KYCStatus = {
      verified: isValid,
      issuer: issuerStr,
      validUntil: notAfter ? notAfter.toISOString() : undefined,
      issuedAt: cert.notBefore ? new Date(cert.notBefore).toISOString() : undefined,
    };

    cache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch (err) {
    console.error('KYC certificate fetch failed:', err);
    const result: KYCStatus = { verified: false };
    cache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  }
}

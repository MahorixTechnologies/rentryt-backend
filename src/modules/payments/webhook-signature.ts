import { createHmac, timingSafeEqual } from 'crypto';

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Paystack: HMAC-SHA512 of the raw body, hex digest, in `x-paystack-signature`. */
export function verifyPaystackSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secretKey: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha512', secretKey)
    .update(rawBody)
    .digest('hex');
  return safeCompare(expected, signatureHeader);
}

/**
 * Flutterwave: current docs describe `flutterwave-signature` (HMAC-SHA256 of
 * the raw body, base64) but many live integrations still send the older
 * `verif-hash` (a plain equality check against the dashboard-configured
 * secret hash) — checking both costs nothing and avoids silently dropping
 * real webhooks if the account is on the older behavior.
 */
export function verifyFlutterwaveSignature(
  rawBody: Buffer,
  headers: { 'flutterwave-signature'?: string; 'verif-hash'?: string },
  secretHash: string,
): boolean {
  const verifHash = headers['verif-hash'];
  if (verifHash && safeCompare(verifHash, secretHash)) return true;

  const hmacSignature = headers['flutterwave-signature'];
  if (hmacSignature) {
    const expected = createHmac('sha256', secretHash)
      .update(rawBody)
      .digest('base64');
    if (safeCompare(expected, hmacSignature)) return true;
  }

  return false;
}

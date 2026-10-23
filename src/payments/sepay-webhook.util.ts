import { createHmac, timingSafeEqual } from 'node:crypto';

export const SEPAY_SIGNATURE_MAX_SKEW_SECONDS = 5 * 60;

export type SePaySignatureFailure =
  | 'missing-secret'
  | 'missing-body-or-headers'
  | 'invalid-timestamp'
  | 'stale-timestamp'
  | 'invalid-signature';

export type SePaySignatureVerification =
  | { valid: true; timestamp: number }
  | { valid: false; reason: SePaySignatureFailure };

export function verifySePaySignature(input: {
  secret: string | undefined;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  rawBody: Buffer | undefined;
  nowMilliseconds?: number;
}): SePaySignatureVerification {
  const {
    secret,
    timestampHeader,
    signatureHeader,
    rawBody,
    nowMilliseconds = Date.now(),
  } = input;

  if (!secret?.trim()) return { valid: false, reason: 'missing-secret' };
  if (!timestampHeader || !signatureHeader || !Buffer.isBuffer(rawBody)) {
    return { valid: false, reason: 'missing-body-or-headers' };
  }
  if (!/^(?:0|[1-9]\d{0,11})$/.test(timestampHeader)) {
    return { valid: false, reason: 'invalid-timestamp' };
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp)) {
    return { valid: false, reason: 'invalid-timestamp' };
  }
  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  if (Math.abs(nowSeconds - timestamp) > SEPAY_SIGNATURE_MAX_SKEW_SECONDS) {
    return { valid: false, reason: 'stale-timestamp' };
  }
  if (!/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) {
    return { valid: false, reason: 'invalid-signature' };
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestampHeader}.`)
    .update(rawBody)
    .digest();
  const supplied = Buffer.from(signatureHeader.slice('sha256='.length), 'hex');
  if (!timingSafeEqual(expected, supplied)) {
    return { valid: false, reason: 'invalid-signature' };
  }

  return { valid: true, timestamp };
}

const PAYMENT_REFERENCE_REGEX = /^VINF[A-F0-9]{16}$/;
const PAYMENT_REFERENCE_IN_CONTENT_REGEX =
  /(?:^|[^A-Z0-9])(VINF[A-F0-9]{16})(?=$|[^A-Z0-9])/g;

export function extractSePayPaymentReference(
  code: string | null | undefined,
  content: string,
): string | null {
  const contentReferences = new Set<string>();
  for (const match of content.matchAll(PAYMENT_REFERENCE_IN_CONTENT_REGEX)) {
    if (match[1]) contentReferences.add(match[1]);
  }
  if (contentReferences.size > 1) return null;

  const contentReference = contentReferences.values().next().value as
    string | undefined;
  if (code !== null && code !== undefined) {
    if (!PAYMENT_REFERENCE_REGEX.test(code)) return null;
    if (contentReference && code !== contentReference) return null;
    return code;
  }

  return contentReference ?? null;
}

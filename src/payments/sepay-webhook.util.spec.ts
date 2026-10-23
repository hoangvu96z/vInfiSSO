import { createHmac } from 'node:crypto';
import {
  extractSePayPaymentReference,
  verifySePaySignature,
} from './sepay-webhook.util';

describe('SePay webhook signature verification', () => {
  const secret = 'unit-test-sepay-secret';
  const timestamp = '1792713600';
  const rawBody = Buffer.from('{"id":42,"transferType":"in"}');

  function signatureFor(body: Buffer, signedTimestamp = timestamp) {
    return `sha256=${createHmac('sha256', secret)
      .update(`${signedTimestamp}.`)
      .update(body)
      .digest('hex')}`;
  }

  it('accepts a valid HMAC over the exact timestamp and raw body', () => {
    expect(
      verifySePaySignature({
        secret,
        timestampHeader: timestamp,
        signatureHeader: signatureFor(rawBody),
        rawBody,
        nowMilliseconds: Number(timestamp) * 1000,
      }),
    ).toEqual({ valid: true, timestamp: Number(timestamp) });
  });

  it('rejects a changed body and malformed signatures', () => {
    const signature = signatureFor(rawBody);
    expect(
      verifySePaySignature({
        secret,
        timestampHeader: timestamp,
        signatureHeader: signature,
        rawBody: Buffer.from(`${rawBody.toString()} `),
        nowMilliseconds: Number(timestamp) * 1000,
      }),
    ).toEqual({ valid: false, reason: 'invalid-signature' });
    expect(
      verifySePaySignature({
        secret,
        timestampHeader: timestamp,
        signatureHeader: 'sha256=bad',
        rawBody,
        nowMilliseconds: Number(timestamp) * 1000,
      }),
    ).toEqual({ valid: false, reason: 'invalid-signature' });
  });

  it('rejects timestamps older or newer than five minutes', () => {
    const now = Number(timestamp) * 1000;
    for (const offset of [-301, 301]) {
      const staleTimestamp = String(Number(timestamp) + offset);
      expect(
        verifySePaySignature({
          secret,
          timestampHeader: staleTimestamp,
          signatureHeader: signatureFor(rawBody, staleTimestamp),
          rawBody,
          nowMilliseconds: now,
        }),
      ).toEqual({ valid: false, reason: 'stale-timestamp' });
    }
  });

  it('fails closed when the webhook secret is absent', () => {
    expect(
      verifySePaySignature({
        secret: undefined,
        timestampHeader: timestamp,
        signatureHeader: signatureFor(rawBody),
        rawBody,
      }),
    ).toEqual({ valid: false, reason: 'missing-secret' });
  });
});

describe('SePay payment reference extraction', () => {
  const reference = 'VINF0123456789ABCDEF';

  it('accepts an exact code or a delimited exact reference in transfer content', () => {
    expect(extractSePayPaymentReference(reference, 'Payment')).toBe(reference);
    expect(
      extractSePayPaymentReference(null, `Chuyen tien ${reference} cam on`),
    ).toBe(reference);
  });

  it('rejects partial, malformed, or conflicting references', () => {
    expect(extractSePayPaymentReference('VINF0123', `VINF0123`)).toBeNull();
    expect(
      extractSePayPaymentReference(
        reference,
        'VINF1111111111111111 and VINF2222222222222222',
      ),
    ).toBeNull();
    expect(
      extractSePayPaymentReference(reference, 'VINF1111111111111111'),
    ).toBeNull();
  });
});

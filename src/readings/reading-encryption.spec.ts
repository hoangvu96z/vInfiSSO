import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import {
  buildJournalPayloadAAD,
  buildReadingPayloadAAD,
  decryptLegacyClientTree,
  decryptLegacyClientValue,
  getReadingEnvelopeVersion,
  LEGACY_CLIENT_SALT,
  ReadingEncryption,
  validateReadingEncryptionEnvironment,
} from './reading-encryption';

function makeLegacyValue(value: unknown, userId: string): string {
  const key = createHash('sha256')
    .update(`${userId}:${LEGACY_CLIENT_SALT}`, 'utf8')
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(
      typeof value === 'string' ? value : JSON.stringify(value),
      'utf8',
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `enc_v1::${iv.toString('base64')}:${ciphertext.toString('base64')}`;
}

function makeV2Envelope(
  value: unknown,
  userId: string,
  keyId: string,
  encodedKey: string,
): { _enc: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(encodedKey, 'base64'),
    iv,
  );
  cipher.setAAD(Buffer.from(`reading:${userId}`, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return {
    _enc: [
      'v2',
      keyId,
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join(':'),
  };
}

describe('reading server-side encryption', () => {
  const key1 = randomBytes(32).toString('base64');
  const key2 = randomBytes(32).toString('base64');
  const userId = 'user-a';
  const payload = {
    question: 'Private question',
    title: 'Private title',
    data: { result: { value: 42 }, aiConversation: [{ text: 'Private' }] },
  };

  it('round-trips a v3 envelope bound to user, reading ID, and payload field', () => {
    const encryption = new ReadingEncryption(`k1:${key1}`, 'k1', true);
    const readingId = 'reading-a';
    const encrypted = encryption.encryptPayload(payload, userId, readingId);

    expect(encrypted._enc.startsWith('v3:k1:')).toBe(true);
    expect(JSON.stringify(encrypted)).not.toContain(payload.question);
    expect(getReadingEnvelopeVersion(encrypted)).toBe('v3');
    expect(buildReadingPayloadAAD(userId, readingId)).toEqual(
      Buffer.from(
        JSON.stringify(['reading', userId, readingId, 'payload']),
        'utf8',
      ),
    );
    expect(encryption.decryptEnvelope(encrypted, userId, readingId)).toEqual(
      payload,
    );
    expect(() =>
      encryption.decryptEnvelope(encrypted, 'user-b', readingId),
    ).toThrow();
    expect(() =>
      encryption.decryptEnvelope(encrypted, userId, 'reading-b'),
    ).toThrow();
  });

  it('encrypts journal reflections with a separate resource namespace', () => {
    const encryption = new ReadingEncryption(`k1:${key1}`, 'k1', true);
    const journalEntryId = 'journal-entry-a';
    const payload = { reflection: 'A private reflection', tags: ['health'] };
    const encrypted = encryption.encryptJournalPayload(
      payload,
      userId,
      journalEntryId,
    );

    expect(encrypted._enc.startsWith('v3:k1:')).toBe(true);
    expect(JSON.stringify(encrypted)).not.toContain(payload.reflection);
    expect(JSON.stringify(encrypted)).not.toContain('health');
    expect(buildJournalPayloadAAD(userId, journalEntryId)).toEqual(
      Buffer.from(
        JSON.stringify(['journal', userId, journalEntryId, 'payload']),
        'utf8',
      ),
    );
    expect(
      encryption.decryptJournalPayload(encrypted, userId, journalEntryId),
    ).toEqual(payload);
    expect(() =>
      encryption.decryptJournalPayload(encrypted, 'user-b', journalEntryId),
    ).toThrow();
    expect(() =>
      encryption.decryptJournalPayload(encrypted, userId, 'journal-entry-b'),
    ).toThrow();
  });

  it('continues to decrypt existing v2 envelopes with their original AAD', () => {
    const encryption = new ReadingEncryption(`k1:${key1}`, 'k1', true);
    const legacyEnvelope = makeV2Envelope(payload, userId, 'k1', key1);

    expect(getReadingEnvelopeVersion(legacyEnvelope)).toBe('v2');
    expect(
      encryption.decryptEnvelope(legacyEnvelope, userId, 'historical-row'),
    ).toEqual(payload);
  });

  it('decrypts old key IDs while encrypting with the active rotation key', () => {
    const oldKeyReader = new ReadingEncryption(`k1:${key1}`, 'k1', true);
    const readingId = 'reading-key-rotation';
    const oldEnvelope = oldKeyReader.encryptPayload(payload, userId, readingId);
    const rotating = new ReadingEncryption(`k1:${key1},k2:${key2}`, 'k2', true);
    const newEnvelope = rotating.encryptPayload(payload, userId, readingId);

    expect(newEnvelope._enc).toMatch(/^v3:k2:/);
    expect(rotating.decryptEnvelope(oldEnvelope, userId, readingId)).toEqual(
      payload,
    );
    expect(rotating.decryptEnvelope(newEnvelope, userId, readingId)).toEqual(
      payload,
    );
  });

  it('rejects missing, malformed, duplicate, or inactive production keys', () => {
    expect(() =>
      validateReadingEncryptionEnvironment({ NODE_ENV: 'production' }),
    ).toThrow(/DATA_ENCRYPTION_KEYS/);
    expect(() =>
      validateReadingEncryptionEnvironment({
        NODE_ENV: 'production',
        DATA_ENCRYPTION_KEYS: `k1:${key1}`,
      }),
    ).toThrow(/DATA_ENCRYPTION_ACTIVE_KEY_ID/);
    expect(() =>
      validateReadingEncryptionEnvironment({
        NODE_ENV: 'production',
        DATA_ENCRYPTION_KEYS: 'k1:not-a-key',
        DATA_ENCRYPTION_ACTIVE_KEY_ID: 'k1',
      }),
    ).toThrow(/DATA_ENCRYPTION_KEYS/);
    expect(() =>
      validateReadingEncryptionEnvironment({
        NODE_ENV: 'production',
        DATA_ENCRYPTION_KEYS: `k1:${key1},k1:${key2}`,
        DATA_ENCRYPTION_ACTIVE_KEY_ID: 'k1',
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      validateReadingEncryptionEnvironment({
        NODE_ENV: 'production',
        DATA_ENCRYPTION_KEYS: `k1:${key1}`,
        DATA_ENCRYPTION_ACTIVE_KEY_ID: 'k2',
      }),
    ).toThrow(/Active reading encryption key ID/);
    expect(() =>
      validateReadingEncryptionEnvironment({ NODE_ENV: 'development' }),
    ).toThrow(/DATA_ENCRYPTION_KEYS is required in every environment/);
    expect(() =>
      validateReadingEncryptionEnvironment({
        NODE_ENV: 'development',
        DATA_ENCRYPTION_KEYS: `k1:${key1}`,
        DATA_ENCRYPTION_ACTIVE_KEY_ID: 'k1',
      }),
    ).not.toThrow();
    expect(() => new ReadingEncryption()).toThrow(/DATA_ENCRYPTION_KEYS/);
  });

  it('decrypts legacy client fields recursively without changing plain fields', () => {
    const secretQuestion = makeLegacyValue('Old question', userId);
    const secretResult = makeLegacyValue({ card: 'The Moon' }, userId);
    expect(decryptLegacyClientValue(secretQuestion, userId)).toBe(
      'Old question',
    );
    expect(
      decryptLegacyClientTree(
        {
          question: secretQuestion,
          aiConversation: [{ answer: secretResult }],
          plain: 'already plaintext',
        },
        userId,
      ),
    ).toEqual({
      question: 'Old question',
      aiConversation: [{ answer: { card: 'The Moon' } }],
      plain: 'already plaintext',
    });
    expect(() =>
      decryptLegacyClientValue(secretQuestion, 'wrong-user'),
    ).toThrow();
  });
});

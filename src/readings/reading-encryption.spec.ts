import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import {
  decryptLegacyClientTree,
  decryptLegacyClientValue,
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

describe('reading server-side encryption', () => {
  const key1 = randomBytes(32).toString('base64');
  const key2 = randomBytes(32).toString('base64');
  const userId = 'user-a';
  const payload = {
    question: 'Private question',
    title: 'Private title',
    data: { result: { value: 42 }, aiConversation: [{ text: 'Private' }] },
  };

  it('round-trips a v2 envelope bound to the reading owner', () => {
    const encryption = new ReadingEncryption(`k1:${key1}`, 'k1', true);
    const encrypted = encryption.encryptPayload(payload, userId);

    expect(encrypted._enc.startsWith('v2:k1:')).toBe(true);
    expect(JSON.stringify(encrypted)).not.toContain(payload.question);
    expect(encryption.decryptEnvelope(encrypted, userId)).toEqual(payload);
    expect(() => encryption.decryptEnvelope(encrypted, 'user-b')).toThrow();
  });

  it('decrypts old key IDs while encrypting with the active rotation key', () => {
    const oldKeyReader = new ReadingEncryption(`k1:${key1}`, 'k1', true);
    const oldEnvelope = oldKeyReader.encryptPayload(payload, userId);
    const rotating = new ReadingEncryption(`k1:${key1},k2:${key2}`, 'k2', true);
    const newEnvelope = rotating.encryptPayload(payload, userId);

    expect(newEnvelope._enc).toMatch(/^v2:k2:/);
    expect(rotating.decryptEnvelope(oldEnvelope, userId)).toEqual(payload);
    expect(rotating.decryptEnvelope(newEnvelope, userId)).toEqual(payload);
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

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ENVELOPE_VERSION = 'v2';
const AES_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const LEGACY_PREFIX = 'enc_v1::';

// This value is public in the historical frontend and is used only to migrate
// its legacy ciphertext. It is not used for new encryption.
export const LEGACY_CLIENT_SALT = 'vinfi_client_e2ee_salt_2026_x89f2a';

export interface ReadingPayload {
  question: string | null;
  title: string;
  data: Record<string, unknown>;
}

export interface ParsedReadingKeys {
  keys: Map<string, Buffer>;
  activeKeyId: string | null;
}

function isBase64(value: string): boolean {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
    value,
  );
}

export function parseReadingEncryptionKeys(
  keysValue: string | undefined,
  activeKeyIdValue: string | undefined,
  required = true,
): ParsedReadingKeys {
  const keys = new Map<string, Buffer>();
  const entries = (keysValue || '').split(',').map((entry) => entry.trim());
  for (const entry of entries) {
    if (!entry) continue;
    const separator = entry.indexOf(':');
    if (separator < 1) {
      throw new Error('Invalid DATA_ENCRYPTION_KEYS configuration');
    }
    const id = entry.slice(0, separator);
    const encodedKey = entry.slice(separator + 1);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || !isBase64(encodedKey)) {
      throw new Error('Invalid DATA_ENCRYPTION_KEYS configuration');
    }
    const key = Buffer.from(encodedKey, 'base64');
    if (key.length !== AES_KEY_BYTES || key.toString('base64') !== encodedKey) {
      throw new Error('Invalid DATA_ENCRYPTION_KEYS configuration');
    }
    if (keys.has(id)) {
      throw new Error('Duplicate DATA_ENCRYPTION_KEYS key ID');
    }
    keys.set(id, key);
  }

  const activeKeyId = activeKeyIdValue?.trim() || null;
  if (required && keys.size === 0) {
    throw new Error('DATA_ENCRYPTION_KEYS is required in every environment');
  }
  if (required && !activeKeyId) {
    throw new Error(
      'DATA_ENCRYPTION_ACTIVE_KEY_ID is required in every environment',
    );
  }
  if (activeKeyId && !keys.has(activeKeyId)) {
    throw new Error('Active reading encryption key ID is not configured');
  }
  if (keys.size > 0 && !activeKeyId) {
    throw new Error(
      'DATA_ENCRYPTION_ACTIVE_KEY_ID is required when keys are configured',
    );
  }

  return { keys, activeKeyId };
}

export function validateReadingEncryptionEnvironment<
  T extends Record<string, unknown>,
>(environment: T): T {
  parseReadingEncryptionKeys(
    typeof environment.DATA_ENCRYPTION_KEYS === 'string'
      ? environment.DATA_ENCRYPTION_KEYS
      : undefined,
    typeof environment.DATA_ENCRYPTION_ACTIVE_KEY_ID === 'string'
      ? environment.DATA_ENCRYPTION_ACTIVE_KEY_ID
      : undefined,
    true,
  );
  return environment;
}

export class ReadingEncryption {
  private readonly keys: Map<string, Buffer>;
  private readonly activeKeyId: string | null;

  constructor(keysValue?: string, activeKeyIdValue?: string, required = true) {
    const parsed = parseReadingEncryptionKeys(
      keysValue,
      activeKeyIdValue,
      required,
    );
    this.keys = parsed.keys;
    this.activeKeyId = parsed.activeKeyId;
  }

  encryptPayload(payload: ReadingPayload, userId: string): { _enc: string } {
    if (!this.activeKeyId) {
      throw new Error('Reading encryption is not configured');
    }
    const key = this.keys.get(this.activeKeyId);
    if (!key) throw new Error('Active reading encryption key is unavailable');

    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`reading:${userId}`, 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      _enc: [
        ENVELOPE_VERSION,
        this.activeKeyId,
        iv.toString('base64url'),
        tag.toString('base64url'),
        ciphertext.toString('base64url'),
      ].join(':'),
    };
  }

  decryptEnvelope(data: unknown, userId: string): ReadingPayload {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Invalid encrypted reading');
    }
    const envelope = (data as Record<string, unknown>)._enc;
    if (typeof envelope !== 'string') {
      throw new Error('Invalid encrypted reading');
    }
    const [version, keyId, ivText, tagText, ciphertextText, ...rest] =
      envelope.split(':');
    if (
      version !== ENVELOPE_VERSION ||
      !keyId ||
      !ivText ||
      !tagText ||
      !ciphertextText ||
      rest.length > 0
    ) {
      throw new Error('Unsupported encrypted reading');
    }
    const key = this.keys.get(keyId);
    if (!key) throw new Error('Reading encryption key is unavailable');

    const iv = Buffer.from(ivText, 'base64url');
    const tag = Buffer.from(tagText, 'base64url');
    const ciphertext = Buffer.from(ciphertextText, 'base64url');
    if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) {
      throw new Error('Invalid encrypted reading');
    }

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(`reading:${userId}`, 'utf8'));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    const payload: unknown = JSON.parse(plaintext);
    if (!isReadingPayload(payload)) {
      throw new Error('Invalid encrypted reading payload');
    }
    return payload;
  }
}

function isReadingPayload(value: unknown): value is ReadingPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    (payload.question === null || typeof payload.question === 'string') &&
    typeof payload.title === 'string' &&
    !!payload.data &&
    typeof payload.data === 'object' &&
    !Array.isArray(payload.data)
  );
}

export function decryptLegacyClientValue(
  value: string,
  userId: string,
): unknown {
  if (!value.startsWith(LEGACY_PREFIX)) return value;
  if (!userId) throw new Error('A user ID is required for legacy decryption');

  const parts = value.slice(LEGACY_PREFIX.length).split(':');
  if (parts.length !== 2 || !parts.every(isBase64)) {
    throw new Error('Invalid legacy reading ciphertext');
  }
  const [ivText, combinedText] = parts;
  const iv = Buffer.from(ivText, 'base64');
  const combined = Buffer.from(combinedText, 'base64');
  if (iv.length !== GCM_IV_BYTES || combined.length < GCM_TAG_BYTES) {
    throw new Error('Invalid legacy reading ciphertext');
  }

  const key = createLegacyClientKey(userId);
  const ciphertext = combined.subarray(0, -GCM_TAG_BYTES);
  const tag = combined.subarray(-GCM_TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
  try {
    return JSON.parse(plaintext) as unknown;
  } catch {
    return plaintext;
  }
}

function createLegacyClientKey(userId: string): Buffer {
  return createHash('sha256')
    .update(`${userId}:${LEGACY_CLIENT_SALT}`, 'utf8')
    .digest();
}

export function decryptLegacyClientTree(
  value: unknown,
  userId: string,
): unknown {
  if (typeof value === 'string') {
    return decryptLegacyClientValue(value, userId);
  }
  if (Array.isArray(value)) {
    return value.map((item) => decryptLegacyClientTree(item, userId));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      decryptLegacyClientTree(item, userId),
    ]),
  );
}

@Injectable()
export class ReadingEncryptionService extends ReadingEncryption {
  constructor(config: ConfigService) {
    super(
      config.get<string>('DATA_ENCRYPTION_KEYS'),
      config.get<string>('DATA_ENCRYPTION_ACTIVE_KEY_ID'),
      true,
    );
  }
}

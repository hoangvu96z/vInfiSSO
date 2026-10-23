import { constants } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { createDecipheriv } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
  decryptLegacyClientTree,
  ReadingEncryption,
  ReadingPayload,
} from './reading-encryption';

const LEGACY_PREFIX = 'enc_v1::';
const LEGACY_KEY_BYTES = 32;
const LEGACY_IV_BYTES = 12;
const LEGACY_TAG_BYTES = 16;
const MAX_PRIVATE_KEY_FILE_BYTES = 256;

export interface RecoverableReading {
  id: string;
  userId: string;
  app: string;
  type: string;
  question: unknown;
  title: unknown;
  data: unknown;
  createdAt: Date | string;
}

export interface RecoveryArtifactRecord {
  id: string;
  userId: string;
  app: string;
  type: string;
  createdAt: string;
  title: string;
  data: { _enc: string };
}

export interface RecoveryArtifact {
  format: 'vinfi-legacy-reading-recovery-v1';
  sourceDatabase: string;
  createdAt: string;
  records: RecoveryArtifactRecord[];
}

export type LegacyReadingDecryptor = (value: unknown) => unknown;

export async function readProtectedLegacyKeyFile(
  filePath: string,
): Promise<Buffer> {
  if (!isAbsolute(filePath)) {
    throw new Error('Legacy key file path must be absolute');
  }

  let file;
  try {
    file = await open(
      filePath,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    const fileStat = await file.stat();
    if (
      !fileStat.isFile() ||
      fileStat.size > MAX_PRIVATE_KEY_FILE_BYTES ||
      (fileStat.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' &&
        fileStat.uid !== process.getuid())
    ) {
      throw new Error('Invalid protected key file');
    }

    const contents = (await file.readFile({ encoding: 'utf8' })).trim();
    if (!/^[a-fA-F0-9]{64}$/.test(contents)) {
      throw new Error('Invalid key format');
    }
    return Buffer.from(contents, 'hex');
  } catch {
    throw new Error(
      'Unable to read a private legacy key file containing a 32-byte hex key',
    );
  } finally {
    await file?.close();
  }
}

export function assertLocalRecoveryDatabaseUrl(databaseUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('Invalid recovery database URL');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    host !== 'localhost' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !/(?:_recovery|_restore)$/.test(databaseName)
  ) {
    throw new Error(
      'Recovery requires a localhost PostgreSQL database ending in _recovery or _restore',
    );
  }
  return databaseName;
}

export function assertRecoveryServerIdentity(
  databaseName: string,
  serverAddress: string | null,
  unixSocket = false,
): void {
  if (
    !/(?:_recovery|_restore)$/.test(databaseName) ||
    (serverAddress === null && !unixSocket) ||
    (serverAddress !== null &&
      !(serverAddress === '::1' || /^127(?:\.\d{1,3}){3}$/.test(serverAddress)))
  ) {
    throw new Error('Connected database is not a local recovery database');
  }
}

export async function assertPrivateRecoverySocketDirectory(
  socketDirectory: string,
): Promise<void> {
  if (!isAbsolute(socketDirectory)) {
    throw new Error('Recovery socket directory must be absolute');
  }

  let socket;
  try {
    socket = await open(
      socketDirectory,
      constants.O_RDONLY | constants.O_DIRECTORY | (constants.O_NOFOLLOW || 0),
    );
    const socketStat = await socket.stat();
    if (
      !socketStat.isDirectory() ||
      (socketStat.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' &&
        socketStat.uid !== process.getuid())
    ) {
      throw new Error('Invalid recovery socket directory');
    }
  } catch {
    throw new Error('Unable to validate a private local recovery socket');
  } finally {
    await socket?.close();
  }
}

export function containsLegacyClientCiphertext(value: unknown): boolean {
  if (typeof value === 'string') return value.startsWith(LEGACY_PREFIX);
  if (Array.isArray(value)) return value.some(containsLegacyClientCiphertext);
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(containsLegacyClientCiphertext);
}

export function decryptLegacyClientValueWithKey(
  value: string,
  key: Buffer,
): unknown {
  if (!value.startsWith(LEGACY_PREFIX)) return value;
  if (key.length !== LEGACY_KEY_BYTES) {
    throw new Error('Invalid candidate legacy key');
  }

  try {
    const parts = value.slice(LEGACY_PREFIX.length).split(':');
    if (parts.length !== 2) throw new Error('Invalid legacy ciphertext');
    const [ivText, combinedText] = parts;
    const iv = decodeBase64(ivText);
    const combined = decodeBase64(combinedText);
    if (iv.length !== LEGACY_IV_BYTES || combined.length <= LEGACY_TAG_BYTES) {
      throw new Error('Invalid legacy ciphertext');
    }

    const ciphertext = combined.subarray(0, -LEGACY_TAG_BYTES);
    const tag = combined.subarray(-LEGACY_TAG_BYTES);
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
  } catch {
    throw new Error(
      'Unable to authenticate legacy ciphertext with the candidate key',
    );
  }
}

export function decryptLegacyClientTreeWithKey(
  value: unknown,
  key: Buffer,
): unknown {
  if (typeof value === 'string') {
    return decryptLegacyClientValueWithKey(value, key);
  }
  if (Array.isArray(value)) {
    return value.map((item) => decryptLegacyClientTreeWithKey(item, key));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([itemKey, item]) => [
      itemKey,
      decryptLegacyClientTreeWithKey(item, key),
    ]),
  );
}

export function createEncryptedRecoveryArtifactRecord(
  reading: RecoverableReading,
  decryptLegacy: LegacyReadingDecryptor,
  encryption: ReadingEncryption,
): RecoveryArtifactRecord {
  const questionValue = decryptLegacy(reading.question ?? null);
  const titleValue = decryptLegacy(reading.title);
  const data = decryptLegacy(reading.data);
  const question = toLegacyText(questionValue, true);
  const title = toLegacyText(titleValue, false);
  if (
    (question !== null && typeof question !== 'string') ||
    title === null ||
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    throw new Error('Unsupported legacy reading payload');
  }

  const payload: ReadingPayload = {
    question,
    title,
    data: data as Record<string, unknown>,
  };
  const storageTitle = getStorageTitle(reading.app, reading.type);
  return {
    id: reading.id,
    userId: reading.userId,
    app: reading.app,
    type: reading.type,
    createdAt: new Date(reading.createdAt).toISOString(),
    title: storageTitle,
    data: encryption.encryptPayload(payload, reading.userId, reading.id),
  };
}

export function decryptLegacyReadingForOwner(
  value: unknown,
  userId: string,
): unknown {
  return decryptLegacyClientTree(value, userId);
}

export function decryptLegacyReadingForDefaultUser(value: unknown): unknown {
  return decryptLegacyClientTree(value, 'default_user');
}

export function createRecoveryArtifact(
  sourceDatabase: string,
  records: RecoveryArtifactRecord[],
): RecoveryArtifact {
  if (!/(?:_recovery|_restore)$/.test(sourceDatabase)) {
    throw new Error('Recovery artifact must come from an isolated database');
  }
  return {
    format: 'vinfi-legacy-reading-recovery-v1',
    sourceDatabase,
    createdAt: new Date().toISOString(),
    records,
  };
}

export async function writeRecoveryArtifactFile(
  filePath: string,
  artifact: RecoveryArtifact,
): Promise<void> {
  if (!isAbsolute(filePath)) {
    throw new Error('Recovery artifact path must be absolute');
  }

  let file;
  let created = false;
  try {
    file = await open(
      filePath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW || 0),
      0o600,
    );
    created = true;
    await file.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, {
      encoding: 'utf8',
    });
    await file.sync();
  } catch {
    if (created) await unlink(filePath).catch(() => undefined);
    throw new Error('Unable to create a new protected recovery artifact');
  } finally {
    await file?.close();
  }
}

function decodeBase64(value: string): Buffer {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error('Invalid legacy ciphertext');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw new Error('Invalid legacy ciphertext');
  }
  return decoded;
}

function toLegacyText(value: unknown, allowNull: boolean): string | null {
  if (value === null && allowNull) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function getStorageTitle(app: string, type: string): string {
  const safeApp = app.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 20) || 'app';
  const safeType =
    type.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 50) || 'reading';
  return `${safeApp}:${safeType}`;
}

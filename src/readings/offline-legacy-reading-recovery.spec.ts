import { createCipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ReadingEncryption } from './reading-encryption';
import {
  assertLocalRecoveryDatabaseUrl,
  assertPrivateRecoverySocketDirectory,
  assertRecoveryServerIdentity,
  containsLegacyClientCiphertext,
  createEncryptedRecoveryArtifactRecord,
  createRecoveryArtifact,
  decryptLegacyClientTreeWithKey,
  readProtectedLegacyKeyFile,
  writeRecoveryArtifactFile,
} from './offline-legacy-reading-recovery';

const LEGACY_PREFIX = 'enc_v1::';

function encryptLegacyValue(value: unknown, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${LEGACY_PREFIX}${iv.toString('base64')}:${ciphertext.toString('base64')}`;
}

describe('offline legacy reading recovery', () => {
  it('reads only a private 32-byte hex key file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'legacy-recovery-'));
    const keyPath = join(directory, 'legacy-key.txt');
    const key = randomBytes(32);
    try {
      await writeFile(keyPath, `${key.toString('hex')}\n`, { mode: 0o600 });
      await chmod(keyPath, 0o600);
      await expect(readProtectedLegacyKeyFile(keyPath)).resolves.toEqual(key);

      await chmod(keyPath, 0o644);
      await expect(readProtectedLegacyKeyFile(keyPath)).rejects.toThrow(
        'Unable to read a private legacy key file',
      );
    } finally {
      key.fill(0);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('decrypts nested values with the supplied legacy key and rejects wrong keys', () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const encryptedQuestion = encryptLegacyValue(
      'synthetic question',
      key,
    );
    const encryptedAiData = encryptLegacyValue(
      { answer: 'synthetic answer' },
      key,
    );
    try {
      expect(
        decryptLegacyClientTreeWithKey(
          { question: encryptedQuestion, ai: encryptedAiData },
          key,
        ),
      ).toEqual({
        question: 'synthetic question',
        ai: { answer: 'synthetic answer' },
      });
      expect(() =>
        decryptLegacyClientTreeWithKey(encryptedQuestion, wrongKey),
      ).toThrow('Unable to authenticate legacy ciphertext');
    } finally {
      key.fill(0);
      wrongKey.fill(0);
    }
  });

  it('rewraps a synthetic legacy row into a V3 encrypted sidecar record', () => {
    const key = randomBytes(32);
    const serverKey = randomBytes(32);
    const readingId = 'reading-1';
    const userId = 'user-1';
    const privateQuestion = 'synthetic private question';
    const privateTitle = 'synthetic private title';
    const privateAnswer = 'synthetic private answer';
    const encryption = new ReadingEncryption(
      `test:${serverKey.toString('base64')}`,
      'test',
    );
    try {
      const record = createEncryptedRecoveryArtifactRecord(
        {
          id: readingId,
          userId,
          app: 'iching',
          type: 'mai-hoa',
          question: encryptLegacyValue(privateQuestion, key),
          title: encryptLegacyValue(privateTitle, key),
          data: {
            aiConversation: encryptLegacyValue(
              { answer: privateAnswer },
              key,
            ),
          },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        key,
        encryption,
      );

      expect(record.title).toBe('iching:mai-hoa');
      expect(record.data._enc.startsWith('v3:test:')).toBe(true);
      expect(JSON.stringify(record)).not.toContain(privateQuestion);
      expect(JSON.stringify(record)).not.toContain(privateTitle);
      expect(JSON.stringify(record)).not.toContain(privateAnswer);
      expect(
        encryption.decryptEnvelope(record.data, userId, readingId),
      ).toEqual({
        question: privateQuestion,
        title: privateTitle,
        data: { aiConversation: { answer: privateAnswer } },
      });
    } finally {
      key.fill(0);
      serverKey.fill(0);
    }
  });

  it('accepts only localhost restore databases and validates the connected server', () => {
    expect(
      assertLocalRecoveryDatabaseUrl(
        'postgresql://recovery:unused@localhost:5432/vinfi_sso_recovery',
      ),
    ).toBe('vinfi_sso_recovery');
    expect(() =>
      assertLocalRecoveryDatabaseUrl(
        'postgresql://recovery:unused@example.com:5432/vinfi_sso_recovery',
      ),
    ).toThrow('localhost PostgreSQL');
    expect(() =>
      assertLocalRecoveryDatabaseUrl(
        'postgresql://recovery:unused@localhost:5432/vinfi_sso',
      ),
    ).toThrow('localhost PostgreSQL');
    expect(() =>
      assertRecoveryServerIdentity('vinfi_sso_recovery', '127.0.0.1'),
    ).not.toThrow();
    expect(() =>
      assertRecoveryServerIdentity('vinfi_sso_recovery', null, true),
    ).not.toThrow();
    expect(() =>
      assertRecoveryServerIdentity('vinfi_sso_recovery', '43.128.116.69'),
    ).toThrow('not a local recovery database');
  });

  it('accepts only a private local PostgreSQL socket directory', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'legacy-recovery-socket-'));
    try {
      await chmod(directory, 0o700);
      await expect(assertPrivateRecoverySocketDirectory(directory)).resolves.toBe(
        undefined,
      );
      await chmod(directory, 0o755);
      await expect(
        assertPrivateRecoverySocketDirectory(directory),
      ).rejects.toThrow('private local recovery socket');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('creates a new mode-0600 artifact without plaintext and refuses overwrite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'legacy-recovery-'));
    const artifactPath = join(directory, 'recovered.json');
    const artifact = createRecoveryArtifact('vinfi_sso_recovery', [
      {
        id: 'reading-1',
        userId: 'user-1',
        app: 'iching',
        type: 'mai-hoa',
        createdAt: '2026-01-01T00:00:00.000Z',
        title: 'iching:mai-hoa',
        data: { _enc: 'v3:test:synthetic-ciphertext' },
      },
    ]);
    try {
      await writeRecoveryArtifactFile(artifactPath, artifact);
      const fileStat = await stat(artifactPath);
      expect(fileStat.mode & 0o077).toBe(0);
      await expect(writeRecoveryArtifactFile(artifactPath, artifact)).rejects.toThrow(
        'new protected recovery artifact',
      );
      const fileContents = await readFile(artifactPath, 'utf8');
      expect(fileContents).toContain('vinfi-legacy-reading-recovery-v1');
      expect(fileContents).not.toContain('synthetic private');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('detects only explicit legacy ciphertext prefixes', () => {
    expect(containsLegacyClientCiphertext({ nested: [`${LEGACY_PREFIX}x:y`] })).toBe(
      true,
    );
    expect(containsLegacyClientCiphertext({ nested: ['plain text'] })).toBe(
      false,
    );
  });
});

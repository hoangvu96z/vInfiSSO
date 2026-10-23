import type { ConfigService } from '@nestjs/config';
import { createObjectStorage } from './object-storage.factory';
import { LocalObjectStorage } from './local-object-storage';
import { S3ObjectStorage } from './s3-object-storage';

function config(values: Record<string, string>): ConfigService {
  return {
    get: (key: string, fallback?: string) => values[key] ?? fallback,
  } as unknown as ConfigService;
}

describe('createObjectStorage', () => {
  it('uses local storage by default', () => {
    expect(createObjectStorage(config({}))).toBeInstanceOf(LocalObjectStorage);
  });

  it('requires all server credentials when S3 is explicitly selected', () => {
    expect(() =>
      createObjectStorage(config({ OBJECT_STORAGE_PROVIDER: 's3' })),
    ).toThrow(/requires bucket, access key, secret key, and region/);
  });

  it('creates the S3 adapter only when it is explicitly selected and configured', () => {
    const storage = createObjectStorage(
      config({
        OBJECT_STORAGE_PROVIDER: 's3',
        OBJECT_STORAGE_S3_ENDPOINT: 'http://127.0.0.1:9000',
        OBJECT_STORAGE_S3_REGION: 'us-east-1',
        OBJECT_STORAGE_S3_BUCKET: 'vinfi-private',
        OBJECT_STORAGE_S3_ACCESS_KEY_ID: 'server-access-key',
        OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: 'server-secret-key',
        OBJECT_STORAGE_S3_FORCE_PATH_STYLE: 'true',
      }),
    );
    expect(storage).toBeInstanceOf(S3ObjectStorage);
  });

  it('rejects invalid providers, endpoints, and booleans', () => {
    expect(() =>
      createObjectStorage(config({ OBJECT_STORAGE_PROVIDER: 'public-url' })),
    ).toThrow(/must be "local" or "s3"/);

    const common = {
      OBJECT_STORAGE_PROVIDER: 's3',
      OBJECT_STORAGE_S3_REGION: 'us-east-1',
      OBJECT_STORAGE_S3_BUCKET: 'vinfi-private',
      OBJECT_STORAGE_S3_ACCESS_KEY_ID: 'server-access-key',
      OBJECT_STORAGE_S3_SECRET_ACCESS_KEY: 'server-secret-key',
    };
    expect(() =>
      createObjectStorage(
        config({
          ...common,
          OBJECT_STORAGE_S3_ENDPOINT: 'https://user:pass@minio.local',
        }),
      ),
    ).toThrow(/must be a valid HTTP\(S\) URL/);
    expect(() =>
      createObjectStorage(
        config({ ...common, OBJECT_STORAGE_S3_FORCE_PATH_STYLE: 'sometimes' }),
      ),
    ).toThrow(/must be true or false/);
  });
});

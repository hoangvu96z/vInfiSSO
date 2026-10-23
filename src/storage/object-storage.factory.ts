import type { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { LocalObjectStorage } from './local-object-storage';
import { S3ObjectStorage } from './s3-object-storage';

export function createObjectStorage(config: ConfigService) {
  const provider = config
    .get<string>('OBJECT_STORAGE_PROVIDER', 'local')
    .trim()
    .toLowerCase();

  if (provider === 'local') {
    return new LocalObjectStorage(path.join(process.cwd(), 'uploads'));
  }
  if (provider !== 's3') {
    throw new Error('OBJECT_STORAGE_PROVIDER must be "local" or "s3"');
  }

  const bucket = config.get<string>('OBJECT_STORAGE_S3_BUCKET', '').trim();
  const accessKeyId = config
    .get<string>('OBJECT_STORAGE_S3_ACCESS_KEY_ID', '')
    .trim();
  const secretAccessKey = config
    .get<string>('OBJECT_STORAGE_S3_SECRET_ACCESS_KEY', '')
    .trim();
  const region = config
    .get<string>('OBJECT_STORAGE_S3_REGION', 'us-east-1')
    .trim();
  const endpoint = config.get<string>('OBJECT_STORAGE_S3_ENDPOINT', '').trim();
  const forcePathStyle = parseBoolean(
    config.get<string>('OBJECT_STORAGE_S3_FORCE_PATH_STYLE', 'true'),
  );

  if (!bucket || !accessKeyId || !secretAccessKey || !region) {
    throw new Error(
      'S3 object storage requires bucket, access key, secret key, and region configuration',
    );
  }
  if (endpoint) validateEndpoint(endpoint);

  return new S3ObjectStorage({
    ...(endpoint ? { endpoint } : {}),
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
  });
}

function validateEndpoint(endpoint: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('OBJECT_STORAGE_S3_ENDPOINT must be a valid HTTP(S) URL');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('OBJECT_STORAGE_S3_ENDPOINT must be a valid HTTP(S) URL');
  }
}

function parseBoolean(value: string): boolean {
  if (value.trim().toLowerCase() === 'true') return true;
  if (value.trim().toLowerCase() === 'false') return false;
  throw new Error('OBJECT_STORAGE_S3_FORCE_PATH_STYLE must be true or false');
}

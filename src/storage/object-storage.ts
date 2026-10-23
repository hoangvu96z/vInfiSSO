/**
 * Private object storage used by server-side features. Callers keep their own
 * authorization checks and expose files through application routes.
 */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export function validateObjectKey(key: string): string {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid object storage key');
  }
  return key;
}

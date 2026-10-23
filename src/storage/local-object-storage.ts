import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ObjectStorage } from './object-storage';
import { validateObjectKey } from './object-storage';

/** Local development/default implementation with the same object key layout. */
@Injectable()
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolveKey(key: string): string {
    const resolved = path.resolve(
      this.root,
      ...validateObjectKey(key).split('/'),
    );
    if (!resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Invalid object storage key');
    }
    return resolved;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    void _contentType;
    const destination = this.resolveKey(key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, body, { mode: 0o600 });
    await fs.chmod(destination, 0o600);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.resolveKey(key));
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolveKey(key), { force: true });
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

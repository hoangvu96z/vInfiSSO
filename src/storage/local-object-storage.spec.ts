import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { LocalObjectStorage } from './local-object-storage';

describe('LocalObjectStorage', () => {
  let root: string;
  let storage: LocalObjectStorage;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'vinfi-object-storage-'));
    storage = new LocalObjectStorage(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes, reads, and deletes a private file under its configured root', async () => {
    const bytes = Buffer.from('private-image');
    await storage.put('notes/abc.webp', bytes, 'image/webp');

    await expect(storage.get('notes/abc.webp')).resolves.toEqual(bytes);
    const stat = await fs.stat(path.join(root, 'notes/abc.webp'));
    expect(stat.mode & 0o777).toBe(0o600);
    await storage.delete('notes/abc.webp');
    await expect(storage.get('notes/abc.webp')).resolves.toBeNull();
  });

  it('rejects keys that could escape its storage root', async () => {
    await expect(
      storage.put('../outside.webp', Buffer.from('x'), 'image/webp'),
    ).rejects.toThrow('Invalid object storage key');
    await expect(storage.get('notes//image.webp')).rejects.toThrow(
      'Invalid object storage key',
    );
  });
});

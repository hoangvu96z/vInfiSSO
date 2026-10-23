jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: {
    EVERY_DAY_AT_3AM: '0 3 * * *',
  },
}));

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { MailService } from '../mail/mail.service';
import type { UsersService } from '../users/users.service';
import { Note, NoteImage } from './note.entity';
import { NoteInvite } from './note-invite.entity';
import { NotesService } from './notes.service';
import { LocalObjectStorage } from '../storage/local-object-storage';
import type { ObjectStorage } from '../storage/object-storage';

describe('NotesService protected image access', () => {
  const filename = '0123456789abcdef01234567.webp';
  const fileBytes = Buffer.from('private-webp-fixture');
  const image: NoteImage = {
    filename,
    url: `/uploads/notes/${filename}`,
    width: 64,
    height: 64,
    size: fileBytes.length,
  };

  let uploadDir: string;
  let storageRoot: string;
  let service: NotesService;
  let notesRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
  };

  const makeNote = (overrides: Partial<Note> = {}): Note =>
    ({
      id: 'note-1',
      userId: 'owner-1',
      guestToken: null,
      shareToken: 'share-token',
      shareMode: 'view',
      sharedWith: [],
      images: [image],
      content: `<p>Image:</p><img src="https://old-api.invalid/uploads/notes/${filename}" alt="saved" width="64"><img src="https://tracker.invalid/pixel.png">`,
      ...overrides,
    }) as Note;

  beforeEach(() => {
    storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vinfi-note-images-'));
    uploadDir = path.join(storageRoot, 'notes');
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, filename), fileBytes);
    notesRepo = {
      findOne: jest.fn(),
      save: jest.fn((note) => Promise.resolve(note)),
    };
    service = new NotesService(
      notesRepo as unknown as Repository<Note>,
      {} as unknown as Repository<NoteInvite>,
      {} as unknown as MailService,
      {} as unknown as UsersService,
      {
        get: (_key: string, defaultValue?: string) => defaultValue,
      } as unknown as ConfigService,
      new LocalObjectStorage(storageRoot),
    );
    Object.defineProperty(service, 'uploadDir', { value: uploadDir });
  });

  afterEach(() => {
    fs.rmSync(storageRoot, { recursive: true, force: true });
  });

  function createService(storage: ObjectStorage): NotesService {
    const created = new NotesService(
      notesRepo as unknown as Repository<Note>,
      {} as unknown as Repository<NoteInvite>,
      {} as unknown as MailService,
      {} as unknown as UsersService,
      {
        get: (_key: string, defaultValue?: string) => defaultValue,
      } as unknown as ConfigService,
      storage,
    );
    Object.defineProperty(created, 'uploadDir', { value: uploadDir });
    return created;
  }

  it('serves an image only to the owner, guest owner, or invited viewer', async () => {
    const ownerNote = makeNote();
    notesRepo.findOne.mockResolvedValue(ownerNote);
    await expect(
      service.getImage(ownerNote.id, filename, 'owner-1'),
    ).resolves.toEqual(fileBytes);

    const guestNote = makeNote({ userId: null, guestToken: 'guest-secret' });
    notesRepo.findOne.mockResolvedValue(guestNote);
    await expect(
      service.getImage(guestNote.id, filename, undefined, 'guest-secret'),
    ).resolves.toEqual(fileBytes);

    const invitedNote = makeNote({
      sharedWith: [{ userId: 'viewer-1', permission: 'view' }],
    });
    notesRepo.findOne.mockResolvedValue(invitedNote);
    await expect(
      service.getImage(invitedNote.id, filename, 'viewer-1'),
    ).resolves.toEqual(fileBytes);
  });

  it('denies unrelated users and filenames that are not attached to the note', async () => {
    const note = makeNote();
    notesRepo.findOne.mockResolvedValue(note);

    await expect(
      service.getImage(note.id, filename, 'stranger-1'),
    ).rejects.toThrow('Bạn không có quyền xem note này');
    await expect(
      service.getImage(note.id, 'fedcba9876543210fedcba98.webp', 'owner-1'),
    ).rejects.toThrow('Không tìm thấy hình ảnh');
    await expect(
      service.getImage(note.id, '../secret.webp', 'owner-1'),
    ).rejects.toThrow('Không tìm thấy hình ảnh');
  });

  it('serves images from active view/edit share tokens and rejects revoked shares', async () => {
    const sharedNote = makeNote({ shareMode: 'view' });
    notesRepo.findOne.mockResolvedValue(sharedNote);
    await expect(
      service.getImageByShareToken('share-token', filename),
    ).resolves.toEqual(fileBytes);

    sharedNote.shareMode = 'edit';
    await expect(
      service.getImageByShareToken('share-token', filename),
    ).resolves.toEqual(fileBytes);

    sharedNote.shareMode = 'none';
    await expect(
      service.getImageByShareToken('share-token', filename),
    ).rejects.toThrow('Note này không được chia sẻ công khai');
  });

  it('rewrites legacy image URLs for private and share-token note responses', async () => {
    const note = makeNote();
    notesRepo.findOne.mockResolvedValue(note);

    const privateView = await service.getNoteById(note.id, 'owner-1');
    expect(privateView.images?.[0]?.url).toBe(
      `/notes/${note.id}/images/${filename}`,
    );
    expect(privateView.content).toContain(
      `src="/notes/${note.id}/images/${filename}"`,
    );
    expect(privateView.content).not.toContain('/uploads/notes/');
    expect(privateView.content).not.toContain('tracker.invalid');

    const shareView = await service.getNoteByShareToken('share-token');
    expect(shareView.images?.[0]?.url).toBe(
      `/notes/share/share-token/images/${filename}`,
    );
    expect(shareView.content).toContain(
      `src="/notes/share/share-token/images/${filename}"`,
    );
  });

  it('preserves orphaned legacy image references as protected URLs but denies downloads', async () => {
    const note = makeNote({ images: [] });
    notesRepo.findOne.mockResolvedValue(note);

    const privateView = await service.getNoteById(note.id, 'owner-1');
    expect(privateView.content).toContain(
      `src="/notes/${note.id}/images/${filename}"`,
    );
    await expect(
      service.getImage(note.id, filename, 'owner-1'),
    ).rejects.toThrow('Không tìm thấy hình ảnh');

    const shareView = await service.getNoteByShareToken('share-token');
    expect(shareView.content).toContain(
      `src="/notes/share/share-token/images/${filename}"`,
    );
    await expect(
      service.getImageByShareToken('share-token', filename),
    ).rejects.toThrow('Không tìm thấy hình ảnh');
  });

  it('returns context-specific routes from owner and share upload flows', async () => {
    const gif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
    const file = { buffer: gif } as Express.Multer.File;
    const note = makeNote({ images: [] });
    notesRepo.findOne.mockResolvedValue(note);

    const uploaded = await service.uploadImage(note.id, file, 'owner-1');
    expect(uploaded.image.url).toMatch(
      new RegExp(`^/notes/${note.id}/images/[a-f0-9]{24}\\.webp$`),
    );
    expect(note.images?.[0].url).toBe(uploaded.image.url);

    const shareNote = makeNote({ images: [], shareMode: 'edit' });
    notesRepo.findOne.mockResolvedValue(shareNote);
    const sharedUpload = await service.uploadImageByShareToken(
      'share-token',
      file,
    );
    expect(sharedUpload.image.url).toMatch(
      /^\/notes\/share\/share-token\/images\/[a-f0-9]{24}\.webp$/,
    );
    expect(shareNote.images?.[0].url).toMatch(
      new RegExp(`^/notes/${shareNote.id}/images/[a-f0-9]{24}\\.webp$`),
    );
  });

  it('uses the private object key for note upload, read, and delete', async () => {
    const objects = new Map<string, Buffer>();
    const put = jest.fn((key: string, body: Buffer): Promise<void> => {
      objects.set(key, body);
      return Promise.resolve();
    });
    const get = jest.fn((key: string): Promise<Buffer | null> =>
      Promise.resolve(objects.get(key) ?? null),
    );
    const deleteObject = jest.fn((key: string): Promise<void> => {
      objects.delete(key);
      return Promise.resolve();
    });
    const storage: ObjectStorage = {
      put,
      get,
      delete: deleteObject,
    };
    const objectService = createService(storage);
    const note = makeNote({ images: [] });
    notesRepo.findOne.mockResolvedValue(note);
    const gif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
    const file = { buffer: gif } as Express.Multer.File;

    const uploaded = await objectService.uploadImage(note.id, file, 'owner-1');
    const key = `notes/${uploaded.image.filename}`;
    expect(put).toHaveBeenCalledWith(key, expect.any(Buffer), 'image/webp');
    expect(
      await objectService.getImage(note.id, uploaded.image.filename, 'owner-1'),
    ).toEqual(objects.get(key));

    const sharedNote = makeNote({
      id: 'shared-note',
      images: [uploaded.image],
      shareMode: 'view',
    });
    notesRepo.findOne.mockResolvedValueOnce(sharedNote);
    await expect(
      objectService.getImageByShareToken(
        'share-token',
        uploaded.image.filename,
      ),
    ).resolves.toEqual(objects.get(key));

    await objectService.deleteImage(note.id, 0, 'owner-1');
    expect(deleteObject).toHaveBeenCalledWith(key);
    expect(objects.has(key)).toBe(false);
  });

  it('keeps reading legacy local images when the configured object store misses', async () => {
    const legacyName = 'fedcba9876543210fedcba98.webp';
    const legacyBytes = Buffer.from('legacy-local-image');
    fs.writeFileSync(path.join(uploadDir, legacyName), legacyBytes);
    const get = jest.fn().mockResolvedValue(null);
    const storage: ObjectStorage = {
      put: jest.fn(),
      get,
      delete: jest.fn(),
    };
    const objectService = createService(storage);
    const note = makeNote({ images: [{ ...image, filename: legacyName }] });
    notesRepo.findOne.mockResolvedValue(note);

    await expect(
      objectService.getImage(note.id, legacyName, 'owner-1'),
    ).resolves.toEqual(legacyBytes);
    expect(get).toHaveBeenCalledWith(`notes/${legacyName}`);
  });

  it('cleans up an uploaded object and restores note metadata when saving fails', async () => {
    const objects = new Map<string, Buffer>();
    const put = jest.fn((key: string, body: Buffer): Promise<void> => {
      objects.set(key, body);
      return Promise.resolve();
    });
    const deleteObject = jest.fn((key: string): Promise<void> => {
      objects.delete(key);
      return Promise.resolve();
    });
    const storage: ObjectStorage = {
      put,
      get: jest.fn((key: string) => Promise.resolve(objects.get(key) ?? null)),
      delete: deleteObject,
    };
    const objectService = createService(storage);
    const originalImages = [image];
    const note = makeNote({ images: originalImages });
    notesRepo.findOne.mockResolvedValue(note);
    notesRepo.save.mockRejectedValueOnce(new Error('database unavailable'));
    const gif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');

    await expect(
      objectService.uploadImage(
        note.id,
        { buffer: gif } as Express.Multer.File,
        'owner-1',
      ),
    ).rejects.toThrow('database unavailable');
    expect(put).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(objects.size).toBe(0);
    expect(note.images).toEqual(originalImages);
  });

  it('does not delete image bytes when saving image removal fails', async () => {
    const deleteObject = jest.fn().mockResolvedValue(undefined);
    const storage: ObjectStorage = {
      put: jest.fn(),
      get: jest.fn().mockResolvedValue(fileBytes),
      delete: deleteObject,
    };
    const objectService = createService(storage);
    const originalImages = [image];
    const note = makeNote({ images: originalImages });
    notesRepo.findOne.mockResolvedValue(note);
    notesRepo.save.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      objectService.deleteImage(note.id, 0, 'owner-1'),
    ).rejects.toThrow('database unavailable');
    expect(note.images).toEqual(originalImages);
    expect(deleteObject).not.toHaveBeenCalled();
    await expect(
      objectService.getImage(note.id, filename, 'owner-1'),
    ).resolves.toEqual(fileBytes);
  });

  it('checks share permission before fetching an object from private storage', async () => {
    const get = jest.fn().mockResolvedValue(fileBytes);
    const storage: ObjectStorage = {
      put: jest.fn(),
      get,
      delete: jest.fn(),
    };
    const objectService = createService(storage);
    const note = makeNote({ shareMode: 'none' });
    notesRepo.findOne.mockResolvedValue(note);

    await expect(
      objectService.getImageByShareToken('share-token', filename),
    ).rejects.toThrow('Note này không được chia sẻ công khai');
    expect(get).not.toHaveBeenCalled();
  });
});

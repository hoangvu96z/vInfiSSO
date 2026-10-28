jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: {
    EVERY_DAY_AT_3AM: '0 3 * * *',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type {
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
} from 'typeorm';
import { NotesService } from './notes.service';
import { Note } from './note.entity';
import { NoteInvite } from './note-invite.entity';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { OBJECT_STORAGE } from '../storage/object-storage';
import type { User } from '../users/user.entity';

type TestNote = Pick<Note, 'id'> & Partial<Note>;
type TestInvite = Pick<NoteInvite, 'token'> & Partial<NoteInvite>;
type TestUser = Pick<User, 'id' | 'email' | 'displayName'>;

type NotesQueryBuilderMock = {
  where: jest.Mock<NotesQueryBuilderMock, [string, Record<string, string>?]>;
  andWhere: jest.Mock<NotesQueryBuilderMock, [string, Record<string, string>?]>;
  orderBy: jest.Mock<NotesQueryBuilderMock, [string, string?]>;
  getMany: jest.Mock<Promise<TestNote[]>, []>;
};

type NotesRepositoryMock = {
  create: jest.Mock<Partial<Note>, [Partial<Note>]>;
  save: jest.Mock<Promise<TestNote>, [Partial<Note>]>;
  find: jest.Mock<Promise<TestNote[]>, [FindManyOptions<Note>?]>;
  findOne: jest.Mock<Promise<Partial<Note> | null>, [FindOneOptions<Note>]>;
  count: jest.Mock<Promise<number>, [FindManyOptions<Note>?]>;
  delete: jest.Mock<
    Promise<{ affected: number | null }>,
    [string | FindOptionsWhere<Note>]
  >;
  update: jest.Mock<
    Promise<{ affected: number | null }>,
    [string | FindOptionsWhere<Note>, Partial<Note>]
  >;
  createQueryBuilder: jest.Mock<NotesQueryBuilderMock, [string?]>;
};

type InviteRepositoryMock = {
  create: jest.Mock<Partial<NoteInvite>, [Partial<NoteInvite>]>;
  save: jest.Mock<Promise<TestInvite>, [Partial<NoteInvite>]>;
  findOne: jest.Mock<
    Promise<Partial<NoteInvite> | null>,
    [FindOneOptions<NoteInvite>]
  >;
  delete: jest.Mock<
    Promise<{ affected: number | null }>,
    [FindOptionsWhere<NoteInvite>]
  >;
};

type UsersServiceMock = {
  findByEmail: jest.Mock<Promise<TestUser | null>, [string]>;
  findById: jest.Mock<Promise<TestUser | null>, [string]>;
};

type ConfigServiceMock = {
  get: jest.Mock<string | undefined, [string, string?]>;
};

type ObjectStorageMock = {
  put: jest.Mock<Promise<void>, [string, Buffer, string]>;
  get: jest.Mock<Promise<Buffer | null>, [string]>;
  delete: jest.Mock<Promise<void>, [string]>;
};

describe('NotesService', () => {
  let service: NotesService;
  let mockNotesRepo: NotesRepositoryMock;
  let mockInviteRepo: InviteRepositoryMock;
  let mockMailService: jest.Mocked<Pick<MailService, 'sendMail'>>;
  let mockUsersService: UsersServiceMock;
  let mockConfigService: ConfigServiceMock;
  let mockObjectStorage: ObjectStorageMock;

  beforeEach(async () => {
    const queryBuilder: NotesQueryBuilderMock = {
      where: jest.fn<
        NotesQueryBuilderMock,
        [string, Record<string, string>?]
      >(),
      andWhere: jest.fn<
        NotesQueryBuilderMock,
        [string, Record<string, string>?]
      >(),
      orderBy: jest.fn<NotesQueryBuilderMock, [string, string?]>(),
      getMany: jest.fn<Promise<TestNote[]>, []>().mockResolvedValue([]),
    };
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);

    mockNotesRepo = {
      create: jest.fn<Partial<Note>, [Partial<Note>]>((dto) => ({ ...dto })),
      save: jest.fn<Promise<TestNote>, [Partial<Note>]>((entity) =>
        Promise.resolve({ ...entity, id: entity.id ?? 'note-1' }),
      ),
      find: jest
        .fn<Promise<TestNote[]>, [FindManyOptions<Note>?]>()
        .mockResolvedValue([]),
      findOne: jest.fn<Promise<Partial<Note> | null>, [FindOneOptions<Note>]>(),
      count: jest
        .fn<Promise<number>, [FindManyOptions<Note>?]>()
        .mockResolvedValue(0),
      delete: jest
        .fn<
          Promise<{ affected: number | null }>,
          [string | FindOptionsWhere<Note>]
        >()
        .mockResolvedValue({ affected: 1 }),
      update: jest
        .fn<
          Promise<{ affected: number | null }>,
          [string | FindOptionsWhere<Note>, Partial<Note>]
        >()
        .mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest
        .fn<NotesQueryBuilderMock, [string?]>()
        .mockReturnValue(queryBuilder),
    };

    mockInviteRepo = {
      create: jest.fn<Partial<NoteInvite>, [Partial<NoteInvite>]>((dto) => ({
        ...dto,
      })),
      save: jest.fn<Promise<TestInvite>, [Partial<NoteInvite>]>((entity) =>
        Promise.resolve({ ...entity, token: entity.token ?? 'invite-token' }),
      ),
      findOne: jest.fn<
        Promise<Partial<NoteInvite> | null>,
        [FindOneOptions<NoteInvite>]
      >(),
      delete: jest
        .fn<
          Promise<{ affected: number | null }>,
          [FindOptionsWhere<NoteInvite>]
        >()
        .mockResolvedValue({ affected: 1 }),
    };

    mockMailService = {
      sendMail: jest
        .fn<
          ReturnType<MailService['sendMail']>,
          Parameters<MailService['sendMail']>
        >()
        .mockResolvedValue(undefined),
    };

    mockUsersService = {
      findByEmail: jest.fn<Promise<TestUser | null>, [string]>(),
      findById: jest.fn<Promise<TestUser | null>, [string]>(),
    };

    mockConfigService = {
      get: jest.fn<string | undefined, [string, string?]>(
        (_key, defaultValue) => defaultValue,
      ),
    };

    mockObjectStorage = {
      put: jest
        .fn<Promise<void>, [string, Buffer, string]>()
        .mockResolvedValue(undefined),
      get: jest.fn<Promise<Buffer | null>, [string]>().mockResolvedValue(null),
      delete: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: getRepositoryToken(Note), useValue: mockNotesRepo },
        { provide: getRepositoryToken(NoteInvite), useValue: mockInviteRepo },
        { provide: MailService, useValue: mockMailService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: OBJECT_STORAGE, useValue: mockObjectStorage },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('uses the vunph.click NoteNow URL for invite links by default', async () => {
    mockNotesRepo.findOne.mockResolvedValue({
      id: 'note-1',
      userId: 'owner-1',
      title: 'Shared note',
      sharedWith: [],
    });
    mockUsersService.findByEmail.mockResolvedValue({
      id: 'invitee-1',
      email: 'reader@example.test',
      displayName: 'Reader',
    });
    mockInviteRepo.findOne.mockResolvedValue(null);

    await service.sendShareInvite(
      'note-1',
      'owner-1',
      'reader@example.test',
      'view',
    );

    const token = mockInviteRepo.save.mock.calls[0]?.[0].token;
    const sentMail = mockMailService.sendMail.mock.calls[0]?.[0];
    expect(sentMail?.html).toContain(
      `https://vunph.click/note/invite/${token}`,
    );
  });

  describe('Character Limit Validation (10x limit)', () => {
    it('should allow guest note with <= 20480 chars', async () => {
      const content = 'a'.repeat(20_480);
      await expect(
        service.createNote({ content }, undefined, 'guest-token-1'),
      ).resolves.toBeDefined();
    });

    it('should throw BadRequestException if guest note exceeds 20480 chars', async () => {
      const content = 'a'.repeat(20_481);
      await expect(
        service.createNote({ content }, undefined, 'guest-token-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow logged-in user note with <= 100000 chars', async () => {
      const content = 'a'.repeat(100_000);
      mockNotesRepo.find.mockResolvedValue([]);
      await expect(
        service.createNote({ content }, 'user-1', undefined),
      ).resolves.toBeDefined();
    });

    it('should throw BadRequestException if user note exceeds 100000 chars', async () => {
      const content = 'a'.repeat(100_001);
      await expect(
        service.createNote({ content }, 'user-1', undefined),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Rich text sanitization', () => {
    it('strips script tags and event handlers on write and read', async () => {
      const result = await service.createNote(
        { content: '<p onclick="alert(1)">Hello</p><script>alert(2)</script>' },
        undefined,
        'guest-token-1',
      );
      expect(result.content).toContain('Hello');
      expect(result.content).not.toMatch(/script|onclick|alert\(/i);
      expect(mockNotesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          content: '<p>Hello</p>',
        }),
      );
    });

    it('sanitizes legacy stored HTML before returning it', async () => {
      mockNotesRepo.findOne.mockResolvedValue({
        id: 'note-legacy',
        userId: 'user-1',
        content:
          '<p onmouseover="alert(1)">Old note</p><script>alert(2)</script>',
      });

      const note = await service.getNoteById('note-legacy', 'user-1');

      expect(note.content).toBe('<p>Old note</p>');
      expect(note.content).not.toMatch(/script|onmouseover|alert\(/i);
    });
  });

  describe('No Auto-Expiration Policy', () => {
    it('should keep guest note with null expiresAt (no 30/60-day auto-delete)', async () => {
      const result = await service.createNote(
        { title: 'Guest Note' },
        undefined,
        'guest-token-1',
      );
      expect(result.expiresAt).toBeNull();
    });

    it('should keep all user notes with null expiresAt regardless of count', async () => {
      const mockNotes = Array.from({ length: 35 }, (_, i) => ({
        id: `n-${i + 1}`,
        createdAt: new Date(Date.now() + i * 1000),
        expiresAt: i === 30 ? new Date() : null,
      }));
      mockNotesRepo.find.mockResolvedValue(mockNotes);

      const result = await service.createNote(
        { title: 'Note 36' },
        'user-1',
        undefined,
      );
      expect(result.expiresAt).toBeNull();
      // Any legacy note with expiresAt is cleared to null
      expect(mockNotesRepo.update).toHaveBeenCalledWith('n-31', {
        expiresAt: null,
      });
    });
  });

  describe('Direct Note Password & Server History (Max 5)', () => {
    it('should set, verify, and remove direct note password', async () => {
      let storedNote: Partial<Note> = {
        id: 'note-pw-1',
        userId: 'user-1',
        title: 'Secret Note',
        content: '<p>Top secret</p>',
        notePasswordHash: null,
      };
      mockNotesRepo.findOne.mockImplementation(() =>
        Promise.resolve(storedNote),
      );
      mockNotesRepo.save.mockImplementation((entity) => {
        storedNote = { ...storedNote, ...entity };
        return Promise.resolve(storedNote as TestNote);
      });

      const locked = await service.setNotePassword(
        'note-pw-1',
        { password: 'my-secret-password' },
        'user-1',
      );
      expect(locked.hasPassword).toBe(true);

      await expect(
        service.verifyNotePassword(
          'note-pw-1',
          { password: 'wrong-password' },
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      const verified = await service.verifyNotePassword(
        'note-pw-1',
        { password: 'my-secret-password' },
        'user-1',
      );
      expect(verified.verified).toBe(true);

      // Removing password requires currentPassword
      await expect(
        service.setNotePassword(
          'note-pw-1',
          { password: null, currentPassword: 'wrong' },
          'user-1',
        ),
      ).rejects.toThrow(ForbiddenException);

      const unlocked = await service.setNotePassword(
        'note-pw-1',
        { password: null, currentPassword: 'my-secret-password' },
        'user-1',
      );
      expect(unlocked.hasPassword).toBe(false);
    });

    it('should cap server history at 5 revisions for logged-in users and keep guest history empty on server', async () => {
      let userNote: Partial<Note> = {
        id: 'note-hist-1',
        userId: 'user-1',
        title: 'V0',
        content: '<p>Content 0</p>',
        bgColor: 'default',
        bgPattern: 'none',
        history: null,
        updatedAt: new Date(),
      };
      mockNotesRepo.findOne.mockImplementation(() =>
        Promise.resolve(userNote),
      );
      mockNotesRepo.save.mockImplementation((entity) => {
        userNote = { ...userNote, ...entity, updatedAt: new Date() };
        return Promise.resolve(userNote as TestNote);
      });

      for (let i = 1; i <= 7; i++) {
        await service.updateNote(
          'note-hist-1',
          { title: `V${i}`, content: `<p>Content ${i}</p>` },
          'user-1',
        );
      }

      expect(userNote.history).toHaveLength(5);
      expect(userNote.history?.[0]?.title).toBe('V6');
      expect(userNote.history?.[4]?.title).toBe('V2');

      // Guest note does not store history on server
      let guestNote: Partial<Note> = {
        id: 'guest-hist-1',
        userId: null,
        guestToken: 'guest-1',
        title: 'G0',
        content: '<p>Guest 0</p>',
        history: null,
      };
      mockNotesRepo.findOne.mockImplementation(() =>
        Promise.resolve(guestNote),
      );
      mockNotesRepo.save.mockImplementation((entity) => {
        guestNote = { ...guestNote, ...entity };
        return Promise.resolve(guestNote as TestNote);
      });

      const updatedGuest = await service.updateNote(
        'guest-hist-1',
        { title: 'G1', content: '<p>Guest 1</p>' },
        undefined,
        'guest-1',
      );
      expect(guestNote.history).toBeNull();
      expect(updatedGuest.history).toBeUndefined();
    });
  });

  describe('Share Mode and Permissions', () => {
    it('should allow updating note via shareToken when shareMode is edit', async () => {
      mockNotesRepo.findOne.mockResolvedValue({
        id: 'note-1',
        title: 'Old Title',
        content: 'Old Content',
        shareMode: 'edit',
        shareToken: 'token-abc',
      });

      const updated = await service.updateByShareToken('token-abc', {
        title: 'New Title',
        content: 'New Content',
      });

      expect(updated.title).toBe('New Title');
      expect(updated.canEdit).toBe(true);
    });

    it('should reject updating note via shareToken when shareMode is view', async () => {
      mockNotesRepo.findOne.mockResolvedValue({
        id: 'note-1',
        shareMode: 'view',
        shareToken: 'token-abc',
      });

      await expect(
        service.updateByShareToken('token-abc', { title: 'New' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow shared editor in sharedWith list to update note', async () => {
      mockNotesRepo.findOne.mockResolvedValue({
        id: 'note-1',
        userId: 'owner-user',
        sharedWith: [{ userId: 'editor-user', permission: 'edit' }],
      });

      const updated = await service.updateNote(
        'note-1',
        { title: 'Updated by collaborator' },
        'editor-user',
      );
      expect(updated.title).toBe('Updated by collaborator');
    });

    it('should forbid user without permission from updating note', async () => {
      mockNotesRepo.findOne.mockResolvedValue({
        id: 'note-1',
        userId: 'owner-user',
        sharedWith: [{ userId: 'viewer-user', permission: 'view' }],
      });

      await expect(
        service.updateNote('note-1', { title: 'Hacker' }, 'stranger-user'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.updateNote('note-1', { title: 'Hacker' }, 'viewer-user'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Claim Guest Notes on Login', () => {
    it('should claim guest notes and associate with user', async () => {
      mockNotesRepo.find
        .mockResolvedValueOnce([
          { id: 'g-note-1', guestToken: 'g-tok', userId: null },
          { id: 'g-note-2', guestToken: 'g-tok', userId: null },
        ])
        .mockResolvedValue([]);

      const result = await service.claimGuestNotes('logged-user', 'g-tok');
      expect(result.claimed).toBe(2);
      expect(mockNotesRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('Expired Invites Cleanup', () => {
    it('should clean up expired invites without deleting notes', async () => {
      await service.cleanupExpiredNotes();
      expect(mockNotesRepo.delete).not.toHaveBeenCalled();
      expect(mockInviteRepo.delete).toHaveBeenCalled();
    });
  });
});

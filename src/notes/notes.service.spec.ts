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

  describe('Character Limit Validation', () => {
    it('should allow guest note with <= 2048 chars', async () => {
      const content = 'a'.repeat(2048);
      await expect(
        service.createNote({ content }, undefined, 'guest-token-1'),
      ).resolves.toBeDefined();
    });

    it('should throw BadRequestException if guest note exceeds 2048 chars', async () => {
      const content = 'a'.repeat(2049);
      await expect(
        service.createNote({ content }, undefined, 'guest-token-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow logged-in user note with <= 10000 chars', async () => {
      const content = 'a'.repeat(10000);
      mockNotesRepo.find.mockResolvedValue([]);
      await expect(
        service.createNote({ content }, 'user-1', undefined),
      ).resolves.toBeDefined();
    });

    it('should throw BadRequestException if user note exceeds 10000 chars', async () => {
      const content = 'a'.repeat(10001);
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

  describe('Guest Expiration & TTL', () => {
    it('should assign ~60 days expiry to guest note', async () => {
      const result = await service.createNote(
        { title: 'Guest Note' },
        undefined,
        'guest-token-1',
      );
      expect(result.expiresAt).toBeDefined();
      expect(result.expiresAt).toBeInstanceOf(Date);
      if (!result.expiresAt) throw new Error('Expected a guest note expiry');
      const diffDays = Math.round(
        (result.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      expect(diffDays).toBe(60);
    });
  });

  describe('User Note Limits (30 Permanent, >30 180-day Expiry)', () => {
    it('should keep note permanent (null expiresAt) if user has <= 30 notes', async () => {
      // Simulate 10 existing notes
      mockNotesRepo.find.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `n-${i}`,
          createdAt: new Date(),
          expiresAt: null,
        })),
      );
      const result = await service.createNote(
        { title: 'Note 11' },
        'user-1',
        undefined,
      );
      expect(result.expiresAt).toBeNull();
    });

    it('should set 180-day expiry on 31st note', async () => {
      // Simulate 31 notes after create
      const mockNotes = Array.from({ length: 31 }, (_, i) => ({
        id: `n-${i + 1}`,
        createdAt: new Date(Date.now() + i * 1000),
        expiresAt: i < 30 ? null : null, // rank 31 needs TTL
      }));
      mockNotesRepo.find.mockResolvedValue(mockNotes);

      await service.createNote({ title: 'Note 31' }, 'user-1', undefined);
      // Verify rebalance called update with an expiry on note 31
      const updatedNote = mockNotesRepo.update.mock.calls.find(
        ([id]) => id === 'n-31',
      );
      expect(updatedNote?.[1].expiresAt).toBeInstanceOf(Date);
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

  describe('Expired Notes Cleanup', () => {
    it('should delete expired notes and invites', async () => {
      mockNotesRepo.find.mockResolvedValue([{ id: 'exp-1', images: null }]);
      await service.cleanupExpiredNotes();
      expect(mockNotesRepo.delete).toHaveBeenCalled();
      expect(mockInviteRepo.delete).toHaveBeenCalled();
    });
  });
});

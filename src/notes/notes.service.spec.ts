jest.mock('@nestjs/schedule', () => ({
  Cron: () => () => {},
  CronExpression: {
    EVERY_DAY_AT_3AM: '0 3 * * *',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotesService } from './notes.service';
import { Note } from './note.entity';
import { NoteInvite } from './note-invite.entity';
import { MailService } from '../mail/mail.service';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';

describe('NotesService', () => {
  let service: NotesService;
  let mockNotesRepo: any;
  let mockInviteRepo: any;
  let mockMailService: any;
  let mockUsersService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockNotesRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: 'note-1', ...entity })),
      find: jest.fn(() => Promise.resolve([])),
      findOne: jest.fn(),
      count: jest.fn(() => Promise.resolve(0)),
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };

    mockInviteRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((entity) => Promise.resolve({ id: 'invite-1', ...entity })),
      findOne: jest.fn(),
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    mockMailService = {
      sendMail: jest.fn().mockResolvedValue(true),
    };

    mockUsersService = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn((key, def) => def),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: getRepositoryToken(Note), useValue: mockNotesRepo },
        { provide: getRepositoryToken(NoteInvite), useValue: mockInviteRepo },
        { provide: MailService, useValue: mockMailService },
        { provide: UsersService, useValue: mockUsersService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Character Limit Validation', () => {
    it('should allow guest note with <= 2048 chars', async () => {
      const content = 'a'.repeat(2048);
      await expect(service.createNote({ content }, undefined, 'guest-token-1')).resolves.toBeDefined();
    });

    it('should throw BadRequestException if guest note exceeds 2048 chars', async () => {
      const content = 'a'.repeat(2049);
      await expect(service.createNote({ content }, undefined, 'guest-token-1')).rejects.toThrow(BadRequestException);
    });

    it('should allow logged-in user note with <= 10000 chars', async () => {
      const content = 'a'.repeat(10000);
      mockNotesRepo.find.mockResolvedValue([]);
      await expect(service.createNote({ content }, 'user-1', undefined)).resolves.toBeDefined();
    });

    it('should throw BadRequestException if user note exceeds 10000 chars', async () => {
      const content = 'a'.repeat(10001);
      await expect(service.createNote({ content }, 'user-1', undefined)).rejects.toThrow(BadRequestException);
    });
  });

  describe('Guest Expiration & TTL', () => {
    it('should assign ~60 days expiry to guest note', async () => {
      const result = await service.createNote({ title: 'Guest Note' }, undefined, 'guest-token-1');
      expect(result.expiresAt).toBeDefined();
      expect(result.expiresAt).toBeInstanceOf(Date);
      const diffDays = Math.round((result.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBe(60);
    });
  });

  describe('User Note Limits (30 Permanent, >30 180-day Expiry)', () => {
    it('should keep note permanent (null expiresAt) if user has <= 30 notes', async () => {
      // Simulate 10 existing notes
      mockNotesRepo.find.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ id: `n-${i}`, createdAt: new Date(), expiresAt: null }))
      );
      const result = await service.createNote({ title: 'Note 11' }, 'user-1', undefined);
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
      expect(mockNotesRepo.update).toHaveBeenCalledWith('n-31', expect.objectContaining({
        expiresAt: expect.any(Date),
      }));
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

      await expect(service.updateByShareToken('token-abc', { title: 'New' })).rejects.toThrow(ForbiddenException);
    });

    it('should allow shared editor in sharedWith list to update note', async () => {
      mockNotesRepo.findOne.mockResolvedValue({
        id: 'note-1',
        userId: 'owner-user',
        sharedWith: [{ userId: 'editor-user', permission: 'edit' }],
      });

      const updated = await service.updateNote('note-1', { title: 'Updated by collaborator' }, 'editor-user');
      expect(updated.title).toBe('Updated by collaborator');
    });

    it('should forbid user without permission from updating note', async () => {
      mockNotesRepo.findOne.mockResolvedValue({
        id: 'note-1',
        userId: 'owner-user',
        sharedWith: [{ userId: 'viewer-user', permission: 'view' }],
      });

      await expect(service.updateNote('note-1', { title: 'Hacker' }, 'stranger-user')).rejects.toThrow(ForbiddenException);
      await expect(service.updateNote('note-1', { title: 'Hacker' }, 'viewer-user')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('Claim Guest Notes on Login', () => {
    it('should claim guest notes and associate with user', async () => {
      mockNotesRepo.find.mockResolvedValueOnce([
        { id: 'g-note-1', guestToken: 'g-tok', userId: null },
        { id: 'g-note-2', guestToken: 'g-tok', userId: null },
      ]).mockResolvedValue([]);

      const result = await service.claimGuestNotes('logged-user', 'g-tok');
      expect(result.claimed).toBe(2);
      expect(mockNotesRepo.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('Expired Notes Cleanup', () => {
    it('should delete expired notes and invites', async () => {
      mockNotesRepo.find.mockResolvedValue([
        { id: 'exp-1', images: null },
      ]);
      await service.cleanupExpiredNotes();
      expect(mockNotesRepo.delete).toHaveBeenCalled();
      expect(mockInviteRepo.delete).toHaveBeenCalled();
    });
  });
});

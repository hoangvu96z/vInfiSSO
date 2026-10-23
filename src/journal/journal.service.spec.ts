import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  DeepPartial,
  FindManyOptions,
  FindOneOptions,
  Repository,
} from 'typeorm';
import type { Reading } from '../readings/reading.entity';
import { ReadingEncryption } from '../readings/reading-encryption';
import type { JournalEntry } from './journal-entry.entity';
import { JournalService } from './journal.service';

type TestReading = Pick<Reading, 'id' | 'app' | 'type' | 'createdAt'> &
  Partial<Pick<Reading, 'userId'>>;
type TestJournalEntry = Pick<
  JournalEntry,
  'id' | 'userId' | 'readingId' | 'encryptedPayload' | 'createdAt' | 'updatedAt'
>;

type JournalRepositoryMock = {
  find: jest.Mock<
    Promise<TestJournalEntry[]>,
    [FindManyOptions<JournalEntry>?]
  >;
  findOne: jest.Mock<
    Promise<Partial<JournalEntry> | null>,
    [FindOneOptions<JournalEntry>]
  >;
  create: jest.Mock<TestJournalEntry, [DeepPartial<JournalEntry>]>;
  save: jest.Mock<Promise<TestJournalEntry>, [TestJournalEntry]>;
  delete: jest.Mock<Promise<{ affected: number }>, [Partial<JournalEntry>]>;
};

type ReadingRepositoryMock = {
  find: jest.Mock<Promise<TestReading[]>, [FindManyOptions<Reading>?]>;
  findOne: jest.Mock<Promise<TestReading | null>, [FindOneOptions<Reading>]>;
};

describe('JournalService', () => {
  const userId = 'user-a';
  const readingId = 'reading-a';
  const reading: TestReading & Pick<Reading, 'question' | 'title'> = {
    id: readingId,
    userId,
    app: 'iching',
    type: 'luc-hao',
    question: 'private question must not be returned',
    title: 'private title must not be returned',
    createdAt: new Date('2026-10-20T08:30:00.000Z'),
  };

  let journalRepo: JournalRepositoryMock;
  let readingsRepo: ReadingRepositoryMock;
  let service: JournalService;
  let encryption: ReadingEncryption;

  beforeEach(() => {
    encryption = new ReadingEncryption(
      `test:${randomBytes(32).toString('base64')}`,
      'test',
    );
    journalRepo = {
      find: jest.fn<
        Promise<TestJournalEntry[]>,
        [FindManyOptions<JournalEntry>?]
      >(),
      findOne: jest.fn<
        Promise<Partial<JournalEntry> | null>,
        [FindOneOptions<JournalEntry>]
      >(),
      create: jest.fn<TestJournalEntry, [DeepPartial<JournalEntry>]>(
        (value) => {
          if (
            !value.id ||
            !value.userId ||
            !value.readingId ||
            !value.encryptedPayload?._enc
          ) {
            throw new Error('Expected a complete journal entry');
          }
          return {
            id: value.id,
            userId: value.userId,
            readingId: value.readingId,
            encryptedPayload: { _enc: value.encryptedPayload._enc },
            createdAt:
              value.createdAt instanceof Date
                ? value.createdAt
                : new Date('2026-10-21T09:00:00.000Z'),
            updatedAt:
              value.updatedAt instanceof Date
                ? value.updatedAt
                : new Date('2026-10-21T09:00:00.000Z'),
          };
        },
      ),
      save: jest.fn<Promise<TestJournalEntry>, [TestJournalEntry]>((value) =>
        Promise.resolve({
          ...value,
          createdAt: value.createdAt || new Date('2026-10-21T09:00:00.000Z'),
          updatedAt: value.updatedAt || new Date('2026-10-21T09:00:00.000Z'),
        }),
      ),
      delete: jest
        .fn<Promise<{ affected: number }>, [Partial<JournalEntry>]>()
        .mockResolvedValue({ affected: 1 }),
    };
    readingsRepo = {
      find: jest.fn<Promise<TestReading[]>, [FindManyOptions<Reading>?]>(),
      findOne: jest.fn<
        Promise<TestReading | null>,
        [FindOneOptions<Reading>]
      >(),
    };
    service = new JournalService(
      journalRepo as unknown as Repository<JournalEntry>,
      readingsRepo as unknown as Repository<Reading>,
      encryption,
    );
  });

  it('encrypts reflections and returns only safe reading metadata', async () => {
    readingsRepo.findOne.mockResolvedValue(reading);
    journalRepo.findOne.mockResolvedValue(null);

    const result = await service.createEntry(userId, {
      readingId,
      tags: ['career', 'growth'],
      reflection: 'A private reflection',
    });

    const saved = journalRepo.save.mock.calls[0]?.[0];
    expect(saved).toMatchObject({ userId, readingId });
    expect(saved?.encryptedPayload._enc).toMatch(/^v3:test:/);
    expect(JSON.stringify(saved?.encryptedPayload)).not.toContain(
      'A private reflection',
    );
    expect(JSON.stringify(saved?.encryptedPayload)).not.toContain('career');
    expect(saved).not.toHaveProperty('tags');
    expect(result.reflection).toBe('A private reflection');
    expect(result.reading).toEqual({
      id: readingId,
      app: 'iching',
      type: 'luc-hao',
      createdAt: reading.createdAt,
    });
    expect(result.reading).not.toHaveProperty('question');
    expect(result.reading).not.toHaveProperty('title');
  });

  it('rejects readings owned by another account and duplicate reflections', async () => {
    readingsRepo.findOne.mockResolvedValue(null);
    await expect(
      service.createEntry(userId, {
        readingId,
        tags: [],
        reflection: 'Private',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    readingsRepo.findOne.mockResolvedValue(reading);
    journalRepo.findOne.mockResolvedValue({ id: 'existing' });
    await expect(
      service.createEntry(userId, {
        readingId,
        tags: [],
        reflection: 'Private',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('filters entries by time and tag and decrypts only matching owned readings', async () => {
    const id = 'journal-entry-a';
    journalRepo.find.mockResolvedValue([
      {
        id,
        userId,
        readingId,
        encryptedPayload: encryption.encryptJournalPayload(
          { reflection: 'A private reflection', tags: ['career'] },
          userId,
          id,
        ),
        createdAt: new Date('2026-10-21T09:00:00.000Z'),
        updatedAt: new Date('2026-10-21T09:00:00.000Z'),
      },
    ]);
    readingsRepo.find.mockResolvedValue([
      {
        id: readingId,
        app: 'iching',
        type: 'luc-hao',
        createdAt: reading.createdAt,
      },
    ]);

    const result = await service.listEntries(userId, {
      from: '2026-10-01',
      to: '2026-10-31',
      tag: 'career',
      app: 'iching',
    });

    expect(result).toHaveLength(1);
    expect(result[0].reflection).toBe('A private reflection');
    const journalFindOptions = journalRepo.find.mock.calls[0]?.[0];
    const journalWhere = journalFindOptions?.where;
    expect(Array.isArray(journalWhere)).toBe(false);
    if (journalWhere && !Array.isArray(journalWhere)) {
      expect(journalWhere.userId).toBe(userId);
      expect(journalWhere.createdAt).toBeDefined();
      expect(journalWhere).not.toHaveProperty('tags');
    }
    const readingFindOptions = readingsRepo.find.mock.calls[1]?.[0];
    expect(readingFindOptions?.where).toMatchObject({ app: 'iching', userId });
    expect(readingFindOptions?.select).toEqual({
      id: true,
      app: true,
      type: true,
      createdAt: true,
    });
  });

  it('paginates topic filters after decrypting tags stored in the payload', async () => {
    const entries = ['one', 'two', 'three'].map((id, index) => ({
      id,
      userId,
      readingId: `${readingId}-${id}`,
      encryptedPayload: encryption.encryptJournalPayload(
        {
          reflection: `Reflection ${id}`,
          tags: index === 1 ? ['career'] : ['love'],
        },
        userId,
        id,
      ),
      createdAt: new Date(`2026-10-2${3 - index}T09:00:00.000Z`),
      updatedAt: new Date('2026-10-21T09:00:00.000Z'),
    }));
    journalRepo.find.mockResolvedValue(entries);
    readingsRepo.find.mockResolvedValue(
      entries.map((entry) => ({
        id: entry.readingId,
        app: 'iching',
        type: 'luc-hao',
        createdAt: reading.createdAt,
      })),
    );

    const result = await service.listEntries(userId, {
      tag: 'love',
      offset: 1,
      limit: 1,
    });

    expect(result).toHaveLength(1);
    expect(result[0].tags).toEqual(['love']);
    expect(journalRepo.find.mock.calls[0]?.[0]).not.toHaveProperty('take');
    expect(journalRepo.find.mock.calls[0]?.[0]).not.toHaveProperty('skip');
  });

  it('does not allow editing or deleting another user’s reflection', async () => {
    journalRepo.findOne.mockResolvedValue({ id: 'entry-a', userId: 'user-b' });
    await expect(
      service.updateEntry(userId, 'entry-a', { reflection: 'Change' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.deleteEntry(userId, 'entry-a')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(journalRepo.save).not.toHaveBeenCalled();
    expect(journalRepo.delete).not.toHaveBeenCalled();
  });
});

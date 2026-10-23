import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  And,
  FindOptionsWhere,
  In,
  LessThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Reading } from '../readings/reading.entity';
import {
  JournalPayload,
  ReadingEncryptionService,
} from '../readings/reading-encryption';
import { JournalEntry } from './journal-entry.entity';
import {
  CreateJournalEntryDto,
  JOURNAL_TAGS,
  JournalTag,
} from './dto/journal-write.dto';

const MAX_REFLECTION_LENGTH = 2000;
const MAX_TAGS = 5;
const MAX_LIST_SIZE = 500;

type JournalReadingSummary = Pick<Reading, 'id' | 'app' | 'type' | 'createdAt'>;

export interface JournalEntryView {
  id: string;
  readingId: string;
  tags: JournalTag[];
  reflection: string;
  createdAt: Date;
  updatedAt: Date;
  reading: JournalReadingSummary;
}

@Injectable()
export class JournalService {
  constructor(
    @InjectRepository(JournalEntry)
    private readonly journalRepo: Repository<JournalEntry>,
    @InjectRepository(Reading)
    private readonly readingsRepo: Repository<Reading>,
    private readonly encryption: ReadingEncryptionService,
  ) {}

  async listEntries(
    userId: string,
    filters: {
      from?: string;
      to?: string;
      tag?: JournalTag;
      app?: string;
      offset?: number;
      limit?: number;
    },
  ): Promise<JournalEntryView[]> {
    const where: FindOptionsWhere<JournalEntry> = { userId };
    const fromDate = filters.from
      ? this.parseDate(filters.from, false)
      : undefined;
    const toDate = filters.to
      ? this.parseDate(filters.to, false)
      : undefined;
    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException('Khoảng thời gian không hợp lệ');
    }
    const from = fromDate ? MoreThanOrEqual(fromDate) : undefined;
    const to = filters.to
      ? LessThan(this.parseDate(filters.to, true))
      : undefined;
    if (from && to) where.createdAt = And(from, to);
    else if (from) where.createdAt = from;
    else if (to) where.createdAt = to;
    if (filters.app) {
      const appReadings = await this.readingsRepo.find({
        where: { userId, app: filters.app },
        select: { id: true },
      });
      if (!appReadings.length) return [];
      where.readingId = In(appReadings.map((reading) => reading.id));
    }

    const query = { where, order: { createdAt: 'DESC' as const, id: 'DESC' as const } };
    const offset = filters.offset ?? 0;
    const limit = Math.min(filters.limit ?? MAX_LIST_SIZE, MAX_LIST_SIZE);
    const rows = await this.journalRepo.find(
      filters.tag ? query : { ...query, skip: offset, take: limit },
    );
    if (!rows.length) return [];

    const candidates = rows
      .map((entry) => ({ entry, payload: this.decrypt(entry) }))
      .filter(({ payload }) => !filters.tag || payload.tags.includes(filters.tag));
    const page = filters.tag
      ? candidates.slice(offset, offset + limit)
      : candidates;
    if (!page.length) return [];

    const readingIds = page.map(({ entry }) => entry.readingId);
    const readings = await this.readingsRepo.find({
      where: {
        id: In(readingIds),
        userId,
        ...(filters.app ? { app: filters.app } : {}),
      },
      select: { id: true, app: true, type: true, createdAt: true },
    });
    const readingsById = new Map(readings.map((reading) => [reading.id, reading]));

    return page
      .filter(({ entry }) => readingsById.has(entry.readingId))
      .map(({ entry, payload }) =>
        this.toView(entry, readingsById.get(entry.readingId)!, payload),
      );
  }

  async listAvailableReadings(
    userId: string,
    filters: { app?: string; offset?: number; limit?: number },
  ): Promise<Array<JournalReadingSummary & { hasReflection: boolean }>> {
    const readings = await this.readingsRepo.find({
      where: { userId, ...(filters.app ? { app: filters.app } : {}) },
      select: { id: true, app: true, type: true, createdAt: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: filters.offset ?? 0,
      take: Math.min(filters.limit ?? MAX_LIST_SIZE, MAX_LIST_SIZE),
    });
    if (!readings.length) return [];

    const entries = await this.journalRepo.find({
      where: { userId, readingId: In(readings.map((reading) => reading.id)) },
      select: { readingId: true },
    });
    const reflectedIds = new Set(entries.map((entry) => entry.readingId));
    return readings.map((reading) => ({
      ...reading,
      hasReflection: reflectedIds.has(reading.id),
    }));
  }

  async createEntry(
    userId: string,
    dto: CreateJournalEntryDto,
  ): Promise<JournalEntryView> {
    const tags = dto.tags ?? [];
    this.validateContent(dto.reflection, tags);
    const reading = await this.readingsRepo.findOne({
      where: { id: dto.readingId, userId },
      select: { id: true, userId: true, app: true, type: true, createdAt: true },
    });
    if (!reading) throw new NotFoundException('Không tìm thấy reading');

    const existing = await this.journalRepo.findOne({
      where: { userId, readingId: reading.id },
    });
    if (existing) {
      throw new ConflictException('Reading này đã có reflection');
    }

    const id = randomUUID();
    const entry = this.journalRepo.create({
      id,
      userId,
      readingId: reading.id,
      encryptedPayload: this.encryption.encryptJournalPayload(
        { reflection: dto.reflection.trim(), tags },
        userId,
        id,
      ),
    });
    try {
      return this.toView(await this.journalRepo.save(entry), reading);
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('Reading này đã có reflection');
      }
      throw error;
    }
  }

  async updateEntry(
    userId: string,
    entryId: string,
    update: { reflection?: string; tags?: JournalTag[] },
  ): Promise<JournalEntryView> {
    if (update.reflection !== undefined) {
      this.validateContent(update.reflection, update.tags);
    } else if (update.tags !== undefined) {
      this.validateTags(update.tags);
    }
    if (update.reflection === undefined && update.tags === undefined) {
      throw new BadRequestException('Không có nội dung cập nhật');
    }

    const entry = await this.journalRepo.findOne({
      where: { id: entryId },
    });
    if (!entry) throw new NotFoundException('Không tìm thấy reflection');
    if (entry.userId !== userId) {
      throw new ForbiddenException('Không có quyền cập nhật reflection');
    }
    const reading = await this.findReadingSummary(userId, entry.readingId);
    const current = this.decrypt(entry);
    const tags = update.tags ?? current.tags;
    entry.encryptedPayload = this.encryption.encryptJournalPayload(
      { reflection: update.reflection?.trim() ?? current.reflection, tags },
      userId,
      entry.id,
    );
    return this.toView(await this.journalRepo.save(entry), reading);
  }

  async deleteEntry(userId: string, entryId: string): Promise<void> {
    const entry = await this.journalRepo.findOne({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Không tìm thấy reflection');
    if (entry.userId !== userId) {
      throw new ForbiddenException('Không có quyền xoá reflection');
    }
    await this.journalRepo.delete({ id: entry.id, userId });
  }

  private async findReadingSummary(
    userId: string,
    readingId: string,
  ): Promise<JournalReadingSummary> {
    const reading = await this.readingsRepo.findOne({
      where: { id: readingId, userId },
      select: { id: true, app: true, type: true, createdAt: true },
    });
    if (!reading) throw new NotFoundException('Không tìm thấy reading');
    return reading;
  }

  private toView(
    entry: JournalEntry,
    reading: JournalReadingSummary,
    payload: JournalPayload = this.decrypt(entry),
  ): JournalEntryView {
    try {
      const readingSummary: JournalReadingSummary = {
        id: reading.id,
        app: reading.app,
        type: reading.type,
        createdAt: reading.createdAt,
      };
      return {
        id: entry.id,
        readingId: entry.readingId,
        tags: payload.tags as JournalTag[],
        reflection: payload.reflection,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        reading: readingSummary,
      };
    } catch {
      throw new InternalServerErrorException(
        'Không thể đọc reflection đã mã hoá. Dữ liệu cũ được giữ nguyên.',
      );
    }
  }

  private decrypt(entry: JournalEntry) {
    try {
      return this.encryption.decryptJournalPayload(
        entry.encryptedPayload,
        entry.userId,
        entry.id,
      );
    } catch {
      throw new InternalServerErrorException(
        'Không thể đọc reflection đã mã hoá. Dữ liệu cũ được giữ nguyên.',
      );
    }
  }

  private validateContent(reflection: string, tags?: string[]): void {
    if (typeof reflection !== 'string' || !reflection.trim()) {
      throw new BadRequestException('Reflection không được để trống');
    }
    if (reflection.length > MAX_REFLECTION_LENGTH) {
      throw new BadRequestException('Reflection vượt quá 2000 ký tự');
    }
    if (tags !== undefined) this.validateTags(tags);
  }

  private validateTags(tags: string[]): void {
    if (
      !Array.isArray(tags) ||
      tags.length > MAX_TAGS ||
      new Set(tags).size !== tags.length ||
      tags.some((tag) => !JOURNAL_TAGS.includes(tag as JournalTag))
    ) {
      throw new BadRequestException('Chủ đề reflection không hợp lệ');
    }
  }

  private parseDate(value: string, exclusiveEnd: boolean): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Ngày phải có định dạng YYYY-MM-DD');
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException('Ngày không hợp lệ');
    }
    if (exclusiveEnd) date.setUTCDate(date.getUTCDate() + 1);
    return date;
  }

  private isUniqueViolation(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && error.code === '23505';
  }
}

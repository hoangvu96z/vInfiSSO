import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Reading } from './reading.entity';
import { AuditLog } from '../users/audit-log.entity';
import {
  decryptLegacyClientTree,
  ReadingEncryptionService,
} from './reading-encryption';

const ENCRYPTED_READING_KEY = '_enc';

function getSafeMetadataTitle(app: string, type: string): string {
  if (
    !/^[A-Za-z0-9_-]{1,20}$/.test(app) ||
    !/^[A-Za-z0-9_-]{1,50}$/.test(type)
  ) {
    throw new BadRequestException('Invalid reading app or type');
  }
  return `${app}:${type}`;
}

@Injectable()
export class ReadingsService {
  constructor(
    @InjectRepository(Reading)
    private readonly readingsRepo: Repository<Reading>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
    private readonly readingEncryption: ReadingEncryptionService,
  ) {}

  async getReadings(userId: string, app?: string): Promise<Reading[]> {
    const where: FindOptionsWhere<Reading> = { userId };
    if (app) where.app = app;
    const readings = await this.readingsRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return readings.map((reading) => this.toApiReading(reading));
  }

  async getReadingById(userId: string, readingId: string): Promise<Reading> {
    const reading = await this.readingsRepo.findOne({
      where: { id: readingId },
    });
    if (!reading) throw new NotFoundException('Không tìm thấy lịch sử');
    if (reading.userId !== userId)
      throw new ForbiddenException('Không có quyền truy cập');
    return this.toApiReading(reading);
  }

  async createReading(
    userId: string,
    dto: {
      app: string;
      type: string;
      question?: string;
      title: string;
      data: Record<string, unknown>;
    },
  ): Promise<Reading> {
    const safeTitle = getSafeMetadataTitle(dto.app, dto.type);
    if (
      typeof dto.title !== 'string' ||
      (dto.question !== undefined &&
        dto.question !== null &&
        typeof dto.question !== 'string')
    ) {
      throw new BadRequestException('Reading question and title must be text');
    }
    if (!dto.data || typeof dto.data !== 'object' || Array.isArray(dto.data)) {
      throw new BadRequestException('Reading data must be an object');
    }
    const payload = {
      question: dto.question ?? null,
      title: dto.title,
      data: dto.data,
    };
    const readingId = randomUUID();
    const reading = this.readingsRepo.create({
      id: readingId,
      userId,
      app: dto.app,
      type: dto.type,
      question: null,
      title: safeTitle,
      data: this.readingEncryption.encryptPayload(payload, userId, readingId),
    });
    const saved = await this.readingsRepo.save(reading);

    await this.auditLogRepo.save({
      userId,
      action: 'create_reading',
      app: dto.app,
      metadata: { type: dto.type },
    });

    return this.toApiReading(saved);
  }

  async updateReadingData(
    userId: string,
    readingId: string,
    partialData: Record<string, unknown>,
  ): Promise<Reading> {
    const reading = await this.readingsRepo.findOne({
      where: { id: readingId },
    });
    if (!reading) throw new NotFoundException('Không tìm thấy lịch sử');
    if (reading.userId !== userId)
      throw new ForbiddenException('Không có quyền cập nhật');
    if (
      !partialData ||
      typeof partialData !== 'object' ||
      Array.isArray(partialData)
    ) {
      throw new BadRequestException('Reading update data must be an object');
    }

    const hasEncryptedEnvelope =
      !!reading.data &&
      typeof reading.data === 'object' &&
      !Array.isArray(reading.data) &&
      Object.prototype.hasOwnProperty.call(reading.data, ENCRYPTED_READING_KEY);
    const current = hasEncryptedEnvelope
      ? this.decryptStoredReading(reading)
      : this.decryptLegacyReadingForUpdate(reading, userId);
    const mergedData = { ...current.data, ...partialData };
    const safeTitle = getSafeMetadataTitle(reading.app, reading.type);
    reading.question = null;
    reading.title = safeTitle;
    reading.data = this.readingEncryption.encryptPayload(
      {
        question: current.question,
        title: current.title,
        data: mergedData,
      },
      userId,
      reading.id,
    );
    const saved = await this.readingsRepo.save(reading);

    const aiConversation = partialData.aiConversation;
    if (aiConversation) {
      const followUps =
        typeof aiConversation === 'object' &&
        !Array.isArray(aiConversation) &&
        'followUps' in aiConversation &&
        Array.isArray(aiConversation.followUps)
          ? aiConversation.followUps.length
          : 0;
      await this.auditLogRepo.save({
        userId,
        action: 'ai_question',
        app: reading.app,
        metadata: {
          readingId,
          followUpsCount: followUps,
        },
      });
    }

    return this.toApiReading(saved);
  }

  async deleteReading(userId: string, readingId: string): Promise<void> {
    const reading = await this.readingsRepo.findOne({
      where: { id: readingId },
    });
    if (!reading) throw new NotFoundException('Không tìm thấy lịch sử');
    if (reading.userId !== userId)
      throw new ForbiddenException('Không có quyền xoá');
    await this.readingsRepo.delete(readingId);
  }

  async deleteAllReadings(userId: string, app?: string): Promise<void> {
    const where: FindOptionsWhere<Reading> = { userId };
    if (app) where.app = app;
    await this.readingsRepo.delete(where);
  }

  private decryptStoredReading(reading: Reading): Reading {
    if (
      !reading.data ||
      typeof reading.data !== 'object' ||
      Array.isArray(reading.data) ||
      !Object.prototype.hasOwnProperty.call(reading.data, ENCRYPTED_READING_KEY)
    ) {
      // Legacy client-encrypted records stay intact for old clients to decode.
      return reading;
    }
    try {
      const payload = this.readingEncryption.decryptEnvelope(
        reading.data,
        reading.userId,
        reading.id,
      );
      return {
        ...reading,
        question: payload.question,
        title: payload.title,
        data: payload.data,
      };
    } catch {
      // Never expose corrupt ciphertext or allow an update to overwrite it.
      throw new InternalServerErrorException(
        'Unable to read encrypted history. Contact support before retrying.',
      );
    }
  }

  private decryptLegacyReadingForUpdate(
    reading: Reading,
    userId: string,
  ): Reading {
    try {
      const question = decryptLegacyClientTree(
        reading.question ?? null,
        userId,
      );
      const title = decryptLegacyClientTree(reading.title, userId);
      const data = decryptLegacyClientTree(reading.data, userId);
      if (
        (question !== null && typeof question !== 'string') ||
        typeof title !== 'string' ||
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data)
      ) {
        throw new Error('Invalid legacy reading payload');
      }
      return {
        ...reading,
        question,
        title,
        data: data as Record<string, unknown>,
      };
    } catch {
      // Legacy client ciphertext must be authenticated before a PATCH can replace it.
      throw new InternalServerErrorException(
        'Unable to read encrypted history. Contact support before retrying.',
      );
    }
  }

  private toApiReading(reading: Reading): Reading {
    return this.decryptStoredReading(reading);
  }
}

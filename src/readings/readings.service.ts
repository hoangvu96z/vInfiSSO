import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Reading } from './reading.entity';
import { AuditLog } from '../users/audit-log.entity';

@Injectable()
export class ReadingsService {
  constructor(
    @InjectRepository(Reading)
    private readonly readingsRepo: Repository<Reading>,
    @InjectRepository(AuditLog)
    private readonly auditLogRepo: Repository<AuditLog>,
  ) {}

  async getReadings(userId: string, app?: string): Promise<Reading[]> {
    const where: any = { userId };
    if (app) where.app = app;
    return this.readingsRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async getReadingById(userId: string, readingId: string): Promise<Reading> {
    const reading = await this.readingsRepo.findOne({ where: { id: readingId } });
    if (!reading) throw new NotFoundException('Không tìm thấy lịch sử');
    if (reading.userId !== userId) throw new ForbiddenException('Không có quyền truy cập');
    return reading;
  }

  async createReading(
    userId: string,
    dto: {
      app: string;
      type: string;
      question?: string;
      title: string;
      data: Record<string, any>;
    },
  ): Promise<Reading> {
    const reading = this.readingsRepo.create({
      userId,
      app: dto.app,
      type: dto.type,
      question: dto.question ?? null,
      title: dto.title,
      data: dto.data,
    });
    const saved = await this.readingsRepo.save(reading);

    await this.auditLogRepo.save({
      userId,
      action: 'create_reading',
      app: dto.app,
      metadata: { type: dto.type, title: dto.title },
    });

    return saved;
  }

  async updateReadingData(
    userId: string,
    readingId: string,
    partialData: Record<string, any>,
  ): Promise<Reading> {
    const reading = await this.readingsRepo.findOne({ where: { id: readingId } });
    if (!reading) throw new NotFoundException('Không tìm thấy lịch sử');
    if (reading.userId !== userId) throw new ForbiddenException('Không có quyền cập nhật');

    reading.data = { ...reading.data, ...partialData };
    const saved = await this.readingsRepo.save(reading);

    if (partialData.aiConversation) {
      await this.auditLogRepo.save({
        userId,
        action: 'ai_question',
        app: reading.app,
        metadata: {
          readingId,
          followUpsCount: partialData.aiConversation.followUps?.length || 0,
        },
      });
    }

    return saved;
  }

  async deleteReading(userId: string, readingId: string): Promise<void> {
    const reading = await this.readingsRepo.findOne({ where: { id: readingId } });
    if (!reading) throw new NotFoundException('Không tìm thấy lịch sử');
    if (reading.userId !== userId) throw new ForbiddenException('Không có quyền xoá');
    await this.readingsRepo.delete(readingId);
  }

  async deleteAllReadings(userId: string, app?: string): Promise<void> {
    const where: any = { userId };
    if (app) where.app = app;
    await this.readingsRepo.delete(where);
  }
}

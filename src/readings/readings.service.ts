import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Reading } from './reading.entity';

@Injectable()
export class ReadingsService {
  constructor(
    @InjectRepository(Reading)
    private readonly readingsRepo: Repository<Reading>,
  ) {}

  async getReadings(userId: string, app?: string): Promise<Reading[]> {
    const where: any = { userId };
    if (app) where.app = app;
    return this.readingsRepo.find({
      where,
      order: { createdAt: 'DESC' },
    });
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
    return this.readingsRepo.save(reading);
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

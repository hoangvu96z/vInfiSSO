import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reading } from './reading.entity';
import { AuditLog } from '../users/audit-log.entity';
import { ReadingsService } from './readings.service';
import { ReadingsController } from './readings.controller';
import { SsoModule } from '../sso/sso.module';
import { ReadingEncryptionService } from './reading-encryption';

@Module({
  imports: [TypeOrmModule.forFeature([Reading, AuditLog]), SsoModule],
  controllers: [ReadingsController],
  providers: [ReadingsService, ReadingEncryptionService],
  exports: [ReadingsService],
})
export class ReadingsModule {}

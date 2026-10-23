import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReadingsModule } from '../readings/readings.module';
import { Reading } from '../readings/reading.entity';
import { SsoModule } from '../sso/sso.module';
import { JournalEntry } from './journal-entry.entity';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([JournalEntry, Reading]),
    ReadingsModule,
    SsoModule,
  ],
  controllers: [JournalController],
  providers: [JournalService],
})
export class JournalModule {}

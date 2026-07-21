import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Reading } from './reading.entity';
import { ReadingsService } from './readings.service';
import { ReadingsController } from './readings.controller';
import { SsoModule } from '../sso/sso.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reading]),
    SsoModule,
  ],
  controllers: [ReadingsController],
  providers: [ReadingsService],
  exports: [ReadingsService],
})
export class ReadingsModule {}

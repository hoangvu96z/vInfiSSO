import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SsoModule } from '../sso/sso.module';
import { StreakState } from './streak-state.entity';
import { StreakController } from './streak.controller';
import { StreakService } from './streak.service';

@Module({
  imports: [TypeOrmModule.forFeature([StreakState]), SsoModule],
  controllers: [StreakController],
  providers: [StreakService],
})
export class StreakModule {}

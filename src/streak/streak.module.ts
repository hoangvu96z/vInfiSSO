import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SsoModule } from '../sso/sso.module';
import { StreakState } from './streak-state.entity';
import { StreakController } from './streak.controller';
import { StreakService } from './streak.service';
import { MeOverviewController } from './me-overview.controller';

@Module({
  imports: [TypeOrmModule.forFeature([StreakState]), SsoModule],
  controllers: [StreakController, MeOverviewController],
  providers: [StreakService],
})
export class StreakModule {}

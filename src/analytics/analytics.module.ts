import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PageVisit } from './page-visit.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { SsoModule } from '../sso/sso.module';
import { AdminGuard } from '../auth/admin.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([PageVisit]),
    SsoModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AdminGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}

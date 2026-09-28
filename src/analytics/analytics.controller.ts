import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import type { Request } from 'express';
import { AnalyticsService } from './analytics.service';
import { RecordVisitDto } from './dto/record-visit.dto';
import { AdminGuard } from '../auth/admin.guard';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * Public tracking endpoint called by TalkWithMe (and other apps) on page load
   * POST /analytics/visit
   */
  @Post('visit')
  async recordVisit(@Body() dto: RecordVisitDto, @Req() req: Request) {
    return this.analyticsService.recordVisit(dto, req);
  }

  /**
   * Admin: Get traffic summary, charts, and device/browser breakdowns
   * GET /analytics/admin/stats?days=30&app=talkwithme
   */
  @Get('admin/stats')
  @UseGuards(AdminGuard)
  async getTrafficStats(
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
    @Query('app') app?: string,
  ) {
    return this.analyticsService.getTrafficStats(days, app);
  }

  /**
   * Admin: Get detailed visitor logs
   * GET /analytics/admin/logs?page=1&limit=50&app=talkwithme&search=...
   */
  @Get('admin/logs')
  @UseGuards(AdminGuard)
  async getTrafficLogs(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('app') app?: string,
    @Query('search') search?: string,
  ) {
    return this.analyticsService.getTrafficLogs(page, limit, app, search);
  }
}

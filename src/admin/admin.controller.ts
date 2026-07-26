import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminGuard } from '../auth/admin.guard';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // GET /admin/stats — Dashboard General Indicators
  @Get('stats')
  async getStats() {
    return this.adminService.getDashboardStats();
  }

  // GET /admin/users — User Management List
  @Get('users')
  async getUsers(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('role') role?: string,
  ) {
    return this.adminService.getUsers(page, limit, search, role);
  }

  // PATCH /admin/users/:id/role — Update User Role
  @Patch('users/:id/role')
  async updateRole(
    @Param('id') userId: string,
    @Body() body: { role: string },
  ) {
    return this.adminService.updateUserRole(userId, body.role);
  }

  // PATCH /admin/users/:id/status — Toggle User Verification/Status
  @Patch('users/:id/status')
  async updateStatus(
    @Param('id') userId: string,
    @Body() body: { isVerified: boolean },
  ) {
    return this.adminService.updateUserStatus(userId, body.isVerified);
  }

  // DELETE /admin/users/:id/sessions — Revoke All Sessions of User
  @Delete('users/:id/sessions')
  async revokeSessions(@Param('id') userId: string) {
    return this.adminService.revokeUserSessions(userId);
  }

  // GET /admin/audit-logs — Traffic & Login Audit Trail Logs
  @Get('audit-logs')
  async getAuditLogs(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('action') action?: string,
    @Query('search') search?: string,
  ) {
    return this.adminService.getAuditLogs(page, limit, action, search);
  }

  // GET /admin/ai-usage — Detailed AI Usage Analytics per User
  @Get('ai-usage')
  async getAiUsage() {
    return this.adminService.getAiUsageStats();
  }

  // GET /admin/analytics — Time Series & Geo/App Distribution Analytics Charts
  @Get('analytics')
  async getAnalytics() {
    return this.adminService.getAnalyticsData();
  }
}

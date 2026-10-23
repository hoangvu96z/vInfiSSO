import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminService } from './admin.service';
import { AdminOnly } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PlansService } from '../plans/plans.service';
import { User } from '../users/user.entity';
import {
  BatchIdsDto,
  BatchUserIdsDto,
  CreateCouponDto,
  GrantPlanDto,
  UpdateCouponDto,
  UpdatePlanDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto/admin-write.dto';

@Controller('admin')
@AdminOnly()
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly plansService: PlansService,
  ) {}

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
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getUsers(
      page,
      limit,
      search,
      role,
      dateFrom,
      dateTo,
    );
  }

  // PATCH /admin/users/:id/role — Update User Role
  @Patch('users/:id/role')
  async updateRole(
    @Param('id') userId: string,
    @Body() body: UpdateUserRoleDto,
    @CurrentUser() actor: User,
    @Req() req: Request,
  ) {
    return this.adminService.updateUserRole(
      userId,
      body.role,
      actor.id,
      req.ip,
      req.headers['user-agent'] || null,
    );
  }

  // PATCH /admin/users/:id/status — Toggle User Verification/Status
  @Patch('users/:id/status')
  async updateStatus(
    @Param('id') userId: string,
    @Body() body: UpdateUserStatusDto,
  ) {
    return this.adminService.updateUserStatus(userId, body.isVerified);
  }

  // DELETE /admin/users/:id/sessions — Revoke All Sessions of User
  @Delete('users/:id/sessions')
  async revokeSessions(@Param('id') userId: string) {
    return this.adminService.revokeUserSessions(userId);
  }

  // POST /admin/users/batch-revoke-sessions — Revoke sessions for multiple users
  @Post('users/batch-revoke-sessions')
  async batchRevokeSessions(@Body() body: BatchUserIdsDto) {
    return this.adminService.revokeMultipleUserSessions(body.userIds);
  }

  // GET /admin/audit-logs — Traffic & Login Audit Trail Logs
  @Get('audit-logs')
  async getAuditLogs(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
    @Query('action') action?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getAuditLogs(
      page,
      limit,
      action,
      search,
      dateFrom,
      dateTo,
    );
  }

  // GET /admin/ai-usage — Detailed AI Usage Analytics per User
  @Get('ai-usage')
  async getAiUsage() {
    return this.adminService.getAiUsageStats();
  }

  // GET /admin/ai-usage/page — Server-paginated AI usage for the admin UI
  @Get('ai-usage/page')
  async getAiUsagePage(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.adminService.getAiUsageStats(
      page,
      limit,
      search,
      dateFrom,
      dateTo,
    );
  }

  // GET /admin/analytics — Time Series & Geo/App Distribution Analytics Charts
  @Get('analytics')
  async getAnalytics() {
    return this.adminService.getAnalyticsData();
  }

  // ─── Plans Admin ──────────────────────────────────────────────────────────

  // GET /admin/plans — Lấy tất cả cấu hình gói
  @Get('plans')
  async getPlans() {
    const plans = await this.plansService.getAllPlans();
    return { plans };
  }

  // PATCH /admin/plans/:name — Cập nhật config gói
  @Patch('plans/:name')
  async updatePlan(@Param('name') name: string, @Body() body: UpdatePlanDto) {
    const plan = await this.plansService.updatePlan(name, body);
    return { plan };
  }

  // ─── Coupons Admin ────────────────────────────────────────────────────────

  // GET /admin/coupons — Danh sách coupon
  @Get('coupons')
  async getCoupons() {
    const coupons = await this.plansService.getAllCoupons();
    return { coupons };
  }

  // GET /admin/coupons/page — Server-paginated coupons for the admin UI
  @Get('coupons/page')
  async getCouponsPage(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.plansService.getCoupons(page, limit, search, dateFrom, dateTo);
  }

  // POST /admin/coupons — Tạo coupon mới
  @Post('coupons')
  async createCoupon(@Body() body: CreateCouponDto) {
    const coupon = await this.plansService.createCoupon(body);
    return { coupon };
  }

  // PATCH /admin/coupons/:id — Cập nhật coupon
  @Patch('coupons/:id')
  async updateCoupon(@Param('id') id: string, @Body() body: UpdateCouponDto) {
    const coupon = await this.plansService.updateCoupon(id, body);
    return { coupon };
  }

  // DELETE /admin/coupons/:id — Xóa coupon
  @Delete('coupons/:id')
  async deleteCoupon(@Param('id') id: string) {
    await this.plansService.deleteCoupon(id);
    return { success: true };
  }

  // POST /admin/coupons/batch-delete — Xóa nhiều coupon
  @Post('coupons/batch-delete')
  async batchDeleteCoupons(@Body() body: BatchIdsDto) {
    await this.plansService.deleteCoupons(body.ids);
    return { success: true, count: body.ids?.length || 0 };
  }

  // ─── User Plan Management ─────────────────────────────────────────────────

  // POST /admin/users/:id/grant-plan — Admin tặng gói cho user
  @Post('users/:id/grant-plan')
  async grantPlan(@Param('id') userId: string, @Body() body: GrantPlanDto) {
    const sub = await this.plansService.adminGrantPlan(
      userId,
      body.planName,
      body.durationDays,
    );
    return { success: true, subscription: sub };
  }

  // PATCH /admin/users/:id/revoke-plan — Thu hồi gói, reset về Free
  @Patch('users/:id/revoke-plan')
  async revokePlan(@Param('id') userId: string) {
    await this.plansService.adminRevokePlan(userId);
    return { success: true };
  }

  // GET /admin/quota-stats — Thống kê AI usage
  @Get('quota-stats')
  async getQuotaStats() {
    return this.plansService.getQuotaStats();
  }
}

import {
  Controller,
  Get,
  Post,
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
import { PlansService } from '../plans/plans.service';

@Controller('admin')
@UseGuards(AdminGuard)
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

  // ─── Plans Admin ──────────────────────────────────────────────────────────

  // GET /admin/plans — Lấy tất cả cấu hình gói
  @Get('plans')
  async getPlans() {
    const plans = await this.plansService.getAllPlans();
    return { plans };
  }

  // PATCH /admin/plans/:name — Cập nhật config gói
  @Patch('plans/:name')
  async updatePlan(
    @Param('name') name: string,
    @Body() body: Record<string, any>,
  ) {
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

  // POST /admin/coupons — Tạo coupon mới
  @Post('coupons')
  async createCoupon(@Body() body: Record<string, any>) {
    const coupon = await this.plansService.createCoupon(body);
    return { coupon };
  }

  // PATCH /admin/coupons/:id — Cập nhật coupon
  @Patch('coupons/:id')
  async updateCoupon(
    @Param('id') id: string,
    @Body() body: Record<string, any>,
  ) {
    const coupon = await this.plansService.updateCoupon(id, body);
    return { coupon };
  }

  // DELETE /admin/coupons/:id — Xóa coupon
  @Delete('coupons/:id')
  async deleteCoupon(@Param('id') id: string) {
    await this.plansService.deleteCoupon(id);
    return { success: true };
  }

  // ─── User Plan Management ─────────────────────────────────────────────────

  // POST /admin/users/:id/grant-plan — Admin tặng gói cho user
  @Post('users/:id/grant-plan')
  async grantPlan(
    @Param('id') userId: string,
    @Body() body: { planName: string; durationDays: number },
  ) {
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

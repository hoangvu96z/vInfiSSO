import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlansService } from './plans.service';
import { SsoService } from '../sso/sso.service';

const COOKIE_NAME = 'sso_token';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly ssoService: SsoService,
  ) {}

  private getToken(req: Request): string | undefined {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.substring(7).trim();
    }
    const raw = req.headers.cookie ?? '';
    const entry = raw
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(`${COOKIE_NAME}=`));
    if (!entry) return undefined;
    const [, val] = entry.split('=');
    return val ? decodeURIComponent(val) : undefined;
  }

  private async requireUser(req: Request) {
    const token = this.getToken(req);
    const user = await this.ssoService.resolveSession(token);
    if (!user) throw new UnauthorizedException('Vui lòng đăng nhập');
    return user;
  }

  private extractAppName(req: Request, body?: any): string {
    const qApp = req.query.app as string;
    const bApp = body?.app as string;
    const hApp = (req.headers['x-app-name'] || req.headers['app']) as string;
    return (bApp || qApp || hApp || 'default').trim().toLowerCase();
  }

  // GET /plans/my-quota — Kiểm tra quota còn lại
  @Get('my-quota')
  async getMyQuota(@Req() req: Request) {
    const user = await this.requireUser(req);
    const app = this.extractAppName(req);
    return this.plansService.checkQuota(user.id, app);
  }

  // GET /plans/my-subscription — Thông tin gói hiện tại
  @Get('my-subscription')
  async getMySubscription(@Req() req: Request) {
    const user = await this.requireUser(req);
    return this.plansService.getMySubscription(user.id);
  }

  // POST /plans/consume — Trừ 1 lượt AI (gọi trước khi hỏi AI)
  @Post('consume')
  async consume(@Req() req: Request, @Body() body?: { app?: string }) {
    const user = await this.requireUser(req);
    const app = this.extractAppName(req, body);
    await this.plansService.consumeQuota(user.id, app);
    const quota = await this.plansService.checkQuota(user.id, app);
    return { success: true, quota };
  }

  // POST /plans/bonus — Xin thêm 5 câu (Premium only)
  @Post('bonus')
  async requestBonus(@Req() req: Request, @Body() body?: { app?: string }) {
    const user = await this.requireUser(req);
    const app = this.extractAppName(req, body);
    const result = await this.plansService.requestBonus(user.id, app);
    const quota = await this.plansService.checkQuota(user.id, app);
    return { ...result, quota };
  }

  // POST /plans/apply-coupon — Nhập mã khuyến mãi
  @Post('apply-coupon')
  async applyCoupon(@Req() req: Request, @Body() body: { code: string }) {
    if (!body.code) {
      throw new UnauthorizedException('Vui lòng nhập mã khuyến mãi');
    }
    const user = await this.requireUser(req);
    return this.plansService.applyCoupon(user.id, body.code);
  }

  // GET /plans/config — Lấy danh sách gói (public, không cần đăng nhập)
  @Get('config')
  async getPlansConfig() {
    const plans = await this.plansService.getAllPlans();
    return { plans };
  }
}

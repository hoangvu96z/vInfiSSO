import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
  BadGatewayException,
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

  // TuViNow uses the same SSO session and quota bucket as /plans/consume.
  @Get('tuvi-ai/config')
  getTuviAiConfig() {
    const models = (process.env.TUVI_AI_MODELS || 'combo1')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);
    const apiKey = process.env.TUVI_AI_API_KEY;
    return { models, configured: !!apiKey };
  }

  @Post('tuvi-ai')
  async interpretTuvi(
    @Req() req: Request,
    @Body()
    body: {
      model?: string;
      messages?: Array<{ role: string; content: string }>;
    },
  ) {
    const user = await this.requireUser(req);
    const { models } = this.getTuviAiConfig();
    const model = body?.model || models[0];
    const messages = body?.messages;
    if (
      !models.includes(model) ||
      !Array.isArray(messages) ||
      messages.length < 1 ||
      messages.length > 12 ||
      messages.some(
        (message) =>
          !message ||
          !['user', 'assistant'].includes(message.role) ||
          typeof message.content !== 'string' ||
          !message.content.trim() ||
          message.content.length > 60000,
      ) ||
      messages.reduce((size, message) => size + message.content.length, 0) >
        180000 ||
      messages[0].role !== 'user' ||
      messages.at(-1)?.role !== 'user'
    ) {
      throw new BadRequestException('Nội dung hoặc model AI không hợp lệ');
    }
    const apiKey = process.env.TUVI_AI_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException('Máy chủ chưa cấu hình AI Tử Vi (vui lòng cấu hình TUVI_AI_API_KEY trong .env)');
    }
    const endpoint = (
      process.env.TUVI_AI_BASE_URL || 'http://43.128.116.69:20128/v1'
    ).replace(/\/$/, '');
    // Charge once per submitted question, never again for an upstream retry.
    await this.plansService.consumeQuota(user.id, 'tuvinow');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${endpoint}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              {
                role: 'system',
                content:
                  'Bạn là người luận giải Tử Vi Đẩu Số. Trả lời bằng tiếng Việt. Tuân thủ định dạng đầu ra được yêu cầu: nếu yêu cầu JSON có sections và references thì chỉ trả JSON hợp lệ, Markdown chỉ được dùng trong chuỗi text; nếu không yêu cầu JSON thì dùng Markdown. Bám đúng dữ liệu lá số được cung cấp; không tự an lại sao, không bịa sao, tiểu hạn hoặc lưu niên còn thiếu. Phân biệt diễn giải với dữ kiện, không khẳng định số phận chắc chắn. Với câu hỏi tiếp theo, trả lời trực tiếp và ngắn gọn dựa trên hội thoại.',
              },
              ...messages,
            ],
          }),
          signal: AbortSignal.timeout(90000),
        });
        if (!response.ok) {
          if (
            attempt === 0 &&
            (response.status === 429 || response.status >= 500)
          )
            continue;
          throw new BadGatewayException(
            'Máy chủ AI từ chối yêu cầu. Vui lòng thử lại sau.',
          );
        }
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          throw new BadGatewayException('AI chưa trả về nội dung luận giải');
        }
        return { content };
      } catch (error) {
        if (error instanceof BadGatewayException) throw error;
        if (attempt === 1)
          throw new BadGatewayException(
            'Không kết nối được AI hoặc yêu cầu đã hết thời gian.',
          );
      }
    }
    throw new BadGatewayException('Không kết nối được AI');
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

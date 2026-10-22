import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
  BadGatewayException,
  Res,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PlansService } from './plans.service';
import { SsoAuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/user.entity';
import { AppQuotaDto, ApplyCouponDto, PlansAiDto, TuviAiDto } from './dto/plan-write.dto';
import { resolveLocalAiBaseUrl } from './ai-upstream.util';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
  ) {}

  private extractAppName(req: Request, body?: any): string {
    const qApp = req.query.app as string;
    const bApp = body?.app as string;
    const hApp = (req.headers['x-app-name'] || req.headers['app']) as string;
    return (bApp || qApp || hApp || 'default').trim().toLowerCase();
  }

  // GET /plans/my-quota — Kiểm tra quota còn lại
  @Get('my-quota')
  @UseGuards(SsoAuthGuard)
  async getMyQuota(@CurrentUser() user: User, @Req() req: Request) {
    const app = this.extractAppName(req);
    return this.plansService.checkQuota(user.id, app);
  }

  // GET /plans/my-subscription — Thông tin gói hiện tại
  @Get('my-subscription')
  @UseGuards(SsoAuthGuard)
  async getMySubscription(@CurrentUser() user: User) {
    return this.plansService.getMySubscription(user.id);
  }

  // POST /plans/consume — Trừ 1 lượt AI (gọi trước khi hỏi AI)
  @Post('consume')
  @UseGuards(SsoAuthGuard)
  async consume(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Body() body?: AppQuotaDto,
  ) {
    const app = this.extractAppName(req, body);
    await this.plansService.consumeQuota(user.id, app);
    const quota = await this.plansService.checkQuota(user.id, app);
    return { success: true, quota };
  }

  // POST /plans/ai — quota-gated server-side OpenAI-compatible streaming proxy.
  @Post('ai')
  @UseGuards(SsoAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async proxyAi(
    @CurrentUser() user: User,
    @Body() body: PlansAiDto,
    @Res() res: Response,
  ) {
    const app = (body?.app || '').trim().toLowerCase();
    const appBuckets: Record<string, string> = {
      iching: 'ichingnow',
      ichingnow: 'ichingnow',
      tarot: 'tarotnow',
      tarotnow: 'tarotnow',
      tuvi: 'tuvinow',
      tuvinow: 'tuvinow',
    };
    const quotaApp = appBuckets[app];
    const defaultModels = [
      'combo1',
      'openrouter/tencent/hy3:free',
      'openrouter/openai/gpt-oss-20b:free',
      'openrouter/poolside/laguna-xs-2.1:free',
      'openrouter/google/gemma-4-26b-a4b-it:free',
    ];
    const allowedModels = (
      process.env.AI_MODELS ||
      [
        ...defaultModels,
        ...(process.env.TUVI_AI_MODELS || '')
          .split(',')
          .map((model) => model.trim())
          .filter(Boolean),
      ].join(',')
    )
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);
    const messages = body?.messages;
    if (
      !quotaApp ||
      !body?.model ||
      !allowedModels.includes(body.model) ||
      body.stream !== true ||
      !Array.isArray(messages) ||
      messages.length < 1 ||
      messages.length > 12 ||
      messages.some(
        (message) =>
          !message ||
          !['system', 'user', 'assistant'].includes(message.role) ||
          typeof message.content !== 'string' ||
          !message.content.trim() ||
          message.content.length > 60000,
      ) ||
      messages.reduce((size, message) => size + message.content.length, 0) >
        180000 ||
      !['user', 'system'].includes(messages[0]?.role) ||
      !['user', 'assistant'].includes(messages.at(-1)?.role || '') ||
      (body.max_tokens !== undefined &&
        (!Number.isInteger(body.max_tokens) ||
          body.max_tokens < 1 ||
          body.max_tokens > 8192)) ||
      (body.temperature !== undefined &&
        (!Number.isFinite(body.temperature) ||
          body.temperature < 0 ||
          body.temperature > 2))
    ) {
      throw new BadRequestException(
        'Nội dung, model hoặc ứng dụng AI không hợp lệ',
      );
    }

    const apiKey = (
      process.env.AI_API_KEY ||
      process.env.TUVI_AI_API_KEY ||
      ''
    ).trim();
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message: 'Dịch vụ AI chưa được cấu hình.',
      });
    }
    const endpoint = resolveLocalAiBaseUrl(
      process.env.AI_BASE_URL || process.env.TUVI_AI_BASE_URL,
    );
    const reservation = await this.plansService.consumeQuota(user.id, quotaApp);
    let responseStarted = false;
    try {
      let upstream: globalThis.Response;
      try {
        upstream = await fetch(`${endpoint}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: body.model,
            messages,
            stream: true,
            ...(body.max_tokens !== undefined
              ? { max_tokens: body.max_tokens }
              : {}),
            ...(body.temperature !== undefined
              ? { temperature: body.temperature }
              : {}),
          }),
          signal: AbortSignal.timeout(90000),
        });
      } catch {
        throw new BadGatewayException({
          code: 'AI_UPSTREAM_ERROR',
          message: 'Không kết nối được dịch vụ AI.',
        });
      }
      if (!upstream.ok || !upstream.body) {
        throw new BadGatewayException({
          code: 'AI_UPSTREAM_ERROR',
          message: 'Dịch vụ AI chưa thể xử lý yêu cầu.',
        });
      }

      const quota = await this.plansService.checkQuota(user.id, quotaApp);
      res.status(200);
      res.setHeader(
        'Content-Type',
        upstream.headers.get('content-type') ||
          'text/event-stream; charset=utf-8',
      );
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Quota-Remaining', String(quota.remaining));
      responseStarted = true;
      for await (const chunk of upstream.body as any) {
        if (res.destroyed) break;
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      await this.plansService.refundQuota(
        user.id,
        reservation.app,
        reservation.date,
        reservation.usedBonus,
      );
      if (!responseStarted) throw error;
      if (!res.destroyed) {
        res.write(
          `data: ${JSON.stringify({ error: { code: 'AI_UPSTREAM_ERROR', message: 'Dịch vụ AI bị gián đoạn.' } })}\n\n`,
        );
        res.end();
      }
    }
  }

  // TuViNow uses the same SSO session and quota bucket as /plans/consume.
  @Get('tuvi-ai/config')
  @UseGuards(SsoAuthGuard)
  getTuviAiConfig() {
    const models = (process.env.TUVI_AI_MODELS || 'combo1')
      .split(',')
      .map((model) => model.trim())
      .filter(Boolean);
    const apiKey = process.env.TUVI_AI_API_KEY?.trim();
    return { models, configured: !!apiKey };
  }

  @Post('tuvi-ai')
  @UseGuards(SsoAuthGuard)
  async interpretTuvi(
    @CurrentUser() user: User,
    @Body() body: TuviAiDto,
  ) {
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
    const apiKey = process.env.TUVI_AI_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException({
        code: 'AI_NOT_CONFIGURED',
        message:
          'Dịch vụ luận giải Tử Vi chưa sẵn sàng. Bạn vẫn có thể sao chép prompt để sử dụng với AI khác.',
      });
    }
    const endpoint = resolveLocalAiBaseUrl(process.env.TUVI_AI_BASE_URL);
    // Charge once per submitted question, never again for an upstream retry.
    const reservation = await this.plansService.consumeQuota(
      user.id,
      'tuvinow',
    );
    try {
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
    } catch (error) {
      await this.plansService.refundQuota(
        user.id,
        reservation.app,
        reservation.date,
        reservation.usedBonus,
      );
      throw error;
    }
  }

  // POST /plans/bonus — Xin thêm 5 câu (Premium only)
  @Post('bonus')
  @UseGuards(SsoAuthGuard)
  async requestBonus(
    @CurrentUser() user: User,
    @Req() req: Request,
    @Body() body?: AppQuotaDto,
  ) {
    const app = this.extractAppName(req, body);
    const result = await this.plansService.requestBonus(user.id, app);
    const quota = await this.plansService.checkQuota(user.id, app);
    return { ...result, quota };
  }

  // POST /plans/apply-coupon — Nhập mã khuyến mãi
  @Post('apply-coupon')
  @UseGuards(SsoAuthGuard)
  async applyCoupon(
    @CurrentUser() user: User,
    @Body() body: ApplyCouponDto,
  ) {
    if (!body.code) {
      throw new UnauthorizedException('Vui lòng nhập mã khuyến mãi');
    }
    return this.plansService.applyCoupon(user.id, body.code);
  }

  // GET /plans/config — Lấy danh sách gói (public, không cần đăng nhập)
  @Get('config')
  async getPlansConfig() {
    const plans = await this.plansService.getAllPlans();
    return { plans };
  }
}

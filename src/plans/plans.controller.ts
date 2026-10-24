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
import {
  AppQuotaDto,
  ApplyCouponDto,
  PlansAiDto,
  TuviAiDto,
} from './dto/plan-write.dto';
import { resolveLocalAiBaseUrl } from './ai-upstream.util';

const DEFAULT_AI_MODELS = [
  'combo1',
  'openrouter/tencent/hy3:free',
  'openrouter/openai/gpt-oss-20b:free',
  'openrouter/poolside/laguna-xs-2.1:free',
  'openrouter/google/gemma-4-26b-a4b-it:free',
];

function getAllowedAiModels(): string[] {
  return (
    process.env.AI_MODELS ||
    [
      ...DEFAULT_AI_MODELS,
      ...(process.env.TUVI_AI_MODELS || '')
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean),
    ].join(',')
  )
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
}

function isExplicitSseErrorValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return value === true;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  return typeof value === 'object' && value !== null;
}

function hasAssistantDeltaContent(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) {
    return value.some((part) => {
      if (typeof part === 'string') return part.trim().length > 0;
      if (typeof part === 'object' && part !== null) {
        const text = (part as { text?: unknown }).text;
        return typeof text === 'string' && text.trim().length > 0;
      }
      return false;
    });
  }
  return false;
}

function createAiSseInspector() {
  const decoder = new TextDecoder('utf-8');
  let lineBuffer = '';
  let currentEvent = '';
  let currentDataLines: string[] = [];
  let hasAssistantContent = false;
  let hasExplicitError = false;

  const inspectParsedEvent = (parsed: unknown) => {
    if (typeof parsed !== 'object' || parsed === null) return;
    const record = parsed as Record<string, unknown>;
    if (
      isExplicitSseErrorValue(record.error) ||
      record.type === 'error' ||
      record.event === 'error' ||
      record.object === 'error'
    ) {
      hasExplicitError = true;
    }
    if (!Array.isArray(record.choices)) return;
    for (const choice of record.choices) {
      if (typeof choice !== 'object' || choice === null) continue;
      const choiceRecord = choice as Record<string, unknown>;
      if (
        isExplicitSseErrorValue(choiceRecord.error) ||
        choiceRecord.finish_reason === 'error' ||
        choiceRecord.finishReason === 'error'
      ) {
        hasExplicitError = true;
      }
      const delta =
        typeof choiceRecord.delta === 'object' && choiceRecord.delta !== null
          ? (choiceRecord.delta as Record<string, unknown>)
          : undefined;
      const message =
        typeof choiceRecord.message === 'object' &&
        choiceRecord.message !== null
          ? (choiceRecord.message as Record<string, unknown>)
          : undefined;
      if (
        hasAssistantDeltaContent(delta?.content) ||
        hasAssistantDeltaContent(message?.content) ||
        hasAssistantDeltaContent(choiceRecord.text)
      ) {
        hasAssistantContent = true;
      }
    }
  };

  const inspectDataPayload = (rawPayload: string): boolean => {
    const payload = rawPayload.trim();
    if (!payload || payload === '[DONE]') return true;
    try {
      const parsed: unknown = JSON.parse(payload);
      inspectParsedEvent(parsed);
      return true;
    } catch {
      return false;
    }
  };

  const flushEvent = () => {
    if (currentEvent === 'error') {
      hasExplicitError = true;
    }
    if (currentDataLines.length > 0) {
      const joined = currentDataLines.join('\n');
      if (!inspectDataPayload(joined) && currentDataLines.length > 1) {
        for (const dataLine of currentDataLines) {
          inspectDataPayload(dataLine);
        }
      }
    }
    currentEvent = '';
    currentDataLines = [];
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '') {
      flushEvent();
      return;
    }
    if (line.startsWith(':')) return;
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim().toLowerCase();
      if (currentEvent === 'error') {
        hasExplicitError = true;
      }
      return;
    }
    if (line.startsWith('data:')) {
      currentDataLines.push(line.slice(5).replace(/^ /, ''));
      return;
    }
    if (line.startsWith('id:') || line.startsWith('retry:')) return;
    inspectDataPayload(line);
  };

  const drainCompletedLines = () => {
    let newlineIndex = lineBuffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = lineBuffer.slice(0, newlineIndex);
      lineBuffer = lineBuffer.slice(newlineIndex + 1);
      processLine(rawLine);
      newlineIndex = lineBuffer.indexOf('\n');
    }
  };

  return {
    push(chunk: Uint8Array | string) {
      lineBuffer +=
        typeof chunk === 'string'
          ? chunk
          : decoder.decode(chunk, { stream: true });
      drainCompletedLines();
    },
    finish() {
      lineBuffer += decoder.decode();
      drainCompletedLines();
      if (lineBuffer.length > 0) {
        processLine(lineBuffer);
        lineBuffer = '';
      }
      flushEvent();
      return {
        hasAssistantContent,
        hasExplicitError,
        shouldRefund: hasExplicitError || !hasAssistantContent,
      };
    },
  };
}

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  private extractAppName(req: Request, body?: AppQuotaDto): string {
    const qApp = req.query.app as string;
    const bApp = body?.app;
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

  @Get('ai/config')
  @UseGuards(SsoAuthGuard)
  getAiConfig() {
    const apiKey = (
      process.env.AI_API_KEY ||
      process.env.TUVI_AI_API_KEY ||
      ''
    ).trim();
    return { models: getAllowedAiModels(), configured: !!apiKey };
  }

  // GET /plans/my-subscription — Thông tin gói hiện tại
  @Get('my-subscription')
  @UseGuards(SsoAuthGuard)
  async getMySubscription(@CurrentUser() user: User) {
    return this.plansService.getMySubscription(user.id);
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
    const allowedModels = getAllowedAiModels();
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
    let refunded = false;
    const refundOnce = async () => {
      if (refunded) return;
      refunded = true;
      await this.plansService.refundQuota(
        user.id,
        reservation.app,
        reservation.date,
        reservation.usedBonus,
      );
    };
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
      const sseInspector = createAiSseInspector();
      responseStarted = true;
      for await (const chunk of upstream.body) {
        if (res.destroyed) break;
        sseInspector.push(chunk);
        res.write(chunk);
      }
      if (sseInspector.finish().shouldRefund) {
        await refundOnce();
      }
      res.end();
    } catch (error) {
      await refundOnce();
      if (!responseStarted) throw error;
      if (!res.destroyed) {
        res.write(
          `data: ${JSON.stringify({ error: { code: 'AI_UPSTREAM_ERROR', message: 'Dịch vụ AI bị gián đoạn.' } })}\n\n`,
        );
        res.end();
      }
    }
  }

  // TuViNow uses the same SSO session and quota bucket as /plans/ai.
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
  @UseGuards(SsoAuthGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async interpretTuvi(@CurrentUser() user: User, @Body() body: TuviAiDto) {
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
  async applyCoupon(@CurrentUser() user: User, @Body() body: ApplyCouponDto) {
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

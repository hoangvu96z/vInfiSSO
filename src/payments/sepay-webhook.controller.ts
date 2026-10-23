import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SePayWebhookDto } from './dto/sepay-webhook.dto';
import { PaymentsService } from './payments.service';
import { verifySePaySignature } from './sepay-webhook.util';
import type { RequestWithRawBody } from '../security/request-body-parsers';

@Controller('payments/webhooks')
@UseGuards(ThrottlerGuard)
export class SePayWebhookController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
  ) {}

  @Post('sepay')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async handleSePayWebhook(
    @Body() payload: SePayWebhookDto,
    @Req() request: RequestWithRawBody,
    @Headers('x-sepay-timestamp') timestampHeader: string | undefined,
    @Headers('x-sepay-signature') signatureHeader: string | undefined,
  ): Promise<{ success: true }> {
    const rawBody = request.rawBody;
    const secret = this.configService.get<string>('SEPAY_WEBHOOK_SECRET');
    if (!secret?.trim()) {
      throw new ServiceUnavailableException({
        code: 'SEPAY_WEBHOOK_NOT_CONFIGURED',
        message: 'Webhook is not configured',
      });
    }
    if (!rawBody) {
      throw new BadRequestException({
        code: 'SEPAY_WEBHOOK_BODY_UNAVAILABLE',
        message: 'Webhook body is unavailable for signature verification',
      });
    }

    const verification = verifySePaySignature({
      secret,
      timestampHeader,
      signatureHeader,
      rawBody,
    });
    if (!verification.valid) {
      if (verification.reason === 'missing-body-or-headers') {
        throw new UnauthorizedException('Invalid SePay webhook signature');
      }
      if (verification.reason === 'stale-timestamp') {
        throw new UnauthorizedException('Stale SePay webhook timestamp');
      }
      if (verification.reason === 'invalid-timestamp') {
        throw new UnauthorizedException('Invalid SePay webhook timestamp');
      }
      throw new UnauthorizedException('Invalid SePay webhook signature');
    }

    // SePay's dashboard test-send uses transaction ID 0. Authenticate the
    // request, then acknowledge it without persisting or processing a payment.
    if (payload.id === 0) return { success: true };

    return this.paymentsService.processSePayWebhook(
      payload,
      rawBody,
      verification.timestamp,
      request.ip ?? null,
      request.get('user-agent') ?? null,
    );
  }
}

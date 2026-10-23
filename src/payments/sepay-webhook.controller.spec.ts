import { GUARDS_METADATA } from '@nestjs/common/constants';
import { createHmac } from 'node:crypto';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { validate } from 'class-validator';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { SePayWebhookController } from './sepay-webhook.controller';
import { SePayWebhookDto } from './dto/sepay-webhook.dto';

describe('SePayWebhookController security', () => {
  it('is public to SSO users but retains request throttling', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SePayWebhookController),
    ).toEqual([ThrottlerGuard]);
    const handler = Object.getOwnPropertyDescriptor(
      SePayWebhookController.prototype,
      'handleSePayWebhook',
    )?.value as object;
    expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(120);
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(
      60_000,
    );
  });

  it('fails closed without SEPAY_WEBHOOK_SECRET', async () => {
    const paymentsService = { processSePayWebhook: jest.fn() };
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    const controller = new SePayWebhookController(
      paymentsService as never,
      configService as never,
    );

    await expect(
      controller.handleSePayWebhook(
        {} as never,
        { rawBody: Buffer.from('{}') } as never,
        '1792713600',
        'sha256=bad',
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(paymentsService.processSePayWebhook).not.toHaveBeenCalled();
  });

  it('rejects an invalid signature before calling payment processing', async () => {
    const paymentsService = { processSePayWebhook: jest.fn() };
    const configService = { get: jest.fn().mockReturnValue('configured-key') };
    const controller = new SePayWebhookController(
      paymentsService as never,
      configService as never,
    );

    await expect(
      controller.handleSePayWebhook(
        {} as never,
        { rawBody: Buffer.from('{}') } as never,
        String(Math.floor(Date.now() / 1000)),
        `sha256=${'0'.repeat(64)}`,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(paymentsService.processSePayWebhook).not.toHaveBeenCalled();
  });

  it('acknowledges signed dashboard test sends with ID 0 without processing', async () => {
    const secret = 'configured-test-key';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const payload = {
      id: 0,
      gateway: 'Vietcombank',
      transactionDate: '2026-10-23 12:00:00',
      accountNumber: '001234567890',
      code: null,
      content: 'SePay dashboard test',
      transferType: 'in',
      transferAmount: 1,
    };
    await expect(
      validate(Object.assign(new SePayWebhookDto(), payload)),
    ).resolves.toHaveLength(0);
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex')}`;
    const paymentsService = { processSePayWebhook: jest.fn() };
    const configService = { get: jest.fn().mockReturnValue(secret) };
    const controller = new SePayWebhookController(
      paymentsService as never,
      configService as never,
    );

    await expect(
      controller.handleSePayWebhook(
        payload as never,
        {
          rawBody,
          ip: '203.0.113.10',
          get: jest.fn().mockReturnValue('SePay test sender'),
        } as never,
        timestamp,
        signature,
      ),
    ).resolves.toEqual({ success: true });
    expect(paymentsService.processSePayWebhook).not.toHaveBeenCalled();
  });
});

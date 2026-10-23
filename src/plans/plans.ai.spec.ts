import {
  BadGatewayException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlansAiDto } from './dto/plan-write.dto';
import { SsoAuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import type { Response } from 'express';

describe('PlansController POST /plans/ai', () => {
  it('requires authentication and limits each client to 10 requests per minute', () => {
    const handler = Object.getOwnPropertyDescriptor(
      PlansController.prototype,
      'proxyAi',
    )?.value as object;

    expect(Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]).toEqual(
      expect.arrayContaining([SsoAuthGuard, ThrottlerGuard]),
    );
    expect(Reflect.getMetadata(THROTTLER_LIMIT + 'default', handler)).toBe(10);
    expect(Reflect.getMetadata(THROTTLER_TTL + 'default', handler)).toBe(
      60_000,
    );
  });

  const consumeQuota = jest.fn();
  const checkQuota = jest.fn();
  const refundQuota = jest.fn();
  const originalFetch = global.fetch;
  const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
  const originalAiKey = process.env.AI_API_KEY;
  const originalTuviKey = process.env.TUVI_AI_API_KEY;
  const originalAiBaseUrl = process.env.AI_BASE_URL;
  const originalTuviAiBaseUrl = process.env.TUVI_AI_BASE_URL;
  let controller: PlansController;
  const user = Object.assign(new User(), { id: 'user-1' });
  const response: {
    status: jest.Mock;
    setHeader: jest.Mock;
    write: jest.Mock;
    end: jest.Mock;
    destroyed: boolean;
  } = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    destroyed: false,
  };
  const body: PlansAiDto = {
    app: 'iching',
    model: 'combo1',
    messages: [{ role: 'user', content: 'Question' }],
    stream: true,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.AI_API_KEY = 'test-key';
    delete process.env.TUVI_AI_API_KEY;
    delete process.env.AI_BASE_URL;
    delete process.env.TUVI_AI_BASE_URL;
    global.fetch = fetchMock;
    consumeQuota.mockResolvedValue({
      app: 'ichingnow',
      date: '2026-10-22',
      month: '2026-10',
      usedBonus: false,
    });
    checkQuota.mockResolvedValue({ remaining: 4 });
    controller = new PlansController({
      consumeQuota,
      checkQuota,
      refundQuota,
    } as unknown as PlansService);
  });

  afterAll(() => {
    global.fetch = originalFetch;
    if (originalAiKey === undefined) delete process.env.AI_API_KEY;
    else process.env.AI_API_KEY = originalAiKey;
    if (originalTuviKey === undefined) delete process.env.TUVI_AI_API_KEY;
    else process.env.TUVI_AI_API_KEY = originalTuviKey;
    if (originalAiBaseUrl === undefined) delete process.env.AI_BASE_URL;
    else process.env.AI_BASE_URL = originalAiBaseUrl;
    if (originalTuviAiBaseUrl === undefined)
      delete process.env.TUVI_AI_BASE_URL;
    else process.env.TUVI_AI_BASE_URL = originalTuviAiBaseUrl;
  });

  it('maps the public app alias onto the existing quota bucket and streams upstream chunks', async () => {
    const chunk = new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    );
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            stream.enqueue(chunk);
            stream.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    );

    await controller.proxyAi(user, body, response as unknown as Response);

    expect(consumeQuota).toHaveBeenCalledWith('user-1', 'ichingnow');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:20128/v1/chat/completions',
      expect.any(Object),
    );
    expect(checkQuota).toHaveBeenCalledWith('user-1', 'ichingnow');
    expect(response.setHeader).toHaveBeenCalledWith('X-Quota-Remaining', '4');
    expect(response.write).toHaveBeenCalledWith(chunk);
    expect(response.end).toHaveBeenCalled();
    expect(refundQuota).not.toHaveBeenCalled();
  });

  it('fails closed on a public AI endpoint before reserving quota', async () => {
    process.env.AI_BASE_URL = 'http://43.128.116.69:20128/v1';

    await expect(
      controller.proxyAi(user, body, response as unknown as Response),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(consumeQuota).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns an upstream failure before streaming and refunds the reserved quota', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      controller.proxyAi(user, body, response as unknown as Response),
    ).rejects.toBeInstanceOf(BadGatewayException);

    expect(consumeQuota).toHaveBeenCalledWith('user-1', 'ichingnow');
    expect(refundQuota).toHaveBeenCalledWith(
      'user-1',
      'ichingnow',
      '2026-10-22',
      false,
    );
    expect(response.status).not.toHaveBeenCalled();
    expect(response.write).not.toHaveBeenCalled();
  });

  it('does not call upstream and exposes a stable quota error when quota is exhausted', async () => {
    consumeQuota.mockRejectedValue(
      new ForbiddenException({ code: 'QUOTA_EXCEEDED' }),
    );

    try {
      await controller.proxyAi(user, body, response as unknown as Response);
      throw new Error('Expected quota rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual({
        code: 'QUOTA_EXCEEDED',
      });
    }

    expect(global.fetch).not.toHaveBeenCalled();
    expect(refundQuota).not.toHaveBeenCalled();
  });
});

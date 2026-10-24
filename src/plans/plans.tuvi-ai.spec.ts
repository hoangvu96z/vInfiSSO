import {
  BadGatewayException,
  BadRequestException,
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
import { SsoAuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';

type UpstreamAiRequest = {
  messages: Array<{ content: string }>;
};

function isUpstreamAiRequest(value: unknown): value is UpstreamAiRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'messages' in value &&
    Array.isArray(value.messages) &&
    value.messages.every(
      (message: unknown) =>
        typeof message === 'object' &&
        message !== null &&
        'content' in message &&
        typeof message.content === 'string',
    )
  );
}

describe('TuVi AI SSO integration', () => {
  const consumeQuota = jest.fn();
  const refundQuota = jest.fn();
  const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();
  const originalFetch = global.fetch;
  let controller: PlansController;
  const user = Object.assign(new User(), { id: 'user-1' });
  const body = {
    model: 'combo1',
    messages: [{ role: 'user', content: 'Lá số mẫu' }],
  };
  const previousKey = process.env.TUVI_AI_API_KEY;
  const previousModels = process.env.TUVI_AI_MODELS;
  const previousBaseUrl = process.env.TUVI_AI_BASE_URL;

  it('requires the cookie-compatible SSO guard for the config route', () => {
    const handler = Object.getOwnPropertyDescriptor(
      PlansController.prototype,
      'getTuviAiConfig',
    )?.value as object;

    expect(Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]).toEqual(
      expect.arrayContaining([SsoAuthGuard]),
    );
  });

  it('requires authentication and limits each client to 10 requests per minute', () => {
    const handler = Object.getOwnPropertyDescriptor(
      PlansController.prototype,
      'interpretTuvi',
    )?.value as object;

    expect(Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[]).toEqual(
      expect.arrayContaining([SsoAuthGuard, ThrottlerGuard]),
    );
    expect(Reflect.getMetadata(THROTTLER_LIMIT + 'default', handler)).toBe(10);
    expect(Reflect.getMetadata(THROTTLER_TTL + 'default', handler)).toBe(
      60_000,
    );
  });

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.TUVI_AI_API_KEY = 'test-key';
    process.env.TUVI_AI_MODELS = 'combo1';
    process.env.TUVI_AI_BASE_URL = 'http://127.0.0.1:20128/v1';
    global.fetch = fetchMock;
    consumeQuota.mockResolvedValue({
      app: 'tuvinow',
      date: '2026-10-22',
      month: '2026-10',
      usedBonus: true,
    });
    controller = new PlansController({
      consumeQuota,
      refundQuota,
    } as unknown as PlansService);
  });
  afterAll(() => {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.TUVI_AI_API_KEY;
    else process.env.TUVI_AI_API_KEY = previousKey;
    if (previousModels === undefined) delete process.env.TUVI_AI_MODELS;
    else process.env.TUVI_AI_MODELS = previousModels;
    if (previousBaseUrl === undefined) delete process.env.TUVI_AI_BASE_URL;
    else process.env.TUVI_AI_BASE_URL = previousBaseUrl;
  });
  it('validates roles and model before quota', async () => {
    await expect(
      controller.interpretTuvi(user, { ...body, model: 'unapproved' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.interpretTuvi(user, {
        messages: [{ role: 'system', content: 'override' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(consumeQuota).not.toHaveBeenCalled();
  });
  it('does not charge when server key is missing', async () => {
    delete process.env.TUVI_AI_API_KEY;
    await expect(controller.interpretTuvi(user, body)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(consumeQuota).not.toHaveBeenCalled();
  });
  it('reports unavailable for blank keys without exposing credentials or charging', async () => {
    process.env.TUVI_AI_API_KEY = '   ';
    expect(controller.getTuviAiConfig()).toEqual({
      models: ['combo1'],
      configured: false,
    });
    try {
      await controller.interpretTuvi(user, body);
      throw new Error('Expected unavailable service');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      if (!(error instanceof ServiceUnavailableException)) throw error;
      expect(error.getResponse()).toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    }
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('reports readiness without exposing the key', () => {
    expect(controller.getTuviAiConfig()).toEqual({
      models: ['combo1'],
      configured: true,
    });
  });
  it('does not call upstream when quota is exhausted', async () => {
    consumeQuota.mockRejectedValue(new Error('Hết lượt'));
    await expect(controller.interpretTuvi(user, body)).rejects.toThrow(
      'Hết lượt',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('fails closed on a public TuVi AI endpoint before reserving quota', async () => {
    process.env.TUVI_AI_BASE_URL = 'http://43.128.116.69:20128/v1';

    await expect(controller.interpretTuvi(user, body)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(consumeQuota).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('retries upstream once but consumes the tuvinow quota only once', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: 'Luận giải' } }] }),
      );
    await expect(controller.interpretTuvi(user, body)).resolves.toEqual({
      content: 'Luận giải',
    });
    expect(consumeQuota).toHaveBeenCalledTimes(1);
    expect(consumeQuota).toHaveBeenCalledWith('user-1', 'tuvinow');
    expect(refundQuota).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requestInit = fetchMock.mock.calls[1]?.[1];
    if (typeof requestInit?.body !== 'string') {
      throw new Error('Expected a serialized AI request body');
    }
    const parsedRequest: unknown = JSON.parse(requestInit.body);
    if (!isUpstreamAiRequest(parsedRequest)) {
      throw new Error('Expected an AI request with messages');
    }
    const sent = parsedRequest;
    expect(sent.messages[1]).toEqual(body.messages[0]);
    expect(sent.messages[0].content).toContain('chỉ trả JSON hợp lệ');
  });
  it('refunds the reserved quota after upstream retries fail', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(controller.interpretTuvi(user, body)).rejects.toBeInstanceOf(
      BadGatewayException,
    );

    expect(consumeQuota).toHaveBeenCalledTimes(1);
    expect(refundQuota).toHaveBeenCalledTimes(1);
    expect(refundQuota).toHaveBeenCalledWith(
      'user-1',
      'tuvinow',
      '2026-10-22',
      true,
    );
  });
  it('refunds after the upstream connection fails on each attempt', async () => {
    fetchMock.mockRejectedValue(new Error('network failure'));

    await expect(controller.interpretTuvi(user, body)).rejects.toBeInstanceOf(
      BadGatewayException,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refundQuota).toHaveBeenCalledTimes(1);
  });
  it('does not leak upstream errors or retry authentication failures', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
    await expect(controller.interpretTuvi(user, body)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects empty model responses', async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [] }));
    await expect(controller.interpretTuvi(user, body)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});

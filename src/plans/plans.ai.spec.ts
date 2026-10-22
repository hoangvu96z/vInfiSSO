import {
  BadGatewayException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { PlansAiDto } from './dto/plan-write.dto';

describe('PlansController POST /plans/ai', () => {
  const consumeQuota = jest.fn();
  const checkQuota = jest.fn();
  const refundQuota = jest.fn();
  const originalFetch = global.fetch;
  const originalAiKey = process.env.AI_API_KEY;
  const originalTuviKey = process.env.TUVI_AI_API_KEY;
  const originalAiBaseUrl = process.env.AI_BASE_URL;
  const originalTuviAiBaseUrl = process.env.TUVI_AI_BASE_URL;
  let controller: PlansController;
  const user = { id: 'user-1' } as any;
  const response = {
    status: jest.fn(),
    setHeader: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    destroyed: false,
  } as any;
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
    global.fetch = jest.fn() as unknown as typeof fetch;
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
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/event-stream' },
      body: (async function* () {
        yield chunk;
      })(),
    });

    await controller.proxyAi(user, body, response);

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
      controller.proxyAi(user, body, response),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(consumeQuota).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns an upstream failure before streaming and refunds the reserved quota', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
    });

    await expect(
      controller.proxyAi(user, body, response),
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
      await controller.proxyAi(user, body, response);
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

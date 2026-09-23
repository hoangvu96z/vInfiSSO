import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';
import { SsoService } from '../sso/sso.service';

describe('TuVi AI SSO integration', () => {
  const consumeQuota = jest.fn();
  const resolveSession = jest.fn();
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  let controller: PlansController;
  const req = { headers: { authorization: 'Bearer session' } } as any;
  const body = {
    model: 'combo1',
    messages: [{ role: 'user', content: 'Lá số mẫu' }],
  };
  const previousKey = process.env.TUVI_AI_API_KEY;
  const previousModels = process.env.TUVI_AI_MODELS;
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.TUVI_AI_API_KEY = 'test-key';
    process.env.TUVI_AI_MODELS = 'combo1';
    global.fetch = fetchMock;
    resolveSession.mockResolvedValue({ id: 'user-1' });
    consumeQuota.mockResolvedValue(undefined);
    controller = new PlansController(
      { consumeQuota } as unknown as PlansService,
      { resolveSession } as unknown as SsoService,
    );
  });
  afterAll(() => {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.TUVI_AI_API_KEY;
    else process.env.TUVI_AI_API_KEY = previousKey;
    if (previousModels === undefined) delete process.env.TUVI_AI_MODELS;
    else process.env.TUVI_AI_MODELS = previousModels;
  });
  it('requires a valid SSO session before consuming or calling AI', async () => {
    resolveSession.mockResolvedValue(null);
    await expect(controller.interpretTuvi(req, body)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('validates roles and model before quota', async () => {
    await expect(
      controller.interpretTuvi(req, { ...body, model: 'unapproved' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.interpretTuvi(req, {
        messages: [{ role: 'system', content: 'override' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(consumeQuota).not.toHaveBeenCalled();
  });
  it('does not charge when server key is missing', async () => {
    delete process.env.TUVI_AI_API_KEY;
    await expect(controller.interpretTuvi(req, body)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(consumeQuota).not.toHaveBeenCalled();
  });
  it('reports unavailable for blank keys without exposing credentials or charging', async () => {
    process.env.TUVI_AI_API_KEY = '   ';
    expect(controller.getTuviAiConfig()).toEqual({ models: ['combo1'], configured: false });
    try {
      await controller.interpretTuvi(req, body);
      throw new Error('Expected unavailable service');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.getResponse().code).toBe('AI_NOT_CONFIGURED');
    }
    expect(consumeQuota).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('public config reveals readiness but never the key', () => {
    expect(controller.getTuviAiConfig()).toEqual({ models: ['combo1'], configured: true });
  });
  it('does not call upstream when quota is exhausted', async () => {
    consumeQuota.mockRejectedValue(new Error('Hết lượt'));
    await expect(controller.interpretTuvi(req, body)).rejects.toThrow(
      'Hết lượt',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('retries upstream once but consumes the tuvinow quota only once', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'Luận giải' } }],
        }),
      });
    await expect(controller.interpretTuvi(req, body)).resolves.toEqual({
      content: 'Luận giải',
    });
    expect(consumeQuota).toHaveBeenCalledTimes(1);
    expect(consumeQuota).toHaveBeenCalledWith('user-1', 'tuvinow');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent.messages[1]).toEqual(body.messages[0]);
    expect(sent.messages[0].content).toContain('chỉ trả JSON hợp lệ');
  });
  it('does not leak upstream errors or retry authentication failures', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 401 });
    await expect(controller.interpretTuvi(req, body)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects empty model responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    });
    await expect(controller.interpretTuvi(req, body)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
});

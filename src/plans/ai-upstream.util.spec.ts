import { ServiceUnavailableException } from '@nestjs/common';
import {
  DEFAULT_LOCAL_AI_BASE_URL,
  resolveLocalAiBaseUrl,
} from './ai-upstream.util';

describe('resolveLocalAiBaseUrl', () => {
  it('defaults to the local AI endpoint and normalizes its trailing slash', () => {
    expect(resolveLocalAiBaseUrl()).toBe(DEFAULT_LOCAL_AI_BASE_URL);
    expect(resolveLocalAiBaseUrl(' http://127.0.0.1:20128/v1/ ')).toBe(
      DEFAULT_LOCAL_AI_BASE_URL,
    );
  });

  it.each([
    'http://43.128.116.69:20128/v1',
    'https://ai.example.test/v1',
    'http://localhost:20128/v1',
    'http://127.0.0.1:20129/v1',
    'http://127.0.0.1:20128/v2',
    'http://user:pass@127.0.0.1:20128/v1',
  ])('fails closed for non-approved endpoint %s', (endpoint) => {
    expect(() => resolveLocalAiBaseUrl(endpoint)).toThrow(
      ServiceUnavailableException,
    );
  });
});

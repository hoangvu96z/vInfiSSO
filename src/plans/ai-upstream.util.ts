import { ServiceUnavailableException } from '@nestjs/common';

export const DEFAULT_LOCAL_AI_BASE_URL = 'http://127.0.0.1:20128/v1';

/** Resolve only the local AI service endpoint; do not allow a remote fallback. */
export function resolveLocalAiBaseUrl(configured?: string): string {
  const candidate = configured?.trim() || DEFAULT_LOCAL_AI_BASE_URL;
  let endpoint: URL;

  try {
    endpoint = new URL(candidate);
  } catch {
    throw aiConfigurationError();
  }

  if (
    endpoint.protocol !== 'http:' ||
    endpoint.hostname !== '127.0.0.1' ||
    endpoint.port !== '20128' ||
    endpoint.pathname.replace(/\/+$/, '') !== '/v1' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw aiConfigurationError();
  }

  return DEFAULT_LOCAL_AI_BASE_URL;
}

function aiConfigurationError(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'AI_NOT_CONFIGURED',
    message: 'Dịch vụ AI chưa được cấu hình đúng.',
  });
}

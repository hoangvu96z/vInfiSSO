export function resolveAllowedRedirectUrl(
  rawUrl: string | undefined,
  allowedOrigins: Iterable<string>,
): URL | null {
  if (!rawUrl || rawUrl.length > 2048) return null;

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return null;
  }

  if (
    !['https:', 'http:'].includes(target.protocol) ||
    target.username ||
    target.password
  ) {
    return null;
  }

  const allowed = new Set(
    [...allowedOrigins].flatMap((origin) => {
      try {
        return [new URL(origin).origin];
      } catch {
        return [];
      }
    }),
  );

  return allowed.has(target.origin) ? target : null;
}

export function normalizeWebOrigin(
  rawOrigin: string | undefined,
): string | null {
  if (!rawOrigin) return null;
  try {
    const url = new URL(rawOrigin);
    if (
      !['https:', 'http:'].includes(url.protocol) ||
      url.origin !== rawOrigin
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

const PRODUCTION_REDIRECT_ORIGINS = [
  'https://vunph.id.vn',
  'https://www.vunph.id.vn',
  'https://vunph.click',
  'https://www.vunph.click',
];

const DEVELOPMENT_PORTS = [3000, 3001, 3002, 5173, 5174, 5175, 5176, 5177];

/**
 * Build the redirect and code-exchange allowlist. Local origins are defaults
 * only in non-production; an operator may still opt in to one explicitly.
 */
export function getOAuthRedirectOrigins(options: {
  isProduction: boolean;
  allowedRedirectOrigins?: string;
  allowedOrigins?: string;
  ssoBaseUrl?: string;
}): string[] {
  const configuredOrigins = [
    options.allowedRedirectOrigins,
    options.allowedOrigins,
  ].flatMap((value) =>
    (value || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  const ssoBaseUrl = options.ssoBaseUrl?.trim();
  const defaultSsoBase = options.isProduction ? [] : ['http://localhost:3000'];
  const ssoOrigins = ssoBaseUrl ? [ssoBaseUrl] : defaultSsoBase;
  const developmentOrigins = options.isProduction
    ? []
    : DEVELOPMENT_PORTS.flatMap((port) => [
        `http://localhost:${port}`,
        `http://127.0.0.1:${port}`,
      ]);

  return [
    ...configuredOrigins,
    ...ssoOrigins,
    ...PRODUCTION_REDIRECT_ORIGINS,
    ...developmentOrigins,
  ];
}

import { SSO_SESSION_ROTATION_HEADER } from '../auth/session-token.util';

/**
 * Return the CORS allowlist for browser requests.
 * An unset or empty allowlist disables cross-origin access instead of falling
 * back to a wildcard, which cannot be safely combined with credentialed SSO.
 */
export function getCorsOptions(
  environment: {
    ALLOWED_ORIGINS?: string;
    ALLOWED_REDIRECT_ORIGINS?: string;
  } = process.env,
) {
  const allowedOrigins = [
    environment.ALLOWED_ORIGINS,
    environment.ALLOWED_REDIRECT_ORIGINS,
  ]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Cookie',
      'x-guest-token',
    ],
    exposedHeaders: [SSO_SESSION_ROTATION_HEADER],
  };
}

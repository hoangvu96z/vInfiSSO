import { normalizeWebOrigin } from '../sso/oauth-redirect.util';
import { SSO_SESSION_COOKIE_NAME } from '../sso/session-cookie.util';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOGOUT_PATH = '/sso/logout';

export interface CsrfOriginConfiguration {
  ALLOWED_ORIGINS?: string;
  ALLOWED_REDIRECT_ORIGINS?: string;
  SSO_BASE_URL?: string;
  NODE_ENV?: string;
}

export interface CsrfRequestOriginInput {
  method: string;
  path: string;
  origin?: string;
  referer?: string;
  cookie?: string;
}

function refererOrigin(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function configuredSsoOrigin(
  configuration: CsrfOriginConfiguration,
): string | null {
  const value = configuration.SSO_BASE_URL?.trim();
  if (value) {
    try {
      const url = new URL(value);
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password
      ) {
        return url.origin;
      }
    } catch {
      return null;
    }
    return null;
  }

  return configuration.NODE_ENV === 'production'
    ? 'https://sso.vunph.click'
    : 'http://localhost:3000';
}

/** Match the exact browser origins admitted by credentialed CORS, plus SSO itself. */
export function getCsrfAllowedOrigins(
  configuration: CsrfOriginConfiguration = process.env,
): Set<string> {
  const values = [
    configuration.ALLOWED_ORIGINS,
    configuration.ALLOWED_REDIRECT_ORIGINS,
  ]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((origin) => origin.trim());

  const allowed = new Set(
    values
      .map((origin) => normalizeWebOrigin(origin))
      .filter((origin): origin is string => origin !== null),
  );
  const ssoOrigin = configuredSsoOrigin(configuration);
  if (ssoOrigin) allowed.add(ssoOrigin);
  return allowed;
}

function hasSessionCookie(cookieHeader: string | undefined): boolean {
  return (cookieHeader || '').split(';').some((entry) => {
    const separator = entry.indexOf('=');
    return (
      separator >= 0 &&
      entry.slice(0, separator).trim() === SSO_SESSION_COOKIE_NAME
    );
  });
}

function requiresOriginValidation(method: string, path: string): boolean {
  const normalizedMethod = method.toUpperCase();
  const normalizedPath = (path.replace(/\/+$/, '') || '/').toLowerCase();
  const isLogoutNavigation =
    normalizedPath === LOGOUT_PATH &&
    (normalizedMethod === 'GET' || normalizedMethod === 'HEAD');
  return !SAFE_METHODS.has(normalizedMethod) || isLogoutNavigation;
}

/**
 * Reject cross-site browser mutations while allowing origin-less server calls
 * only when they do not carry the ambient SSO session cookie.
 */
export function isCsrfOriginAllowed(
  input: CsrfRequestOriginInput,
  allowedOrigins: ReadonlySet<string>,
): boolean {
  if (!requiresOriginValidation(input.method, input.path)) return true;

  const hasCookie = hasSessionCookie(input.cookie);
  const hasOriginHeader = input.origin !== undefined;
  const hasRefererHeader = input.referer !== undefined;
  if (!hasCookie && !hasOriginHeader && !hasRefererHeader) return true;

  // Do not fall back to Referer if a present Origin is malformed or null.
  const sourceOrigin = hasOriginHeader
    ? normalizeWebOrigin(input.origin)
    : refererOrigin(input.referer);
  return sourceOrigin !== null && allowedOrigins.has(sourceOrigin);
}

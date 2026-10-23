import type { Request } from 'express';

const SESSION_COOKIE = 'sso_token';
export const SSO_SESSION_ROTATION_HEADER = 'X-Sso-Session-Token';

/** Extract the session token consistently from Bearer auth or the SSO cookie. */
export function extractSessionToken(req: Request): string | undefined {
  const authorization = req.headers.authorization;
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const token = authorization.slice(7).trim();
    if (token) return token;
  }

  for (const entry of (req.headers.cookie || '').split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== SESSION_COOKIE) {
      continue;
    }

    const value = entry.slice(separator + 1).trim();
    if (!value) return undefined;
    try {
      return decodeURIComponent(value) || undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

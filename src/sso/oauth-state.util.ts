import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions } from 'express';
import { resolveAllowedRedirectUrl } from './oauth-redirect.util';

export type OAuthProvider = 'google' | 'facebook';

export const OAUTH_STATE_MAX_AGE_MS = 5 * 60 * 1000;

interface OAuthStatePayload {
  version: 1;
  provider: OAuthProvider;
  state: string;
  redirectTo: string | null;
  expiresAt: number;
}

export interface OAuthStateGrant {
  state: string;
  cookieValue: string;
}

export interface RestoredOAuthState {
  redirectTo: URL | null;
}

export function getOAuthStateCookieName(provider: OAuthProvider): string {
  return `sso_oauth_state_${provider}`;
}

export function getOAuthStateCookieOptions(
  provider: OAuthProvider,
  nodeEnv?: string,
): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: nodeEnv === 'production',
    path: `/sso/oauth/${provider}`,
    maxAge: OAUTH_STATE_MAX_AGE_MS,
  };
}

export function getOAuthStateCookieClearOptions(
  provider: OAuthProvider,
  nodeEnv?: string,
): CookieOptions {
  const options = getOAuthStateCookieOptions(provider, nodeEnv);
  delete options.maxAge;
  return options;
}

function validateSecret(secret: string): void {
  if (typeof secret !== 'string' || secret.trim().length < 32) {
    throw new Error('OAuth state signing secret is not configured');
  }
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createOAuthStateGrant(
  provider: OAuthProvider,
  redirectTo: string | null,
  secret: string,
  now = Date.now(),
): OAuthStateGrant {
  validateSecret(secret);
  const payload: OAuthStatePayload = {
    version: 1,
    provider,
    state: randomBytes(32).toString('base64url'),
    redirectTo,
    expiresAt: now + OAUTH_STATE_MAX_AGE_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url',
  );

  return {
    state: payload.state,
    cookieValue: `${encodedPayload}.${sign(encodedPayload, secret)}`,
  };
}

export function restoreOAuthStateGrant(
  cookieValue: string | undefined,
  providedState: unknown,
  provider: OAuthProvider,
  secret: string,
  allowedRedirectOrigins: Iterable<string>,
  now = Date.now(),
): RestoredOAuthState | null {
  validateSecret(secret);
  if (
    !cookieValue ||
    cookieValue.length > 4096 ||
    typeof providedState !== 'string' ||
    !/^[A-Za-z0-9_-]{40,64}$/.test(providedState)
  ) {
    return null;
  }

  const parts = cookieValue.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0])) {
    return null;
  }

  const [encodedPayload, suppliedSignature] = parts;
  if (!/^[A-Za-z0-9_-]{43}$/.test(suppliedSignature)) return null;

  const expectedSignature = Buffer.from(sign(encodedPayload, secret));
  const actualSignature = Buffer.from(suppliedSignature);
  if (
    expectedSignature.length !== actualSignature.length ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    return null;
  }

  let payload: OAuthStatePayload;
  try {
    const json = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    if (Buffer.from(json).toString('base64url') !== encodedPayload) return null;
    payload = JSON.parse(json) as OAuthStatePayload;
  } catch {
    return null;
  }

  if (
    payload.version !== 1 ||
    payload.provider !== provider ||
    typeof payload.state !== 'string' ||
    payload.state !== providedState ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.expiresAt <= now ||
    payload.expiresAt > now + OAUTH_STATE_MAX_AGE_MS ||
    (payload.redirectTo !== null &&
      (typeof payload.redirectTo !== 'string' ||
        payload.redirectTo.length > 2048))
  ) {
    return null;
  }

  if (payload.redirectTo === null) return { redirectTo: null };

  const redirectTo = resolveAllowedRedirectUrl(
    payload.redirectTo,
    allowedRedirectOrigins,
  );
  return redirectTo ? { redirectTo } : null;
}

/** Parse an exact, unique cookie value without requiring cookie-parser. */
export function readUniqueCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;

  const matches = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;

  const value = matches[0].slice(name.length + 1);
  return value.length > 0 ? value : undefined;
}

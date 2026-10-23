import type { CookieOptions } from 'express';

export const SSO_SESSION_COOKIE_NAME = 'sso_token';

export interface SessionCookieConfiguration {
  nodeEnv?: string;
  /** Used only to expire a legacy Domain cookie during logout. */
  cookieDomain?: string;
}

function legacyCookieDomainFor({
  cookieDomain,
}: SessionCookieConfiguration): string | undefined {
  const configuredDomain = cookieDomain?.trim();
  return configuredDomain || undefined;
}

function baseCookieOptions(
  configuration: SessionCookieConfiguration,
): CookieOptions {
  const isProduction = configuration.nodeEnv === 'production';

  return {
    httpOnly: true,
    // Apps on vunph.id.vn call the API on sso.vunph.click. Lax cookies are
    // omitted from those cross-site fetches, so production requires None.
    // Keep local HTTP development on Lax because browsers require Secure with
    // SameSite=None.
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    path: '/',
  };
}

export function getSessionCookieOptions(
  configuration: SessionCookieConfiguration = {},
): CookieOptions {
  return {
    ...baseCookieOptions(configuration),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  };
}

/** Return the legacy parent-domain cookie tombstone, if one is configured. */
export function getLegacySessionCookieClearOptions(
  configuration: SessionCookieConfiguration = {},
): CookieOptions[] {
  const legacyDomain = legacyCookieDomainFor(configuration);
  return legacyDomain
    ? [{ ...baseCookieOptions(configuration), domain: legacyDomain }]
    : [];
}

/** Clear a legacy parent-domain cookie and the current host-only cookie. */
export function getSessionCookieClearOptions(
  configuration: SessionCookieConfiguration = {},
): CookieOptions[] {
  const base = baseCookieOptions(configuration);
  return [...getLegacySessionCookieClearOptions(configuration), base];
}

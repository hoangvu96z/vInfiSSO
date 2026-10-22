import type { CookieOptions } from 'express';

export const SSO_SESSION_COOKIE_NAME = 'sso_token';

export interface SessionCookieConfiguration {
  nodeEnv?: string;
  cookieDomain?: string;
}

function cookieDomainFor({ cookieDomain }: SessionCookieConfiguration):
  | string
  | undefined {
  const configuredDomain = cookieDomain?.trim();
  // The apps call the API on sso.vunph.click, so a host-only cookie is enough
  // and keeps it off unrelated hosts. Operators can override this if needed.
  return configuredDomain || undefined;
}

function baseCookieOptions(
  configuration: SessionCookieConfiguration,
): CookieOptions {
  const isProduction = configuration.nodeEnv === 'production';
  const domain = cookieDomainFor(configuration);

  return {
    httpOnly: true,
    // The app and SSO hosts are same-site under vunph.click, so Lax works for
    // credentialed fetches while keeping the cookie out of cross-site requests.
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    ...(domain ? { domain } : {}),
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

/** Clear both the new shared-domain cookie and the old host-only cookie. */
export function getSessionCookieClearOptions(
  configuration: SessionCookieConfiguration = {},
): CookieOptions[] {
  const base = baseCookieOptions(configuration);
  if (!base.domain) return [base];

  const { domain, ...hostOnlyOptions } = base;
  return [base, hostOnlyOptions];
}

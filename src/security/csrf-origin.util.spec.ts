import { getCsrfAllowedOrigins, isCsrfOriginAllowed } from './csrf-origin.util';

describe('CSRF origin validation for session-cookie requests', () => {
  const allowedOrigins = getCsrfAllowedOrigins({
    NODE_ENV: 'production',
    SSO_BASE_URL: 'https://sso.vunph.click',
    ALLOWED_ORIGINS: 'https://vunph.id.vn,https://www.vunph.id.vn',
    ALLOWED_REDIRECT_ORIGINS: 'https://vunph.click',
  });

  it.each([
    'https://vunph.id.vn',
    'https://www.vunph.id.vn',
    'https://vunph.click',
    'https://sso.vunph.click',
  ])(
    'accepts configured trusted origin %s for a cookie-backed mutation',
    (origin) => {
      expect(
        isCsrfOriginAllowed(
          {
            method: 'PATCH',
            path: '/sso/profile',
            origin,
            cookie: 'sso_token=session-token',
          },
          allowedOrigins,
        ),
      ).toBe(true);
    },
  );

  it('rejects an untrusted origin even when a session cookie is present', () => {
    expect(
      isCsrfOriginAllowed(
        {
          method: 'DELETE',
          path: '/readings/1',
          origin: 'https://attacker.example',
          cookie: 'sso_token=session-token',
        },
        allowedOrigins,
      ),
    ).toBe(false);
  });

  it('rejects a malformed Origin instead of falling back to a trusted Referer', () => {
    expect(
      isCsrfOriginAllowed(
        {
          method: 'POST',
          path: '/sso/logout',
          origin: 'null',
          referer: 'https://vunph.id.vn/settings',
          cookie: 'sso_token=session-token',
        },
        allowedOrigins,
      ),
    ).toBe(false);
  });

  it('uses the Referer origin only when Origin is absent', () => {
    expect(
      isCsrfOriginAllowed(
        {
          method: 'POST',
          path: '/sso/logout',
          referer: 'https://vunph.id.vn/settings',
          cookie: 'sso_token=session-token',
        },
        allowedOrigins,
      ),
    ).toBe(true);
  });

  it('allows origin-less unauthenticated server mutations', () => {
    expect(
      isCsrfOriginAllowed(
        { method: 'POST', path: '/contact/messages' },
        allowedOrigins,
      ),
    ).toBe(true);
  });

  it('rejects an origin-less cookie-backed mutation', () => {
    expect(
      isCsrfOriginAllowed(
        {
          method: 'POST',
          path: '/readings',
          cookie: 'other=value; sso_token=session-token',
        },
        allowedOrigins,
      ),
    ).toBe(false);
  });

  it('validates legacy GET logout because it revokes the current session', () => {
    expect(
      isCsrfOriginAllowed(
        {
          method: 'GET',
          path: '/sso/logout',
          origin: 'https://attacker.example',
          cookie: 'sso_token=session-token',
        },
        allowedOrigins,
      ),
    ).toBe(false);
    expect(
      isCsrfOriginAllowed(
        {
          method: 'GET',
          path: '/sso/logout',
          origin: 'https://vunph.id.vn',
          cookie: 'sso_token=session-token',
        },
        allowedOrigins,
      ),
    ).toBe(true);
  });

  it('also protects case-insensitive legacy logout paths', () => {
    expect(
      isCsrfOriginAllowed(
        {
          method: 'GET',
          path: '/SSO/LOGOUT/',
          origin: 'https://attacker.example',
          cookie: 'sso_token=session-token',
        },
        allowedOrigins,
      ),
    ).toBe(false);
  });

  it('leaves safe reads and OAuth callback GETs outside mutation checks', () => {
    expect(
      isCsrfOriginAllowed(
        {
          method: 'GET',
          path: '/sso/oauth/google/callback',
          cookie: 'sso_oauth_state_google=state',
        },
        allowedOrigins,
      ),
    ).toBe(true);
  });

  it('does not trust configured origins with paths, credentials, or non-web schemes', () => {
    const configured = getCsrfAllowedOrigins({
      ALLOWED_ORIGINS:
        'https://vunph.id.vn/path,https://user:pass@evil.example,javascript:alert(1)',
      SSO_BASE_URL: 'https://sso.vunph.click/base',
    });
    expect(configured).toEqual(new Set(['https://sso.vunph.click']));
  });
});

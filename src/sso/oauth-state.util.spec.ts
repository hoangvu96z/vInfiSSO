import {
  createOAuthStateGrant,
  getOAuthStateCookieClearOptions,
  getOAuthStateCookieName,
  getOAuthStateCookieOptions,
  OAUTH_STATE_MAX_AGE_MS,
  readUniqueCookie,
  restoreOAuthStateGrant,
} from './oauth-state.util';

const secret = 'stable-session-signing-secret-with-more-than-32-characters';
const allowedOrigins = ['https://app.example.test'];

describe('OAuth state persistence', () => {
  it.each(['google', 'facebook'] as const)(
    'round-trips the validated %s redirect with a provider-bound state cookie',
    (provider) => {
      const now = 1_800_000_000_000;
      const redirectTo =
        'https://app.example.test/reading/callback?view=weekly#result';
      const grant = createOAuthStateGrant(provider, redirectTo, secret, now);

      expect(grant.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(
        restoreOAuthStateGrant(
          grant.cookieValue,
          grant.state,
          provider,
          secret,
          allowedOrigins,
          now + OAUTH_STATE_MAX_AGE_MS - 1,
        ),
      ).toEqual({ redirectTo: new URL(redirectTo) });
      expect(getOAuthStateCookieName(provider)).toBe(
        `sso_oauth_state_${provider}`,
      );
      expect(getOAuthStateCookieOptions(provider, 'production')).toEqual(
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
          path: `/sso/oauth/${provider}`,
          maxAge: OAUTH_STATE_MAX_AGE_MS,
        }),
      );
      expect(
        getOAuthStateCookieClearOptions(provider, 'production'),
      ).not.toHaveProperty('maxAge');
    },
  );

  it('rejects changed, mismatched, expired, or disallowed callback state', () => {
    const now = 1_800_000_000_000;
    const grant = createOAuthStateGrant(
      'google',
      'https://app.example.test/callback',
      secret,
      now,
    );

    expect(
      restoreOAuthStateGrant(
        `${grant.cookieValue}x`,
        grant.state,
        'google',
        secret,
        allowedOrigins,
        now,
      ),
    ).toBeNull();
    expect(
      restoreOAuthStateGrant(
        grant.cookieValue,
        grant.state,
        'facebook',
        secret,
        allowedOrigins,
        now,
      ),
    ).toBeNull();
    expect(
      restoreOAuthStateGrant(
        grant.cookieValue,
        `${grant.state}x`,
        'google',
        secret,
        allowedOrigins,
        now,
      ),
    ).toBeNull();
    expect(
      restoreOAuthStateGrant(
        grant.cookieValue,
        grant.state,
        'google',
        secret,
        allowedOrigins,
        now + OAUTH_STATE_MAX_AGE_MS,
      ),
    ).toBeNull();
    expect(
      restoreOAuthStateGrant(
        grant.cookieValue,
        grant.state,
        'google',
        secret,
        ['https://other.example.test'],
        now,
      ),
    ).toBeNull();
  });

  it('fails closed when the callback contains a missing or duplicate state cookie', () => {
    const name = getOAuthStateCookieName('google');
    expect(readUniqueCookie(undefined, name)).toBeUndefined();
    expect(readUniqueCookie(`${name}=one; ${name}=two`, name)).toBeUndefined();
    expect(readUniqueCookie(`${name}=signed.value; other=ignored`, name)).toBe(
      'signed.value',
    );
  });
});

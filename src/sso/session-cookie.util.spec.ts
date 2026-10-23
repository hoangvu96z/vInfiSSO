import {
  getLegacySessionCookieClearOptions,
  getSessionCookieClearOptions,
  getSessionCookieOptions,
} from './session-cookie.util';

describe('SSO session cookie options', () => {
  it('uses a secure, cross-site, host-only production cookie', () => {
    expect(getSessionCookieOptions({ nodeEnv: 'production' })).toEqual({
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  });

  it('keeps local cookies host-only and usable over HTTP', () => {
    expect(getSessionCookieOptions({ nodeEnv: 'development' })).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  });

  it('never broadens a newly issued cookie to a parent domain', () => {
    expect(
      getSessionCookieOptions({
        nodeEnv: 'production',
        cookieDomain: '.vunph.click',
      }).domain,
    ).toBeUndefined();
  });

  it('only emits a parent-domain tombstone for legacy-cookie cleanup', () => {
    expect(
      getLegacySessionCookieClearOptions({
        nodeEnv: 'production',
        cookieDomain: '.vunph.click',
      }),
    ).toEqual([
      expect.objectContaining({
        domain: '.vunph.click',
        sameSite: 'none',
        secure: true,
      }),
    ]);
  });

  it('clears only the production host-only cookie by default', () => {
    expect(getSessionCookieClearOptions({ nodeEnv: 'production' })).toEqual([
      expect.objectContaining({
        path: '/',
        secure: true,
        sameSite: 'none',
        httpOnly: true,
      }),
    ]);
  });

  it('clears a configured legacy domain cookie and the host-only cookie', () => {
    const options = getSessionCookieClearOptions({
      nodeEnv: 'production',
      cookieDomain: '.vunph.click',
    });

    expect(options).toHaveLength(2);
    expect(options[0]).toEqual(
      expect.objectContaining({
        domain: '.vunph.click',
        path: '/',
        sameSite: 'none',
        secure: true,
      }),
    );
    expect(options[1]).not.toHaveProperty('domain');
  });

  it('clears only the host-only cookie when no domain is configured', () => {
    expect(getSessionCookieClearOptions({ nodeEnv: 'development' })).toEqual([
      expect.objectContaining({ path: '/', secure: false, sameSite: 'lax' }),
    ]);
  });
});

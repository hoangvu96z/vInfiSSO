import {
  getSessionCookieClearOptions,
  getSessionCookieOptions,
} from './session-cookie.util';

describe('SSO session cookie options', () => {
  it('uses a secure host-only production cookie by default', () => {
    expect(getSessionCookieOptions({ nodeEnv: 'production' })).toEqual({
      httpOnly: true,
      sameSite: 'lax',
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

  it('allows operators to override the production cookie domain', () => {
    expect(
      getSessionCookieOptions({
        nodeEnv: 'production',
        cookieDomain: '.vunph.click',
      }).domain,
    ).toBe('.vunph.click');
  });

  it('clears only the production host-only cookie by default', () => {
    expect(getSessionCookieClearOptions({ nodeEnv: 'production' })).toEqual([
      expect.objectContaining({
        path: '/',
        secure: true,
        sameSite: 'lax',
        httpOnly: true,
      }),
    ]);
  });

  it('clears both configured domain and legacy host-only cookies', () => {
    expect(
      getSessionCookieClearOptions({
        nodeEnv: 'production',
        cookieDomain: '.vunph.click',
      }),
    ).toEqual([
      expect.objectContaining({ domain: '.vunph.click', path: '/' }),
      expect.not.objectContaining({ domain: expect.anything() }),
    ]);
  });

  it('clears only the host-only cookie when no domain is configured', () => {
    expect(getSessionCookieClearOptions({ nodeEnv: 'development' })).toEqual([
      expect.objectContaining({ path: '/', secure: false, sameSite: 'lax' }),
    ]);
  });
});

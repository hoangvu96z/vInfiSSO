import {
  getOAuthRedirectOrigins,
  normalizeWebOrigin,
  resolveAllowedRedirectUrl,
} from './oauth-redirect.util';

describe('OAuth redirect allowlist', () => {
  const allowedOrigins = ['https://vunph.id.vn', 'http://localhost:5173'];

  it('keeps a path/query only for an explicitly allowed origin', () => {
    const target = resolveAllowedRedirectUrl(
      'https://vunph.id.vn/kinhdich/?from=sso',
      allowedOrigins,
    );
    expect(target?.toString()).toBe('https://vunph.id.vn/kinhdich/?from=sso');
  });

  it.each([
    'https://vunph.id.vn.evil.example/callback',
    'https://user:pass@vunph.id.vn/callback',
    'javascript:alert(1)',
    'not a URL',
  ])('rejects an unsafe destination: %s', (candidate) => {
    expect(resolveAllowedRedirectUrl(candidate, allowedOrigins)).toBeNull();
  });

  it('accepts only a canonical web Origin header', () => {
    expect(normalizeWebOrigin('https://vunph.id.vn')).toBe(
      'https://vunph.id.vn',
    );
    expect(normalizeWebOrigin('https://vunph.id.vn/')).toBeNull();
    expect(normalizeWebOrigin('null')).toBeNull();
  });

  it('allows loopback defaults only outside production', () => {
    const development = getOAuthRedirectOrigins({ isProduction: false });
    const production = getOAuthRedirectOrigins({ isProduction: true });

    expect(development).toContain('http://localhost:5173');
    expect(development).toContain('http://127.0.0.1:5173');
    expect(
      resolveAllowedRedirectUrl('http://localhost:5173/callback', production),
    ).toBeNull();
  });

  it('allows a production loopback origin only when explicitly configured', () => {
    const production = getOAuthRedirectOrigins({
      isProduction: true,
      allowedRedirectOrigins: 'http://localhost:5173',
    });

    expect(
      resolveAllowedRedirectUrl('http://localhost:5173/callback', production)
        ?.origin,
    ).toBe('http://localhost:5173');
  });

  it('keeps the id.vn app origins in the production callback allowlist', () => {
    const production = getOAuthRedirectOrigins({ isProduction: true });

    expect(production).toEqual(
      expect.arrayContaining([
        'https://vunph.id.vn',
        'https://www.vunph.id.vn',
      ]),
    );
    expect(
      resolveAllowedRedirectUrl('https://vunph.id.vn/kinhdich/', production)
        ?.origin,
    ).toBe('https://vunph.id.vn');
  });
});

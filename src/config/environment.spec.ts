import { validateApplicationEnvironment } from './environment';

const validEncryption = {
  DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 1).toString('base64')}`,
  DATA_ENCRYPTION_ACTIVE_KEY_ID: 'k1',
};

describe('validateApplicationEnvironment', () => {
  it('requires a 32-character SESSION_SECRET in production', () => {
    expect(() =>
      validateApplicationEnvironment({
        NODE_ENV: 'production',
        ...validEncryption,
      }),
    ).toThrow(/SESSION_SECRET must be a non-placeholder secret/);
    expect(() =>
      validateApplicationEnvironment({
        NODE_ENV: 'production',
        SESSION_SECRET: '  short  ',
        ...validEncryption,
      }),
    ).toThrow(/SESSION_SECRET must be a non-placeholder secret/);
  });

  it('rejects documented examples and common placeholder markers', () => {
    const placeholders = [
      'your-random-session-secret-min-32-chars',
      'another-random-string-min-32-chars',
      'GENERATE_WITH: openssl rand -hex 32',
      'change-me-012345678901234567890123456789',
      'replace_me_012345678901234567890123456789',
      'REPLACE_WITH_OUTPUT_OF_openssl_rand_hex_32',
    ];

    for (const SESSION_SECRET of placeholders) {
      expect(() =>
        validateApplicationEnvironment({
          NODE_ENV: 'production',
          SESSION_SECRET,
          ...validEncryption,
        }),
      ).toThrow(/SESSION_SECRET must be a non-placeholder secret/);
    }
  });

  it('accepts a sufficiently long production secret', () => {
    const environment = {
      NODE_ENV: 'production',
      SESSION_SECRET: 'a'.repeat(32),
      ...validEncryption,
    };

    expect(validateApplicationEnvironment(environment)).toBe(environment);
  });

  it('allows placeholder-like words away from the start when not a marker', () => {
    const environment = {
      NODE_ENV: 'production',
      SESSION_SECRET: 'secure-your-own-secret-012345678901234567890',
      ...validEncryption,
    };

    expect(validateApplicationEnvironment(environment)).toBe(environment);
  });

  it('does not require SESSION_SECRET outside production', () => {
    const environment = {
      NODE_ENV: 'development',
      ...validEncryption,
    };

    expect(validateApplicationEnvironment(environment)).toBe(environment);
  });
});

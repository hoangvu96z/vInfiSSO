import { isAllowedPaymentMutationOrigin } from './payment-origin.guard';

describe('isAllowedPaymentMutationOrigin', () => {
  it('accepts a same-origin browser mutation', () => {
    expect(
      isAllowedPaymentMutationOrigin({
        origin: 'https://sso.example.test',
        protocol: 'https',
        host: 'sso.example.test',
        allowedOrigins: [],
      }),
    ).toBe(true);
  });

  it('accepts a configured cross-origin app', () => {
    expect(
      isAllowedPaymentMutationOrigin({
        origin: 'https://app.example.test',
        protocol: 'https',
        host: 'sso.example.test',
        allowedOrigins: ['https://app.example.test'],
      }),
    ).toBe(true);
  });

  it.each([
    undefined,
    'null',
    'https://attacker.example.test',
    'https://app.example.test/path',
    'javascript:alert(1)',
  ])('rejects an absent, malformed, or untrusted Origin: %s', (origin) => {
    expect(
      isAllowedPaymentMutationOrigin({
        origin,
        protocol: 'https',
        host: 'sso.example.test',
        allowedOrigins: ['https://app.example.test'],
      }),
    ).toBe(false);
  });
});

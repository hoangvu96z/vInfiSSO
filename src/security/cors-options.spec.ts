import { getCorsOptions } from './cors-options';

describe('CORS options', () => {
  it('fails closed when no origins are configured', () => {
    const options = getCorsOptions({});

    expect(options.origin).toBe(false);
    expect(options.credentials).toBe(true);
  });

  it('uses only the configured application and redirect origins', () => {
    const options = getCorsOptions({
      ALLOWED_ORIGINS: 'https://app.example, http://localhost:5173,',
      ALLOWED_REDIRECT_ORIGINS: 'https://other.example',
    });

    expect(options.origin).toEqual([
      'https://app.example',
      'http://localhost:5173',
      'https://other.example',
    ]);
    expect(options.origin).not.toContain('*');
  });
});

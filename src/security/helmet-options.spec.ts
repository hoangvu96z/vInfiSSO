import express from 'express';
import helmet from 'helmet';
import request from 'supertest';
import { getHelmetOptions } from './helmet-options';

describe('Helmet security headers', () => {
  const makeApp = (isProduction: boolean) => {
    const app = express();
    app.use(helmet(getHelmetOptions(isProduction)));
    app.get('/ui/admin', (_req, res) => {
      res.type('html').send('<script>legacyAdminPage()</script>');
    });
    return app;
  };

  it('sets the compatibility-aware CSP and security headers in production', async () => {
    const response = await request(makeApp(true)).get('/ui/admin');
    const csp = response.headers['content-security-policy'];

    expect(response.status).toBe(200);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain('https://cdn.jsdelivr.net');
    expect(csp).toContain("script-src-attr 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
    expect(response.headers['strict-transport-security']).toContain(
      'max-age=31536000',
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['cross-origin-resource-policy']).toBe(
      'cross-origin',
    );
    expect(response.headers['referrer-policy']).toBe(
      'strict-origin-when-cross-origin',
    );
  });

  it('does not enable HSTS or upgrade-insecure-requests for local development', async () => {
    const response = await request(makeApp(false)).get('/ui/admin');
    const csp = response.headers['content-security-policy'];

    expect(response.status).toBe(200);
    expect(response.headers['strict-transport-security']).toBeUndefined();
    expect(csp).not.toContain('upgrade-insecure-requests');
  });
});

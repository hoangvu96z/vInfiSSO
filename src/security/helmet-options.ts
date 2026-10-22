import type { HelmetOptions } from 'helmet';

/**
 * CSP for the legacy login/register/app HTML and the compiled admin UI.
 *
 * The legacy login/register/app pages still use inline scripts, event handlers,
 * and styles, so those remain enabled until those pages are migrated. External
 * scripts and styles are limited to the same origin and Google Fonts; resource
 * types without an explicit source fall back to same-origin.
 */
export function getHelmetOptions(isProduction: boolean): HelmetOptions {
  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        // The legacy login/register/app pages attach inline event handlers.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    // Profile avatar URLs are consumed by the suite's other origins.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: isProduction
      ? { maxAge: 31_536_000, includeSubDomains: false }
      : false,
    xContentTypeOptions: true,
    xFrameOptions: { action: 'deny' },
  };
}

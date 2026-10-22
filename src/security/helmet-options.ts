import type { HelmetOptions } from 'helmet';
import type { Response } from 'express';

/**
 * CSP for the compiled admin UI and legacy demo pages.
 *
 * Inline scripts are allowed only when they carry the per-response nonce set by
 * main.ts. Inline event handlers are blocked. Inline styles remain enabled for
 * the legacy layouts; external scripts and styles are limited to same origin
 * and Google Fonts, while resource types without an explicit source fall back
 * to same-origin.
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
        scriptSrc: [
          "'self'",
          (_req, res) => {
            const nonce: unknown = (res as Response).locals.cspNonce;
            return typeof nonce === 'string' && nonce
              ? `'nonce-${nonce}'`
              : "'none'";
          },
        ],
        scriptSrcAttr: ["'none'"],
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

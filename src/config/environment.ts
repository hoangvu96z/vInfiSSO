import { validateReadingEncryptionEnvironment } from '../readings/reading-encryption';

const KNOWN_SESSION_SECRET_PLACEHOLDERS = new Set([
  'another-random-string-min-32-chars',
  'generate_with: openssl rand -hex 32',
]);

function isSessionSecretPlaceholder(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  return (
    KNOWN_SESSION_SECRET_PLACEHOLDERS.has(normalized) ||
    /^your(?:[-_\s]|$)/.test(normalized) ||
    /\b(?:change|replace)[-_\s]*(?:me|with)(?:\b|_)/.test(normalized)
  );
}

export function validateApplicationEnvironment<
  T extends Record<string, unknown>,
>(environment: T): T {
  validateReadingEncryptionEnvironment(environment);

  if (environment.NODE_ENV === 'production') {
    const sessionSecret =
      typeof environment.SESSION_SECRET === 'string'
        ? environment.SESSION_SECRET.trim()
        : '';
    if (
      sessionSecret.length < 32 ||
      isSessionSecretPlaceholder(sessionSecret)
    ) {
      throw new Error(
        'SESSION_SECRET must be a non-placeholder secret of at least 32 characters in production',
      );
    }
  }

  return environment;
}

// Existing process variables and .env retain precedence over deployment defaults.
export function getEnvFiles(environment = process.env.NODE_ENV): string[] {
  return environment === 'production' ? ['.env', '.env.production'] : ['.env'];
}

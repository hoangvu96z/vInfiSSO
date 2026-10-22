export function normalizeQuotaAppName(appName?: string): string {
  const normalized = appName?.trim().toLowerCase() || 'default';
  if (normalized === 'iching') return 'ichingnow';
  if (normalized === 'tarot') return 'tarotnow';
  if (normalized === 'tuvi') return 'tuvinow';
  return normalized;
}

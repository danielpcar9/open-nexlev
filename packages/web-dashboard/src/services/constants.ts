export const ALGORITHM_VERSION = '2026-10-23.e4-v1';
export const CHANNEL_ID = /^UC[\w-]{22}$/;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error != null && 'code' in error && String((error as { code: string }).code).startsWith('SQLITE_CONSTRAINT');
}

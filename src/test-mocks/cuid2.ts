export function isCuid(value: unknown): boolean {
  return typeof value === 'string' && /^[a-z0-9]+$/.test(value);
}

import { randomUUID } from 'node:crypto';

export const uuid = () => randomUUID();
export const now = () => new Date().toISOString();

export function shortId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/**
 * BR-1 — deterministic branch-name slugs.
 *
 * Auto-created refs (branch-on-act while detached) and derived legacy-lane
 * names both slug from the SAME source, in the same priority order, so live
 * sessions and `deriveBranches` produce consistent vocabulary:
 *   1. the commit's `cause.intent` (the human-facing "why"),
 *   2. else `field-value` when the value is a scalar,
 *   3. else the field alone,
 *   4. else the literal `'path'`.
 * Slugs are pure lowercase kebab (deterministic; inert data, R12 — never
 * parsed back). Uniqueness is a counter suffix: `name`, `name-2`, `name-3`…
 */

import type { CommitRecord } from '../log/index.js';

/** Lowercase kebab: first 4 words, capped at 32 chars, never a trailing dash. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w.length > 0)
    .slice(0, 4)
    .join('-')
    .slice(0, 32)
    .replace(/-+$/, '');
}

/** The deterministic base name for a ref born at `record` (see file header). */
export function slugForCommit(record: CommitRecord): string {
  const fromIntent = record.cause.intent === undefined ? '' : slugify(record.cause.intent);
  if (fromIntent !== '') return fromIntent;
  const v = record.value;
  const scalar = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
  const fromData = slugify(scalar ? `${record.field}-${String(v)}` : record.field);
  return fromData === '' ? 'path' : fromData;
}

/** `base` if free, else the first free `base-2`, `base-3`, … (deterministic). */
export function uniqueSlug(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  let n = 2;
  while (taken(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

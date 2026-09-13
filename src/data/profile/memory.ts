import type { Row } from '../types.js';
import { ProfileError } from './error.js';
import type { ProfileProvider, ProfileSchema, ProfileSourceRef } from './types.js';
import { normalizeSchema, sameSource } from './validate.js';

/** Snapshot a bounded array. Large sources should implement the streaming provider directly. */
export function createArrayProfileProvider(input: ProfileSchema, rows: readonly Row[]): ProfileProvider {
  const schema = normalizeSchema(input);
  if (!Array.isArray(rows) || rows.length > 1_000_000) throw new ProfileError('PROFILE_LIMIT', 'Array provider accepts at most 1000000 rows');
  const names = new Set(schema.columns.map(column => column.name));
  if (rows.length * schema.columns.length > 2_000_000) throw new ProfileError('PROFILE_LIMIT', 'Array snapshot exceeds 2000000 declared cells; use a streaming provider');
  let characters = 0;
  // Keep only declared cells; nested values are invalid at the read boundary, not coerced.
  const snapshot = rows.map(row => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new ProfileError('INVALID_VALUE', 'Array provider requires row objects');
    return Object.freeze(Object.fromEntries(schema.columns.map(column => {
      const descriptor = Object.getOwnPropertyDescriptor(row, column.name);
      if (descriptor && !('value' in descriptor)) throw new ProfileError('INVALID_VALUE', 'Array provider does not read accessors');
      const value: unknown = descriptor?.value;
      if (typeof value === 'string') {
        characters += value.length;
        if (characters > 8_000_000) throw new ProfileError('PROFILE_LIMIT', 'Array snapshot exceeds 8000000 string characters; use a streaming provider');
      }
      // No shared mutable cell handles, including cells not selected by a later plan.
      if ((typeof value === 'object' && value !== null) || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
        throw new ProfileError('INVALID_VALUE', `Array provider requires primitive cells: ${column.name}`);
      }
      return [column.name, value];
    })));
  });
  const check = (source: ProfileSourceRef) => sameSource(source, schema.source);
  return Object.freeze({
    describe(source: ProfileSourceRef) { check(source); return schema; },
    *scan(source: ProfileSourceRef, columns: readonly string[], signal?: AbortSignal) {
      check(source);
      for (const column of columns) if (!names.has(column)) throw new ProfileError('INVALID_PROFILE', `Unknown projected column: ${column}`);
      for (const row of snapshot) {
        if (signal?.aborted) throw new ProfileError('CANCELLED', 'Profile was cancelled');
        yield Object.fromEntries(columns.map(column => [column, row[column]]));
      }
    },
  });
}

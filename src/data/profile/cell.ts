import type { Cell } from '../../derive/types.js';
import { ProfileError } from './error.js';
import type { ProfileColumn } from './types.js';

/** Typed, normalized cells are shared by selection and reduction. Never coerce invalid data. */
export function profileCell(value: unknown, column: ProfileColumn): Cell {
  if (!['number', 'string', 'boolean'].includes(column.type)) {
    throw new ProfileError('INVALID_PROFILE', `Profiling ${column.type} columns is not supported: ${column.name}`);
  }
  if (value === null || value === undefined) return null;
  if (typeof value !== column.type || (typeof value === 'number' && !Number.isFinite(value))) {
    throw new ProfileError('INVALID_VALUE', `Invalid ${column.type} value in ${column.name}`);
  }
  if (typeof value === 'string' && value.length > 16_384) {
    throw new ProfileError('PROFILE_LIMIT', `Value in ${column.name} exceeds 16384 characters`);
  }
  return value as Cell;
}

import { judgeExpr } from '../../derive/judge.js';
import { OPS_VERSION } from '../../derive/types.js';
import { ProfileError } from './error.js';
import type { ProfilePlan, ProfileSchema, ProfileSourceRef } from './types.js';
import { PROFILE_QUANTILE_METHODS, PROFILE_STATISTICS } from './operations.types.js';

export const PROFILE_DEFAULT_LIMITS = Object.freeze({
  maxScannedRows: 1_000_000, maxExactValues: 100_000, maxDistinctValues: 128,
  maxRetainedValues: 1_000_000, maxRetainedCharacters: 1_000_000,
});
export const PROFILE_MAXIMUM_LIMITS = Object.freeze({ maxScannedRows: 10_000_000, maxExactValues: 1_000_000, maxDistinctValues: 4096,
  maxRetainedValues: 2_000_000, maxRetainedCharacters: 8_000_000 });
const statistics: readonly string[] = PROFILE_STATISTICS;

export function invalid(message: string): never { throw new ProfileError('INVALID_PROFILE', message); }

/** Bound and detach wire declarations before awaiting a provider or notifying an observer. */
export function declaration<T>(value: T): T {
  let nodes = 0, characters = 0;
  const active = new Set<object>();
  function copy(input: unknown, depth: number): unknown {
    if (++nodes > 20_000 || depth > 70) invalid('Declaration is too large or deeply nested');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input === 'string') {
      characters += input.length;
      if (input.length > 16_384 || characters > 262_144) invalid('Declaration text is too large');
      return input;
    }
    if (typeof input !== 'object' || input === null) invalid('Declarations must contain only finite JSON values');
    const array = Array.isArray(input);
    if (!array && Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) invalid('Declarations must contain plain objects');
    if (active.has(input)) invalid('Declarations cannot be cyclic');
    active.add(input);
    const keys = Reflect.ownKeys(input);
    if (keys.length > 20_000) invalid('Declaration has too many members');
    const entries: [string, unknown][] = [];
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') invalid('Declarations cannot contain symbol keys');
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      if (!('value' in descriptor) || !descriptor.enumerable) invalid('Declarations cannot contain accessors or hidden values');
      characters += key.length;
      if (characters > 262_144) invalid('Declaration text is too large');
      entries.push([key, copy(descriptor.value, depth + 1)]);
    }
    active.delete(input);
    if (array) {
      if (entries.length !== input.length || entries.some(([key], i) => key !== String(i))) invalid('Declaration arrays must be dense');
      return Object.freeze(entries.map(([, item]) => item));
    }
    return Object.freeze(Object.fromEntries(entries));
  }
  return copy(value, 0) as T;
}

export function record(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`);
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) if (!allowed.includes(key)) invalid(`Unknown ${label} property: ${key}`);
  return obj;
}
export function textId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) invalid(`${label} must be a nonempty string of at most 4096 characters`);
}
export function positiveLimit(value: unknown, label: string, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) invalid(`${label} must be an integer from 1 to ${max}`);
}
function source(value: unknown): asserts value is ProfileSourceRef {
  const obj = record(value, ['id', 'version'], 'source');
  textId(obj.id, 'source.id'); textId(obj.version, 'source.version');
}
export function sameSource(actual: ProfileSourceRef, expected: ProfileSourceRef): void {
  if (actual.id !== expected.id || actual.version !== expected.version) {
    throw new ProfileError('SOURCE_MISMATCH', 'Provider snapshot does not match the requested source and version');
  }
}

export function normalizePlan(input: ProfilePlan): ProfilePlan {
  const plan = declaration(input);
  const obj = record(plan, ['kind', 'version', 'ops', 'source', 'selectionRef', 'where', 'fields', 'quantileMethod', 'limits'], 'profile');
  if (obj.kind !== 'profile' || obj.version !== 1 || obj.ops !== OPS_VERSION) invalid('Unsupported profile kind, version, or expression vocabulary');
  source(obj.source); textId(obj.selectionRef, 'selectionRef');
  if (!Array.isArray(obj.fields) || obj.fields.length < 1 || obj.fields.length > 32) invalid('Profile requires 1 to 32 fields');
  const names = new Set<string>();
  let quantiles = false;
  for (const value of obj.fields) {
    const field = record(value, ['field', 'statistics', 'frequencies'], 'field');
    textId(field.field, 'field');
    if (names.has(field.field)) invalid(`Repeated field: ${field.field}`);
    names.add(field.field);
    if ('frequencies' in field && typeof field.frequencies !== 'boolean') invalid('frequencies must be boolean');
    if ('statistics' in field) {
      if (!Array.isArray(field.statistics) || field.statistics.length < 1 || field.statistics.length > statistics.length) invalid('statistics must be a nonempty list');
      const seen = new Set<string>();
      for (const stat of field.statistics) {
        if (typeof stat !== 'string' || !statistics.includes(stat) || seen.has(stat)) invalid('Unknown or repeated statistic');
        seen.add(stat);
        if (stat === 'median' || stat === 'p95') quantiles = true;
      }
    }
  }
  if ('quantileMethod' in obj && !(PROFILE_QUANTILE_METHODS as readonly unknown[]).includes(obj.quantileMethod)) invalid('Unsupported quantile method');
  if (quantiles && !obj.quantileMethod) invalid('median and p95 require an explicit quantileMethod');
  const limits: Record<keyof typeof PROFILE_DEFAULT_LIMITS, number> = { ...PROFILE_DEFAULT_LIMITS };
  if ('limits' in obj) {
    const overrides = record(obj.limits, Object.keys(limits), 'limits');
    for (const key of Object.keys(overrides) as (keyof typeof limits)[]) {
      const value = overrides[key];
      positiveLimit(value, key, PROFILE_MAXIMUM_LIMITS[key]); limits[key] = value;
    }
  }
  return Object.freeze({ ...plan, limits: Object.freeze(limits) });
}

export function normalizeSchema(input: ProfileSchema): ProfileSchema {
  const schema = declaration(input);
  const obj = record(schema, ['source', 'table', 'grain', 'columns'], 'schema');
  source(obj.source); textId(obj.table, 'table'); textId(obj.grain, 'grain');
  if (!Array.isArray(obj.columns) || obj.columns.length < 1 || obj.columns.length > 256) invalid('Schema requires 1 to 256 columns');
  const names = new Set<string>();
  for (const value of obj.columns) {
    const col = record(value, ['name', 'type', 'role', 'meaning', 'unit'], 'column');
    textId(col.name, 'column.name'); textId(col.meaning, 'column.meaning');
    if (names.has(col.name)) invalid(`Repeated column: ${col.name}`);
    names.add(col.name);
    if (!['number', 'string', 'boolean', 'date', 'unknown'].includes(col.type as string)) invalid('Unsupported column type');
    if (!['measure', 'dimension', 'identifier', 'absence'].includes(col.role as string)) invalid('Unsupported column role');
    if ('unit' in col) textId(col.unit, 'column.unit');
  }
  return schema;
}

export function validateSelection(plan: ProfilePlan, schema: ProfileSchema): readonly string[] {
  const columns = new Map(schema.columns.map(c => [c.name, c]));
  let reads: readonly string[] = [];
  if (plan.where !== undefined) {
    const judged = judgeExpr(plan.where, schema.table, schema.columns);
    if (!judged.ok) invalid(judged.problem);
    if (judged.type !== 'boolean') invalid('Profile where must produce a boolean');
    reads = judged.reads;
  }
  for (const name of [...reads, ...plan.fields.map(f => f.field)]) {
    const col = columns.get(name);
    if (!col) invalid(`Unknown column: ${name}`);
    if (!['number', 'string', 'boolean'].includes(col.type)) invalid(`Profiling ${col.type} columns is not supported: ${name}`);
  }
  for (const field of plan.fields) {
    const col = columns.get(field.field)!;
    if (field.statistics?.length && (col.type !== 'number' || col.role !== 'measure')) invalid(`Statistics require a numeric measure: ${field.field}`);
  }
  return reads;
}

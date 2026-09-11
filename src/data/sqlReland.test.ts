/**
 * sqlReland.test.ts — pins the STATEMENTS a reland runs, byte for byte. Every
 * string here is what the wasm engine will actually ask its backend, so a
 * change that reorders a join, drops the `IS NOT NULL`, or compares a column
 * the old table lacks fails here rather than as a wrong delta over a real
 * refresh — where "updated: 0" and "updated: everything" both look like numbers.
 */
import { describe, it, expect } from 'vitest';
import { RELAND_KEY_COLUMN, dropStagingSQL, emptyStagingSQL, relandSQL, stagingTableOf } from './sqlReland.js';
import { DELTA_SAMPLE } from './delta.js';
import type { ColumnInfo } from './types.js';

const col = (name: string, type: ColumnInfo['type'] = 'string'): ColumnInfo => ({ name, type });
const STAGING = stagingTableOf('cases');

/** The two CTEs every keyed statement opens with, for a key BOTH sides carry. */
const SIDES =
  'WITH __old AS (SELECT * FROM (SELECT *, CAST("id" AS VARCHAR) AS __key, ROW_NUMBER() OVER (PARTITION BY CAST("id" AS VARCHAR) ORDER BY "__row" ASC) AS __nth FROM "cases" WHERE "id" IS NOT NULL) WHERE __nth = 1), ' +
  '__new AS (SELECT * FROM (SELECT *, CAST("id" AS VARCHAR) AS __key, ROW_NUMBER() OVER (PARTITION BY CAST("id" AS VARCHAR) ORDER BY "__row" ASC) AS __nth FROM "__reland_cases" WHERE "id" IS NOT NULL) WHERE __nth = 1)';
const ADDED = 'FROM __new n LEFT JOIN __old o ON o.__key = n.__key WHERE o.__key IS NULL';
const REMOVED = 'FROM __old o LEFT JOIN __new n ON n.__key = o.__key WHERE n.__key IS NULL';
const UNKEYED = '(SELECT COUNT(*) FROM "cases") - (SELECT COUNT(*) FROM __old) + (SELECT COUNT(*) FROM "__reland_cases") - (SELECT COUNT(*) FROM __new)';

describe('the names', () => {
  it('the staging table and the sample column are prefixed like every other bookkeeping name, so a real column cannot be shadowed', () => {
    expect(STAGING).toBe('__reland_cases');
    expect(RELAND_KEY_COLUMN).toBe('__key');
    expect(DELTA_SAMPLE).toBe(20);
  });
});

describe('the replace, the drop, the empty version', () => {
  it('the replace COPIES the staging table, source-order column and all — never re-numbers it', () => {
    expect(relandSQL('cases', STAGING, undefined, { old: [], new: [] }).replace).toBe('CREATE OR REPLACE TABLE "cases" AS SELECT * FROM "__reland_cases"');
  });

  it('the drop is IF EXISTS, so the one statement tidies up after a landing that never happened', () => {
    expect(dropStagingSQL(STAGING)).toBe('DROP TABLE IF EXISTS "__reland_cases"');
    expect(relandSQL('cases', STAGING, 'id', { old: [col('id')], new: [col('id')] }).drop).toBe(dropStagingSQL(STAGING));
  });

  it('zero new rows keep the OLD schema — a staging table with the old columns and none of the rows', () => {
    expect(emptyStagingSQL('cases', STAGING)).toBe('CREATE OR REPLACE TABLE "__reland_cases" AS SELECT * FROM "cases" WHERE FALSE');
  });

  it('with no key there is no delta to ask for: the table is replaced, and how many rows did it was known before any statement ran', () => {
    expect(relandSQL('cases', STAGING, undefined, { old: [col('id')], new: [col('id')] })).toEqual({
      replace: 'CREATE OR REPLACE TABLE "cases" AS SELECT * FROM "__reland_cases"',
      drop: 'DROP TABLE IF EXISTS "__reland_cases"',
    });
  });
});

describe('the keyed delta — first row per key, in source order, on both sides', () => {
  const columns = { old: [col('id', 'number'), col('week', 'number'), col('cases', 'number')], new: [col('id', 'number'), col('week', 'number'), col('cases', 'number')] };

  it('counts: one row of five numbers, over the two first-occurrence CTEs', () => {
    expect(relandSQL('cases', STAGING, 'id', columns).delta?.counts).toBe(
      `${SIDES} SELECT (SELECT COUNT(*) ${ADDED}) AS added, ` +
        '(SELECT COUNT(*) FROM __new n JOIN __old o ON o.__key = n.__key WHERE (n."id" IS DISTINCT FROM o."id") OR (n."week" IS DISTINCT FROM o."week") OR (n."cases" IS DISTINCT FROM o."cases")) AS updated, ' +
        `(SELECT COUNT(*) ${REMOVED}) AS removed, ${UNKEYED} AS unkeyed, (SELECT COUNT(*) FROM __new) AS keyed`,
    );
  });

  it('samples: the RAW key, each list in ITS OWN table\'s source order, capped at DELTA_SAMPLE', () => {
    const samples = relandSQL('cases', STAGING, 'id', columns).delta?.samples;
    expect(samples).toEqual({
      added: `${SIDES} SELECT n."id" AS __key ${ADDED} ORDER BY n."__row" ASC LIMIT 20`,
      updated: `${SIDES} SELECT n."id" AS __key FROM __new n JOIN __old o ON o.__key = n.__key WHERE (n."id" IS DISTINCT FROM o."id") OR (n."week" IS DISTINCT FROM o."week") OR (n."cases" IS DISTINCT FROM o."cases") ORDER BY n."__row" ASC LIMIT 20`,
      removed: `${SIDES} SELECT o."id" AS __key ${REMOVED} ORDER BY o."__row" ASC LIMIT 20`,
    });
  });

  it('the source-order column is never compared, whichever side listed it', () => {
    const withRow = { old: [col('id'), col('v'), col('__row', 'number')], new: [col('id'), col('v'), col('__row', 'number')] };
    expect(relandSQL('cases', STAGING, 'id', withRow).delta?.counts).toContain('WHERE (n."id" IS DISTINCT FROM o."id") OR (n."v" IS DISTINCT FROM o."v")) AS updated');
  });
});

describe('what "different" means — deltaByKey\'s compare, said in SQL', () => {
  it('a column the new rows ADD is a difference on every shared key: the predicate is TRUE', () => {
    const grew = { old: [col('id'), col('v')], new: [col('id'), col('v'), col('extra')] };
    expect(relandSQL('cases', STAGING, 'id', grew).delta?.counts).toContain('ON o.__key = n.__key WHERE TRUE) AS updated');
  });

  it('a column the new rows DROP is stripped before the compare: only the shared columns are compared', () => {
    const shrank = { old: [col('id'), col('v'), col('gone')], new: [col('id'), col('v')] };
    expect(relandSQL('cases', STAGING, 'id', shrank).delta?.counts).toContain('WHERE (n."id" IS DISTINCT FROM o."id") OR (n."v" IS DISTINCT FROM o."v")) AS updated');
  });

  it('a column whose semantic TYPE moved is a difference on every shared key — never text-cast, which could read `1` and `\'1\'` as the same value; one whose type held (even a widened SQL type in the same bucket) is compared natively', () => {
    const moved = { old: [col('id', 'number'), col('v', 'string')], new: [col('id', 'number'), col('v', 'number')] };
    expect(relandSQL('cases', STAGING, 'id', moved).delta?.counts).toContain('ON o.__key = n.__key WHERE TRUE) AS updated');
    const widened = { old: [col('id', 'number'), col('v', 'number')], new: [col('id', 'number'), col('v', 'number')] };
    expect(relandSQL('cases', STAGING, 'id', widened).delta?.counts).toContain('WHERE (n."id" IS DISTINCT FROM o."id") OR (n."v" IS DISTINCT FROM o."v")) AS updated');
  });

  it('a key the NEW side lacks: that side is an EMPTY set with the same bookkeeping columns, every statement still binds, and keyed comes back 0', () => {
    const { counts, samples } = relandSQL('cases', STAGING, 'id', { old: [col('id'), col('v')], new: [col('v')] }).delta!;
    expect(counts).toContain('__new AS (SELECT *, NULL AS __key FROM "__reland_cases" WHERE FALSE)');
    expect(counts).toContain('WHERE (n."v" IS DISTINCT FROM o."v")) AS updated'); // the shared column is still compared — over a join that is empty
    expect(samples?.added).toContain('SELECT n.__key AS __key FROM __new n'); // the raw column does not exist on that side
    expect(samples?.removed).toContain('SELECT o."id" AS __key FROM __old o');
  });

  it('no shared column at all: nothing to compare, and the predicate says FALSE rather than rendering an empty OR', () => {
    expect(relandSQL('cases', STAGING, 'id', { old: [col('a')], new: [col('b')] }).delta?.counts).toContain('ON o.__key = n.__key WHERE TRUE) AS updated'); // `b` is added…
    expect(relandSQL('cases', STAGING, 'id', { old: [col('a')], new: [] }).delta?.counts).toContain('ON o.__key = n.__key WHERE FALSE) AS updated'); // …and here nothing is
  });

  it('a key the OLD side lacks: the mirror image — everything new is added, nothing is removed', () => {
    const { counts, samples } = relandSQL('cases', STAGING, 'id', { old: [col('v')], new: [col('id'), col('v')] }).delta!;
    expect(counts).toContain('WITH __old AS (SELECT *, NULL AS __key FROM "cases" WHERE FALSE)');
    expect(counts).toContain('ON o.__key = n.__key WHERE TRUE) AS updated'); // `id` is a column the new rows add
    expect(samples?.removed).toContain('SELECT o.__key AS __key FROM __old o');
  });

  it('identifiers are quoted, so a table or key with a double quote in it cannot break out of the statement', () => {
    const odd = relandSQL('ca"ses', stagingTableOf('ca"ses'), 'i"d', { old: [col('i"d')], new: [col('i"d')] });
    expect(odd.replace).toBe('CREATE OR REPLACE TABLE "ca""ses" AS SELECT * FROM "__reland_ca""ses"');
    expect(odd.delta?.key).toBe('i"d');
    expect(odd.delta?.counts).toContain('CAST("i""d" AS VARCHAR) AS __key');
  });
});

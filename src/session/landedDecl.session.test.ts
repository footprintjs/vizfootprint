/**
 * AN ACT DECLARES WHAT IT LANDS — end to end, from the act's own output to the
 * channel that judges the column.
 *
 * The finding, in one sentence: a declared table's column says what it IS, and
 * an act's landed column said only its type — so a RANK, which is an integer
 * and is not a magnitude, was read `continuous` and refused by every channel
 * that takes a column with distinct values. Three consumers in two days
 * repaired that with a hand-written declaration in the DEFINITION, about a
 * column the definition does not own.
 *
 * What is pinned here: the rank case in both directions (the whole packet in
 * one test), the four words arriving where a declared column's would, the
 * ownership rule and its refusal, and — broadly — that an act which declares
 * nothing is exactly what it was. The vocabulary's own door is
 * `../encoding/landedColumn.test.ts`; the facet fold is
 * `../encoding/encoding.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { flowChart } from 'footprintjs';
import { buildDashboard } from '../def/index.js';
import { defineAnalysis } from '../analysis/index.js';
import type { AnalysisModule, ColumnsOutput, DataRow, OutputColumn } from '../analysis/index.js';
import type { ColumnDecl } from '../encoding/index.js';
import type { Cause } from '../cause/index.js';
import type { DashboardDef } from '../def/index.js';
import { makeDashboardDef } from './dashboard.fixture.js';

const cause: Cause = { requestedBy: 'user', computedBy: 'user', intent: 'a test' };

/** The column every test here lands: a PLACE, one per row, spelled as an integer. */
const RANK = 'hotspot_rank';

/**
 * An act that really lands `RANK` — one integer per row, `1..n` — saying about
 * it exactly what it is handed. `{ type: 'int' }` alone is the world as it was
 * before an act could speak.
 */
function rankAct(landed: OutputColumn, id = 'ranker'): AnalysisModule<readonly DataRow[], ColumnsOutput> {
  return defineAnalysis<readonly DataRow[], ColumnsOutput>({
    id,
    kind: 'transform',
    produces: 'columns',
    inputs: [{ column: 'price', role: 'value' }],
    build: () =>
      flowChart<Record<string, unknown>>(
        'rank the rows',
        (scope) => {
          const args = scope.$getArgs<{ n: number }>();
          scope.$setValue(RANK, Array.from({ length: args.n }, (_, i) => i + 1));
        },
        'rank',
      ).build(),
    toRunInput: (rows) => ({ n: rows.length }),
    readOutput: () => ({ ok: true, output: { as: 'columns', table: 'data', columns: { [RANK]: landed } } }),
  });
}

/** The fixture def, with one act declared and (optionally) a definition entry for the same column. */
function defWithRank(landed: OutputColumn, declared?: ColumnDecl): DashboardDef {
  const base = makeDashboardDef();
  return {
    ...base,
    data: { data: { ...base.data['data']!, ...(declared === undefined ? {} : { columns: { [RANK]: declared } }) } },
    analyses: { ...base.analyses, ranker: rankAct(landed) },
  };
}

type Session = ReturnType<ReturnType<typeof buildDashboard>['createSession']>;

/** Land the act, then ask the `bar` view's x channel — which takes a column with DISTINCT values — to take the rank. */
async function bindRankToBarX(s: Session): Promise<{ readonly ok: boolean; readonly detail: string }> {
  const res = await s.dispatch({ verb: 'reencode', viewId: 'bar', bindings: { x: RANK }, cause });
  return { ok: res.ok, detail: res.ok ? '' : res.rejection.detail };
}

/** The facet the encoding plane folded for one column of the default table. */
async function facetOfRank(s: Session): Promise<Record<string, unknown> | undefined> {
  const over = await s.overview();
  return over.columns['data']?.find((f) => f.field === RANK) as Record<string, unknown> | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('the case that started this: a landed integer, and a channel that takes distinct values', () => {
  it('is REFUSED when the act says nothing beyond its type — the integer is read as a magnitude', async () => {
    const s = buildDashboard(defWithRank({ type: 'int' })).createSession();
    const landed = await s.declareAnalysis('ranker');
    expect(landed.materialized).toEqual([RANK]);

    expect(await facetOfRank(s)).toEqual({ field: RANK, type: 'number', scale: 'continuous' });
    const bound = await bindRankToBarX(s);
    expect(bound.ok).toBe(false);
    expect(bound.detail).toContain(RANK);
  });

  it('is ACCEPTED when the act declares the same integer a discrete dimension — same values, same act, same channel', async () => {
    const s = buildDashboard(defWithRank({ type: 'int', role: 'dimension', scale: 'discrete' })).createSession();
    const landed = await s.declareAnalysis('ranker');
    expect(landed.materialized).toEqual([RANK]);

    expect(await facetOfRank(s)).toEqual({ field: RANK, type: 'number', role: 'dimension', scale: 'discrete' });
    expect(await bindRankToBarX(s)).toEqual({ ok: true, detail: '' });
    expect(s.viewEncodings('bar')).toEqual({ x: RANK });
  });
});

describe('the landed column carries the four words where a declared column would', () => {
  it('role, scale, label and unit all arrive on the facet', async () => {
    const s = buildDashboard(
      defWithRank({ type: 'int', role: 'dimension', scale: 'discrete', label: 'the place a model gave this row', unit: 'place' }),
    ).createSession();
    await s.declareAnalysis('ranker');

    expect(await facetOfRank(s)).toEqual({
      field: RANK,
      type: 'number',
      role: 'dimension',
      scale: 'discrete',
      label: 'the place a model gave this row',
      unit: 'place',
    });
  });

  it("the act's own `type` is NOT a facet — the store's reading is what a chart sees", async () => {
    // `int` is the act's finer shape vocabulary; the values landed and the engine read them as
    // `number`, which is the type vocabulary a chart speaks.
    const s = buildDashboard(defWithRank({ type: 'int', role: 'dimension', scale: 'discrete' })).createSession();
    await s.declareAnalysis('ranker');
    expect((await facetOfRank(s))?.['type']).toBe('number');
  });
});

describe('an act that declares nothing is byte-identical to what it always was', () => {
  it('the facet, the registry row and the answer are exactly the pre-declaration ones', async () => {
    const s = buildDashboard(defWithRank({ type: 'int' })).createSession();
    const landed = await s.declareAnalysis('ranker');

    // the ANSWER
    expect(landed.materialized).toEqual([RANK]);
    expect(landed.gap).toBeUndefined();
    // the FACET — three keys, no role, and the scale the type has always implied
    const facet = await facetOfRank(s);
    expect(Object.keys(facet ?? {}).sort()).toEqual(['field', 'scale', 'type']);
    // the VALUES
    const rows = await s.viewQuery({ columns: ['id', RANK], limit: 3 });
    expect(rows.ok && rows.rows.map((r) => r[RANK])).toEqual([1, 2, 3]);
  });

  it('EVERY built-in columns act in the fixture still folds a facet with no declaration on it', async () => {
    // Broad rather than pinned to one act: the whole existing world is acts that say `{ type }`,
    // and none of them may gain a word.
    const s = buildDashboard(makeDashboardDef()).createSession();
    await s.declareAnalysis('clustering');
    const over = await s.overview();
    for (const facet of over.columns['data'] ?? []) {
      expect(Object.keys(facet).sort()).toEqual(['field', 'scale', 'type']);
      expect(facet.role).toBeUndefined();
    }
  });
});

describe('one column, one owner — a definition that also declares it is refused BY NAME', () => {
  it('names both places, lands nothing for that column, and says what to delete', async () => {
    const s = buildDashboard(
      defWithRank({ type: 'int', role: 'dimension', scale: 'discrete' }, { role: 'dimension', scale: 'discrete' }),
    ).createSession();
    const landed = await s.declareAnalysis('ranker');

    expect(landed.materialized).toEqual([]);
    expect(landed.gap?.detail).toBe(
      `analysis "ranker" lands column "${RANK}" on table "data" declares what it lands, and the definition declares "${RANK}" too — a column has ONE owner and the act owns the one it lands, so this column was not written. Delete the definition's entry for "${RANK}", or take the declaration off the act.`,
    );
    // AND IT IS REFUSED EVEN WHEN THE TWO AGREE: a definition entry nothing reads is one waiting to
    // be believed, and one that agrees today is one edit from disagreeing silently.
    expect(landed.gap?.code).toBe('guard-failed');
  });

  it('the SAME definition entry is untouched while the act says nothing — the def still owns it', async () => {
    const s = buildDashboard(
      defWithRank({ type: 'int' }, { role: 'dimension', scale: 'discrete', label: 'the definition’s word' }),
    ).createSession();
    const landed = await s.declareAnalysis('ranker');

    expect(landed.materialized).toEqual([RANK]);
    expect(await facetOfRank(s)).toEqual({ field: RANK, type: 'number', role: 'dimension', scale: 'discrete', label: 'the definition’s word' });
    expect(await bindRankToBarX(s)).toEqual({ ok: true, detail: '' });
  });
});

describe('a declaration the vocabulary does not admit is refused at the door that judges the act', () => {
  it('a scale nobody can read refuses in the vocabulary’s own words, and the column does not land', async () => {
    const s = buildDashboard(defWithRank({ type: 'int', scale: 'ordinal' as never })).createSession();
    const landed = await s.declareAnalysis('ranker');

    expect(landed.materialized).toEqual([]);
    expect(landed.gap?.detail).toBe(`analysis "ranker" lands column "${RANK}" on table "data" declares scale "ordinal" — a scale is one of discrete, continuous`);
  });

  it('a role nobody can read refuses the same way', async () => {
    const s = buildDashboard(defWithRank({ type: 'int', role: 'rank' as never })).createSession();
    const landed = await s.declareAnalysis('ranker');
    expect(landed.materialized).toEqual([]);
    expect(landed.gap?.detail).toBe(
      `analysis "ranker" lands column "${RANK}" on table "data" declares role "rank" — a role is one of identifier, dimension, measure, absence`,
    );
  });

  it('the act’s OTHER columns still get their turn — one bad declaration is one column', async () => {
    const base = makeDashboardDef();
    const two = defineAnalysis<readonly DataRow[], ColumnsOutput>({
      id: 'two',
      kind: 'transform',
      produces: 'columns',
      inputs: [{ column: 'price', role: 'value' }],
      build: () =>
        flowChart<Record<string, unknown>>(
          'land two',
          (scope) => {
            const args = scope.$getArgs<{ n: number }>();
            scope.$setValue(RANK, Array.from({ length: args.n }, (_, i) => i + 1));
            scope.$setValue('band', Array.from({ length: args.n }, (_, i) => `b${i % 3}`));
          },
          'land',
        ).build(),
      toRunInput: (rows) => ({ n: rows.length }),
      readOutput: () => ({
        ok: true,
        output: { as: 'columns', table: 'data', columns: { [RANK]: { type: 'int', scale: 'ordinal' as never }, band: { type: 'string' } } },
      }),
    });
    const s = buildDashboard({ ...base, analyses: { ...base.analyses, two } }).createSession();
    const landed = await s.declareAnalysis('two');
    expect(landed.materialized).toEqual(['band']);
  });
});

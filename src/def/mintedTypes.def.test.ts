/**
 * A MINTED COLUMN HAS A TYPE, AND THE DECLARATION ALREADY KNEW IT.
 *
 * One aggregate covers every rule at once: it groups by a declared string and
 * measures a `count`, a `sum` over a declared number, a `min` over a declared
 * date and a `max` over a column the parent never declared. The five types it
 * lands are the five answers — string, number, number, date, unknown — and the
 * rest of the file is the two doors that now judge them, in the sentences a
 * DECLARED column of the same type has always earned.
 */

import { describe, expect, it } from 'vitest';
import { mintedColumnNames, mintedTables } from './builtinAnalyses.js';
import { tableReachOf } from './tableReach.js';
import { validateDashboardDef } from './validate.js';
import { columnStanding } from '../links/index.js';
import type { DashboardDef, LayerDecl } from './types.js';

const SIGHTINGS = [
  { planet: 'mars', radius: 3.4, seen: '2020-01-01', murk: 'thin' },
  { planet: 'venus', radius: 6.1, seen: '2021-06-02', murk: 'thick' },
];

/** The parent: three columns TYPED, and `murk` deliberately declared with no type at all. */
const PARENT_COLUMNS = { planet: { type: 'string' }, radius: { type: 'number' }, seen: { type: 'date' }, murk: { role: 'dimension' } } as const;

/** The one act. Its four measures are the four rules, in the order the brief states them. */
const PER_PLANET = {
  builtin: 'aggregate',
  table: 'sightings',
  name: 'per_planet',
  ops: 1,
  groupBy: ['planet'],
  measures: [
    { as: 'sightings', expr: { op: 'count', args: [{ col: 'planet' }] } },
    { as: 'total_radius', expr: { op: 'sum', args: [{ col: 'radius' }] } },
    { as: 'first_seen', expr: { op: 'min', args: [{ col: 'seen' }] } },
    { as: 'widest_murk', expr: { op: 'max', args: [{ col: 'murk' }] } },
  ],
};

/** A def whose one view carries the layers it is handed. `columns` is swappable — `null` means the parent declares none — so the undeclared-parent case is the same def minus its types. */
function makeDef(layers: readonly LayerDecl[], extra: Partial<DashboardDef> = {}, columns: unknown = PARENT_COLUMNS): DashboardDef {
  return {
    meta: { title: 'sightings' },
    data: { sightings: { rows: SIGHTINGS, ...(columns === null ? {} : { columns }) } as never },
    actors: { per: { actor: 'user', label: 'Per planet' } },
    analyses: { perPlanet: PER_PLANET } as never,
    encodings: [{ viewId: 'per', chartKind: 'bar', channels: ['x', 'y'], layers: layers as LayerDecl[] }],
    defaultTable: 'sightings',
    ...extra,
  };
}

const barOn = (table: string, initial: Record<string, string>): LayerDecl => ({ layerId: 'bars', table, chartKind: 'bar', channels: ['x', 'y'], initial });

describe('the five types an aggregate lands', () => {
  it('a group column keeps the parent’s declared type; a fixed reducer yields its own; min/max yield what they reduce; an undeclared column is unknown', () => {
    expect(mintedTables(makeDef([])).get('per_planet')).toEqual({
      analysisId: 'perPlanet',
      columns: [
        { name: 'planet', type: 'string' }, // the group column IS the parent's column
        { name: 'sightings', type: 'number' }, // count says number whatever it counts
        { name: 'total_radius', type: 'number' }, // sum over a declared number
        { name: 'first_seen', type: 'date' }, // min yields the type it reduces — a date
        { name: 'widest_murk', type: 'unknown' }, // the parent declared the column but never its type
      ],
      key: 'planet',
    });
  });

  it('a parent that declares no columns lands five columns and no types — the honest answer, not a guess', () => {
    const minted = mintedTables(makeDef([], {}, null)).get('per_planet')!;
    // the two reducers whose `yields` row is FIXED still answer: they never needed the parent
    expect(minted.columns).toEqual([
      { name: 'planet', type: 'unknown' },
      { name: 'sightings', type: 'number' },
      { name: 'total_radius', type: 'number' },
      { name: 'first_seen', type: 'unknown' },
      { name: 'widest_murk', type: 'unknown' },
    ]);
  });

  it('a `columns` entry that is not a declaration, and a measure with no `as`, are read for what they say and nothing more', () => {
    // a malformed `columns` is refused by name on its own line (../encoding/shape.ts); here it is simply no evidence
    const bent = mintedTables(makeDef([], {}, { planet: 'string', radius: { type: 'number' } })).get('per_planet')!;
    expect(bent.columns[0]).toEqual({ name: 'planet', type: 'unknown' });
    expect(bent.columns[2]).toEqual({ name: 'total_radius', type: 'number' }); // the well-formed neighbour still counts
    // a measure record that never names the column it lands, lands nothing — the group column is the whole table
    const noAs = { ...PER_PLANET, measures: [{ expr: { op: 'count', args: [{ col: 'planet' }] } }] };
    expect(mintedTables({ data: { sightings: { columns: PARENT_COLUMNS } }, analyses: { perPlanet: noAs } }).get('per_planet')!.columns).toEqual([{ name: 'planet', type: 'string' }]);
  });

  it('the names are derived from the one list, never stored beside it', () => {
    expect(mintedColumnNames(mintedTables(makeDef([])).get('per_planet')!)).toEqual(['planet', 'sightings', 'total_radius', 'first_seen', 'widest_murk']);
  });
});

describe('the encoding door judges a minted type exactly as it judges a declared one', () => {
  it('a bar’s magnitude bound to a minted STRING is refused — and in the same words a declared string earns', () => {
    const minted = validateDashboardDef(makeDef([barOn('per_planet', { x: 'planet', y: 'planet' })]));
    // the same binding on the DECLARED parent, whose `planet` is a declared string: one sentence, one address
    const declared = validateDashboardDef(makeDef([barOn('sightings', { x: 'planet', y: 'planet' })]));
    expect(declared).toEqual(['encodings[0].layers[0].initial.y: "planet" is string; the y channel of a bar needs a number']);
    expect(minted).toEqual(declared); // NO new vocabulary for a minted column — the refusal it earns is the one its type earns
  });

  it('a bar’s magnitude bound to a minted NUMBER or a minted unknown is accepted', () => {
    expect(validateDashboardDef(makeDef([barOn('per_planet', { x: 'planet', y: 'total_radius' })]))).toEqual([]);
    // `unknown` keeps its present meaning: not judged. This is the pre-existing escape hatch, still reachable.
    expect(validateDashboardDef(makeDef([barOn('per_planet', { x: 'planet', y: 'widest_murk' })]))).toEqual([]);
  });

  it('a minted DATE on a bar’s magnitude is refused as a date, not as a mystery', () => {
    expect(validateDashboardDef(makeDef([barOn('per_planet', { x: 'planet', y: 'first_seen' })]))).toEqual([
      'encodings[0].layers[0].initial.y: "first_seen" is date; the y channel of a bar needs a number',
    ]);
  });

  it('a field the act does not land is still refused for EXISTENCE, in the sentence it always had', () => {
    expect(validateDashboardDef(makeDef([barOn('per_planet', { x: 'planet', y: 'ghost' })]))).toEqual([
      'encodings[0].layers[0].initial.y: "ghost" is not a column of the table',
    ]);
  });
});

describe('a logarithmic axis over a minted column', () => {
  /** A POSITION channel of a point layer — a bar's own magnitude is refused a logarithm by law 11c, whatever its type. */
  const pointOn = (y: string): LayerDecl => ({ layerId: 'dots', table: 'per_planet', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'total_radius', y } });
  // a frame on a view WITH layers states the resolution too; `y` is the axis under test
  const withLog = (y: string): string[] =>
    validateDashboardDef(makeDef([pointOn(y)], { encodings: [{ viewId: 'per', chartKind: 'point', channels: ['x', 'y'], frame: { y: { mode: 'shared', transform: 'log' } }, layers: [pointOn(y)] }] } as never));

  it('is accepted on a minted number', () => {
    expect(withLog('total_radius')).toEqual([]);
  });

  it('is refused on a minted string — by BOTH doors that read a type, each in its own existing sentence', () => {
    expect(withLog('planet')).toEqual([
      'encodings[0].frame.y: transform "log" needs a number — layer "dots" binds y to "planet", a string',
      'encodings[0].layers[0].initial.y: "planet" is string; the y channel of a point needs a number or a date',
    ]);
  });

  it('is not judged on a minted column the parent never typed — refused on evidence, never on ignorance', () => {
    expect(withLog('widest_murk')).toEqual([]);
  });
});

describe('the frame’s shared-scale law reads a minted type too (law 10)', () => {
  const mintedY: LayerDecl = { layerId: 'agg', table: 'per_planet', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'total_radius', y: 'total_radius' } };
  const declaredY: LayerDecl = { layerId: 'raw', table: 'sightings', chartKind: 'point', channels: ['x', 'y'], initial: { x: 'radius', y: 'planet' } };
  const shared = (layers: readonly LayerDecl[]): string[] =>
    validateDashboardDef(makeDef(layers, { encodings: [{ viewId: 'per', chartKind: 'point', channels: ['x', 'y'], frame: { y: { mode: 'shared' } }, layers }] } as never));

  it('one axis over a minted NUMBER and a declared STRING disagrees, in the law’s own sentence', () => {
    // exactly what law 10 exists to refuse, now reachable for a minted column because its type is known
    expect(shared([mintedY, declaredY])).toEqual([
      'encodings[0].frame.y: layer "raw" shares y with layer "agg" but y is a number on "agg" and a string on "raw"',
      'encodings[0].frame.y: layer "raw" shares y with layer "agg" but y is continuous on "agg" and discrete on "raw"',
      'encodings[0].layers[1].initial.y: "planet" is string; the y channel of a point needs a number or a date',
    ]);
  });

  it('…and agrees where both are numbers', () => {
    expect(shared([mintedY, { ...declaredY, initial: { x: 'radius', y: 'radius' } }])).toEqual([]);
  });
});

describe('reach still answers about EXISTENCE', () => {
  it('tableReachOf carries the minted column NAMES, and columnStanding reads them as before', () => {
    const reach = tableReachOf(makeDef([]));
    expect(reach.columns['per_planet']).toEqual(['planet', 'sightings', 'total_radius', 'first_seen', 'widest_murk']);
    expect(columnStanding('per_planet', 'total_radius', reach)).toBe('present');
    expect(columnStanding('per_planet', 'ghost', reach)).toBe('absent');
    expect(columnStanding('nobody', 'total_radius', reach)).toBe('undeclared');
  });
});

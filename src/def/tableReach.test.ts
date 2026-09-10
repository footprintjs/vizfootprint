/**
 * The ONE reader both reach doors share (`./tableReach.ts`): what a definition
 * says about its tables reaching one another. Total over `unknown`, because the
 * def door calls it on a RAW definition whose relations may not have been
 * judged yet.
 */
import { describe, expect, it } from 'vitest';
import { tableReachOf } from './tableReach.js';

const sum = { op: 'sum', args: [{ col: 'radius' }] };

describe('tableReachOf — the relations, and the columns of every table whose list is KNOWN', () => {
  it('reads the declared relations and skips every malformed one, without refusing anything', () => {
    const reach = tableReachOf({
      relations: [
        { from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' }, label: 'a tie' },
        'nope',
        { from: { table: 'edges' }, to: { table: 'nodes', column: 'id' } },
        { from: { table: 'edges', column: 'target' }, to: 42 },
      ],
    });
    expect(reach.relations).toEqual([{ from: { table: 'edges', column: 'source' }, to: { table: 'nodes', column: 'id' } }]);
  });

  it('a table an ACT mints knows its whole column list; a DECLARED table is judged by its declared columns', () => {
    const reach = tableReachOf({
      data: { measurements: { rows: [], columns: { planet: { role: 'dimension' }, radius: { role: 'measure' } } } },
      analyses: { radiiPerPlanet: { builtin: 'aggregate', table: 'measurements', name: 'radii_per_planet', ops: 1, groupBy: ['planet'], measures: [{ as: 'radii', expr: sum }] } },
    });
    expect(reach.columns).toEqual({ measurements: ['planet', 'radius'], radii_per_planet: ['planet', 'radii'] });
  });

  it('a DECLARED table that states no columns proves nothing — even against an act of the same name', () => {
    const reach = tableReachOf({
      data: { measurements: { rows: [] } },
      analyses: { shadow: { builtin: 'aggregate', table: 'measurements', name: 'measurements', ops: 1, groupBy: ['planet'], measures: [{ as: 'radii', expr: sum }] } },
    });
    expect(reach.columns).toEqual({}); // the declared name wins, and it says nothing
  });

  it('answers empty for a def that is not an object, and for one that declares neither', () => {
    expect(tableReachOf('nope')).toEqual({ relations: [], columns: {} });
    expect(tableReachOf({ meta: { title: 'x' } })).toEqual({ relations: [], columns: {} });
  });
});

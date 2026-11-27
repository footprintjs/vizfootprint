/**
 * D30 cases (base -> feature): mixed offsets/equal instants are silent -> participant counts;
 * canonical/default/non-temporal output stays exact; duplicates count occurrences, not pairs;
 * old Date objects/unknown cells are not string evidence; refresh has no cached answer;
 * independent axes gain no carrier; shuffled and calendar-edge cells match an independent oracle.
 * Real engine/adapter/renderer, protocol, visibility and precedence tests live beside their owners.
 */
import { describe, expect, it } from 'vitest';
import { frameDomains } from './frame.js';
import { dateOrderConflictOf } from '../def/index.js';

const mixed = ['2026-04-01T23:00:00-05:00', '2026-04-02T01:00:00Z', '2026-04-02T05:00:00Z'];
const fold = (values: readonly unknown[]) => frameDomains([{layerId:'series', chartKind:'line', channels:{x:{type:'date',values}}}]).x;
const witness = (values: readonly unknown[]) => (fold(values) as {dateOrder?:unknown} | undefined)?.dateOrder;
function oracle(cells: readonly unknown[]) {
  const values = cells.filter((cell):cell is string => typeof cell === 'string' && Number.isFinite(Date.parse(cell)));
  const seen = new Set<number>();
  for(let i=0;i<values.length;i++) for(let j=i+1;j<values.length;j++) {
    const a=values[i]!,b=values[j]!;
    if((a<b?-1:a>b?1:0)!==Math.sign(Date.parse(a)-Date.parse(b))) {seen.add(i);seen.add(j);}
  }
  return seen.size === 0 ? undefined : {compared:values.length,conflicted:seen.size};
}
describe('date order — one observed fact, no change to interval meaning', () => {
  it('counts the occurrences participating in a mixed-offset disagreement', () => {
    expect(witness(mixed)).toEqual({compared:3,conflicted:2});
    expect(fold(mixed)).toMatchObject({domain:[mixed[1],mixed[2]]});
  });
  it('counts distinct spellings of the same instant without changing first-read domain ties', () => {
    const cells=['2026-04-02T01:00:00Z','2026-04-01T20:00:00-05:00'];
    expect(witness(cells)).toEqual({compared:2,conflicted:2});
    expect(fold(cells)).toMatchObject({domain:[cells[0],cells[0]]});
  });
  it('counts repeated participants separately rather than counting pairs or unique values', () => {
    expect(witness([mixed[0],mixed[0],mixed[1],mixed[2]])).toEqual({compared:4,conflicted:3});
  });
  it('does not count Date objects, unreadable strings or absent cells as original strings', () => {
    const cells=[new Date(mixed[0]!),null,undefined,'invalid',...mixed];
    expect(witness(cells)).toEqual({compared:3,conflicted:2});expect(dateOrderConflictOf(cells)).toEqual({compared:3,conflicted:2});
  });
  it('retains canonical and absent/default frames byte for byte', () => {
    expect(fold(['2026-04-01','2026-04-02'])).toEqual({mode:'shared',basis:'table',guide:'merged',scale:'temporal',domain:['2026-04-01','2026-04-02']});
    expect(fold([null,'invalid'])).toBeUndefined();
    expect(witness(['2026-04-01','2026-04-01'])).toBeUndefined();
    expect(witness([])).toBeUndefined();
  });
  it('does not add an independent carrier or assess a categorical date-shaped label', () => {
    const layer={layerId:'series',channels:{x:{type:'date' as const,values:mixed}}};
    expect(frameDomains([layer],{x:{mode:'independent',guide:'per-layer'}}).x).toEqual({mode:'independent',guide:'per-layer'});
    expect(frameDomains([{layerId:'series',channels:{x:{type:'string',values:mixed}}}]).x).toEqual({mode:'shared',guide:'merged',basis:'table',scale:'categorical',domain:mixed});
  });
  it('does not carry a previous update into later canonical data', () => {
    expect(witness(mixed)).toBeDefined();
    expect(witness(['2026-04-01','2026-04-02'])).toBeUndefined();
  });
  it('agrees with the pairwise oracle through permutations, ties and calendar reading edges', () => {
    const edge=[...mixed,'2026-04-01T20:00:00-05:00','2026-02-30','2026-03-02','2026-03-01','2026-03-08T02:30:00','2026-03-08T03:00:00','-000001-01-01','0000-01-01','2026-01-01','invalid',null];
    let seed=1701;
    const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
    for(let i=0;i<512;i++) {const cells=Array.from({length:next()%15},()=>edge[next()%edge.length]);expect(witness(cells)).toEqual(oracle(cells));expect(dateOrderConflictOf(cells)).toEqual(oracle(cells));}
  });
});

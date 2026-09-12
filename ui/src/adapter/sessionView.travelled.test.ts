/**
 * `SelectionView.travelled` RIDES THE WIRE WHOLE OR NOT AT ALL —
 * `sessionView.ts` · `travelledOf`, the twin of `narrowedForOf` and read by
 * the same rule: an entry is carried when its required half is whole (a
 * `match` clause with a field and a values array; a `via` with a path of
 * two-ended relations and a number of rows), a malformed `label` only drops
 * the label, and when nothing survives the key is absent — never `{}`. Both
 * hosts pass through `mapSelections`, so both are pinned.
 */
import { describe, expect, it } from 'vitest';
import { createSessionView, sessionSource, mapPollState, type SessionLike, type RawPollState } from './sessionView.js';

const RADIUS_REF = { from: { table: 'planets', column: 'radius_ref' }, to: { table: 'references', column: 'ref' } };
const whole = {
  'by_year~references': { clause: { kind: 'match', field: 'ref', values: ['ref-A', 'ref-B'] }, via: { path: [RADIUS_REF], label: 'where the composite took its accepted radius from', rows: 3 }, label: 'Discoveries by year' },
  sheet: { clause: { kind: 'match', field: 'ref', values: [] }, via: { path: [RADIUS_REF], rows: 0 } },
};
const pick = { viewId: 'mass_radius~planets', field: 'pl_name', kind: 'match', value: { values: ['Kepler-22b'] } };
const selections = [
  { ...pick, viewId: 'whole', travelled: whole },
  // one whole entry beside the halves: a clause that is not a match, a values that is not a list, a path with an end missing (or half an end, or a null one), an empty path, a missing rows, a non-object, and a label that is not a name
  {
    ...pick,
    viewId: 'mixed',
    travelled: {
      years: whole['by_year~references'],
      point: { clause: { kind: 'point', field: 'ref', value: 'ref-A' }, via: { path: [RADIUS_REF], rows: 1 } },
      scalar: { clause: { kind: 'match', field: 'ref', values: 'ref-A' }, via: { path: [RADIUS_REF], rows: 1 } },
      halfHop: { clause: { kind: 'match', field: 'ref', values: ['ref-A'] }, via: { path: [{ from: RADIUS_REF.from }], rows: 1 } },
      halfEnd: { clause: { kind: 'match', field: 'ref', values: ['ref-A'] }, via: { path: [{ from: { table: 'planets' }, to: RADIUS_REF.to }], rows: 1 } },
      nullEnd: { clause: { kind: 'match', field: 'ref', values: ['ref-A'] }, via: { path: [{ from: RADIUS_REF.from, to: null }], rows: 1 } },
      noHop: { clause: { kind: 'match', field: 'ref', values: ['ref-A'] }, via: { path: [], rows: 1 } },
      noRows: { clause: { kind: 'match', field: 'ref', values: ['ref-A'] }, via: { path: [RADIUS_REF] } },
      junk: 'ref',
      named: { clause: { kind: 'match', field: 'ref', values: ['ref-A'] }, via: { path: [RADIUS_REF], label: 7, rows: 1 }, label: ['not', 'a', 'name'] },
    },
  },
  { ...pick, viewId: 'empty', travelled: { half: { clause: { kind: 'match', field: 'ref' } } } },
  { ...pick, viewId: 'junk', travelled: 'ref' },
  { ...pick, viewId: 'list', travelled: [whole['by_year~references']] },
  { ...pick, viewId: 'none' },
];
const RAW = { defaultTable: 'planets', records: [], views: [], activeSelections: selections, analyses: [], fdr: { procedure: 'LORD++', alpha: 0.05, tests: 0, discoveries: 0, wealth: 0, ledger: [] }, columns: {}, gaps: [], branches: [], bookmarks: [], cursor: null, head: null, cursorTests: 0, viewingPast: false } as unknown as RawPollState;

describe('`travelled` on a live selection rides through entry by entry, each only when the wire carried it WHOLE', () => {
  const s = mapPollState(RAW);
  const by = (viewId: string) => s.selections.find((x) => x.viewId === viewId)!;

  it('every whole entry — a match clause, a path of two-ended relations, a number of rows, labels that are strings or none — carried as-is, keyed by the consumer\'s address', () => {
    expect(by('whole').travelled).toEqual(whole);
    expect('label' in by('whole').travelled!['sheet']!.via).toBe(false); // no relation label on the wire = none here, never invented
    expect('label' in by('whole').travelled!['sheet']!).toBe(false); // …and no consumer label either
  });

  it('half an entry is dropped; a label that is not a name only drops THAT label — the relation\'s and the consumer\'s each on its own', () => {
    expect(by('mixed').travelled).toEqual({
      years: whole['by_year~references'],
      named: { clause: { kind: 'match', field: 'ref', values: ['ref-A'] }, via: { path: [RADIUS_REF], rows: 1 } },
    });
    expect('label' in by('mixed').travelled!['named']!.via).toBe(false);
    expect('label' in by('mixed').travelled!['named']!).toBe(false);
  });

  it('nothing whole, a non-object, a list, or nothing at all — NO key, never `undefined` and never `{}`', () => {
    for (const viewId of ['empty', 'junk', 'list', 'none']) expect('travelled' in by(viewId), viewId).toBe(false);
  });

  it('the in-process session host comes through the same reader — both hosts, one law; a CLEARED source carries it the same way', async () => {
    const session = {
      commits: () => [],
      overview: () => ({ defaultTable: 'planets', views: [], activeSelections: selections, clearedSelections: [{ ...selections[0], viewId: 'gone', clearedBy: 's9' }, { ...selections[2], viewId: 'gone-empty', clearedBy: 's9' }], analyses: [], fdr: { procedure: 'LORD++', alpha: 0.05, tests: 0, discoveries: 0, wealth: 0, ledger: [] }, columns: {}, encodings: {}, gaps: 0, currentView: null, engines: {}, time: { cursor: null, head: null, branches: 0, bookmarks: 0, cursorTests: 0, viewingPast: false }, paths: { current: 'main', detachedAt: null, list: [], events: [] } }),
      gaps: () => [],
      branches: () => [],
      bookmarkViews: () => [],
      paths: () => [],
    } as unknown as SessionLike;
    const view = createSessionView(sessionSource(session));
    await view.refresh();
    const state = view.getState();
    const at = (viewId: string) => state.selections.find((x) => x.viewId === viewId)!;
    expect(at('whole').travelled).toEqual(whole);
    for (const viewId of ['empty', 'junk', 'list', 'none']) expect('travelled' in at(viewId), viewId).toBe(false);
    expect(state.cleared!.find((c) => c.viewId === 'gone')!.travelled).toEqual(whole);
    expect('travelled' in state.cleared!.find((c) => c.viewId === 'gone-empty')!).toBe(false);
    view.dispose();
  });

  it('the link graph\'s edges come through verbatim, `via` included', () => {
    const edge = { id: 'a:point→b', source: 'a', kind: 'point', target: 'b', response: 'filter', origin: 'default', via: [RADIUS_REF] };
    const st = mapPollState({ ...RAW, links: { default: 'crossfilter', views: [], edges: [edge] } } as unknown as RawPollState);
    expect(st.links?.edges[0]?.via).toEqual([RADIUS_REF]);
  });
});

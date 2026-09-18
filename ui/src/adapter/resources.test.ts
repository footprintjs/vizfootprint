/**
 * The wire carries the declared RESOURCES — a declared source that is NOT a
 * table (`vizfootprint/source`): the facts (never a payload), and a commit
 * standing on bytes the dashboard has since re-fetched, marked exactly as a
 * moved data version is.
 */
import { describe, it, expect } from 'vitest';
import { createSessionView, mapPollState, sessionSource, type RawPollState } from './sessionView.js';
import { buildDashboard } from 'vizfootprint/def';
import { makeDashboardDef } from '../../../src/session/dashboard.fixture.js';

const PDB = 'HEADER    COMPLEX (ENZYME/INHIBITOR)              14-NOV-97   1AY7\nATOM      1  N   ILE A   1\n';

describe('mapPollState — the declared resources', () => {
  it('keeps well-formed rows (with or without a locator), drops malformed ones, and reads nothing from a missing or non-object field', () => {
    const state = mapPollState({
      records: [],
      resources: {
        structure: { format: 'text', via: 'http', at: 'https://x/1ay7.pdb', version: 'etag:"v1"', retrievedAt: '2026-09-17T00:00:00.000Z', bytes: 171236 },
        logo: { format: 'bytes', via: 'inline', version: 'inline:2-abcd1234', retrievedAt: '2026-09-17T00:00:00.000Z', bytes: 2 },
        broken: { format: 'text', bytes: 'lots' },
      },
    });
    expect(state.resources).toEqual({
      structure: { format: 'text', via: 'http', at: 'https://x/1ay7.pdb', version: 'etag:"v1"', retrievedAt: '2026-09-17T00:00:00.000Z', bytes: 171236 },
      logo: { format: 'bytes', via: 'inline', version: 'inline:2-abcd1234', retrievedAt: '2026-09-17T00:00:00.000Z', bytes: 2 },
    });
    expect(mapPollState({ records: [] }).resources).toBeUndefined();
    expect(mapPollState({ records: [], resources: 'nope' }).resources).toBeUndefined();
  });

  it('carries the ONE state word when the wire says it, and never invents it', () => {
    // bytes on the wire right now: the facts beside the word are the ones the dashboard HOLDS
    const arriving = mapPollState({
      records: [],
      resources: {
        structure: { format: 'text', via: 'http', at: 'https://x/1ay7.pdb', version: 'etag:"v1"', retrievedAt: '2026-09-17T00:00:00.000Z', bytes: 171236, state: 'arriving' },
        logo: { format: 'bytes', via: 'inline', version: 'v1', retrievedAt: 'now', bytes: 2 },
        nonsense: { format: 'text', via: 'http', version: 'v1', retrievedAt: 'now', bytes: 1, state: 'landed' },
      },
    } as RawPollState);
    expect(arriving.resources!.structure!.state).toBe('arriving');
    expect('state' in arriving.resources!.logo!).toBe(false); // absent = simply held
    expect('state' in arriving.resources!.nonsense!).toBe(false); // a word this vocabulary does not have is not carried
  });

  it('there is no payload key to carry, even when a wire tries to send one', () => {
    const state = mapPollState({
      records: [],
      resources: { structure: { format: 'text', via: 'inline', version: 'v1', retrievedAt: 'now', bytes: 2, body: PDB } },
    });
    expect(JSON.stringify(state.resources)).not.toContain('HEADER');
    expect(Object.keys(state.resources!.structure!)).toEqual(['format', 'via', 'version', 'retrievedAt', 'bytes']);
  });
});

describe('mapPollState — a commit true of bytes that have moved', () => {
  it('is marked when the resource has since moved; a current one is not; no stamp = no mark; no provenance = nothing judged', () => {
    const resources = { structure: { format: 'text', via: 'http', version: 'etag:"v2"', retrievedAt: 'now', bytes: 4 } };
    const records: RawPollState['records'] = [
      { id: 's1', parent: null, viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Formal', cause: { requestedBy: 'user' }, resources: { structure: 'etag:"v1"' } },
      { id: 's2', parent: 's1', viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Work', cause: { requestedBy: 'user' }, resources: { structure: 'etag:"v2"' } },
      { id: 's3', parent: 's2', viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Party', cause: { requestedBy: 'user' } },
      { id: 's4', parent: 's3', viewId: 'bar', kind: 'point' as const, field: 'category', value: 'Casual', cause: { requestedBy: 'user' }, resources: { elsewhere: 'v9' } },
    ];
    const state = mapPollState({ records, resources });
    expect(state.commits.map((c) => [c.id, c.resourceMoved, c.resources, c.movedResources])).toEqual([
      ['s1', true, { structure: 'etag:"v1"' }, [{ resource: 'structure', from: 'etag:"v1"', to: 'etag:"v2"' }]],
      ['s2', false, { structure: 'etag:"v2"' }, undefined],
      ['s3', undefined, undefined, undefined],
      ['s4', false, { elsewhere: 'v9' }, undefined], // a resource with no provenance on the wire is not judged: silence is not a change
    ]);
    // a malformed stamp off the wire is dropped, never shown as a fact
    const odd: RawPollState['records'] = [{ id: 'o1', parent: null, viewId: 'bar', kind: 'point' as const, field: 'category', value: 'x', cause: { requestedBy: 'user' }, resources: 'nope' as never }];
    expect(mapPollState({ records: odd, resources }).commits.map((c) => c.resources)).toEqual([undefined]);
    // no provenance at all: nothing is judged, and the DATA stamp is untouched by any of it
    expect(mapPollState({ records }).commits.map((c) => c.resourceMoved)).toEqual([undefined, undefined, undefined, undefined]);
    expect(state.commits.map((c) => [c.dataMoved, c.moved])).toEqual([[undefined, undefined], [undefined, undefined], [undefined, undefined], [undefined, undefined]]);
  });
});

describe('the in-process path carries the resource stamp too', () => {
  it('a commit over a def with a declared resource carries the version it was true of, and the view marks nothing moved', async () => {
    const dash = buildDashboard({ ...makeDashboardDef(), resources: { structure: { format: 'text', via: 'inline', at: PDB } } });
    const session = dash.createSession();
    await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: { requestedBy: 'user', computedBy: 'user' } });
    const view = createSessionView(sessionSource(session));
    await view.refresh();
    const state = view.getState();
    const [commit] = state.commits;
    expect(commit?.resources).toEqual({ structure: dash.resources.structure!.version });
    expect(commit?.resourceMoved).toBe(false);
    expect(state.resources).toEqual({ structure: dash.resources.structure });
    expect(JSON.stringify(state.resources)).not.toContain('HEADER');
    view.dispose();
  });

  it('a def with NO resources carries neither key — byte-identical to a state mapped before they existed', async () => {
    const dash = buildDashboard(makeDashboardDef());
    const session = dash.createSession();
    await session.dispatch({ verb: 'select', viewId: 'bar', field: 'category', value: 'Formal', cause: { requestedBy: 'user', computedBy: 'user' } });
    const view = createSessionView(sessionSource(session));
    await view.refresh();
    const state = view.getState();
    expect('resources' in state).toBe(false);
    expect('resources' in state.commits[0]!).toBe(false);
    expect('resourceMoved' in state.commits[0]!).toBe(false);
    view.dispose();
  });
});

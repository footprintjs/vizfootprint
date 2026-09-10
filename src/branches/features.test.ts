/**
 * `logFeatures` — the feature card of a captured TRACE, and the law it follows:
 * never claim more than the log holds (src/branches/README.md, law 5).
 *
 * The load-bearing test is the last one in the first block: three of the ten
 * verbs can be used without landing a commit, so their absence reads `'unseen'`
 * — "I cannot see it from here" — and never `'not-landed'`.
 */
import { describe, expect, it } from 'vitest';
import type { CommitRecord } from '../log/index.js';
import { UNSEEN_VERBS, logFeatures, verbOf } from './index.js';
import { LOG_VERBS } from './features.js';
// the ONE import this package's shipped sources may not make (see ./README.md, law 5) —
// a test may, and this is what makes the replica below a pin rather than a copy
import { DISPATCH_VERBS } from '../def/index.js';

/** Hand-author a raw CommitRecord — this package must work on a bare log (no session). */
function rec(id: string, parent: string | null, over: Partial<CommitRecord> = {}): CommitRecord {
  return {
    id,
    parent,
    viewId: 'bar',
    actorMeta: { actor: 'user' },
    kind: 'point',
    field: 'disease',
    value: 'A',
    clientViewIds: ['bar'],
    predicateSQL: '',
    cause: { requestedBy: 'user', computedBy: 'user' },
    ts: 0,
    ...over,
  };
}

/** One of every namespace a verb lands under, in one straight line. */
const EVERY_VERB: CommitRecord[] = [
  rec('c1', null),
  rec('c2', 'c1', { viewId: 'trend', kind: 'interval', value: [1, 9] }),
  rec('c3', 'c2', { viewId: 'annotation:user', field: 'note' }),
  rec('c4', 'c3', { viewId: 'analysis:byDisease' }),
  rec('c5', 'c4', { viewId: 'encoding:bar', field: 'category', value: 'kind' }),
  rec('c6', 'c5', { viewId: 'link:bar:point→trend', value: null }),
  rec('c7', 'c6', { viewId: 'prose:bar', field: 'title' }),
  rec('c8', 'c7', { viewId: 'layout:dashboard', field: 'preset', value: 'wide' }),
];

describe('the vocabulary — a pinned replica, never a copy', () => {
  it('LOG_VERBS IS the def\'s DISPATCH_VERBS, member for member and in order', () => {
    // src/branches may not import the def in a SHIPPED source (the BR-1 boundary), so the
    // ten verbs are spelled here — and pinned here, so an eleventh fails this suite
    expect([...LOG_VERBS]).toEqual([...DISPATCH_VERBS]);
  });

  it('every verb the card answers for is one of the ten', () => {
    expect(Object.keys(logFeatures([]).verbs).sort()).toEqual([...LOG_VERBS].sort());
  });
});

describe('verbOf — the verb a commit came from, read off its namespace', () => {
  it('names the verb for every namespace a verb lands under', () => {
    expect(EVERY_VERB.map(verbOf)).toEqual(['select', 'filter', 'annotate', 'analyze', 'reencode', 'link', 'describe', 'navigate']);
  });

  it('splits the probe the way the probe\'s own door does: an interval is a filter, every other kind a select', () => {
    for (const kind of ['point', 'cell', 'match', 'neighbourhood'] as const) expect(verbOf({ viewId: 'bar', kind })).toBe('select');
    expect(verbOf({ viewId: 'bar', kind: 'interval' })).toBe('filter');
    // a LAYER address is a viewId like any other
    expect(verbOf({ viewId: 'net~edges', kind: 'neighbourhood' })).toBe('select');
  });

  it('the two namespaces no dispatch verb lands are no verb at all — never read as a select', () => {
    expect(verbOf({ viewId: 'chart:c1', kind: 'point' })).toBeNull();
    expect(verbOf({ viewId: 'bookmark:1', kind: 'point' })).toBeNull();
  });
});

describe('logFeatures — what a trace shows, and what it cannot', () => {
  it('reports every verb that landed', () => {
    const card = logFeatures(EVERY_VERB);
    expect(card.commits).toBe(8);
    expect(card.verbs).toEqual({
      select: 'landed',
      filter: 'landed',
      annotate: 'landed',
      navigate: 'landed',
      analyze: 'landed',
      fork: 'unseen',
      bookmark: 'unseen',
      reencode: 'landed',
      link: 'landed',
      describe: 'landed',
    });
  });

  it('a verb that ALWAYS lands and did not is `not-landed`; one a log can be blind to is `unseen`, never that', () => {
    const card = logFeatures([rec('c1', null)]);
    // the seven that always land, and here did not
    expect(card.verbs.filter).toBe('not-landed');
    expect(card.verbs.annotate).toBe('not-landed');
    expect(card.verbs.analyze).toBe('not-landed');
    expect(card.verbs.reencode).toBe('not-landed');
    expect(card.verbs.link).toBe('not-landed');
    expect(card.verbs.describe).toBe('not-landed');
    // the three a log can be blind to — each with a sentence saying why
    expect([card.verbs.navigate, card.verbs.fork, card.verbs.bookmark]).toEqual(['unseen', 'unseen', 'unseen']);
    expect(Object.keys(UNSEEN_VERBS).sort()).toEqual(['bookmark', 'fork', 'navigate']);
    for (const sentence of Object.values(UNSEEN_VERBS)) expect(sentence).toContain('lands no commit');
  });

  it('a navigate that DID land is reported as landed — the layout form is the one that lands', () => {
    expect(logFeatures([rec('c1', null, { viewId: 'layout:dashboard', field: 'preset', value: 'wide' })]).verbs.navigate).toBe('landed');
  });

  it('the selection kinds are the ones that landed on a REAL view — a prose commit is a `point` and is not one', () => {
    expect(logFeatures(EVERY_VERB).selectionKinds).toEqual(['interval', 'point']);
    // every synthetic commit carries a kind; none of them is a selection
    expect(logFeatures(EVERY_VERB.slice(2)).selectionKinds).toEqual([]);
    expect(logFeatures([rec('c1', null, { viewId: 'net', kind: 'neighbourhood' })]).selectionKinds).toEqual(['neighbourhood']);
  });

  it('the WALKS beside the kinds: which derivation landed, alphabetically, and never a guess', () => {
    const walk = (id: string, value: unknown) => rec(id, null, { viewId: 'net', kind: 'neighbourhood', value });
    const card = logFeatures([
      walk('c1', { seed: 'flu', derivation: 'path', hops: 2, to: 'strep', ids: ['flu', 'cold', 'strep'] }),
      walk('c2', { seed: 'flu', derivation: 'ego', hops: 1, ids: ['flu', 'cold'] }),
      walk('c3', { seed: 'cold', derivation: 'ego', hops: 2, ids: ['cold', 'flu', 'strep'] }),
    ]);
    expect(card.selectionKinds).toEqual(['neighbourhood']); // the kind says a walk landed
    expect(card.walkDerivations).toEqual(['ego', 'path']); // this says WHICH walk, each once
    // a derivation another build minted is REPORTED (a card says what the trace says), and a body
    // with no readable derivation is not reported at all rather than reported as this build's default
    expect(logFeatures([walk('c1', { derivation: 'community', ids: [] }), walk('c2', { ids: [] }), walk('c3', null)]).walkDerivations).toEqual(['community']);
    // nobody walked: no derivations, and no zero to explain
    expect(logFeatures(EVERY_VERB).walkDerivations).toEqual([]);
  });

  it('a commit no verb landed lands no verb — an agent-authored chart is registered, never selected', () => {
    const card = logFeatures([rec('c1', null, { viewId: 'chart:proposal1' }), rec('c2', 'c1', { viewId: 'bookmark:1' })]);
    expect(card.commits).toBe(2);
    expect(card.verbs.select).toBe('not-landed');
    expect(card.selectionKinds).toEqual([]);
    // they are still commits, and still belong to a family
    expect(card.families).toEqual({ interaction: 0, design: 0, analysis: 1, story: 1 });
  });

  it('counts every family, including the ones with nothing in them', () => {
    expect(logFeatures(EVERY_VERB).families).toEqual({ interaction: 2, design: 4, analysis: 1, story: 1 });
    expect(logFeatures([]).families).toEqual({ interaction: 0, design: 0, analysis: 0, story: 0 });
  });
});

describe('logFeatures — branching, the stores beside the log, and who acted', () => {
  it('counts the lanes `deriveBranches` names: none, one, or a branch', () => {
    expect(logFeatures([])).toMatchObject({ commits: 0, lanes: 0, branched: false });
    expect(logFeatures([rec('c1', null), rec('c2', 'c1')])).toMatchObject({ lanes: 1, branched: false });
    // c2 and c2b are siblings off c1 — two leaves, two lanes
    expect(logFeatures([rec('c1', null), rec('c2', 'c1'), rec('c2b', 'c1')])).toMatchObject({ lanes: 2, branched: true });
  });

  it('counts the bookmarks and saved selections it is HANDED — and zero when it is handed none', () => {
    expect(logFeatures(EVERY_VERB, { bookmarks: [{}, {}], saved: [{}] })).toMatchObject({ bookmarks: 2, saved: 1 });
    expect(logFeatures(EVERY_VERB)).toMatchObject({ bookmarks: 0, saved: 0 });
    expect(logFeatures(EVERY_VERB, { bookmarks: [{}] })).toMatchObject({ bookmarks: 1, saved: 0 });
  });

  it('a correlationId is counted as itself; only the CAUSE makes it the agent\'s', () => {
    const log = [
      rec('c1', null, { correlationId: 'saved:test#1' }), // a user's own selection, carrying a host join key
      rec('c2', 'c1', { correlationId: 'tool#7', cause: { requestedBy: 'agent', computedBy: 'system' } }),
      rec('c3', 'c2', { correlationId: 'tool#8', cause: { requestedBy: 'user', computedBy: 'agent' } }),
      rec('c4', 'c3'), // no correlation at all
    ];
    expect(logFeatures(log)).toMatchObject({ correlated: 3, agentCorrelated: 2 });
    // the CDC capture's shape: five ids, none of them an agent's
    expect(logFeatures([rec('c1', null, { correlationId: 'saved:test#11' })])).toMatchObject({ correlated: 1, agentCorrelated: 0 });
  });
});

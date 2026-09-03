/**
 * BR-1 acceptance — `src/branches`, the git-style named-branching mini-library
 * over the append-only commit log (docs/RESEARCH_STATE.md, BR-1 decision entry).
 *
 * Written FIRST (packet order): these tests pin the approved design —
 *   1. refs + HEAD live BESIDE the log, never in it (commits stay frozen, R8
 *      untouched; refs are the one thing allowed to move);
 *   2. act-at-tip advances the ref, act-while-detached auto-creates a
 *      cause-slugged, unique ref (today's branch-on-act, now named) — BOTH
 *      journaled as lightweight ref-events (never commits);
 *   3. `deriveBranches` names every lane of a legacy anonymous log
 *      deterministically;
 *   4. `commonAncestor` — loop-safe LCA, missing-id honest;
 *   5. `foldDiff` — the structured state diff from the log ALONE (last-wins
 *      per key: selection=(viewId), encoding=(viewId,channel), analysis=(id));
 *   6. `planBringOver` / `planUndo` — plan, don't execute: {recipe, conflicts}.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { CommitRecord } from '../log/index.js';
import {
  BranchRefs,
  commonAncestor,
  deriveBranches,
  foldDiff,
  foldStateAt,
  keyOf,
  planBringOver,
  planUndo,
  slugForCommit,
  keysOf,
  familyOf,
  ENCODING_VIEW_PREFIX,
  ANALYSIS_VIEW_PREFIX,
  ANNOTATION_VIEW_PREFIX,
  BEAT_VIEW_PREFIX,
} from './index.js';

/** Hand-author a raw CommitRecord — branches/ must work on a bare log (no session). */
function rec(id: string, parent: string | null, over: Partial<CommitRecord> = {}): CommitRecord {
  return {
    id,
    parent,
    viewId: 'bar',
    actorMeta: { actor: 'user' },
    kind: 'point',
    field: 'category',
    value: 'Formal',
    clientViewIds: ['bar'],
    predicateSQL: '',
    cause: { requestedBy: 'user', computedBy: 'user' },
    ts: 0,
    ...over,
  };
}

const intent = (text: string) => ({ requestedBy: 'user' as const, computedBy: 'user' as const, intent: text });

describe('BR-1 boundary — src/branches imports ONLY the log layer', () => {
  it('every ../ import in the shipped sources targets ../log', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(here).filter((f) => f.endsWith('.ts') && !f.includes('.test.'));
    expect(sources.length).toBeGreaterThan(0);
    for (const file of sources) {
      const text = readFileSync(join(here, file), 'utf8');
      const specifiers = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const spec of specifiers) {
        if (spec.startsWith('..')) expect(spec, `${file} imports ${spec}`).toMatch(/^\.\.\/log\//);
      }
    }
  });
});

describe('refs & HEAD — beside the log, never in it', () => {
  it('starts attached to an unborn "main"; the first (root) commit creates the ref — journaled', () => {
    const refs = new BranchRefs();
    expect(refs.head).toEqual({ branch: 'main' });
    expect(refs.branches()).toEqual({});

    const routed = refs.noteCommit(rec('c1', null));
    expect(routed).toEqual({ name: 'main', created: true });
    expect(refs.branches()).toEqual({ main: 'c1' });
    expect(refs.head).toEqual({ branch: 'main' });
    expect(refs.events()).toEqual([{ type: 'create', name: 'main', at: 'c1', auto: true, ts: 0 }]);
  });

  it('act-at-tip ADVANCES the ref (journaled as an advance event, not a create)', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    const routed = refs.noteCommit(rec('c2', 'c1'));
    expect(routed).toEqual({ name: 'main', created: false });
    expect(refs.branches()).toEqual({ main: 'c2' });
    expect(refs.events().at(-1)).toEqual({ type: 'advance', name: 'main', at: 'c2', ts: 1 });
  });

  it('act-while-detached AUTO-CREATES a cause-slugged ref and attaches HEAD — journaled', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    refs.noteCommit(rec('c2', 'c1'));
    refs.detach('c1'); // the cursor travelled into the past
    expect(refs.head).toEqual({ detached: 'c1' });
    expect(refs.events().at(-1)).toEqual({ type: 'switch', to: null, at: 'c1', ts: 2 });

    const routed = refs.noteCommit(rec('c3', 'c1', { cause: intent('premium focus') }));
    expect(routed).toEqual({ name: 'premium-focus', created: true });
    expect(refs.head).toEqual({ branch: 'premium-focus' });
    expect(refs.branches()).toEqual({ main: 'c2', 'premium-focus': 'c3' });
    expect(refs.events().at(-1)).toEqual({ type: 'create', name: 'premium-focus', at: 'c3', auto: true, ts: 3 });
  });

  it('auto-names stay unique — the same cause slug gets a counter suffix', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    refs.noteCommit(rec('c2', 'c1'));
    refs.detach('c1');
    refs.noteCommit(rec('c3', 'c1', { cause: intent('premium focus') }));
    refs.detach('c1');
    const routed = refs.noteCommit(rec('c4', 'c1', { cause: intent('premium focus') }));
    expect(routed.name).toBe('premium-focus-2');
    expect(Object.keys(refs.branches()).sort()).toEqual(['main', 'premium-focus', 'premium-focus-2']);
  });

  it('a commit without an intent slugs from field+value; an unsluggable one falls back to "path"', () => {
    expect(slugForCommit(rec('x', null))).toBe('category-formal'); // string value
    expect(slugForCommit(rec('x', null, { field: 'price', value: 42, kind: 'point' }))).toBe('price-42'); // number value
    expect(slugForCommit(rec('x', null, { field: 'inStock', value: true }))).toBe('instock-true'); // boolean value
    expect(slugForCommit(rec('x', null, { field: 'price', value: [10, 20], kind: 'interval' }))).toBe('price'); // non-scalar → field alone
    expect(slugForCommit(rec('x', null, { field: '***', value: { deep: true }, cause: intent('!!!') }))).toBe('path');
  });

  it('extending ANOTHER ref\'s tip while detached advances that ref and re-attaches HEAD', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    refs.noteCommit(rec('c2', 'c1'));
    refs.detach('c2'); // detached AT the tip of main (git-style: checkout by id detaches)
    const routed = refs.noteCommit(rec('c3', 'c2'));
    expect(routed).toEqual({ name: 'main', created: false }); // unambiguous lane continuation
    expect(refs.head).toEqual({ branch: 'main' });
    expect(refs.branches()).toEqual({ main: 'c3' });
  });

  it('switchTo attaches HEAD to a named ref (journaled); an unknown name is an honest rejection', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    refs.detach('c1');
    const ok = refs.switchTo('main');
    expect(ok).toEqual({ ok: true, tip: 'c1' });
    expect(refs.head).toEqual({ branch: 'main' });
    expect(refs.events().at(-1)).toEqual({ type: 'switch', to: 'main', at: 'c1', ts: 2 });

    const bad = refs.switchTo('nope');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.detail).toContain('nope');
  });

  it('createAt names a ref at any commit and attaches; a taken or empty name is rejected', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    refs.noteCommit(rec('c2', 'c1'));
    const ok = refs.createAt('experiment', 'c1');
    expect(ok).toEqual({ ok: true, name: 'experiment' });
    expect(refs.head).toEqual({ branch: 'experiment' });
    expect(refs.branches()).toEqual({ main: 'c2', experiment: 'c1' });
    expect(refs.events().at(-1)).toEqual({ type: 'create', name: 'experiment', at: 'c1', auto: false, ts: 2 });

    expect(refs.createAt('main', 'c1').ok).toBe(false); // taken
    expect(refs.createAt('   ', 'c1').ok).toBe(false); // empty after trim
    expect(refs.createAt('x'.repeat(65), 'c1').ok).toBe(false); // too long
  });

  it('rename moves the name, follows HEAD, journals; unknown/collision/invalid are rejected', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    const ok = refs.rename('main', 'trunk');
    expect(ok).toEqual({ ok: true });
    expect(refs.branches()).toEqual({ trunk: 'c1' });
    expect(refs.head).toEqual({ branch: 'trunk' }); // HEAD followed the rename
    expect(refs.events().at(-1)).toEqual({ type: 'rename', from: 'main', to: 'trunk', ts: 1 });

    expect(refs.rename('ghost', 'x').ok).toBe(false); // unknown old name
    refs.createAt('side', 'c1');
    expect(refs.rename('side', 'trunk').ok).toBe(false); // collision
    expect(refs.rename('side', '  ').ok).toBe(false); // invalid new name
  });

  it('rename while HEAD is on a DIFFERENT ref leaves HEAD alone', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    refs.createAt('side', 'c1'); // HEAD now on side
    expect(refs.rename('main', 'trunk')).toEqual({ ok: true });
    expect(refs.head).toEqual({ branch: 'side' });
  });

  it('adopt seeds derived names (legacy logs) without moving HEAD; existing names are not clobbered', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    const adopted = refs.adopt({ main: 'zz', legacy: 'c9' });
    expect(adopted).toEqual(['legacy']); // 'main' already exists — never clobbered
    expect(refs.branches()).toEqual({ main: 'c1', legacy: 'c9' });
    expect(refs.head).toEqual({ branch: 'main' });
    expect(refs.events().at(-1)).toEqual({ type: 'create', name: 'legacy', at: 'c9', auto: true, ts: 1 });
  });

  it('a SECOND root commit (parent null, refs already exist) starts its own named lane', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    const routed = refs.noteCommit(rec('r2', null, { cause: intent('fresh start') }));
    expect(routed).toEqual({ name: 'fresh-start', created: true });
    expect(refs.branches()).toEqual({ main: 'c1', 'fresh-start': 'r2' });
  });

  it('a root commit while detached with NO refs at all still auto-creates (never crashes)', () => {
    const refs = new BranchRefs();
    refs.detach(null);
    const routed = refs.noteCommit(rec('c1', null, { cause: intent('cold open') }));
    expect(routed).toEqual({ name: 'cold-open', created: true });
    expect(refs.head).toEqual({ branch: 'cold-open' });
  });

  it('ref-events are frozen (the journal is auditable, not editable)', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    const event = refs.events()[0]!;
    expect(Object.isFrozen(event)).toBe(true);
  });
});

describe('deriveBranches — a legacy anonymous log gets stable, deterministic names', () => {
  /** c1─c2 (main line) with c2b a sibling off c1, and c3b extending c2b. */
  const LEGACY: CommitRecord[] = [
    rec('c1', null, { cause: intent('pick Data') }),
    rec('c2', 'c1', { viewId: 'scatter', field: 'price', kind: 'interval', value: [10, 20], cause: intent('low band') }),
    rec('c2b', 'c1', { viewId: 'scatter', field: 'price', kind: 'interval', value: [50, 60], cause: intent('high band') }),
    rec('c3b', 'c2b', { cause: intent('narrow further') }),
  ];

  it('names every lane: the first leaf lane is "main", siblings slug from their divergence commit', () => {
    expect(deriveBranches(LEGACY)).toEqual({ main: 'c2', 'high-band': 'c3b' });
  });

  it('same input → same names (deterministic across calls and across a serialization round-trip)', () => {
    const a = deriveBranches(LEGACY);
    const b = deriveBranches(LEGACY);
    const c = deriveBranches(JSON.parse(JSON.stringify(LEGACY)) as CommitRecord[]);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
  });

  it('colliding slugs get counter suffixes (counting past -2); every leaf still gets a name', () => {
    const log: CommitRecord[] = [
      rec('c1', null),
      rec('c2', 'c1'),
      rec('b1', 'c1', { cause: intent('same idea') }),
      rec('b2', 'c1', { cause: intent('same idea') }),
      rec('b3', 'c1', { cause: intent('same idea') }),
    ];
    expect(deriveBranches(log)).toEqual({ main: 'c2', 'same-idea': 'b1', 'same-idea-2': 'b2', 'same-idea-3': 'b3' });
  });

  it('an empty log derives no names; a custom default name is honored', () => {
    expect(deriveBranches([])).toEqual({});
    expect(deriveBranches(LEGACY, { defaultName: 'trunk' })).toEqual({ trunk: 'c2', 'high-band': 'c3b' });
  });
});

describe('commonAncestor — loop-safe LCA on the parent tree, missing-id honest', () => {
  const LOG: CommitRecord[] = [rec('c1', null), rec('c2', 'c1'), rec('c2b', 'c1'), rec('c3', 'c2')];

  it('same-path: the ancestor of (c1, c3) is c1 itself', () => {
    expect(commonAncestor(LOG, 'c1', 'c3')).toEqual({ ok: true, ancestorId: 'c1' });
    expect(commonAncestor(LOG, 'c3', 'c1')).toEqual({ ok: true, ancestorId: 'c1' });
  });

  it('siblings: the ancestor of (c3, c2b) is the fork point c1', () => {
    expect(commonAncestor(LOG, 'c3', 'c2b')).toEqual({ ok: true, ancestorId: 'c1' });
  });

  it('a commit is its own ancestor: (c2, c2) → c2', () => {
    expect(commonAncestor(LOG, 'c2', 'c2')).toEqual({ ok: true, ancestorId: 'c2' });
  });

  it('an unknown id is an honest typed miss, naming every missing id', () => {
    expect(commonAncestor(LOG, 'ghost', 'c2')).toEqual({ ok: false, reason: 'unknown-commit', missing: ['ghost'] });
    expect(commonAncestor(LOG, 'ghost', 'phantom')).toEqual({ ok: false, reason: 'unknown-commit', missing: ['ghost', 'phantom'] });
  });

  it('disjoint roots have NO common ancestor — ancestorId is null, honestly', () => {
    const twoRoots = [...LOG, rec('r2', null), rec('r3', 'r2')];
    expect(commonAncestor(twoRoots, 'c3', 'r3')).toEqual({ ok: true, ancestorId: null });
  });

  it('a hand-corrupted CYCLIC raw log terminates (loop-safe), never spins', () => {
    const cyclic = [rec('a', 'b'), rec('b', 'a'), rec('z', null)];
    expect(commonAncestor(cyclic, 'a', 'z')).toEqual({ ok: true, ancestorId: null });
    // b sits in a's (cycle-truncated) ancestor chain, so the walk from b hits itself first.
    expect(commonAncestor(cyclic, 'a', 'b')).toEqual({ ok: true, ancestorId: 'b' });
  });
});

describe('foldDiff — the structured state diff computed from the log ALONE (last-wins per key)', () => {
  /**
   * root: select category=Formal on bar
   * A-side: reencode scatter x→rating · re-select bar category=Casual · analysis correlation p=.03 · filter scatter price [10,20]
   * B-side: analysis correlation p=.5 · annotation (inert)
   */
  const LOG: CommitRecord[] = [
    rec('c1', null), // bar: Formal (shared)
    rec('a1', 'c1', { viewId: `${ENCODING_VIEW_PREFIX}scatter`, field: 'x', value: 'rating' }),
    rec('a2', 'a1', { value: 'Casual' }), // bar re-select — last-wins on selection:(bar)
    rec('a3', 'a2', { viewId: `${ANALYSIS_VIEW_PREFIX}correlation`, field: 'pValue', value: 0.03 }),
    rec('a4', 'a3', { viewId: 'scatter', kind: 'interval', field: 'price', value: [10, 20] }),
    rec('b1', 'c1', { viewId: `${ANALYSIS_VIEW_PREFIX}correlation`, field: 'pValue', value: 0.5 }),
    rec('b2', 'b1', { viewId: `${ANNOTATION_VIEW_PREFIX}user`, field: '__annotation__', value: 'a note' }),
  ];

  it('reports ancestor, changed, onlyA, onlyB — deterministically ordered by key', () => {
    const d = foldDiff(LOG, 'a4', 'b2');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.ancestor).toBe('c1');
    // changed: the shared bar selection diverged AND the analysis re-ran with a different value
    expect(d.changed.map((c) => c.key)).toEqual(['analysis:correlation', 'selection:bar']);
    expect(d.changed[0]).toMatchObject({ a: { value: 0.03, commitId: 'a3' }, b: { value: 0.5, commitId: 'b1' } });
    expect(d.changed[1]).toMatchObject({ a: { clause: { value: 'Casual' } }, b: { clause: { value: 'Formal' } } });
    // onlyA: the scatter encoding + the scatter interval exist only on A
    expect(d.onlyA.map((e) => e.key)).toEqual(['encoding:scatter:x', 'selection:scatter']);
    // onlyB: nothing (the annotation is INERT — never state)
    expect(d.onlyB).toEqual([]);
  });

  it('identical state reached through DIFFERENT commits is NOT a change (values compare, ids do not)', () => {
    const log = [rec('c1', null), rec('x', 'c1', { value: 'Party' }), rec('y', 'c1', { value: 'Party' })];
    const d = foldDiff(log, 'x', 'y');
    expect(d.ok && d.changed).toEqual([]);
    expect(d.ok && d.onlyA).toEqual([]);
    expect(d.ok && d.onlyB).toEqual([]);
  });

  it('a cleared selection (interval null) drops the key — surfacing as an only-side entry', () => {
    const log = [
      rec('c1', null, { viewId: 'scatter', kind: 'interval', field: 'price', value: [10, 20] }),
      rec('x', 'c1', { viewId: 'scatter', kind: 'interval', field: 'price', value: null }), // clear
      rec('y', 'c1', { value: 'Work' }), // sibling keeps the interval, adds a bar select
    ];
    const d = foldDiff(log, 'x', 'y');
    expect(d.ok && d.onlyA).toEqual([]);
    expect(d.ok ? d.onlyB.map((e) => e.key).sort() : []).toEqual(['selection:bar', 'selection:scatter']);
  });

  it('an unknown tip is an honest typed miss', () => {
    const d = foldDiff(LOG, 'ghost', 'b2');
    expect(d).toEqual({ ok: false, reason: 'unknown-commit', missing: ['ghost'] });
  });

  it('FILTER-1: a half-open interval ([lo, null]) folds and diffs by VALUE, same as any other bound', () => {
    const log = [
      rec('c1', null, { viewId: 'scatter', kind: 'interval', field: 'price', value: [150, null] }), // "150 or more"
      rec('x', 'c1', { value: 'Work' }), // A: sibling bar select, keeps the half-open filter
      rec('y', 'c1', { viewId: 'scatter', kind: 'interval', field: 'price', value: [null, 150] }), // B: "up to 150" — same key, different value
    ];
    expect(foldStateAt(log, 'x').get('selection:scatter')).toMatchObject({ clause: { value: [150, null] } });
    const d = foldDiff(log, 'x', 'y');
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.changed.map((c) => c.key)).toEqual(['selection:scatter']);
    expect(d.changed[0]).toMatchObject({ a: { clause: { value: [150, null] } }, b: { clause: { value: [null, 150] } } });
    expect(d.onlyA.map((e) => e.key)).toEqual(['selection:bar']);
  });

  it('foldStateAt of a null tip is the empty state (the fold of the empty path)', () => {
    expect(foldStateAt(LOG, null).size).toBe(0);
  });

  it('comparing a tip against itself yields the empty diff with itself as ancestor', () => {
    const d = foldDiff(LOG, 'a4', 'a4');
    expect(d.ok && d.ancestor).toBe('a4');
    expect(d.ok && d.changed).toEqual([]);
  });

  it('a `beat:` record is INERT in the fold — a name is never crossfilter state (the namespace `src/def/validate` reserves, and the story bridge reads)', () => {
    const beat = rec('k1', null, { viewId: `${BEAT_VIEW_PREFIX}0`, field: '__beat__', value: 'after cleanup' });
    expect(keyOf(beat)).toBeNull();
    expect(keysOf(beat)).toEqual([]);
    expect(familyOf(beat)).toBe('story'); // still a story-family record, exactly like an annotation
    expect(foldStateAt([beat], 'k1').size).toBe(0);
  });
});

describe('planBringOver — cherry-pick as a PLAN: {recipe, conflicts}, never an execution', () => {
  const LOG: CommitRecord[] = [
    rec('c1', null), // bar: Formal
    rec('a1', 'c1', { value: 'Casual' }), // bar re-select on A
    rec('a2', 'a1', { viewId: 'scatter', kind: 'interval', field: 'price', value: [60, 130] }),
    rec('b1', 'c1', { viewId: 'cluster', field: 'cluster_id', value: 2 }), // B: untouched bar key
    rec('b2', 'b1', { value: 'Party' }), // B ALSO re-selects bar — the conflict arm
  ];

  it('clean case: the key is untouched on the target path since the LCA — no conflicts', () => {
    const plan = planBringOver(LOG, 'a2', 'b1'); // bring the scatter interval onto B
    expect(plan).toEqual({
      ok: true,
      recipe: { apply: 'selection', viewId: 'scatter', kind: 'interval', field: 'price', value: [60, 130] },
      conflicts: [],
    });
  });

  it('conflict case: the same key was touched on the target path since the LCA — named by the overriding commit id, plan still executable', () => {
    const plan = planBringOver(LOG, 'a1', 'b2'); // bring the bar re-select onto B, but b2 already re-selected bar
    expect(plan).toEqual({
      ok: true,
      recipe: { apply: 'selection', viewId: 'bar', kind: 'point', field: 'category', value: 'Casual' },
      conflicts: ['b2'],
    });
  });

  it('encoding / analysis / annotation commits map to their own recipes', () => {
    const log = [
      rec('c1', null),
      rec('e1', 'c1', { viewId: `${ENCODING_VIEW_PREFIX}scatter`, field: 'x', value: 'rating' }),
      rec('t1', 'e1', { viewId: `${ANALYSIS_VIEW_PREFIX}correlation`, field: 'pValue', value: 0.03 }),
      rec('n1', 't1', { viewId: `${ANNOTATION_VIEW_PREFIX}user`, field: '__annotation__', value: 'note!' }),
    ];
    expect(planBringOver(log, 'e1', 'c1')).toMatchObject({ ok: true, recipe: { apply: 'encoding', viewId: 'scatter', channel: 'x', field: 'rating' } });
    expect(planBringOver(log, 't1', 'c1')).toMatchObject({ ok: true, recipe: { apply: 'analysis', analysisId: 'correlation' } });
    expect(planBringOver(log, 'n1', 'c1')).toMatchObject({ ok: true, recipe: { apply: 'annotation', target: '', note: 'note!' }, conflicts: [] }); // a loose note (the plain field) re-notes loosely; a note on a commit carries that commit id
  });

  it('a null target tip (empty timeline) plans with no conflicts', () => {
    expect(planBringOver(LOG, 'a1', null)).toMatchObject({ ok: true, conflicts: [] });
  });

  it('unknown source or target ids are an honest typed miss', () => {
    expect(planBringOver(LOG, 'ghost', 'b1').ok).toBe(false);
    const both = planBringOver(LOG, 'ghost', 'phantom');
    expect(both).toMatchObject({ ok: false, reason: 'unknown-commit' });
    if (!both.ok) expect(both.detail).toContain('ghost');
  });

  it('bringing over a commit already ON the target path: itself is never its own conflict, later touches are', () => {
    const plan = planBringOver(LOG, 'c1', 'b2'); // c1 selected bar; b2 later re-selected bar on the same path
    expect(plan).toMatchObject({ ok: true, conflicts: ['b2'] });
  });
});

describe('planUndo — revert as a PLAN: restore the key\'s value at the commit\'s parent', () => {
  const LOG: CommitRecord[] = [
    rec('c1', null), // bar: Formal
    rec('c2', 'c1', { value: 'Casual' }), // bar re-select
    rec('c3', 'c2', { viewId: 'scatter', kind: 'interval', field: 'price', value: [60, 130] }),
    rec('e1', 'c3', { viewId: `${ENCODING_VIEW_PREFIX}scatter`, field: 'x', value: 'rating' }),
    rec('e2', 'e1', { viewId: `${ENCODING_VIEW_PREFIX}scatter`, field: 'x', value: 'price' }),
  ];

  it('restores the parent value: undo(c2) at tip → re-select the parent\'s Formal', () => {
    const plan = planUndo(LOG, 'c2', 'e2');
    expect(plan).toEqual({
      ok: true,
      recipe: { apply: 'selection', viewId: 'bar', kind: 'point', field: 'category', value: 'Formal' },
      conflicts: [],
    });
  });

  it('absent at parent → a CLEAR recipe: undo(c1) clears the bar selection (and names c2 as the overriding conflict)', () => {
    const plan = planUndo(LOG, 'c1', 'e2');
    expect(plan).toEqual({
      ok: true,
      recipe: { apply: 'clear-selection', viewId: 'bar', field: 'category', kind: 'point' }, // kind-faithful: a cleared POINT
      conflicts: ['c2'], // c2 touched the same key after c1 on the target path — explicit, still executable
    });
  });

  it('undo of an interval commit with no prior interval → clear-selection', () => {
    expect(planUndo(LOG, 'c3', 'e2')).toEqual({
      ok: true,
      recipe: { apply: 'clear-selection', viewId: 'scatter', field: 'price', kind: 'interval' },
      conflicts: [],
    });
  });

  it('encoding undo restores the PRIOR binding; absent-at-parent → clear-encoding (session resolves the initial)', () => {
    expect(planUndo(LOG, 'e2', 'e2')).toEqual({
      ok: true,
      recipe: { apply: 'encoding', viewId: 'scatter', channel: 'x', field: 'rating' },
      conflicts: [],
    });
    expect(planUndo(LOG, 'e1', 'e2')).toEqual({
      ok: true,
      recipe: { apply: 'clear-encoding', viewId: 'scatter', channel: 'x' },
      conflicts: ['e2'],
    });
  });

  it('an analysis commit is honestly NOT undoable (the FDR ledger never refunds)', () => {
    const log = [rec('c1', null), rec('t1', 'c1', { viewId: `${ANALYSIS_VIEW_PREFIX}correlation`, field: 'pValue', value: 0.03 })];
    const plan = planUndo(log, 't1', 't1');
    expect(plan).toMatchObject({ ok: false, reason: 'not-undoable' });
    if (!plan.ok) expect(plan.detail).toContain('never refunds');
  });

  it('an annotation commit is honestly NOT undoable (inert data has no prior state)', () => {
    const log = [rec('c1', null), rec('n1', 'c1', { viewId: `${ANNOTATION_VIEW_PREFIX}user`, field: '__annotation__', value: 'x' })];
    expect(planUndo(log, 'n1', 'n1')).toMatchObject({ ok: false, reason: 'not-undoable' });
  });

  it('unknown ids are an honest typed miss; a null tip plans without conflicts', () => {
    expect(planUndo(LOG, 'ghost', 'e2')).toMatchObject({ ok: false, reason: 'unknown-commit' });
    expect(planUndo(LOG, 'c2', 'phantom')).toMatchObject({ ok: false, reason: 'unknown-commit' });
    expect(planUndo(LOG, 'c2', null)).toMatchObject({ ok: true, conflicts: [] });
  });
});

// ---------------------------------------------------------------------------
// D30 — cell commits through the branches layer (fold, diff, plans).
// ---------------------------------------------------------------------------
describe('D30 cell commits — fold key unchanged, clear rule, plans carry the pair', () => {
  const cellRec = (id: string, parent: string | null, value: unknown, over: Partial<CommitRecord> = {}): CommitRecord =>
    rec(id, parent, {
      viewId: 'heatmap',
      kind: 'cell',
      field: 'price × category',
      fields: ['price', 'category'],
      value,
      ...over,
    });

  it('TARGETED: a cell commit folds under the SAME key as any probe — selection:${viewId}, last-wins per view', () => {
    const interval = rec('c1', null, { viewId: 'heatmap', kind: 'interval', field: 'price', value: [0, 50] });
    const cell = cellRec('c2', 'c1', [[100, 150], 'Formal']);
    expect(keyOf(interval)).toBe('selection:heatmap');
    expect(keyOf(cell)).toBe('selection:heatmap'); // the D30 ruling: fold key UNCHANGED
    const state = foldStateAt([interval, cell], 'c2');
    expect(state.size).toBe(1); // last-wins per view: the cell REPLACED the interval under one key
    expect(state.get('selection:heatmap')).toMatchObject({
      kind: 'selection',
      clause: { kind: 'cell', fields: ['price', 'category'], value: [[100, 150], 'Formal'] },
      commitId: 'c2',
    });
  });

  it('a cleared cell (value null) DELETES the selection key, exactly like a cleared interval', () => {
    const log = [cellRec('c1', null, [[100, 150], 'Formal']), cellRec('c2', 'c1', null)];
    expect(foldStateAt(log, 'c1').has('selection:heatmap')).toBe(true);
    expect(foldStateAt(log, 'c2').has('selection:heatmap')).toBe(false);
  });

  it('foldDiff fingerprints a cell by its PAIR + values (identical cells on two branches are NOT a change)', () => {
    const base = cellRec('c1', null, [[100, 150], 'Formal']);
    const sameA = cellRec('a1', 'c1', [[100, 150], 'Formal']);
    const diffB = cellRec('b1', 'c1', [[200, 250], 'Casual']);
    const d1 = foldDiff([base, sameA, diffB], 'a1', 'b1');
    expect(d1.ok && d1.changed.length).toBe(1); // different values → a change
    const d2 = foldDiff([base, sameA, cellRec('b2', 'c1', [[100, 150], 'Formal'])], 'a1', 'b2');
    expect(d2.ok && d2.changed.length).toBe(0); // identical cells via different commits → NOT a change
  });

  it('planBringOver of a cell commit carries the field pair so the executor re-lands the COMPOUND', () => {
    const log = [rec('c1', null), cellRec('h1', 'c1', [[100, 150], 'Formal'])];
    const plan = planBringOver(log, 'h1', 'c1');
    expect(plan).toMatchObject({
      ok: true,
      recipe: { apply: 'selection', kind: 'cell', viewId: 'heatmap', fields: ['price', 'category'], value: [[100, 150], 'Formal'] },
    });
  });

  it('planUndo restores a PRIOR cell compound (pair and all); with nothing prior it clears KIND-FAITHFULLY', () => {
    const first = cellRec('h1', null, [[0, 50], 'Casual']);
    const second = cellRec('h2', 'h1', [[100, 150], 'Formal']);
    const undoSecond = planUndo([first, second], 'h2', 'h2');
    expect(undoSecond).toMatchObject({
      ok: true,
      recipe: { apply: 'selection', kind: 'cell', fields: ['price', 'category'], value: [[0, 50], 'Casual'] },
    });
    const undoFirst = planUndo([first, second], 'h1', 'h2');
    // absent at parent → a CELL-shaped clear (the recipe's `field` is the joint
    // label, not a column — an interval-clear would trip the executor's guard)
    expect(undoFirst).toMatchObject({
      ok: true,
      recipe: { apply: 'clear-selection', viewId: 'heatmap', fields: ['price', 'category'] },
    });
  });
});

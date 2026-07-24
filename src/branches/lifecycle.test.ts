/**
 * TL-1 acceptance (branches tier) — the trail LIFECYCLE over `BranchRefs`:
 * archive / restore / discardTo.
 *
 * The principle these pin: **never erase the record — erase the VIEW.** Refs
 * move and hide; commits are forever. Concretely —
 *   1. an archived path keeps its NAME and TIP and is merely hidden from the
 *      default listing (`tipOf` still answers; `has` still owns the namespace);
 *   2. HEAD may never ride an archived ref: archiving the path HEAD is on
 *      detaches HEAD at that path's tip, `switchTo` refuses an archived name,
 *      and tip-extension skips archived refs (no accidental resurrection);
 *   3. the last VISIBLE path cannot be archived (a typed gap, never a no-op);
 *   4. `restore` is the exact inverse — the listing round-trips byte-identically;
 *   5. `discardTo` is ONE transaction: create → archive → discard → attach, all
 *      validated BEFORE the first event is journaled, and the abandoned tip is
 *      still a real, resolvable ref;
 *   6. every lifecycle event carries its ACTOR (`by`) in the journal.
 */
import { describe, it, expect } from 'vitest';
import type { CommitRecord } from '../log/index.js';
import { BranchRefs } from './index.js';

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

/** main: c1 → c2; a sibling path "premium-focus" at c3 off c1. HEAD ends on the sibling. */
function twoPaths(): BranchRefs {
  const refs = new BranchRefs();
  refs.noteCommit(rec('c1', null));
  refs.noteCommit(rec('c2', 'c1'));
  refs.detach('c1');
  refs.noteCommit(rec('c3', 'c1', { cause: intent('premium focus') }));
  return refs;
}

describe('TL-1 archive — hidden, not erased', () => {
  it('an archived path leaves the default listing but keeps its name and tip', () => {
    const refs = twoPaths();
    const res = refs.archive('main', 'user');
    expect(res).toEqual({ ok: true, tip: 'c2', detached: false });

    expect(refs.branches()).toEqual({ 'premium-focus': 'c3' }); // hidden by default
    expect(refs.branches({ includeArchived: true })).toEqual({ main: 'c2', 'premium-focus': 'c3' });
    expect(refs.isArchived('main')).toBe(true);
    expect(refs.archivedNames()).toEqual(['main']);
    expect(refs.tipOf('main')).toBe('c2'); // still resolvable — compare/why keep working
    expect(refs.has('main')).toBe(true); // the name still OWNS the namespace
  });

  it('the journal records the archive with its ACTOR', () => {
    const refs = twoPaths();
    refs.archive('main', 'agent');
    expect(refs.events().at(-1)).toEqual({ type: 'archive', name: 'main', at: 'c2', by: 'agent', ts: 4 });
  });

  it('archiving the path HEAD rides DETACHES HEAD at that path\'s tip', () => {
    const refs = twoPaths();
    expect(refs.currentBranch()).toBe('premium-focus');
    const res = refs.archive('premium-focus', 'user');
    expect(res).toEqual({ ok: true, tip: 'c3', detached: true });
    expect(refs.head).toEqual({ detached: 'c3' }); // standing in the same place, on no named path
    expect(refs.events().at(-1)).toEqual({ type: 'switch', to: null, at: 'c3', ts: 5 });
  });

  it('acting at an archived tip starts a NEW path — an archived ref is never re-advanced', () => {
    const refs = twoPaths();
    refs.archive('premium-focus', 'user'); // HEAD detaches at c3
    const routed = refs.noteCommit(rec('c4', 'c3', { cause: intent('second look') }));
    expect(routed).toEqual({ name: 'second-look', created: true });
    expect(refs.tipOf('premium-focus')).toBe('c3'); // frozen where it was left
    expect(refs.branches()).toEqual({ main: 'c2', 'second-look': 'c4' });
  });

  it('switchTo refuses an archived name (restore it first)', () => {
    const refs = twoPaths();
    refs.archive('main', 'user');
    const res = refs.switchTo('main');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toBe('path "main" is archived — restore it first');
  });

  it('the LAST visible path cannot be archived; an unknown or already-archived name is refused', () => {
    const refs = twoPaths();
    expect(refs.archive('ghost', 'user')).toEqual({ ok: false, detail: 'no path named "ghost"' });
    expect(refs.archive('main', 'user').ok).toBe(true);
    expect(refs.archive('main', 'user')).toEqual({ ok: false, detail: 'path "main" is already archived' });
    expect(refs.archive('premium-focus', 'user')).toEqual({
      ok: false,
      detail: '"premium-focus" is the only visible path — start another one before archiving it',
    });
    expect(refs.branches()).toEqual({ 'premium-focus': 'c3' }); // nothing hidden by the refusal
  });
});

describe('TL-1 the frozen-ref rule — an archived ref refuses every way of touching it', () => {
  /**
   * REGRESSION (found in adversarial review): `rename` moved the name in
   * `_branches` without touching `_archived`, so renaming an archived path
   * RESURRECTED it (visible, switchable, no `restore` event) AND left the old
   * name stale in `_archived` — which then made the NEXT ref born under that
   * name secretly archived, invisible in `paths()`, with HEAD riding it.
   */
  it('renaming an ARCHIVED path is refused, in the same words as switchTo', () => {
    const refs = twoPaths();
    refs.archive('main', 'user');
    const events = refs.events().length;

    const res = refs.rename('main', 'trunk');
    expect(res).toEqual({ ok: false, detail: 'path "main" is archived — restore it first' });
    // nothing moved, nothing was written, and the path is still hidden
    expect(refs.branches({ includeArchived: true })).toEqual({ main: 'c2', 'premium-focus': 'c3' });
    expect(refs.isArchived('main')).toBe(true);
    expect(refs.events().length).toBe(events);
    // no silent resurrection: it is still unswitchable until restored
    expect(refs.switchTo('main').ok).toBe(false);

    // …and restoring first is all it takes
    expect(refs.restore('main', 'user').ok).toBe(true);
    expect(refs.rename('main', 'trunk')).toEqual({ ok: true });
    expect(refs.branches()).toEqual({ trunk: 'c2', 'premium-focus': 'c3' });
  });

  it('a name RE-CREATED after its archived owner was renamed is born VISIBLE (no stale hidden name)', () => {
    const refs = twoPaths();
    refs.archive('main', 'user');
    refs.rename('main', 'trunk'); // refused — the whole point
    // restore-then-rename is the honest route, and it frees the old name cleanly
    refs.restore('main', 'user');
    refs.rename('main', 'trunk');

    const created = refs.createAt('main', 'c1'); // the freed name, born fresh
    expect(created).toEqual({ ok: true, name: 'main' });
    expect(refs.isArchived('main')).toBe(false); // NOT secretly archived
    expect(refs.branches()).toEqual({ trunk: 'c2', 'premium-focus': 'c3', main: 'c1' }); // visible in the listing
    expect(refs.head).toEqual({ branch: 'main' }); // HEAD may ride it — it is not archived
  });

  it('INVARIANT: every archived name is a live ref, and HEAD is never on one', () => {
    const refs = twoPaths();
    const check = (): void => {
      for (const name of refs.archivedNames()) {
        expect(refs.tipOf(name), `archived "${name}" must still be a live ref`).toBeDefined();
      }
      const head = refs.currentBranch();
      if (head !== null) expect(refs.isArchived(head), `HEAD must never ride archived "${head}"`).toBe(false);
    };

    check();
    refs.archive('main', 'user');
    check();
    refs.rename('main', 'trunk'); // refused
    check();
    refs.restore('main', 'user');
    refs.rename('main', 'trunk');
    check();
    refs.createAt('main', 'c1');
    check();
    refs.archive('trunk', 'user');
    check();
    refs.noteCommit(rec('c9', 'c1', { cause: intent('later still') }));
    check();
    refs.discardTo('main', 'c1', 'parked', 'user');
    check();
    expect([...refs.archivedNames()].sort()).toEqual(['parked', 'trunk']);
  });
});

describe('TL-1 restore — the exact inverse', () => {
  it('restore round-trips the listing byte-identically and journals with its actor', () => {
    const refs = twoPaths();
    const before = JSON.stringify(refs.branches({ includeArchived: true }));
    refs.archive('main', 'user');
    const res = refs.restore('main', 'user');
    expect(res).toEqual({ ok: true, tip: 'c2' });
    expect(JSON.stringify(refs.branches({ includeArchived: true }))).toBe(before);
    expect(refs.branches()).toEqual({ main: 'c2', 'premium-focus': 'c3' });
    expect(refs.isArchived('main')).toBe(false);
    expect(refs.archivedNames()).toEqual([]);
    expect(refs.events().at(-1)).toEqual({ type: 'restore', name: 'main', at: 'c2', by: 'user', ts: 5 });
  });

  it('restoring an unknown or un-archived path is an honest rejection', () => {
    const refs = twoPaths();
    expect(refs.restore('ghost', 'user')).toEqual({ ok: false, detail: 'no path named "ghost"' });
    expect(refs.restore('main', 'user')).toEqual({ ok: false, detail: 'path "main" is not archived' });
  });

  it('state() lists the visible refs plus the archived names', () => {
    const refs = twoPaths();
    refs.archive('main', 'user');
    expect(refs.state()).toEqual({
      branches: { 'premium-focus': 'c3' },
      head: { branch: 'premium-focus' },
      archived: ['main'],
    });
  });
});

describe('TL-1 discardTo — one transaction, zero deletions', () => {
  it('moves the ref back, parks the abandoned future as an archived path, attaches HEAD', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    refs.noteCommit(rec('c2', 'c1'));
    refs.noteCommit(rec('c3', 'c2'));
    refs.detach('c1'); // stepped back

    const res = refs.discardTo('main', 'c1', 'discarded-c3', 'user');
    expect(res).toEqual({ ok: true, kept: 'discarded-c3', from: 'c3' });
    expect(refs.branches()).toEqual({ main: 'c1' }); // the rewound path, alone in the listing
    expect(refs.branches({ includeArchived: true })).toEqual({ main: 'c1', 'discarded-c3': 'c3' });
    expect(refs.tipOf('discarded-c3')).toBe('c3'); // the old tip is still a real, named ref
    expect(refs.head).toEqual({ branch: 'main' }); // the next act extends the rewound path

    expect(refs.events().slice(-4)).toEqual([
      { type: 'create', name: 'discarded-c3', at: 'c3', auto: true, ts: 4 },
      { type: 'archive', name: 'discarded-c3', at: 'c3', by: 'user', ts: 5 },
      { type: 'discard', name: 'main', from: 'c3', to: 'c1', kept: 'discarded-c3', by: 'user', ts: 6 },
      { type: 'switch', to: 'main', at: 'c1', ts: 7 },
    ]);
  });

  it('discarding while ALREADY attached to the path journals no extra switch', () => {
    const refs = new BranchRefs();
    refs.noteCommit(rec('c1', null));
    refs.noteCommit(rec('c2', 'c1'));
    expect(refs.currentBranch()).toBe('main');
    expect(refs.discardTo('main', 'c1', 'kept', 'user').ok).toBe(true);
    expect(refs.head).toEqual({ branch: 'main' });
    expect(refs.events().at(-1)).toMatchObject({ type: 'discard', name: 'main', from: 'c2', to: 'c1' });
  });

  it('every rejection leaves the journal and the refs UNTOUCHED (validate-then-write)', () => {
    const refs = twoPaths();
    const events = refs.events().length;
    const listing = refs.branches({ includeArchived: true });

    expect(refs.discardTo('ghost', 'c1', 'kept', 'user')).toEqual({ ok: false, detail: 'no path named "ghost"' });
    expect(refs.discardTo('premium-focus', 'c3', 'kept', 'user')).toEqual({
      ok: false,
      detail: 'path "premium-focus" already ends at "c3" — there is nothing after it to discard',
    });
    expect(refs.discardTo('main', 'c1', '   ', 'user')).toEqual({ ok: false, detail: 'path name must be a non-empty string' });
    expect(refs.discardTo('main', 'c1', 'premium-focus', 'user')).toEqual({
      ok: false,
      detail: 'a path named "premium-focus" already exists',
    });

    refs.archive('main', 'user');
    expect(refs.discardTo('main', 'c1', 'kept', 'user')).toEqual({ ok: false, detail: 'path "main" is archived — restore it first' });

    expect(refs.events().length).toBe(events + 1); // only the archive above wrote
    expect(refs.branches({ includeArchived: true })).toEqual(listing);
  });
});

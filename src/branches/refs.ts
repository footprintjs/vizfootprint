/**
 * BR-1 — `BranchRefs`: named refs + HEAD, beside the log, never in it.
 *
 * Commits stay frozen (the append-only R8 log is untouched); the refs are the
 * one thing allowed to move. The rules (packet-approved):
 *   - commit while HEAD is on a branch tip → ADVANCE that ref;
 *   - commit while detached (the cursor travelled into the past) →
 *     AUTO-CREATE a new ref, named from the commit's cause (slug-unique with
 *     a counter fallback), and attach HEAD — today's branch-on-act, now named.
 * Every create/advance/switch/rename lands in the ref-event journal (NOT the
 * commit log) with a logical timestamp — even branch bookkeeping is auditable.
 *
 * TL-1 — the trail LIFECYCLE, on one principle: **never erase the record, erase
 * the VIEW.** Refs move; commits are forever.
 *   - `archive(name)` hides a path from the default listing while KEEPING its
 *     name and tip (`tipOf` still answers, so compare/why still work on it).
 *     HEAD may not ride an archived ref — archiving the path HEAD is on
 *     detaches HEAD at that path's tip, so the next act auto-creates a NEW
 *     named ref instead of silently re-advancing an archived one.
 *
 *     **The frozen-ref rule** (ONE rule, three refusals): an archived ref is
 *     frozen where it was left, so every way of TOUCHING a ref refuses it —
 *     `switchTo`, `rename` (both: "restore it first"), and `discardTo` — and
 *     tip-extension skips archived refs for the same reason. Restore it, then
 *     touch it. Two structural invariants fall out, both pinned by tests:
 *     `_archived ⊆ _branches` (never a stale hidden name) and HEAD is NEVER on
 *     an archived ref.
 *   - `restore(name)` is the exact inverse (name, tip, and journal unchanged).
 *   - `discardTo(name, commitId, keepAs)` moves a ref BACK to an earlier commit
 *     and parks the abandoned future under a fresh, immediately-archived ref —
 *     ONE journal transaction, zero deletions.
 */

import type { CommitRecord } from '../log/index.js';
import type { Head, RefEvent, RefState } from './types.js';
import { slugForCommit, uniqueSlug } from './slug.js';

export interface BranchRefsOptions {
  /** The name of the (unborn) branch HEAD starts on. Default `'main'`. */
  readonly defaultName?: string;
}

const MAX_NAME_LENGTH = 64;

/** A rejected ref operation — honest detail string, never a silent no-op (R14). */
function invalidName(name: string): string | null {
  if (name.trim().length === 0) return 'path name must be a non-empty string';
  if (name.length > MAX_NAME_LENGTH) return `path name too long (max ${MAX_NAME_LENGTH} chars)`;
  return null;
}

/** How a listing treats archived refs — hidden by default, never gone. */
export interface BranchListOptions {
  /** Include the archived refs too (flagged by `isArchived`). Default false. */
  readonly includeArchived?: boolean;
}

export class BranchRefs {
  private readonly _branches = new Map<string, string>(); // name → tipCommitId
  /** TL-1: names hidden from the default listing. The refs themselves are untouched. */
  private readonly _archived = new Set<string>();
  private _head: Head;
  private readonly _events: RefEvent[] = [];

  constructor(opts: BranchRefsOptions = {}) {
    this._head = { branch: opts.defaultName ?? 'main' };
  }

  get head(): Head {
    return this._head;
  }

  /**
   * A plain `{name → tipCommitId}` snapshot (fresh object each call). VISIBLE
   * refs only unless `includeArchived` — an archived path is hidden from the
   * default listing, never deleted (its tip stays resolvable via `tipOf`).
   */
  branches(opts: BranchListOptions = {}): Record<string, string> {
    const all = [...this._branches];
    return Object.fromEntries(opts.includeArchived === true ? all : all.filter(([name]) => !this._archived.has(name)));
  }

  /** The ref-event journal (frozen entries, append-only). */
  events(): readonly RefEvent[] {
    return this._events;
  }

  /** Every ref name, archived or not — an archived name still OWNS the namespace. */
  has(name: string): boolean {
    return this._branches.has(name);
  }

  /** TL-1: is this path hidden from the default listing? */
  isArchived(name: string): boolean {
    return this._archived.has(name);
  }

  /** The archived path names, in creation order. */
  archivedNames(): readonly string[] {
    return [...this._branches.keys()].filter((name) => this._archived.has(name));
  }

  /** The tip of ANY ref, archived or not (hidden is not gone — compare/why still resolve it). */
  tipOf(name: string): string | undefined {
    return this._branches.get(name);
  }

  /** The branch HEAD rides, or null when detached. */
  currentBranch(): string | null {
    return 'branch' in this._head ? this._head.branch : null;
  }

  state(): RefState {
    return { branches: this.branches(), head: this._head, archived: this.archivedNames() };
  }

  private get ts(): number {
    return this._events.length;
  }

  private journal(event: RefEvent): void {
    this._events.push(Object.freeze(event));
  }

  /**
   * The VISIBLE ref whose tip is `commitId`, or null. Archived refs are skipped
   * deliberately (TL-1): acting at an archived tip must start a new named path,
   * never silently re-advance the ref someone hid — an archived ref is frozen
   * where it was left.
   */
  private nameOfTip(commitId: string): string | null {
    for (const [name, tip] of this._branches) {
      if (tip === commitId && !this._archived.has(name)) return name;
    }
    return null;
  }

  /**
   * Route a freshly-landed commit through the ref rules (file header). Call
   * AFTER the commit is in the log. Returns which ref the commit landed on
   * and whether that ref was created for it.
   */
  noteCommit(record: CommitRecord): { name: string; created: boolean } {
    const headBranch = this.currentBranch();

    // (a) the unborn default branch: HEAD names a branch with no tip yet and
    //     this is a ROOT commit — the branch is born here.
    if (record.parent === null && headBranch !== null && !this._branches.has(headBranch)) {
      this._branches.set(headBranch, record.id);
      this.journal({ type: 'create', name: headBranch, at: record.id, auto: true, ts: this.ts });
      return { name: headBranch, created: true };
    }

    // (b) tip-extension: the commit extends a known tip → advance that ref
    //     (HEAD's own branch wins when several refs share the tip) + attach.
    //     Extending a tip is unambiguous lane continuation even when HEAD is
    //     detached AT that tip (git-parity: the lane simply grows).
    if (record.parent !== null) {
      const name =
        headBranch !== null && this._branches.get(headBranch) === record.parent
          ? headBranch
          : this.nameOfTip(record.parent);
      if (name !== null) {
        this._branches.set(name, record.id);
        this._head = { branch: name };
        this.journal({ type: 'advance', name, at: record.id, ts: this.ts });
        return { name, created: false };
      }
    }

    // (c) detached / mid-history — branch-on-act, now NAMED: auto-create a
    //     cause-slugged unique ref and attach HEAD.
    const name = uniqueSlug(slugForCommit(record), (n) => this._branches.has(n));
    this._branches.set(name, record.id);
    this._head = { branch: name };
    this.journal({ type: 'create', name, at: record.id, auto: true, ts: this.ts });
    return { name, created: true };
  }

  /**
   * Attach HEAD to a named ref (journaled). Unknown name → honest rejection.
   * An ARCHIVED name is refused too (TL-1): riding it would let the next act
   * advance a hidden ref, resurrecting it by accident — restore it first.
   */
  switchTo(name: string): { ok: true; tip: string } | { ok: false; detail: string } {
    const tip = this._branches.get(name);
    if (tip === undefined) return { ok: false, detail: `no path named "${name}"` };
    if (this._archived.has(name)) return { ok: false, detail: `path "${name}" is archived — restore it first` };
    this._head = { branch: name };
    this.journal({ type: 'switch', to: name, at: tip, ts: this.ts });
    return { ok: true, tip };
  }

  /** Detach HEAD at a commit (the cursor travelled by id, not by name). Journaled. */
  detach(commitId: string | null): void {
    this._head = { detached: commitId };
    this.journal({ type: 'switch', to: null, at: commitId, ts: this.ts });
  }

  /** Create a ref at a commit and attach HEAD (journaled, `auto:false` — user-named). */
  createAt(name: string, commitId: string): { ok: true; name: string } | { ok: false; detail: string } {
    const invalid = invalidName(name);
    if (invalid !== null) return { ok: false, detail: invalid };
    if (this._branches.has(name)) return { ok: false, detail: `a path named "${name}" already exists` };
    this._branches.set(name, commitId);
    this._head = { branch: name };
    this.journal({ type: 'create', name, at: commitId, auto: false, ts: this.ts });
    return { ok: true, name };
  }

  /**
   * Rename a ref; HEAD follows if attached to it (journaled).
   *
   * An ARCHIVED `from` is REFUSED (TL-1 — the frozen-ref rule, see the file
   * header): renaming is the third way to touch a ref, so it answers exactly
   * like `switchTo` and `discardTo`. Two real bugs live behind a permissive
   * rename, and the refusal closes both: the name would arrive UN-archived
   * (a silent resurrection, with no `restore` event in the journal and HEAD
   * free to ride it), and the OLD name would be left in `_archived` while
   * absent from `_branches` — a stale entry that would make the next ref born
   * under that name secretly archived and invisible in `paths()`. The refusal
   * is what keeps `_archived ⊆ _branches` true for every code path.
   */
  rename(from: string, to: string): { ok: true } | { ok: false; detail: string } {
    const tip = this._branches.get(from);
    if (tip === undefined) return { ok: false, detail: `no path named "${from}"` };
    if (this._archived.has(from)) return { ok: false, detail: `path "${from}" is archived — restore it first` };
    const invalid = invalidName(to);
    if (invalid !== null) return { ok: false, detail: invalid };
    if (this._branches.has(to)) return { ok: false, detail: `a path named "${to}" already exists` };
    this._branches.delete(from);
    this._branches.set(to, tip);
    if (this.currentBranch() === from) this._head = { branch: to };
    this.journal({ type: 'rename', from, to, ts: this.ts });
    return { ok: true };
  }

  // ── TL-1: the lifecycle — archive / restore / discard-from-here ─────────────

  /**
   * HIDE a path from the default listing, keeping its name and tip (never a
   * deletion — `tipOf(name)` still answers and every commit stays in the log).
   *
   * The HEAD rule: archiving the path HEAD rides DETACHES HEAD at that path's
   * tip. You keep standing exactly where you were, but on no named path, so
   * the next act auto-creates a fresh named ref (the existing branch-on-act
   * rule) instead of quietly re-advancing something you just hid.
   *
   * The last VISIBLE path cannot be archived — hiding it would leave nothing
   * to stand on (a typed rejection, never a silent no-op).
   */
  archive(name: string, by: string): { ok: true; tip: string; detached: boolean } | { ok: false; detail: string } {
    const tip = this._branches.get(name);
    if (tip === undefined) return { ok: false, detail: `no path named "${name}"` };
    if (this._archived.has(name)) return { ok: false, detail: `path "${name}" is already archived` };
    if (Object.keys(this.branches()).length <= 1) {
      return { ok: false, detail: `"${name}" is the only visible path — start another one before archiving it` };
    }
    this._archived.add(name);
    this.journal({ type: 'archive', name, at: tip, by, ts: this.ts });
    const detached = this.currentBranch() === name;
    if (detached) this.detach(tip); // HEAD may never ride an archived ref
    return { ok: true, tip, detached };
  }

  /** The exact inverse of {@link archive}: the path is listed again, unchanged. */
  restore(name: string, by: string): { ok: true; tip: string } | { ok: false; detail: string } {
    const tip = this._branches.get(name);
    if (tip === undefined) return { ok: false, detail: `no path named "${name}"` };
    if (!this._archived.has(name)) return { ok: false, detail: `path "${name}" is not archived` };
    this._archived.delete(name);
    this.journal({ type: 'restore', name, at: tip, by, ts: this.ts });
    return { ok: true, tip };
  }

  /**
   * Move `name`'s ref BACK to `commitId` and park the abandoned future under a
   * fresh ref called `keepAs`, archived on arrival — ONE journal transaction
   * (create → archive → discard → attach), validated in full before the first
   * event is written, so a rejection leaves the journal untouched.
   *
   * NOTHING is deleted: the old tip is still a real commit, still foldable by
   * id, and one `restore(keepAs)` away from being listed again. HEAD attaches
   * to `name` at `commitId` — the next act extends the path you just rewound.
   */
  discardTo(
    name: string,
    commitId: string,
    keepAs: string,
    by: string,
  ): { ok: true; kept: string; from: string } | { ok: false; detail: string } {
    const from = this._branches.get(name);
    if (from === undefined) return { ok: false, detail: `no path named "${name}"` };
    if (this._archived.has(name)) return { ok: false, detail: `path "${name}" is archived — restore it first` };
    if (from === commitId) return { ok: false, detail: `path "${name}" already ends at "${commitId}" — there is nothing after it to discard` };
    const invalid = invalidName(keepAs);
    if (invalid !== null) return { ok: false, detail: invalid };
    if (this._branches.has(keepAs)) return { ok: false, detail: `a path named "${keepAs}" already exists` };

    this._branches.set(keepAs, from);
    this.journal({ type: 'create', name: keepAs, at: from, auto: true, ts: this.ts });
    this._archived.add(keepAs);
    this.journal({ type: 'archive', name: keepAs, at: from, by, ts: this.ts });
    this._branches.set(name, commitId);
    this.journal({ type: 'discard', name, from, to: commitId, kept: keepAs, by, ts: this.ts });
    if (this.currentBranch() !== name) {
      // HEAD was detached (the usual "step back, then discard") — attach it to
      // the rewound path so the next act extends it. Journaled like any switch.
      this._head = { branch: name };
      this.journal({ type: 'switch', to: name, at: commitId, ts: this.ts });
    }
    return { ok: true, kept: keepAs, from };
  }

  /**
   * Seed derived names (a legacy anonymous log run through `deriveBranches`).
   * Existing names are never clobbered; HEAD does not move. Returns the names
   * actually adopted (each journaled `auto:true`).
   */
  adopt(branches: Readonly<Record<string, string>>): string[] {
    const adopted: string[] = [];
    for (const [name, tip] of Object.entries(branches)) {
      if (this._branches.has(name)) continue;
      this._branches.set(name, tip);
      this.journal({ type: 'create', name, at: tip, auto: true, ts: this.ts });
      adopted.push(name);
    }
    return adopted;
  }
}

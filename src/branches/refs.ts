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

export class BranchRefs {
  private readonly _branches = new Map<string, string>(); // name → tipCommitId
  private _head: Head;
  private readonly _events: RefEvent[] = [];

  constructor(opts: BranchRefsOptions = {}) {
    this._head = { branch: opts.defaultName ?? 'main' };
  }

  get head(): Head {
    return this._head;
  }

  /** A plain `{name → tipCommitId}` snapshot (fresh object each call). */
  branches(): Record<string, string> {
    return Object.fromEntries(this._branches);
  }

  /** The ref-event journal (frozen entries, append-only). */
  events(): readonly RefEvent[] {
    return this._events;
  }

  has(name: string): boolean {
    return this._branches.has(name);
  }

  tipOf(name: string): string | undefined {
    return this._branches.get(name);
  }

  /** The branch HEAD rides, or null when detached. */
  currentBranch(): string | null {
    return 'branch' in this._head ? this._head.branch : null;
  }

  state(): RefState {
    return { branches: this.branches(), head: this._head };
  }

  private get ts(): number {
    return this._events.length;
  }

  private journal(event: RefEvent): void {
    this._events.push(Object.freeze(event));
  }

  private nameOfTip(commitId: string): string | null {
    for (const [name, tip] of this._branches) {
      if (tip === commitId) return name;
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

  /** Attach HEAD to a named ref (journaled). Unknown name → honest rejection. */
  switchTo(name: string): { ok: true; tip: string } | { ok: false; detail: string } {
    const tip = this._branches.get(name);
    if (tip === undefined) return { ok: false, detail: `no path named "${name}"` };
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

  /** Rename a ref; HEAD follows if attached to it (journaled). */
  rename(from: string, to: string): { ok: true } | { ok: false; detail: string } {
    const tip = this._branches.get(from);
    if (tip === undefined) return { ok: false, detail: `no path named "${from}"` };
    const invalid = invalidName(to);
    if (invalid !== null) return { ok: false, detail: invalid };
    if (this._branches.has(to)) return { ok: false, detail: `a path named "${to}" already exists` };
    this._branches.delete(from);
    this._branches.set(to, tip);
    if (this.currentBranch() === from) this._head = { branch: to };
    this.journal({ type: 'rename', from, to, ts: this.ts });
    return { ok: true };
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

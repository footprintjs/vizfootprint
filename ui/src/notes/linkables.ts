/**
 * WHAT A NOTE MAY LINK TO — derived from the state, never kept by hand: the
 * saved selections by name, the checkpoints by label, the live selections and
 * the recent commits by id, each with the words a person would recognise it
 * by. The same list feeds the picker and the mention grammar's world, and the
 * two agree by construction: every mention the picker inserts resolves. A
 * name the bracketed form cannot carry (a `]` inside it, a line break, a space
 * at either end) is inserted by its commit id instead; two saves under one
 * name resolve to the NEWEST, and the older one is offered by its id.
 */
import type { MentionWorld } from '../../../src/prose/index.js';
import type { SessionViewState } from '../adapter/types.js';

export interface Linkable {
  readonly kind: 'saved' | 'beat' | 'selection' | 'commit';
  /** The mention to type: `@[name]` for a saved selection or a beat, `#id` for a commit. */
  readonly mention: string;
  readonly label: string;
  readonly description: string;
}

/** The saved selections — every adapter wire carries the list; an older wire without it has none to link. */
function savedOf(state: SessionViewState): NonNullable<SessionViewState['saved']> {
  /* v8 ignore next -- an older wire without `saved`: the adapters in this repo always set it */
  return state.saved ?? [];
}

/** Can `@[name]` carry this name back out unchanged? The grammar stops at the first `]` or line break and trims the name. */
export function bracketSafe(name: string): boolean {
  return name.length > 0 && name === name.trim() && !/[\]\n]/.test(name);
}

/** How many recent commits the picker lists (placeholder — the log is the full list, the picker is a reach). */
export const RECENT_COMMITS = 12;

/** The picker's list, most useful first: saved selections, checkpoints, live selections, then the newest commits. */
export function linkablesOf(state: SessionViewState): readonly Linkable[] {
  const out: Linkable[] = [];
  const byName = new Set<string>();
  for (const s of savedOf(state)) {
    // newest first: the first row with a name owns `@[name]`; an older save under the same name is reached by its id
    const older = byName.has(s.name);
    byName.add(s.name);
    const byId = older || !bracketSafe(s.name);
    out.push({ kind: 'saved', mention: byId ? `#${s.commitId}` : `@[${s.name}]`, label: s.name, description: `saved selection · ${s.viewId}: ${s.field} ${s.kind}${older ? ` · an older save, #${s.commitId}` : ''}` });
  }
  for (const c of state.checkpoints) {
    if (bracketSafe(c.label)) out.push({ kind: 'beat', mention: `@[${c.label}]`, label: c.label, description: `checkpoint${c.commitId !== null ? ` · #${c.commitId}` : ''}` });
    else if (c.commitId !== null) out.push({ kind: 'beat', mention: `#${c.commitId}`, label: c.label, description: `checkpoint · #${c.commitId}` });
    // a beat with no commit of its own and a label the grammar cannot carry has no mention — it is not offered
  }
  for (const sel of state.selections) {
    if (sel.commitId === undefined) continue;
    out.push({ kind: 'selection', mention: `#${sel.commitId}`, label: `${sel.viewId}: ${sel.field}`, description: `live selection · #${sel.commitId}` });
  }
  const recent = state.commits.slice(-RECENT_COMMITS).reverse();
  for (const c of recent) out.push({ kind: 'commit', mention: `#${c.id}`, label: `#${c.id} ${c.label}`, description: c.intent !== undefined ? `${c.intent} · ${c.actor}` : c.actor });
  return out;
}

/** The mention grammar's world for this state: every commit the log holds, every beat named, every saved selection by name. */
export function mentionWorldOf(state: SessionViewState): MentionWorld {
  return {
    commits: new Map(state.commits.map((c) => [c.id, c.intent !== undefined ? `${c.label} — ${c.intent}` : c.label])),
    beats: new Set(state.checkpoints.map((c) => c.label)),
    saved: new Set(savedOf(state).map((s) => s.name)), // saved logic by name: a `@[name]` ref applies the condition
  };
}

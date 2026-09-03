/**
 * WHAT A NOTE MAY LINK TO — derived from the state, never kept by hand: the
 * saved selections by name, the bookmarks by label, the live selections and
 * the recent commits by id, each with the words a person would recognise it
 * by. The same list feeds the picker and the mention grammar's world, and the
 * two agree by construction: every mention the picker inserts resolves. A
 * name the bracketed form cannot carry (a `]` inside it, a line break, a space
 * at either end) is offered as a COMMIT where one exists, and not at all where
 * none does.
 *
 * A ref carries an ID, never a name — that is what lets a record be renamed
 * without touching a word of the prose — so the mention world maps name → id.
 * A bookmark carries its own id (`b1`, …) and a saved picture its own (`p1`, …),
 * both minted by their store. A saved picture is NOT a commit and names none, so
 * a name the bracketed form cannot carry has no mention at all — it is not
 * offered, the same rule a bookmark without an id already followed. A bookmark
 * from a wire that predates bookmark ids has no id to link, so it is offered by
 * its commit instead of by its name: the picker and the world stay in step.
 */
import type { MentionWorld } from 'vizfootprint/prose';
import type { SavedSelectionView, SessionViewState } from '../adapter/types.js';

export interface Linkable {
  readonly kind: 'saved' | 'bookmark' | 'selection' | 'commit';
  /** The mention to type: `@[name]` for a saved selection or a bookmark, `#id` for a commit. */
  readonly mention: string;
  readonly label: string;
  readonly description: string;
}

/** The picture's conditions in a phrase — what a writer picks it out by ("bar: category point, map: region match"). */
function savedWords(s: SavedSelectionView): string {
  return s.conditions.map((c) => `${c.viewId}: ${c.field} ${c.kind}`).join(', ');
}

/** Can `@[name]` carry this name back out unchanged? The grammar stops at the first `]` or line break and trims the name. */
export function bracketSafe(name: string): boolean {
  return name.length > 0 && name === name.trim() && !/[\]\n]/.test(name);
}

/** How many recent commits the picker lists (placeholder — the log is the full list, the picker is a reach). */
export const RECENT_COMMITS = 12;

/** The picker's list, most useful first: saved selections, bookmarks, live selections, then the newest commits. */
export function linkablesOf(state: SessionViewState): readonly Linkable[] {
  const out: Linkable[] = [];
  for (const s of state.saved) {
    // a picture is saved LOGIC, not a moment: it has no commit to fall back on, so a name
    // the grammar cannot carry has no mention and is simply not offered
    if (!bracketSafe(s.name)) continue;
    out.push({ kind: 'saved', mention: `@[${s.name}]`, label: s.name, description: `saved selection · ${savedWords(s)}` });
  }
  for (const c of state.bookmarks) {
    if (c.id !== undefined && bracketSafe(c.label)) out.push({ kind: 'bookmark', mention: `@[${c.label}]`, label: c.label, description: `bookmark${c.commitId !== null ? ` · #${c.commitId}` : ''}` });
    else if (c.commitId !== null) out.push({ kind: 'bookmark', mention: `#${c.commitId}`, label: c.label, description: `bookmark · #${c.commitId}` });
    // a bookmark with no commit of its own and a label the grammar cannot carry has no mention — it is not offered
  }
  for (const sel of state.selections) {
    if (sel.commitId === undefined) continue;
    out.push({ kind: 'selection', mention: `#${sel.commitId}`, label: `${sel.viewId}: ${sel.field}`, description: `live selection · #${sel.commitId}` });
  }
  const recent = state.commits.slice(-RECENT_COMMITS).reverse();
  for (const c of recent) out.push({ kind: 'commit', mention: `#${c.id}`, label: `#${c.id} ${c.label}`, description: c.intent !== undefined ? `${c.intent} · ${c.actor}` : c.actor });
  return out;
}

/**
 * The mention grammar's world for this state: every commit the log holds, and
 * every bookmark and saved picture by NAME → the id a ref carries. Two pictures
 * never share a name (the store refuses a duplicate at save, at rename and at
 * restore), so a picture name resolves to exactly one; two BOOKMARKS may share
 * one, and there the first row wins — the same one the picker offers `@[name]`.
 */
export function mentionWorldOf(state: SessionViewState): MentionWorld {
  const bookmarks = new Map<string, string>();
  for (const c of state.bookmarks) if (c.id !== undefined && !bookmarks.has(c.label)) bookmarks.set(c.label, c.id);
  const saved = new Map<string, string>();
  for (const s of state.saved) if (!saved.has(s.name)) saved.set(s.name, s.id); // the PICTURE's id — what the library's ref validator judges, and what a rename never moves
  return {
    commits: new Map(state.commits.map((c) => [c.id, c.intent !== undefined ? `${c.label} — ${c.intent}` : c.label])),
    bookmarks,
    saved,
  };
}

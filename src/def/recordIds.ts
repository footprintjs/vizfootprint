/**
 * IDS FOR THE RECORDS BESIDE THE LOG — a saved selection is `p1`, `p2`… (a
 * picture), a bookmark is `b1`, `b2`…. The id, not the name, is what a note's words
 * link, so renaming a record is free: the link still points at the same thing
 * and only the display words go stale.
 *
 * The store mints them, and it NEVER MINTS A NUMBER TWICE: it carries a
 * counter that only goes up (the precedent is the commit log's own `s1`,
 * `s2`, … on an append-only log). The next id is one past the highest number
 * the store has minted OR now holds, whichever is higher — so forgetting a
 * record does not free its number, and a record a host restores as `p7`
 * pushes the counter past 7 even on a store that has minted nothing.
 *
 * THE SCOPE IS THE DASHBOARD, not the session — for pictures, for bookmarks,
 * and (since the identity fix) for commits too. These records name each other
 * ACROSS sessions: a bookmark holds a commit id, and both the bookmark store
 * and the commit counter are read by every session on the dashboard. Two
 * sessions minting `s1` each meant a bookmark made in one silently found a
 * different act in the other. See src/log/README.md, "Law 2".
 *
 * WHY the counter and not just "one past the highest id in the store":
 * forgetting is refused while words on screen link the record, but the words
 * on screen are the ones the CURRENT CURSOR sees. Seek to an earlier moment
 * (or another branch) and the note that links `p1` is invisible; forget the
 * picture there, save a new one, and the old note would come back pointing at
 * a different picture — a wrong filter, silently. A number that has been
 * handed out is spent for the life of the store.
 */

/** The prefix a commit's id carries (`s1`, `s2`, …). */
export const COMMIT_ID_PREFIX = 's';

/** The prefix a saved selection's id carries. */
export const PICTURE_ID_PREFIX = 'p';

/** The prefix a bookmark's id carries. */
export const BOOKMARK_ID_PREFIX = 'b';

/** What minting needs of a store: the records it holds, and `minted` — the highest number it has ever handed out. */
export interface RecordStore {
  readonly list: readonly { readonly id: string }[];
  minted: number;
}

/**
 * The number an id names under `prefix` — 0 when it names none of this
 * store's. DIGITS ONLY: `p1e3` and `p0x10` are another system's names, not
 * the numbers 1000 and 16 that `Number` would read out of them (a host
 * restoring one would jump the store's numbering by a thousand).
 */
function numberOf(prefix: string, id: string): number {
  if (!id.startsWith(prefix)) return 0;
  const digits = id.slice(prefix.length);
  return /^\d+$/.test(digits) ? Number(digits) : 0;
}

/** The next id the store hands out: one past the highest number it has minted or now holds, written back to the counter so it is never handed out again. */
export function mintRecordId(prefix: string, store: RecordStore): string {
  let highest = store.minted;
  for (const record of store.list) highest = Math.max(highest, numberOf(prefix, record.id));
  store.minted = highest + 1;
  return `${prefix}${store.minted}`;
}

/**
 * Raise a counter past every number these ids name under `prefix`.
 *
 * A record a host puts back POINTS AT other records — a bookmark names a
 * commit, a picture names the commits it was saved from — and a number that is
 * already pointed at must never be handed out again. Without this, a fresh
 * dashboard whose counter starts at 0 could mint the very commit id a restored
 * bookmark already names, and the bookmark would silently start resolving to a
 * real but WRONG act: the same collision the per-session counter used to cause,
 * one door along. Same digits-only rule as {@link mintRecordId}.
 */
export function raiseMinted(prefix: string, ids: readonly string[], store: { minted: number }): void {
  for (const id of ids) store.minted = Math.max(store.minted, numberOf(prefix, id));
}

/**
 * The id a restored record should carry: the one it arrived with when that is
 * a name no record in the store holds, a fresh one otherwise. `assigned` says
 * the store had to name it — the caller reports that, so an id is never
 * quietly overwritten. Either way the counter clears what came back: a kept
 * `p7` raises it to 7, so the store can never mint `p7` again.
 */
export function restoredRecordId(prefix: string, carried: string | undefined, store: RecordStore): { readonly id: string; readonly assigned: boolean } {
  if (carried !== undefined && !store.list.some((record) => record.id === carried)) {
    store.minted = Math.max(store.minted, numberOf(prefix, carried));
    return { id: carried, assigned: false };
  }
  return { id: mintRecordId(prefix, store), assigned: true };
}

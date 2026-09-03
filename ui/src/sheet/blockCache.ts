/**
 * THE VERSIONED BLOCK CACHE — one per sheet, shared by both adapters.
 *
 * Scrolling a grid asks for overlapping windows: rows 0–40, then 8–48, then
 * 16–56. Sent straight through, that is one engine call (or one network hop)
 * per frame. So a window is served out of fixed BLOCKS of `blockRows` rows,
 * and only the blocks that are missing are fetched — as ONE range, never one
 * call per block. The blocks are an LRU: a served block moves to the back, and
 * the front is dropped when the map is full.
 *
 * TWO KEYS, NOT ONE.
 *   • The QUESTION — table, view, columns, sort. Change it and the blocks are
 *     about other rows: they are forgotten.
 *   • The STAMP — the data version and the cursor. The blocks wear the stamp
 *     of the ANSWER that filled them, never of the ask. A host whose polled
 *     cursor is one poll behind therefore asks with the old stamp, gets an
 *     answer stamped with the live one, and it applies — no refusal, and the
 *     next ask (with the caught-up prop) is a hit. Only when the answer's own
 *     stamp differs from the blocks' are they dropped: two versions never
 *     share a grid.
 *
 * ANSWERS APPLY IN REQUEST ORDER, AND ONLY TO THE QUESTION THEY WERE ASKED
 * UNDER. Every ask carries a sequence number and the question it was made
 * under; an answer whose number is below the last APPLIED one, or whose
 * question the cache has since left, is dropped silently (`null`) — a fresher
 * answer is already on screen, and there is nothing to tell.
 *
 * Pure where it can be: `blockKey`, `questionKey`, `blockRange`, `sliceWindow`
 * and `splitBlocks` are functions over their arguments.
 */
import type { SheetRefusal, SheetWindow, SortSpec } from './types.js';
import type { Row } from '../../../src/data/index.js';

/** How many rows one block holds (placeholder — the bench decides the real one). */
export const SHEET_BLOCK_ROWS = 100;
/** How many blocks a sheet keeps before the least recently served is dropped (placeholder). */
export const SHEET_MAX_BLOCKS = 50;

/** Everything that makes a window's rows the rows they are. */
export interface BlockKeyParts {
  readonly table?: string;
  readonly viewId?: string;
  readonly columns?: readonly string[];
  readonly sort?: readonly SortSpec[];
  /**
   * The table's data version the host believes it is at. It is part of the ASK
   * (a moved version means "ask again"), never of what the blocks are about —
   * the blocks wear the answer's own stamp.
   */
  readonly version?: string | null;
  /** The cursor commit the host believes it is at — same rule as `version`. */
  readonly cursor?: string | null;
}

/** WHICH ROWS, in what order — JSON, so a column called `a,b` can never collide with a delimiter. */
export function questionKey(parts: BlockKeyParts): string {
  return JSON.stringify([parts.table ?? null, parts.viewId ?? null, parts.columns ?? null, parts.sort ?? null]);
}

/** The whole ask, question and stamp — what a host uses to tell two asks apart. */
export function blockKey(parts: BlockKeyParts): string {
  return JSON.stringify([questionKey(parts), parts.version ?? null, parts.cursor ?? null]);
}

/** Which blocks a window touches, first and last inclusive. */
export function blockRange(offset: number, limit: number, blockRows: number): { readonly first: number; readonly last: number } {
  return { first: Math.floor(offset / blockRows), last: Math.floor((offset + limit - 1) / blockRows) };
}

/** The part of one answer a caller asked for — the answer always starts at or before the request. */
export function sliceWindow(answer: SheetWindow, offset: number, limit: number): SheetWindow {
  const from = offset - answer.start;
  return { ...answer, rows: answer.rows.slice(from, from + limit), rowIds: answer.rowIds.slice(from, from + limit), start: offset };
}

/** One row of a block: the row and the identity that rides with it, kept together so they can never drift apart. */
export interface SheetEntry {
  readonly row: Row;
  readonly id: string;
}

/** One block: `blockRows` rows of the table in window order (the last block of a table is short). */
export type SheetBlock = readonly SheetEntry[];

/**
 * One answer cut into blocks — only the COMPLETE ones. A block is complete
 * when it holds every row the count says it should (a full block, or the
 * table's short tail); a half-filled block would later serve a short window
 * and the grid would show a gap that is not in the data.
 */
export function splitBlocks(answer: SheetWindow, blockRows: number): Map<number, SheetBlock> {
  const out = new Map<number, SheetBlock>();
  const entries = answer.rows.map((row, i) => ({ row, id: answer.rowIds[i] ?? '' }));
  const { first, last } = blockRange(answer.start, Math.max(entries.length, 1), blockRows);
  for (let b = first; b <= last; b++) {
    const from = b * blockRows - answer.start;
    const block = entries.slice(from, from + blockRows);
    const expected = Math.max(0, Math.min(blockRows, answer.count - b * blockRows));
    if (block.length === expected) out.set(b, block);
  }
  return out;
}

/** What a held window remembers besides its rows — the stamp is the ANSWER's, never the ask's. */
interface BlockMeta {
  readonly columns: readonly string[];
  readonly positional: boolean;
  readonly key: string | undefined;
  readonly count: number;
  readonly version: string | null;
  readonly cursor: string | null;
}

export interface BlockCacheOptions {
  readonly blockRows?: number;
  readonly maxBlocks?: number;
}

/** Fetch one aligned range from the data layer — the ONE call a miss costs. */
export type RangeFetch = (offset: number, limit: number) => Promise<SheetWindow | SheetRefusal>;

export interface BlockCache {
  /**
   * Serve one window from the blocks, or fetch the missing range as one call.
   * `null` means the answer was superseded — a fresher one is already applied,
   * so there is nothing new to show and nothing to say.
   */
  window(parts: BlockKeyParts, offset: number, limit: number, fetch: RangeFetch): Promise<SheetWindow | SheetRefusal | null>;
  /** Forget everything — for a host that knows the question changed under it. */
  invalidate(): void;
  /** How many blocks are held (what a test counts). */
  readonly size: number;
}

export function createBlockCache(options: BlockCacheOptions = {}): BlockCache {
  const blockRows = options.blockRows ?? SHEET_BLOCK_ROWS;
  const maxBlocks = options.maxBlocks ?? SHEET_MAX_BLOCKS;
  let question: string | null = null;
  let meta: BlockMeta | null = null;
  const blocks = new Map<number, SheetBlock>();
  // monotonic ACROSS questions: an answer to a question we have left must never overtake a newer one
  let requests = 0;
  let applied = 0;

  const forget = (): void => {
    meta = null;
    blocks.clear();
  };

  /** Do the held blocks answer the moment the host asked about? (It said nothing = anything it is told.) */
  const stampAgrees = (parts: BlockKeyParts, held: BlockMeta): boolean =>
    (parts.version === undefined || parts.version === held.version) && (parts.cursor === undefined || parts.cursor === held.cursor);

  /** Every row of the window out of the blocks, or null when one is missing. A served block moves to the back (LRU). */
  const served = (held: BlockMeta, offset: number, limit: number): SheetWindow | null => {
    const end = Math.min(offset + limit, held.count);
    const rows: Row[] = [];
    const rowIds: string[] = [];
    const touched: number[] = [];
    for (let i = offset; i < end; i++) {
      const at = Math.floor(i / blockRows);
      const block = blocks.get(at);
      if (block === undefined) return null;
      // a HELD block is a complete one (`splitBlocks`), so every row below the count is in it
      const entry = block[i - at * blockRows]!;
      rows.push(entry.row);
      rowIds.push(entry.id);
      if (touched[touched.length - 1] !== at) touched.push(at);
    }
    for (const at of touched) {
      const block = blocks.get(at)!;
      blocks.delete(at);
      blocks.set(at, block); // used = newest: the LRU front stays the one nobody is reading
    }
    return { ok: true, columns: held.columns, rows, rowIds, positional: held.positional, ...(held.key !== undefined ? { key: held.key } : {}), count: held.count, start: offset, version: held.version, cursor: held.cursor };
  };

  return {
    get size() {
      return blocks.size;
    },
    invalidate: forget,
    async window(parts, offset, limit, fetch) {
      const asked = questionKey(parts);
      if (asked !== question) {
        forget();
        question = asked;
      }
      const held = meta;
      if (held !== null && stampAgrees(parts, held)) {
        const hit = served(held, offset, limit);
        if (hit !== null) return hit;
      }
      const { first, last } = blockRange(offset, limit, blockRows);
      const mine = ++requests;
      const forQuestion = asked; // an in-flight ask belongs to the question it was made under
      const answer = await fetch(first * blockRows, (last - first + 1) * blockRows);
      if (question !== forQuestion) return null; // the question moved on: this answer is about other rows
      if (!answer.ok) return answer; // the engine's own refusal, sentence and all, rides through
      if (mine < applied) return null; // a fresher answer is already on screen: nothing to show, nothing to say
      applied = mine;
      // two versions never share a grid: an answer stamped differently replaces the blocks rather than joining them
      if (meta !== null && (meta.version !== answer.version || meta.cursor !== answer.cursor)) blocks.clear();
      meta = { columns: answer.columns, positional: answer.positional, key: answer.key, count: answer.count, version: answer.version, cursor: answer.cursor };
      for (const [index, block] of splitBlocks(answer, blockRows)) blocks.set(index, block);
      for (const oldest of blocks.keys()) {
        if (blocks.size <= maxBlocks) break;
        blocks.delete(oldest);
      }
      return sliceWindow(answer, offset, limit);
    },
  };
}

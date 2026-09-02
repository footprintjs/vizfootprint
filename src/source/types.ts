/**
 * The data-source layer (layer 1): where a table's rows COME FROM, stated as
 * three independent tags a def carries — what shape the bytes are (`format`),
 * how they travel (`via`), where they live (`at`) — and ONE small port a
 * carrier implements. No clause ever reaches a source: the query port
 * (`DataProvider`) stays on top, unchanged. See ./README.md.
 */
import type { Row } from '../data/types.js';

/** What shape the bytes are. */
export const SOURCE_FORMATS = ['rows', 'csv', 'json'] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

/** How they travel. `inline` is the def itself; `file` is a path or file URL read by the process; `http` is declared now and carried by the adapter of step 5. */
export const SOURCE_VIAS = ['inline', 'file', 'http'] as const;
export type SourceVia = (typeof SOURCE_VIAS)[number];

/** A table's source, as a def states it. Inert data (R12): echoed, never executed. */
export interface SourceDecl {
  readonly format: SourceFormat;
  readonly via: SourceVia;
  /** Where: the inline payload itself (`via: 'inline'`), or a path / URL string. */
  readonly at?: unknown;
  /** Per-carrier options, echoed to the adapter (a CSV delimiter, a JSON path). */
  readonly options?: Readonly<Record<string, unknown>>;
}

/** What a source can do, declared when it opens — only what is declared may be relied on. */
export interface SourceCapabilities {
  /** The source can deliver deltas after the snapshot. */
  readonly live: boolean;
  /** The source can be asked with a predicate. Always false today: a source produces rows, the query port judges them. */
  readonly pushdown: false;
}

/** One reading of a source: the rows, a version the adapter can vouch for, and when it was read. */
/** What a snapshot may be asked: an abort signal, and the version the caller already holds (a conditional read). */
export interface SnapshotOptions {
  readonly signal?: AbortSignal;
  /**
   * The version the caller holds; a carrier that can tell answers `{ unchanged: true }`
   * without moving the bytes. Each carrier's version is only as sharp as what it
   * vouches for: the file carrier's `mtime;size` reads "unchanged" for bytes rewritten
   * in the same second at the same size (a restored mtime, a coarse file system);
   * the http carrier trusts the server's validator. A hash would cost the read the
   * conditional exists to avoid, so the assumption is stated rather than hidden.
   */
  readonly sinceVersion?: string;
}

/** The answer to a conditional read whose version still holds. */
export interface SourceUnchanged {
  readonly unchanged: true;
  readonly version: string;
}

export const isUnchanged = (s: SourceSnapshot | SourceUnchanged): s is SourceUnchanged => 'unchanged' in s;

export interface SourceSnapshot {
  readonly rows: readonly Row[];
  /** What the adapter knows of the bytes' identity: a file's modification time and size, an inline payload's length. */
  readonly version: string;
  /** ISO 8601. */
  readonly retrievedAt: string;
}

export interface SourceHandle {
  readonly capabilities: SourceCapabilities;
  /**
   * The rows as of now. A carrier honours `signal` where its transport can be
   * cut (a read, a request) and answers `sinceVersion` with `{ unchanged }`
   * when its version still holds (a stat, a 304, a hash compare); a delta
   * channel gated by `live` arrives with the streaming carrier.
   */
  snapshot(options?: SnapshotOptions): Promise<SourceSnapshot | SourceUnchanged>;
  close(): Promise<void>;
}

/** The port a carrier implements: one file per carrier, never a vendor's spelling in the core. */
export interface SourceAdapter {
  readonly via: SourceVia;
  open(decl: SourceDecl, ctx: { readonly table: string }): Promise<SourceHandle>;
}

/** What a built dashboard records about a table's source — the provenance a caption may quote. */
export interface SourceInfo {
  readonly format: SourceFormat;
  readonly via: SourceVia;
  /** The locator, when it was a string (an inline payload is not repeated). */
  readonly at?: string;
  readonly version: string;
  readonly retrievedAt: string;
  readonly rows: number;
}

/** A source's refusal: a sentence a program can branch on. */
/**
 * The closed vocabulary of source refusals — the reason a caller can branch on.
 * `no-adapter`: no carrier for the via · `malformed`: the locator or the payload
 * is not what the format needs · `unavailable`: the place exists but did not
 * answer with data (a missing file, a 404, a 500) · `unauthorized`: 401 / 403 ·
 * `disconnected`: no connection at all · `timeout`: no answer in time ·
 * `cancelled`: the caller's signal aborted · `too-large`: the body exceeds the
 * carrier's byte cap · `no-live` / `no-pushdown`: a capability the adapter
 * declared false was relied on anyway.
 */
export const SOURCE_REFUSALS = ['no-adapter', 'malformed', 'unavailable', 'unauthorized', 'disconnected', 'timeout', 'cancelled', 'too-large', 'no-live', 'no-pushdown'] as const;
export type SourceRefusalReason = (typeof SOURCE_REFUSALS)[number];

/** What a caller gets if it ignores a capability the adapter declared false. */
export const CAPABILITY_REFUSALS = { live: 'no-live', pushdown: 'no-pushdown' } as const satisfies Record<keyof SourceCapabilities, SourceRefusalReason>;

/**
 * A refusal a carrier throws: a typed reason, the table and via it names, and
 * one sentence. `name` lives on the prototype (not an own field), so
 * `JSON.stringify` keeps the sentence; `toJSON` carries the typed fields too.
 */
export class SourceRefusal extends Error {
  constructor(
    readonly reason: SourceRefusalReason,
    message: string,
    readonly table: string,
    readonly via: SourceVia,
  ) {
    super(message);
  }
  toJSON(): { readonly name: 'SourceRefusal'; readonly reason: SourceRefusalReason; readonly message: string; readonly table: string; readonly via: SourceVia } {
    return { name: 'SourceRefusal', reason: this.reason, message: this.message, table: this.table, via: this.via };
  }
}
SourceRefusal.prototype.name = 'SourceRefusal';

/** A brand check, not only `instanceof`: a refusal from a second copy of this module, another realm, or a structured clone still reads as one. */
export const isSourceRefusal = (e: unknown): e is SourceRefusal =>
  e instanceof SourceRefusal ||
  (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'SourceRefusal' && (SOURCE_REFUSALS as readonly unknown[]).includes((e as { reason?: unknown }).reason));

export interface SourceRejection {
  readonly rejected: string;
}

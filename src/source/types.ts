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
/** What a snapshot may be asked: today only an abort signal. */
export interface SnapshotOptions {
  readonly signal?: AbortSignal;
}

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
   * cut (a read, a request); conditional reads (`sinceVersion`) and a delta
   * channel gated by `live` arrive with the http and streaming carriers.
   */
  snapshot(options?: SnapshotOptions): Promise<SourceSnapshot>;
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
export interface SourceRejection {
  readonly rejected: string;
}

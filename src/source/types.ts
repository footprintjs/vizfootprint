/**
 * The data-source layer (layer 1): where a table's rows COME FROM, stated as
 * three independent tags a def carries — what shape the bytes are (`format`),
 * how they travel (`via`), where they live (`at`) — and ONE small port a
 * carrier implements. No clause ever reaches a source: the query port
 * (`DataProvider`) stays on top, unchanged. See ./README.md.
 *
 * …and the same three tags on a RESOURCE, which is a declared source that is
 * NOT a table (a structure file, a geometry, a font): it lands as bytes, it
 * carries a version, and it is never rows — the second half of this file
 * (`RESOURCE_FORMATS` onward) is that shape, carried by these same carriers
 * with the decode step skipped.
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

/** ONE test for both landings: a table's snapshot and a resource's answer the same `{ unchanged }` from the same carriers, so a second predicate would be a second thing to keep in step. */
export const isUnchanged = (s: SourceSnapshot | ResourceSnapshot | SourceUnchanged): s is SourceUnchanged => 'unchanged' in s;

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
  /**
   * The SAME carrier, asked for a RESOURCE: the same transport, the same
   * version, the decode step skipped (there are no columns to judge, so
   * `decodeRows` and the guards that judge a landing against a table's
   * declaration cannot and must not apply).
   *
   * OPTIONAL so a carrier written before resources existed is still a valid
   * adapter; a host that declares a resource on such a via is refused
   * `no-adapter` by name (`./open.ts` · `openResource`), never handed rows instead.
   */
  openResource?(decl: ResourceDecl, ctx: { readonly resource: string }): Promise<ResourceHandle>;
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

// ── resources: a declared source that is NOT a table ─────────────────────────

/**
 * What shape a RESOURCE lands in. A resource is a declared source that is not a
 * table — a protein structure file, a GeoJSON geometry, a font, a shader — so it
 * has no columns to judge and there is nothing to decode: `bytes` answers a
 * `Uint8Array`, `text` a string, and that is the whole vocabulary.
 *
 * WHY it is a SECOND list beside {@link SOURCE_FORMATS} rather than two more
 * entries in it: a format there names a shape rows are PARSED out of, and every
 * reader of that list (the decoder's switch, the def door's sentence, guard 1's
 * contradiction set) is about rows. `bytes` in that list would be a format the
 * decoder has no arm for — the law is that a resource is never rows, and one
 * list per question is how it is kept.
 */
export const RESOURCE_FORMATS = ['bytes', 'text'] as const;
export type ResourceFormat = (typeof RESOURCE_FORMATS)[number];

/**
 * A resource, as a def states it: the same three tags a table's source carries
 * — what shape it lands in (`format`), how it travels (`via`, the SAME
 * {@link SOURCE_VIAS} vocabulary), where it lives (`at`) — judged at the def
 * door in the same shape and refused in the same words. Inert data (R12).
 */
export interface ResourceDecl {
  readonly format: ResourceFormat;
  readonly via: SourceVia;
  /** Where: the inline payload itself (`via: 'inline'`), or a path / URL string. */
  readonly at?: unknown;
  /** Per-carrier options, echoed to the adapter. */
  readonly options?: Readonly<Record<string, unknown>>;
}

/**
 * One reading of a resource: the bytes as the declaration asked for them, a
 * version the carrier can vouch for, and when it was read — `version` and
 * `retrievedAt` are exactly what a {@link SourceSnapshot} carries, from exactly
 * the same carrier code, because what a carrier can vouch for does not depend
 * on whether rows come out of the bytes.
 *
 * DISCRIMINATED on `format` so a reader narrows `body` instead of testing it: a
 * consumer that has to ask `instanceof Uint8Array` is a consumer the
 * declaration already answered for.
 */
export type ResourceSnapshot =
  | { readonly format: 'bytes'; readonly body: Uint8Array; readonly version: string; readonly retrievedAt: string }
  | { readonly format: 'text'; readonly body: string; readonly version: string; readonly retrievedAt: string };

/**
 * The resource twin of {@link SourceHandle} — the same capabilities and the
 * same conditional read, answering bytes instead of rows.
 *
 * THE LAW IN THE TYPE, and not in a comment: **only a CONDITIONAL read can
 * answer `unchanged`.** A read that holds no `sinceVersion` gives a carrier
 * nothing to compare, so there is no version it could vouch for and no honest
 * way for it to say "the same as what you have". The two overloads say exactly
 * that, which is why no caller of a first read carries a guard against an
 * answer it cannot receive: the build door's `readResource`
 * (`../def/buildDashboard.ts`) reads with no version and is handed a
 * `ResourceSnapshot`, and only the refresh door, which holds one, sees the
 * union.
 *
 * A carrier implements it as an overloaded function DECLARATION — three lines
 * of signature it cannot get wrong, rather than one cast in a factory, since a
 * single reader returning the union is not assignable to the narrow overload
 * and a cast there would put the promise back where a comment used to be.
 */
export interface ResourceHandle {
  readonly capabilities: SourceCapabilities;
  snapshot(options?: SnapshotOptions & { readonly sinceVersion?: undefined }): Promise<ResourceSnapshot>;
  snapshot(options: SnapshotOptions & { readonly sinceVersion: string }): Promise<ResourceSnapshot | SourceUnchanged>;
  close(): Promise<void>;
}

/**
 * What a built dashboard records about a declared resource — FACTS, and never
 * the payload (values never ride the overview, and bytes are not even a value).
 * `bytes` is the SIZE of what landed, which is the one thing a reader can be
 * told about a body it may not be handed.
 */
export interface ResourceInfo {
  readonly format: ResourceFormat;
  readonly via: SourceVia;
  /** The locator, when it was a string (an inline payload is not repeated). */
  readonly at?: string;
  readonly version: string;
  readonly retrievedAt: string;
  /** How many BYTES landed — the size, never the payload. */
  readonly bytes: number;
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
 *
 * ONE vocabulary for tables AND resources — a resource fails the same ways a
 * table's bytes do, so a second list would be a second thing to keep in step.
 * What a RESOURCE narrows is which entries can ever be reached: `malformed` is
 * the LOCATOR only (an `at` that is not a URL, an inline payload that is not the
 * declared shape), never the payload, because nothing is decoded and a body has
 * no shape to contradict.
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

/**
 * A refusal a carrier throws for a RESOURCE: the same typed reason from the same
 * vocabulary, naming the resource and the via.
 *
 * WHY it is its own class and not a {@link SourceRefusal} with the name in
 * `table`: `table` is a declared TABLE's name everywhere else it is read, and
 * putting a resource's name there would be the very category error the law
 * forbids — a resource is a declared source that is NOT a table. The
 * vocabulary is shared (one `SOURCE_REFUSALS`), the sentence shape is shared,
 * and {@link brandedAs} is the one brand test both checks ask.
 */
export class ResourceRefusal extends Error {
  constructor(
    readonly reason: SourceRefusalReason,
    message: string,
    readonly resource: string,
    readonly via: SourceVia,
  ) {
    super(message);
  }
  toJSON(): { readonly name: 'ResourceRefusal'; readonly reason: SourceRefusalReason; readonly message: string; readonly resource: string; readonly via: SourceVia } {
    return { name: 'ResourceRefusal', reason: this.reason, message: this.message, resource: this.resource, via: this.via };
  }
}
ResourceRefusal.prototype.name = 'ResourceRefusal';

/** The brand both refusal checks ask: the class's own `name` plus a reason from the shared vocabulary. */
const brandedAs = (e: unknown, name: string): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === name && (SOURCE_REFUSALS as readonly unknown[]).includes((e as { reason?: unknown }).reason);

/** A brand check, not only `instanceof`: a refusal from a second copy of this module, another realm, or a structured clone still reads as one. */
export const isSourceRefusal = (e: unknown): e is SourceRefusal => e instanceof SourceRefusal || brandedAs(e, 'SourceRefusal');

/** The resource twin of {@link isSourceRefusal}, on the same brand. */
export const isResourceRefusal = (e: unknown): e is ResourceRefusal => e instanceof ResourceRefusal || brandedAs(e, 'ResourceRefusal');

export interface SourceRejection {
  readonly rejected: string;
}

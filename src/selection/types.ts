/**
 * SELECTION — THE PORT IS OUR SHAPE; THE LIVE SELECTION IS SOMEBODY'S ENGINE.
 *
 * The law it follows: interface + adapter + strategy. A clause, a source, a
 * rejection and the port that mints and holds them are declared HERE, in this
 * package's own words, with no engine imported. An engine (Mosaic today) is an
 * adapter behind `vizfootprint/mosaic` that answers this port; the built-in
 * (`builtinSelection.ts`) answers it with no engine at all. Nothing above this
 * folder — the log, the session, a chart — may know which one it is holding.
 *
 * First customers: `src/log/log.ts` (mints a clause per commit, pushes it
 * outbound), the demo dashboards (listen, skip), and the adapter door.
 *
 * Data before code: engine → source + registry → clause + spec → capabilities
 * + rejection → the port.
 */

import type { Actor, Cause } from '../cause/index.js';
import { isRejection } from '../data/index.js';
import type { CellSide, MatchValue } from '../data/index.js';

// ── the engines ─────────────────────────────────────────────────────────────

/** Who answers the port: this package alone, or the Mosaic adapter. */
export type SelectionEngine = 'builtin' | 'mosaic';

// ── the source and its registry: one object per id, ever ────────────────────

/** Serializable metadata describing who drives a registered view/source. */
export interface ActorMeta {
  /** The actor that owns/drives this view (its default `computedBy`). */
  actor: Actor;
  /** Optional human label for the view. */
  label?: string;
  /** Layer 4: what acting on this view DOES, in one sentence — the routing text a phrase is matched against, and the words an offer carries. */
  does?: string;
}

/**
 * A live source object: the clause `source`, and (for self-exclusion) a member
 * of the clause `clients` set. Its IDENTITY is the load-bearing property —
 * every identity-dependent operation on the port is a reference compare or a
 * `Set.has` — and the two fields exist so the log can name it by id.
 *
 * A plain class. WHY: the port owns the identity law (`SourceRegistry` below),
 * not the engine; an adapter that needs its engine's own client type wraps a
 * source once (a WeakMap, one wrapper per source) rather than making every
 * source in the package an instance of somebody's base class.
 */
export class RegisteredSource {
  /** Stable registry key. Survives serialization; identity does not. */
  readonly viewId: string;
  /** Serializable actor metadata for this source. */
  readonly meta: ActorMeta;

  constructor(viewId: string, meta: ActorMeta) {
    this.viewId = viewId;
    this.meta = meta;
  }
}

/** Thrown when a registry is asked to do something that would break identity. */
export class SourceRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceRegistryError';
  }
}

const ACTOR_SET = new Set<Actor>(['user', 'agent', 'system']);

function validateActorMeta(meta: ActorMeta): ActorMeta {
  if (meta === null || typeof meta !== 'object') {
    throw new SourceRegistryError('actorMeta must be an object');
  }
  if (!ACTOR_SET.has(meta.actor)) {
    throw new SourceRegistryError(`actorMeta.actor must be one of user|agent|system, got ${String(meta.actor)}`);
  }
  if (meta.label !== undefined && typeof meta.label !== 'string') {
    throw new SourceRegistryError('actorMeta.label, if present, must be a string');
  }
  if (meta.does !== undefined && typeof meta.does !== 'string') {
    throw new SourceRegistryError('actorMeta.does, if present, must be a string');
  }
  // data-only rebuild. WHY `does` rides too: the record stamps `source.meta`, and
  // the log's wire parser (`rebuildActorMeta`) accepts `does` back in — a registry
  // that dropped it would write records its own reader could never have produced
  return {
    actor: meta.actor,
    ...(meta.label !== undefined && { label: meta.label }),
    ...(meta.does !== undefined && { does: meta.does }),
  };
}

/**
 * Maps stable ids -> live source objects. One registry = one identity space.
 * The SAME id always returns the SAME object within a registry; a fresh
 * registry rebuilds fresh objects for the same ids (the replay contract).
 *
 * Object identity cannot be serialized. The registry restores it by
 * RECONSTRUCTION: serialize the id; on replay build a FRESH registry with the
 * SAME ids, and every clause rebuilt against it shares one identity again.
 */
export class SourceRegistry {
  private readonly sources = new Map<string, RegisteredSource>();

  /**
   * Register (or fetch) the stable source object for a view id. Idempotent for
   * an identical meta; throws on a conflicting re-registration so identity can
   * never silently fork.
   */
  register(viewId: string, actorMeta: ActorMeta): RegisteredSource {
    if (typeof viewId !== 'string' || viewId.length === 0) {
      throw new SourceRegistryError('viewId must be a non-empty string');
    }
    const meta = validateActorMeta(actorMeta);
    const existing = this.sources.get(viewId);
    if (existing) {
      if (existing.meta.actor !== meta.actor || existing.meta.label !== meta.label || existing.meta.does !== meta.does) {
        throw new SourceRegistryError(`viewId "${viewId}" already registered with different actorMeta`);
      }
      return existing;
    }
    const source = new RegisteredSource(viewId, meta);
    this.sources.set(viewId, source);
    return source;
  }

  /** Look up an already-registered source. Undefined if unknown. */
  get(viewId: string): RegisteredSource | undefined {
    return this.sources.get(viewId);
  }

  /** Look up, or throw if the id was never registered. */
  require(viewId: string): RegisteredSource {
    const s = this.sources.get(viewId);
    if (!s) throw new SourceRegistryError(`no source registered for viewId "${viewId}"`);
    return s;
  }

  has(viewId: string): boolean {
    return this.sources.has(viewId);
  }

  /** All registered ids, in insertion order. */
  ids(): string[] {
    return [...this.sources.keys()];
  }

  get size(): number {
    return this.sources.size;
  }
}

// ── the clause: what a port mints, holds, and hands to listeners ────────────

/** The four clause kinds the engine carries: point, interval, the D30 compound cell, and the SET-1 match. */
export type CauseClauseKind = 'point' | 'interval' | 'cell' | 'match';

/** The clause meta: the kind's name as the engine spells it, plus the two-slot cause. */
export interface CauseMetadata {
  readonly type: string;
  /** The provenance of this clause. */
  readonly cause: Cause;
}

/**
 * A cause-tagged clause in the port's own shape. `predicateSQL` is the one
 * persisted byte (`CommitRecord.predicateSQL` is `String()` of it): a SQL
 * descriptor rendered by the engine's own rules, or `null` when the clause is
 * CLEARED — the same `null` a Mosaic clause carries as its predicate.
 */
export interface CauseClause {
  readonly kind: CauseClauseKind;
  readonly source: RegisteredSource;
  /** Cross-filter self-exclusion set — identity, never a flag. */
  readonly clients: ReadonlySet<RegisteredSource>;
  readonly value: unknown;
  readonly predicateSQL: string | null;
  readonly meta: CauseMetadata;
}

/** The four clause kinds a port mints from, each with its registry-backed source. */
export type CauseClauseSpec =
  | {
      kind: 'point';
      source: RegisteredSource;
      field: string;
      /**
       * The WIRE's point value — the same slot a commit carries, because a
       * commit and this clause are the two doors of ONE act and are built from
       * one value. `null` CLEARS it (the one spelling every kind shares; see
       * `pointValueFromWire`, which every port reads it through), anything else
       * is equality. IS NULL survives where a `null` is a value inside a
       * compound rather than the whole clause: a cell side, a match list entry.
       */
      value: unknown;
      cause: Cause;
      /** Cross-filter self-exclusion set. Defaults to [source]. */
      clients?: RegisteredSource[];
    }
  | {
      kind: 'interval';
      source: RegisteredSource;
      field: string;
      /**
       * `[lo, hi]`, a half-open pair with one bound `null` ("no bound on this
       * side" — `[150, null]` is "150 or more"; `src/data`'s `IntervalBounds`
       * is the seam that EVALUATES this shape), or `null` to clear. ISO-8601
       * date-string bounds ride this rail too. The descriptor an engine
       * renders for a half-open or string pair is the engine's own rendering,
       * not executable SQL — `src/data`'s `resolvePredicateSQL` is the one
       * honest SQL this package relies on.
       */
      value: [number, number] | [number, null] | [null, number] | [string, string] | [string, null] | [null, string] | null;
      cause: Cause;
      clients?: RegisteredSource[];
    }
  | {
      /**
       * The D30 compound CELL: one gesture selects on TWO fields ("price
       * 100–150 AND category Formal") — ONE commit, one clause whose
       * predicate is the AND of both sides. Each side is a `CellSide`
       * (interval `[lo, hi]` or a point value); `value: null` clears the
       * whole cell (the cleared-interval rule).
       */
      kind: 'cell';
      source: RegisteredSource;
      fields: readonly [string, string];
      value: readonly [CellSide, CellSide] | null;
      cause: Cause;
      clients?: RegisteredSource[];
    }
  | {
      /**
       * The SET-1 MATCH: one field, MANY values (IN) — or everything but them
       * (`exclude`, NOT IN). A `null` IN THE LIST is a real IS NULL — a value
       * inside a compound, never the whole clause's clear. `value: null`
       * clears the match (the cleared-interval rule).
       */
      kind: 'match';
      source: RegisteredSource;
      field: string;
      value: MatchValue;
      cause: Cause;
      clients?: RegisteredSource[];
    };

// ── capabilities + typed rejection (R14: declare honestly, refuse typed) ────

export interface SelectionCapabilities {
  /** Does `native()` hand back a live engine selection (coordinator-driven queries), or is the port the whole engine? */
  readonly liveSelection: boolean;
  /** Does `skip()` honour cross-filter self-exclusion? */
  readonly canSkip: boolean;
}

/** The act a rejection was filed against — always the one that actually ran, never a stand-in. */
export type SelectionOperation = 'port' | 'clause' | 'update' | 'skip' | 'native';

/** Typed reason codes — every rejection names one; never a bare `false`/`undefined`. */
export type SelectionRejectionReason =
  /** The spec carries a value the engine cannot honestly render (an undefined cell side, a non-pair interval, a value string coercion refuses, an unknown kind). */
  | 'unsupported-shape'
  /** `native()` was asked of a port that has no engine selection behind it. */
  | 'no-live-selection'
  /** A `source` or a `clients` entry is not a registry-minted `RegisteredSource`, or the clause itself was not minted by this port — no identity law can hold over it. */
  | 'unknown-source'
  /** An engine object already stands behind a port minted with a different strategy; the door will not stand a second one. */
  | 'port-conflict';

export interface SelectionRejection {
  readonly ok: false;
  readonly engine: SelectionEngine;
  readonly operation: SelectionOperation;
  readonly reason: SelectionRejectionReason;
  /** Human-facing detail. INERT — never parsed, never dispatched on. */
  readonly detail?: string;
}

/** Build a typed rejection. The one constructor every port funnels through — no ad hoc shapes. */
export function reject(
  engine: SelectionEngine,
  operation: SelectionOperation,
  reason: SelectionRejectionReason,
  detail?: string,
): SelectionRejection {
  return detail !== undefined ? { ok: false, engine, operation, reason, detail } : { ok: false, engine, operation, reason };
}

/**
 * ONE guard for every `{ ok: false }` answer in the package, re-exported from
 * the data seam. WHY not a guard of our own: two guards with one body and two
 * predicates let a caller narrow a port answer to the DATA rejection (its
 * reason vocabulary) with no compile error; a structural predicate narrows
 * `CauseClause | SelectionRejection` to `SelectionRejection` just the same.
 */
export { isRejection };

/**
 * Thrown by `update()` / `skip()` when the clause handed in was not minted by
 * this port, and by an adapter door refusing to stand a second port on one
 * engine object. One error class for every engine: a misuse must be as loud on
 * the built-in as on Mosaic, or a session that works on one breaks the day a
 * host hands in the other. It rides the port's listener law — a throw out of
 * `update()` PROPAGATES to the log's outbound try/catch, which files it as a
 * typed gap.
 */
export class SelectionPortError extends Error {
  readonly rejection: SelectionRejection;
  constructor(rejection: SelectionRejection) {
    super(rejection.detail ?? rejection.reason);
    this.name = 'SelectionPortError';
    this.rejection = rejection;
  }
}

// ── the port ────────────────────────────────────────────────────────────────

/** What a listener receives: the clauses standing after the update that woke it. */
export type SelectionListener = (clauses: readonly CauseClause[]) => void;

/**
 * The selection port. One per session; the log mints through `clause()`,
 * pushes through `update()`, and every reader asks `clauses()`/`skip()`.
 *
 * Listener law: `listen()` callbacks run SYNCHRONOUSLY inside `update()`, and
 * a throw PROPAGATES out of `update()`. WHY: the log's outbound step wraps
 * `update()` in the one try/catch that files a failed relay as a typed gap
 * (`onSelectionUpdateFailed`); a port that swallowed or deferred the throw
 * would turn that gap into silence.
 */
export interface SelectionPort {
  readonly engine: SelectionEngine;
  readonly capabilities: SelectionCapabilities;
  /** Mint a clause from a spec, or say why this engine cannot. Never throws for a shape problem. */
  clause(spec: CauseClauseSpec): CauseClause | SelectionRejection;
  /**
   * Push a clause onto the live selection: drops the clause standing for the
   * same source, then keeps this one if it carries a predicate. A clause this
   * port did not mint throws a `SelectionPortError` — never a silent no-op.
   */
  update(clause: CauseClause): void;
  /** The clauses THIS PORT minted that stand now, in arrival order. A frozen snapshot of frozen clauses. */
  clauses(): readonly CauseClause[];
  /** Cross-filter self-exclusion: should `client` NOT be filtered by `clause`? A clause this port did not mint throws. */
  skip(client: RegisteredSource, clause: CauseClause): boolean;
  /** Subscribe to every update; returns the unsubscribe. */
  listen(fn: SelectionListener): () => void;
  /**
   * The engine's own live selection object, for a host that drives the engine
   * directly — or a rejection when there is none. An adapter narrows
   * `selection` to its engine's type.
   */
  native(): NativeSelection | SelectionRejection;
}

/** The `ok` arm of `native()`: the engine object, whatever the engine calls it. */
export interface NativeSelection {
  readonly ok: true;
  readonly selection: unknown;
}

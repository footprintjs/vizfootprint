/**
 * SourceRegistry — the answer to Mosaic's identity problem.
 *
 * A Mosaic SelectionClause identifies its origin by an OBJECT IDENTITY:
 *   node_modules/@uwdata/mosaic-core/dist/src/SelectionClause.d.ts:56-69
 *     `export type ClauseSource = object & { reset?: () => void };`
 *     "A unique identifier (according to object equality) for the source
 *      component that generated this clause."
 * and every identity-dependent operation is a reference compare or Set.has:
 *   - remove(source):  Selection.js:91-96 -> resolve() filters `source !== c.source`
 *                      (SelectionResolver.resolve, Selection.js:263)
 *   - cross-filter self-exclusion: SelectionResolver.skip, Selection.js:278-283
 *                      `this.cross && clause?.clients?.has(client)`
 *
 * Object identity cannot be serialized. This registry restores it by
 * RECONSTRUCTION: a stable string id -> a live source object, created once per
 * registry. Serialize the id; on replay build a FRESH registry with the SAME
 * ids, and every clause rebuilt against it shares one consistent identity again.
 *
 * Q9 (RESOLVED — docs/RESEARCH_STATE.md canonical Q9 / SPEC.md §10 Q9):
 * `SelectionClause.clients` is typed `Set<MosaicClient>`
 *   node_modules/@uwdata/mosaic-core/dist/src/SelectionClause.d.ts (the
 *   `clients` option on `clausePoint`/`clauseInterval`, mirrored on the
 *   returned clause shape).
 * but its ONLY runtime read anywhere in the installed package is an identity
 * `Set.has(client)` check:
 *   node_modules/@uwdata/mosaic-core/dist/src/Selection.js:278-283
 *     `skip(client, clause) { ... return Boolean(this.cross && clause?.clients?.has(client)); }`
 * (confirmed exhaustively: `grep -rn '\.clients' dist/src` turns up exactly
 * one other `.clients` — Coordinator.js's OWN unrelated connected-clients
 * set — and zero property/method access on a `clients` SET MEMBER anywhere).
 * `MosaicClient` (node_modules/@uwdata/mosaic-core/dist/src/MosaicClient.js:20-233)
 * is a plain class with ONLY public fields/accessors/methods — no `#private`
 * fields — so it is honestly *implementable*, not just cast-around; and its
 * safe defaults (`prepare()` no-ops at MosaicClient.js:119-120, `query()`
 * returns `null` at MosaicClient.js:126-128) mean a subclass that never
 * connects to a coordinator (`_coordinator` stays `null`) is inert.
 * `RegisteredSource` therefore EXTENDS `MosaicClient` for real: it IS one
 * (`instanceof MosaicClient` — the same nominal check `isMosaicClient` uses,
 * MosaicClient.js:2-4 — is genuinely true, not merely cast to type-check),
 * so `Set<RegisteredSource>` is a real `Set<MosaicClient>` — no double-cast
 * through `unknown` to force the type checker anywhere in src/mosaic/**.
 */

import { MosaicClient } from '@uwdata/mosaic-core';
import type { Actor } from '../cause/index.js';

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
 * A live source object handed to Mosaic as a clause `source` (and, for
 * self-exclusion, as a member of the clause `clients` set). Its IDENTITY is the
 * load-bearing property; the fields exist so the log can reference it by id.
 *
 * Genuinely extends `MosaicClient` (Q9, see file header) rather than merely
 * satisfying its shape. It is never `coordinator`-connected and never
 * `enabled`/`initialize()`d — only its identity and the two data fields below
 * are used. `viewId`/`meta` are added instance fields on top of the inherited
 * `MosaicClient` surface (which stays default/inert).
 */
export class RegisteredSource extends MosaicClient {
  /** Stable registry key. Survives serialization; identity does not. */
  readonly viewId: string;
  /** Serializable actor metadata for this source. */
  readonly meta: ActorMeta;
  /** Optional Mosaic reset hook (called by Selection.reset / single-mode). */
  reset?: () => void;

  constructor(viewId: string, meta: ActorMeta) {
    // MosaicClient.d.ts:40 — filterSelection is optional; this source is
    // identity-only and is never connected to a coordinator.
    super();
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
  // data-only rebuild
  return meta.label !== undefined ? { actor: meta.actor, label: meta.label } : { actor: meta.actor };
}

/**
 * Maps stable ids -> live source objects. One registry = one identity space.
 * The SAME id always returns the SAME object within a registry; a fresh
 * registry rebuilds fresh objects for the same ids (the replay contract).
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
      if (existing.meta.actor !== meta.actor || existing.meta.label !== meta.label) {
        throw new SourceRegistryError(
          `viewId "${viewId}" already registered with different actorMeta`,
        );
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

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
 */

import type { Actor } from '../cause/index.js';

/** Serializable metadata describing who drives a registered view/source. */
export interface ActorMeta {
  /** The actor that owns/drives this view (its default `computedBy`). */
  actor: Actor;
  /** Optional human label for the view. */
  label?: string;
}

/**
 * A live source object handed to Mosaic as a clause `source` (and, for
 * self-exclusion, as a member of the clause `clients` set). Its IDENTITY is the
 * load-bearing property; the fields exist so the log can reference it by id.
 */
export interface RegisteredSource {
  /** Stable registry key. Survives serialization; identity does not. */
  readonly viewId: string;
  /** Serializable actor metadata for this source. */
  readonly meta: ActorMeta;
  /** Optional Mosaic reset hook (called by Selection.reset / single-mode). */
  reset?: () => void;
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
    const source: RegisteredSource = { viewId, meta };
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

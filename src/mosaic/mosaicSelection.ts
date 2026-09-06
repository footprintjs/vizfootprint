/**
 * MOSAIC SELECTION — THE PORT ANSWERED BY A LIVE MOSAIC `Selection`.
 *
 * The law it follows: interface + adapter + strategy. `src/selection` declares
 * the port in this package's own words and judges every spec ONCE
 * (`judge.ts`); this file takes that verdict and builds the real engine's
 * twin — every clause by Mosaic's own factories (`clausePoint`,
 * `clauseInterval`, composed with the real `and`/`or`/`not`/`literal`), stood
 * on a real `Selection`, projected to OUR `CauseClause` beside it. This is the
 * ONLY module in the package that imports `@uwdata/mosaic-core` and
 * `@uwdata/mosaic-sql` (both optional peers): a consumer who never calls
 * `mosaicSelection()` never loads them.
 *
 * First customers: a host that runs a Mosaic coordinator and wants the log's
 * clauses on the same live selection its own clients answer to — beside the
 * clauses those clients push themselves (bench/x4 is the in-repo one);
 * `createSession({ selection: mosaicSelection() })`; the adapter tests, which
 * run against the real package.
 *
 * Data before code: the wrapper client → the port's shape → the factory door
 * → the standing ports → the door.
 */

import { MosaicClient, Selection, clauseInterval, clausePoint } from '@uwdata/mosaic-core';
import type { ClauseMetadata, SelectionClause } from '@uwdata/mosaic-core';
import { and, literal, not, or } from '@uwdata/mosaic-sql';
import type { ExprNode } from '@uwdata/mosaic-sql';
import type { Cause } from '../cause/index.js';
import { pointValueFromWire } from '../data/index.js';
import type { CellSide, MatchValue } from '../data/index.js';
import { judge, rejectionOf } from '../selection/judge.js';
import {
  SelectionPortError,
  reject,
  type CauseClause,
  type CauseClauseSpec,
  type RegisteredSource,
  type SelectionListener,
  type SelectionOperation,
  type SelectionPort,
} from '../selection/index.js';

const ENGINE = 'mosaic';

// ── the wrapper: the client a source answers to when the host has none ──────

/**
 * The engine's view of a source. Mosaic types a clause's `clients` as
 * `Set<MosaicClient>` and its only runtime read of that set is an identity
 * `Set.has(client)` (Selection.js:278-283, measured on 0.28.1), so the
 * cross-filter self-exclusion a host sees through `Selection.skip` /
 * `Selection.predicate(client)` rests on handing Mosaic the SAME object every
 * time. `MosaicClient` has no private fields and inert defaults (`prepare()`
 * no-ops, `query()` returns null), so an instance that is never
 * coordinator-connected is honestly a client and does nothing.
 *
 * Minted only by a port's `client()` — never `new` it yourself: a second
 * wrapper for the same source is a second identity, and `skip()` would
 * silently answer false for it. A host whose views ARE MosaicClients names
 * them through `clientFor` instead, and no wrapper is minted for those.
 */
export class MosaicRegisteredSource extends MosaicClient {
  /** The port-side identity this wrapper stands for. */
  readonly source: RegisteredSource;

  constructor(source: RegisteredSource) {
    super();
    this.source = source;
  }
}

// ── the port's shape: what only a Mosaic host can want ──────────────────────

export interface MosaicSelectionOptions {
  /**
   * The host's REAL `MosaicClient` for a source — the view the coordinator
   * queries for. Consulted once per source, before the default wrapper is
   * minted, and memoized: what it answers is what `Selection.skip` and
   * `Selection.predicate(client)` compare against. Answer `undefined` for a
   * source the host does not view itself.
   */
  readonly clientFor?: (source: RegisteredSource) => MosaicClient | undefined;
}

export interface MosaicSelectionPort extends SelectionPort {
  readonly engine: 'mosaic';
  /** The live `Selection` every clause is stood on — for a coordinator, a `MosaicClient`, or `remove(source)`. Never a rejection here. */
  native(): { readonly ok: true; readonly selection: Selection };
  /** The ONE `MosaicClient` a source answers to — the host's own (`clientFor`) or the port's wrapper — the identity `Selection.skip` / `Selection.predicate(client)` compare against. */
  client(source: RegisteredSource): MosaicClient;
  /**
   * The clauses standing on the live `Selection` that did NOT come through
   * this port — a host's own interactors push theirs onto the same bus.
   * `clauses()` omits them (they carry no cause and no registry identity);
   * this is the counter that keeps the omission honest.
   */
  foreign(): readonly SelectionClause[];
}

/** Mosaic's `ClauseMetadata` plus the two-slot cause, riding on the native clause. */
interface NativeCauseMetadata extends ClauseMetadata {
  cause: Cause;
}

// ── the factory door: spec → the REAL Mosaic clause ─────────────────────────

interface FactoryOptions {
  source: RegisteredSource;
  clients: Set<MosaicClient>;
}

/** One cell side through the real factory for its shape: an array side is `clauseInterval`, anything else `clausePoint`. */
function cellSidePredicate(field: string, side: CellSide, opts: FactoryOptions): ExprNode {
  // WHY `as never`: Mosaic's .d.ts types the extent as `[number, number]`; the call is proven
  // non-throwing for every side shape the judge admits (src/data/predicate.test.ts)
  const built = Array.isArray(side) ? clauseInterval(field, side as never, opts) : clausePoint(field, side, opts);
  // WHY `!`: the judge has already refused every side that would build without a predicate (an undefined side)
  return built.predicate!;
}

/** The IN-list of a match: every entry through the real `clausePoint`, the arms through the real `or`, the polarity through the real `not`. */
function matchPredicate(field: string, body: Exclude<MatchValue, null>, opts: FactoryOptions): ExprNode {
  const arms = body.values.map((v) => clausePoint(field, v, opts).predicate!); // same proof as cellSidePredicate
  const inList: ExprNode = arms.length === 0 ? literal(false) : arms.length === 1 ? arms[0]! : or(...arms);
  return body.exclude === true ? not(inList) : inList;
}

/**
 * Build the real Mosaic clause for a spec the judge already admitted. Mosaic
 * has no compound point×interval or IN-list factory of its own, so the cell
 * and match clause literals are assembled here from genuine factory output;
 * `meta.type` is an open string, so `'cell'`/`'match'` are legal. The cause
 * rides `meta` as a superset of `ClauseMetadata`: Mosaic's pre-aggregation
 * reads a clause's metadata by destructuring KNOWN fields only
 * (PreAggregator.js:192-206) and never enumerates or rejects unknown keys.
 */
function nativeOf(spec: CauseClauseSpec, cause: Cause, opts: FactoryOptions): SelectionClause {
  let clause: SelectionClause;
  switch (spec.kind) {
    case 'point':
      // WHY through `pointValueFromWire`: the one-translation law — the judge read the wire's `null` the same way
      clause = clausePoint(spec.field, pointValueFromWire(spec.value), opts);
      break;
    case 'interval':
      // WHY `as never`: Mosaic's .d.ts types the extent as `[number, number]`; the
      // call is proven non-throwing for every shape the spec accepts (predicate.test.ts)
      clause = clauseInterval(spec.field, spec.value as never, opts);
      break;
    case 'cell': {
      const predicate =
        spec.value === null
          ? null
          : and(cellSidePredicate(spec.fields[0], spec.value[0], opts), cellSidePredicate(spec.fields[1], spec.value[1], opts));
      clause = { meta: { type: 'cell' }, ...opts, value: spec.value, predicate };
      break;
    }
    case 'match': {
      const predicate = spec.value === null ? null : matchPredicate(spec.field, spec.value, opts);
      clause = { meta: { type: 'match' }, ...opts, value: spec.value, predicate };
      break;
    }
  }
  // the factory's own meta (its `type` is the kind already) with the cause laid on top
  const meta: NativeCauseMetadata = { ...clause.meta, type: spec.kind, cause };
  return { ...clause, meta };
}

/** Read the cause back off a NATIVE clause (one taken from `native().selection.clauses` / `.active`), or undefined if it carries none. */
export function causeOf(clause: SelectionClause): Cause | undefined {
  return (clause.meta as NativeCauseMetadata | undefined)?.cause;
}

// ── the standing ports: one port per Selection, ever ────────────────────────

interface Standing {
  readonly port: MosaicSelectionPort;
  readonly clientFor: MosaicSelectionOptions['clientFor'];
}

// WHY module-level: the same law the registry keeps per id, kept per engine object — two ports on
// one Selection would be two wrapper identities, and the second could not read what the first stood
const standing = new WeakMap<Selection, Standing>();

function standingFor(selection: Selection, options: MosaicSelectionOptions): MosaicSelectionPort | undefined {
  const stood = standing.get(selection);
  if (stood === undefined) return undefined;
  if (options.clientFor !== undefined && options.clientFor !== stood.clientFor) {
    throw new SelectionPortError(
      reject(ENGINE, 'port', 'port-conflict', 'this Selection already stands behind a port minted with a different clientFor — one port per Selection, ever'),
    );
  }
  return stood.port;
}

// ── the door ────────────────────────────────────────────────────────────────

/**
 * Answer the selection port with a live Mosaic `Selection`. Hand it to the
 * log — `new CauseSelectionSession(mosaicSelection())` — or to a session —
 * `createSession({ selection: mosaicSelection() })` — and every commit's
 * clause lands on `native().selection` as a real Mosaic clause, cause on its
 * meta. Idempotent per `Selection`: a second call returns the port already
 * standing on it, and a different `clientFor` on that call throws.
 *
 * @param selection the `Selection` to stand clauses on; a fresh crossfilter by default.
 * @param options   `clientFor` — the host's real `MosaicClient` per source.
 */
export function mosaicSelection(selection: Selection = Selection.crossfilter(), options: MosaicSelectionOptions = {}): MosaicSelectionPort {
  const stood = standingFor(selection, options);
  if (stood !== undefined) return stood;

  // WHY WeakMaps, per port: each is an identity table the engine must agree
  // with — one client per source, one native clause per minted clause — and
  // none may outlive the objects it keys.
  const clients = new WeakMap<RegisteredSource, MosaicClient>();
  const natives = new WeakMap<CauseClause, SelectionClause>();
  const projections = new WeakMap<SelectionClause, CauseClause>();

  function client(source: RegisteredSource): MosaicClient {
    let known = clients.get(source);
    if (known === undefined) {
      // WHY the host's strategy first: Mosaic's skip/predicate compare against the REAL client the
      // coordinator queries for — a wrapper standing in for a view the host renders itself would
      // leave that view filtered by its own brush (the classic crossfilter self-filter bug)
      known = options.clientFor?.(source) ?? new MosaicRegisteredSource(source);
      clients.set(source, known);
    }
    return known;
  }

  function mint(spec: CauseClauseSpec): CauseClause {
    const verdict = judge(spec);
    // WHY the identity split: the native clause's `source` is the registry object itself (Mosaic
    // compares it by identity — a host pushing its own clauses with that source replaces ours, as
    // bench/x4 relies on); its `clients` are the engine's clients, because that set is typed and
    // compared as MosaicClients
    const native = nativeOf(spec, verdict.cause, { source: verdict.source, clients: new Set(verdict.clients.map(client)) });
    const byte = native.predicate === null ? null : String(native.predicate);
    /* v8 ignore next 5 -- the byte law's own guard: parity of the judge's renderer with the real factories is pinned for every shape in src/data/predicate.test.ts, so the arm is unreachable until the peer drifts */
    if (byte !== verdict.predicateSQL) {
      throw new SelectionPortError(
        reject(ENGINE, 'clause', 'unsupported-shape', `byte law broken: the engine rendered ${String(byte)} where the judge rendered ${String(verdict.predicateSQL)}`),
      );
    }
    const clause: CauseClause = Object.freeze({
      kind: spec.kind,
      source: verdict.source,
      clients: new Set(verdict.clients),
      value: spec.value,
      predicateSQL: byte,
      meta: Object.freeze({ type: spec.kind, cause: Object.freeze(verdict.cause) }),
    });
    natives.set(clause, native);
    projections.set(native, clause);
    return clause;
  }

  function nativeFor(clause: CauseClause, operation: SelectionOperation): SelectionClause {
    const native = natives.get(clause);
    if (native === undefined) {
      throw new SelectionPortError(
        reject(ENGINE, operation, 'unknown-source', `a clause for "${String(clause?.source?.viewId)}" was not minted by this port — mint it through the port that stands it`),
      );
    }
    return native;
  }

  // WHY omit, never deny: a host's own interactors push clauses onto the same Selection with
  // sources this port can never replace; refusing the whole answer over one of them would make
  // the port unusable on exactly the host it exists for. `foreign()` is the counter.
  const clauses = (): readonly CauseClause[] => Object.freeze(selection.clauses.flatMap((native) => projections.get(native) ?? []));
  const foreign = (): readonly SelectionClause[] => Object.freeze(selection.clauses.filter((native) => !projections.has(native)));

  // WHY the port keeps its own listeners instead of Selection.addEventListener:
  // Mosaic's dispatcher calls callbacks synchronously only while no earlier
  // emit of the same tick is still settling — a second update in one tick is
  // queued to a microtask, where a throw never reaches update(). The port's
  // listener law (synchronous, throws propagate — what the log's outbound
  // try/catch files as a gap) must hold on every engine, so port listeners run
  // here, after the engine took the clause; native() listeners stay Mosaic's.
  const listeners = new Set<SelectionListener>();

  const port: MosaicSelectionPort = {
    engine: ENGINE,
    // WHY read off the resolver: Mosaic's skip is `cross && clients.has(client)`, so on an
    // intersect/union/single Selection self-exclusion is off, and the dial must say so
    capabilities: { liveSelection: true, canSkip: selection.resolver.cross },
    clause(spec) {
      try {
        return mint(spec);
      } catch (error) {
        return rejectionOf(ENGINE, error);
      }
    },
    update(clause) {
      // Mosaic's own resolve (drop the same source, keep with a predicate) runs inside update()
      selection.update(nativeFor(clause, 'update'));
      if (listeners.size === 0) return;
      const now = clauses();
      for (const fn of listeners) fn(now);
    },
    clauses,
    skip: (source, clause) => selection.skip(client(source), nativeFor(clause, 'skip')),
    listen(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    native: () => ({ ok: true, selection }),
    client,
    foreign,
  };
  standing.set(selection, { port, clientFor: options.clientFor });
  return port;
}

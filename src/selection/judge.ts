/**
 * JUDGE — ONE VERDICT PER SPEC, WHICHEVER ENGINE ANSWERS.
 *
 * The law it follows: the two ports must reject one spec identically, and
 * mint one byte for it. A policy that lives in two adapters drifts the day a
 * fifth clause kind or a new refusal arrives (the replica hazard), so the
 * whole verdict — the cause gate, the identity gate over `source` AND every
 * `clients` entry, the shape verdict and the byte — is decided HERE, once. An
 * engine adapter takes the verdict and builds only its native twin beside it.
 *
 * First customers: `builtinSelection.ts` (the verdict IS its clause) and
 * `../mosaic/mosaicSelection.ts` (the verdict, then the real factories). Not
 * on the `/selection` barrel: a port mints through it, nothing above a port
 * judges a spec.
 *
 * Data before code: the refusal → the verdict → the gates → the door.
 */

import { validateCause, type Cause } from '../cause/index.js';
import { isClearedSQL, mosaicDescriptorSQL, pointValueFromWire } from '../data/index.js';
import { RegisteredSource, reject, type CauseClauseSpec, type SelectionEngine, type SelectionRejection, type SelectionRejectionReason } from './types.js';

// ── refusal: module-private, caught ONCE at a port's door ───────────────────

class Refusal extends Error {
  readonly reason: SelectionRejectionReason;
  constructor(reason: SelectionRejectionReason, problem: string) {
    super(problem);
    this.name = 'SelectionRefusal';
    this.reason = reason;
  }
}

function refuse(reason: SelectionRejectionReason, problem: string): never {
  throw new Refusal(reason, problem);
}

/**
 * The door's one catch, for every port. A `Refusal` names its reason; a
 * `TypeError` is `mosaicDescriptorSQL` declining a shape the real factories
 * would refuse. Anything else — the cause gate's `CauseValidationError` above
 * all — is not a shape problem and PROPAGATES: R12 says a malformed cause
 * never enters the clause stream, and the log's own JUDGE throws that same
 * error first.
 */
export function rejectionOf(engine: SelectionEngine, error: unknown): SelectionRejection {
  if (error instanceof Refusal) return reject(engine, 'clause', error.reason, error.message);
  if (error instanceof TypeError) return reject(engine, 'clause', 'unsupported-shape', error.message);
  throw error;
}

// ── the verdict ─────────────────────────────────────────────────────────────

/** Everything a port needs to mint, decided once: the rebuilt cause, the identities, the byte. */
export interface Verdict {
  readonly cause: Cause;
  readonly source: RegisteredSource;
  /** The self-exclusion set, in the spec's order; `[source]` when the spec named none. */
  readonly clients: readonly RegisteredSource[];
  /** The engine's byte, or `null` when the clause is cleared (what a cleared Mosaic clause carries as its predicate). */
  readonly predicateSQL: string | null;
}

// ── the gates ───────────────────────────────────────────────────────────────

function identityOf(role: string, candidate: unknown): RegisteredSource {
  if (!(candidate instanceof RegisteredSource)) {
    refuse('unknown-source', `a clause ${role} must come from a SourceRegistry — got ${Object.prototype.toString.call(candidate)}`);
  }
  return candidate;
}

/** WHY every entry and not just `source`: `skip()` is `clients.has(client)`, so an unregistered client would silently never be skipped. */
function sourcesOf(spec: CauseClauseSpec): { source: RegisteredSource; clients: readonly RegisteredSource[] } {
  const source = identityOf('source', spec.source);
  const clients = spec.clients === undefined ? [source] : spec.clients.map((c) => identityOf('client', c));
  return { source, clients };
}

/** The byte, by the engine's own rules (`mosaicDescriptorSQL`), or a refusal for a shape no engine renders. */
function descriptorOf(spec: CauseClauseSpec): string {
  switch (spec.kind) {
    case 'point':
      // WHY through `pointValueFromWire`: the one-translation law (src/data/clauseFromWire.ts) — the
      // wire's `null` clears, and the clause and the record this act also lands must not disagree about that
      return mosaicDescriptorSQL('point', spec.field, pointValueFromWire(spec.value));
    case 'interval':
      return mosaicDescriptorSQL('interval', spec.field, spec.value);
    case 'cell':
      return mosaicDescriptorSQL('cell', spec.fields, spec.value);
    case 'match':
      return mosaicDescriptorSQL('match', spec.field, spec.value);
    default:
      // reachable only from an untyped caller; a switch that fell off would mint a clause with no byte
      return refuse('unsupported-shape', `unknown clause kind "${String((spec as { kind?: unknown }).kind)}"`);
  }
}

// ── the door ────────────────────────────────────────────────────────────────

/** Judge a spec: throws a `Refusal`/`TypeError` for a port to catch through `rejectionOf`, or answers the verdict. */
export function judge(spec: CauseClauseSpec): Verdict {
  const cause = validateCause(spec.cause); // R12: throws, never rejects — see rejectionOf
  const { source, clients } = sourcesOf(spec);
  const sql = descriptorOf(spec);
  // WHY null and not "null": the port's clause carries what a Mosaic clause carries — no predicate;
  // the log spells it `String(null)` at its own boundary, once, for every engine
  return { cause, source, clients, predicateSQL: isClearedSQL(sql) ? null : sql };
}

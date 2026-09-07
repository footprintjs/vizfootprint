/**
 * JUDGE — ONE VERDICT PER SPEC, WHICHEVER ENGINE ANSWERS.
 *
 * The law it follows: the two ports must reject one spec identically, and
 * mint one byte for it. A policy that lives in two adapters drifts the day a
 * NEW clause kind or a new refusal arrives (the replica hazard — the
 * neighbourhood was that day, and it cost this file two arms), so the
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
import { isClearedSQL, mosaicDescriptorSQL, neighbourhoodFieldLabel, pointValueFromWire } from '../data/index.js';
import type { NeighbourhoodValue, NeighbourhoodValueBody } from '../data/index.js';
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
    // a primitive is QUOTED (a view id string is exactly what a caller meant to hand `require`);
    // anything else has no spelling worth printing, so it is named by its type
    const got = typeof candidate === 'string' ? JSON.stringify(candidate) : Object.prototype.toString.call(candidate);
    refuse('unknown-source', `a clause ${role} must come from a SourceRegistry — got ${got}`);
  }
  return candidate;
}

/** WHY every entry and not just `source`: `skip()` is `clients.has(client)`, so an unregistered client would silently never be skipped. */
function sourcesOf(spec: CauseClauseSpec): { source: RegisteredSource; clients: readonly RegisteredSource[] } {
  const source = identityOf('source', spec.source);
  // the INDEX rides the role: a list of clients refuses over one entry, and the caller needs to know which
  const clients = spec.clients === undefined ? [source] : spec.clients.map((c, i) => identityOf(`client [${i}]`, c));
  return { source, clients };
}

/**
 * A walk's QUESTION, judged beside its answer. The byte is made of the `ids`
 * alone, so nothing downstream would ever notice a body that records WHICH rows
 * were selected but not which walk found them — until a bring-over or a saved
 * picture re-asks it from a seed that was never there, and refuses two hops
 * away, blaming the act instead of the commit.
 *
 * WHY here: judge is the one verdict both ports take, and this is the one kind
 * whose value is a question and an answer in one object ({@link
 * NeighbourhoodValueBody}). A cleared walk (`null`) records no question by
 * definition and is not judged.
 */
function judgeWalkQuestion(fields: readonly [string, string], value: NeighbourhoodValue): void {
  if (value === null) return;
  const body = value as Partial<NeighbourhoodValueBody>;
  const missing = [
    ...('seed' in body ? [] : ['seed']),
    ...(typeof body.derivation === 'string' ? [] : ['derivation']),
    ...(typeof body.hops === 'number' ? [] : ['hops']),
  ];
  if (missing.length > 0) {
    refuse(
      'unsupported-shape',
      `a neighbourhood value records its question WITH its answer — "${neighbourhoodFieldLabel(fields)}" got a walked list and no ${missing.join(', no ')}`,
    );
  }
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
    case 'neighbourhood': {
      // the ANSWER first (it is what the byte is made of), then the QUESTION beside it
      const byte = mosaicDescriptorSQL('neighbourhood', spec.fields, spec.value);
      judgeWalkQuestion(spec.fields, spec.value);
      return byte;
    }
    default: {
      // reachable only from an untyped caller; a switch that fell off would mint a clause with no byte.
      // The `never` binding is the compiler's pin: a kind added to the union with no arm above lands
      // here as something other than `never`, and the build names the one that was forgotten.
      const unhandled: never = spec;
      return refuse('unsupported-shape', `unknown clause kind "${String((unhandled as { kind?: unknown }).kind)}"`);
    }
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

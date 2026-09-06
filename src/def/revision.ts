/**
 * THE DEFINITION'S REVISION — one short string that says *which* definition a
 * dashboard was built from.
 *
 * A served answer states what it was true as of, and half of that is the data
 * (each source vouches for its own version) and half is the DECLARATION: the
 * views, the columns, the links, the rules, the analyses. A reader holding a
 * cached part needs one value to compare before trusting it, and until now
 * there was none — a def could be edited, rebuilt and served again, and
 * nothing in the answer moved.
 *
 * It is computed ONCE, at build, over the validated def, and frozen with it.
 * Not a cryptographic hash and never presented as one: it is FNV-1a over a
 * key-sorted serialization, which is enough to tell two definitions apart and
 * is not a defence against someone constructing a collision on purpose.
 *
 * **What it cannot cover, stated rather than hidden.** A `DashboardDef` may
 * carry an analysis as a FUNCTION (a module, or a raw def with a `run`). A
 * function is not data and cannot be digested — its body could change with
 * nothing in the serialization moving — so a function contributes only its
 * name here. Two defs that differ only inside an analysis function's body
 * carry the same revision, and the honest reading of `revision` is therefore
 * *"the declaration, as far as the declaration is data"*. An analysis
 * declared as a builtin RECORD (`{ builtin: 'formula', … }`) is data all the
 * way down and is covered completely — the same asymmetry `AnalysisAct.def`
 * already draws, for the same reason.
 */
import { fnv1a } from '../source/hash.js';
import type { DashboardDef } from './types.js';

/** The prefix a revision carries, so a reader can tell it from an `asOf` (`o-…`) or a commit id (`s7`). */
export const REVISION_PREFIX = 'r-';

/**
 * A stable serialization: object keys in SORTED order, so two equal defs
 * written in a different key order digest the same. `undefined`-valued keys
 * are dropped, exactly as `JSON.stringify` drops them, so a key written and
 * left undefined never moves the revision.
 */
export function stableJson(value: unknown): string {
  if (typeof value === 'function') return JSON.stringify(`[function ${value.name === '' ? 'anonymous' : value.name}]`);
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const own = value as { toJSON?: unknown };
  // a value with its own `toJSON` (a Date in an inline row) serializes as JSON says it does, never as its empty own-key set
  if (typeof own.toJSON === 'function') return stableJson((own.toJSON as () => unknown).call(value));
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(record[k])}`).join(',')}}`;
}

/** The revision of a definition — computed once at build and frozen onto the {@link Dashboard}. */
export function defRevision(def: DashboardDef): string {
  return `${REVISION_PREFIX}${fnv1a(stableJson(def))}`;
}

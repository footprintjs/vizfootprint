/**
 * L0 cause embryo — the two-slot provenance tag every cause-carrying artifact
 * wears. This is the smallest honest unit of "who asked for this, and who
 * computed it", plus a replay marker.
 *
 * Invariants served:
 *  - R1  two-slot cause (requestedBy / computedBy are independent).
 *  - R2  replay is a MODE: the original cause is preserved verbatim; a replay
 *        only ADDS `replayed: true`. requestedBy/computedBy are never rewritten.
 *  - R12 validators, never model-authored code. Nothing here evals, interprets,
 *        or dispatches on a string value. A string is inert data.
 */

/** The three actor classes that can request or compute a change. */
export type Actor = 'user' | 'agent' | 'system';

/** The frozen set of valid actors — the ONLY values the enum slots accept. */
export const ACTORS: readonly Actor[] = ['user', 'agent', 'system'] as const;

/**
 * The two-slot cause. `requestedBy` and `computedBy` are deliberately separate:
 * a user can request something an agent computes, or an agent can request
 * something the system computes, etc.
 */
export interface Cause {
  /** Who initiated the intent behind this change. */
  requestedBy: Actor;
  /** Who actually produced the value / clause. */
  computedBy: Actor;
  /**
   * Present (and exactly `true`) only when this cause was re-emitted by a
   * replay of the log. Absence means "authored live". R2: this is additive.
   */
  replayed?: true;
  /**
   * Free-text, human-facing note. Treated as INERT DATA — never parsed,
   * never dispatched on. An injection string here is just a string.
   */
  intent?: string;
  /**
   * BR-1 bring-over (cherry-pick) marker: the id of the commit this commit
   * REPLAYS onto another path. A bring-over is an ordinary commit — no new
   * verb — so the provenance rides here. Inert data, like `intent`: the id
   * is a plain string, never parsed or dereferenced by the validator.
   */
  replayedFrom?: string;
  /**
   * BR-1 undo (revert) marker: the id of the commit this commit REVERTS
   * (the new commit restores the key's value at that commit's parent).
   * Same inert-data discipline as `replayedFrom`.
   */
  revertOf?: string;
  /**
   * The saved selection whose `replace` apply made this clear. A clear that
   * only makes room for a picture is not a person clearing: nothing is
   * remembered for a link's `onClear`, so no ghost of the old picture survives.
   */
  replacedBy?: string;
  /**
   * BR-1 conflict note: the ids of the commits that touched the SAME state
   * key on the target path since the common ancestor, at the moment a
   * bring-over/undo plan was executed. Present only when the plan reported
   * conflicts — the plan stays executable, the note is explicit + audited.
   * Inert data: ids are plain strings.
   */
  conflicts?: readonly string[];
}

/** The exhaustive set of keys a Cause may carry. Anything else is rejected. */
const CAUSE_KEYS = new Set(['requestedBy', 'computedBy', 'replayed', 'intent', 'replayedFrom', 'revertOf', 'replacedBy', 'conflicts']);

/** Error thrown when a value is not a well-formed Cause. Carries every problem. */
export class CauseValidationError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`invalid Cause: ${problems.join('; ')}`);
    this.name = 'CauseValidationError';
    this.problems = problems;
  }
}

/** Runtime type guard for the Actor enum. */
export function isActor(x: unknown): x is Actor {
  return typeof x === 'string' && (ACTORS as readonly string[]).includes(x);
}

/** The result of a non-throwing parse. */
export type CauseParseResult =
  | { ok: true; cause: Cause }
  | { ok: false; problems: string[] };

/**
 * Strict, allocation-fresh validator. Returns a normalized Cause containing
 * ONLY the known fields (nothing smuggled via extra or prototype-polluting
 * keys survives), or a list of problems. Never throws, never evals.
 */
export function parseCause(value: unknown): CauseParseResult {
  const problems: string[] = [];

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, problems: ['cause must be a plain object'] };
  }

  // Reject ANY key we do not explicitly know. `Object.keys` returns own
  // enumerable string keys — including a JSON-parsed "__proto__" own key,
  // so prototype-pollution payloads land here and are rejected as unknown.
  for (const key of Object.keys(value)) {
    if (!CAUSE_KEYS.has(key)) problems.push(`unknown key "${key}"`);
  }

  const record = value as Record<string, unknown>;

  if (!('requestedBy' in record)) {
    problems.push('missing requestedBy');
  } else if (!isActor(record.requestedBy)) {
    problems.push(`requestedBy must be one of ${ACTORS.join('|')}`);
  }

  if (!('computedBy' in record)) {
    problems.push('missing computedBy');
  } else if (!isActor(record.computedBy)) {
    problems.push(`computedBy must be one of ${ACTORS.join('|')}`);
  }

  if ('replayed' in record && record.replayed !== true) {
    problems.push('replayed, if present, must be exactly true');
  }

  if ('intent' in record && typeof record.intent !== 'string') {
    problems.push('intent, if present, must be a string');
  }

  if ('replayedFrom' in record && typeof record.replayedFrom !== 'string') {
    problems.push('replayedFrom, if present, must be a string commit id');
  }

  if ('replacedBy' in record && typeof record.replacedBy !== 'string') {
    problems.push('replacedBy, if present, must be the saved selection\'s name');
  }
  if ('revertOf' in record && typeof record.revertOf !== 'string') {
    problems.push('revertOf, if present, must be a string commit id');
  }

  if ('conflicts' in record) {
    const c = record.conflicts;
    if (!Array.isArray(c) || !c.every((id) => typeof id === 'string')) {
      problems.push('conflicts, if present, must be an array of string commit ids');
    }
  }

  if (problems.length) return { ok: false, problems };

  // Rebuild from scratch — this is the data-only firewall. Whatever else was
  // on the input object (getters, symbols, extra props) does not pass.
  const cause: Cause = {
    requestedBy: record.requestedBy as Actor,
    computedBy: record.computedBy as Actor,
  };
  if (record.replayed === true) cause.replayed = true;
  if (typeof record.intent === 'string') cause.intent = record.intent;
  if (typeof record.replayedFrom === 'string') cause.replayedFrom = record.replayedFrom;
  if (typeof record.revertOf === 'string') cause.revertOf = record.revertOf;
  if (typeof record.replacedBy === 'string') cause.replacedBy = record.replacedBy;
  if (Array.isArray(record.conflicts)) cause.conflicts = [...(record.conflicts as string[])]; // fresh array — the firewall copies, never aliases
  return { ok: true, cause };
}

/** Throwing validator. Returns the normalized Cause or throws CauseValidationError. */
export function validateCause(value: unknown): Cause {
  const result = parseCause(value);
  if (!result.ok) throw new CauseValidationError(result.problems);
  return result.cause;
}

/** Convenience predicate. */
export function isCause(value: unknown): value is Cause {
  return parseCause(value).ok;
}

/**
 * Produce a replay-marked copy of a cause WITHOUT touching the two slots (R2).
 * Idempotent: replaying a replayed cause stays replayed with the same slots.
 */
export function markReplayed(cause: Cause): Cause {
  const validated = validateCause(cause);
  return { ...validated, replayed: true };
}

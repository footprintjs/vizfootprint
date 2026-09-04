/**
 * The cause a landed commit carries — re-derived by the session, never taken on
 * trust from the caller.
 *
 * A commit's `cause` is the whole of WHY, and `src/log`'s first law is that it
 * is tamper-evident once landed. That law is worth nothing if the caller can
 * simply assert it on the way in, so every act passes through here first: the
 * shape is validated by the cause gate (R12), and `computedBy` is FORCED to
 * `'system'` for an analysis (R1) rather than believed. An analysis that could
 * claim a person computed it is a dashboard that can attribute a machine's
 * conclusion to a human, silently, at the one place a reader would look to
 * check.
 *
 * Everything else on a validated cause rides through untouched, because it is
 * inert provenance the trace is meant to carry: `replayedFrom` and `revertOf`
 * say a bring-over or an undo is an ORDINARY commit whose cause tells the
 * story, `replacedBy` marks a clear that was making room for a saved picture
 * (so a link's `onClear` never remembers it as a real clear), and `conflicts`
 * records what a plan had to step over.
 *
 * **Before you add a key here**: pass-through is not free. Anything this
 * function copies out of a caller's cause becomes part of the tamper-evident
 * record, so it must be something the cause gate already validated and
 * something no downstream fold BRANCHES on without judging it again —
 * `replacedBy` is read by `rebuildFold`, and it is safe only because it is a
 * marker, never a value the fold has to interpret.
 */
import { validateCause, type Actor, type Cause } from '../cause/index.js';
import type { DispatchVerb } from '../def/types.js';

/** The cause a commit lands with: validated (R12), with `computedBy` forced for an analysis (R1). */
export function stampCause(cause: Cause, verb: DispatchVerb, as: Actor | undefined): Cause {
  const validated = validateCause(cause); // R12 gate — never trusts caller shape
  const requestedBy: Actor = as ?? validated.requestedBy;
  // R1: an analysis is computedBy:'system' BY CONSTRUCTION — never caller-supplied.
  const computedBy: Actor = verb === 'analyze' ? 'system' : (as ?? validated.computedBy);
  const out: Cause = { requestedBy, computedBy };
  if (validated.intent !== undefined) out.intent = validated.intent;
  // BR-1 provenance tags ride the stamp untouched (validated inert data):
  // a bring-over/undo is an ORDINARY commit — its cause carries the story.
  if (validated.replayedFrom !== undefined) out.replayedFrom = validated.replayedFrom;
  if (validated.revertOf !== undefined) out.revertOf = validated.revertOf;
  if (validated.replacedBy !== undefined) out.replacedBy = validated.replacedBy; // a clear that makes room for a saved picture says so
  if (validated.conflicts !== undefined) out.conflicts = validated.conflicts;
  return out;
}

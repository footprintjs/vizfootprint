/**
 * One translation, in both directions, between the three shapes a selection
 * wears: the CLAUSE the data layer evaluates, the flat TRIPLE a commit carries,
 * the CONDITION a saved picture stores, and the ACT that lands any of them.
 *
 * Nothing here reads the session. Every function is total over its arguments
 * and returns a fresh value, which is why they are the safest part of the
 * session to hold apart from it: a clause becoming a commit, a commit becoming
 * a clause again, a saved condition becoming a dispatch, a live clause becoming
 * a clear — those are RULES, not state, and the session should be reading them
 * rather than restating them.
 *
 * **The one thing to know before changing anything here.** These functions are
 * the reason folding as you WALK equals folding a REPLAY (`README.md`, law 3).
 * `doProbe` lands a commit through one of them and `rebuildFold` reads it back
 * through another; if the two ever disagree about what a `match`'s polarity or
 * a `cell`'s pair means, a seek shows something the live walk never did — and
 * it fails silently, because both answers parse. Add a kind to one function
 * here and you are adding it to all of them.
 *
 * `probeClause` is knowingly the library's own internal twin of
 * `clauseFromWire` in [`../data`](../data/README.md) (point/interval/match),
 * and the `rec.kind === 'cell' ? {…} : probeClause(…)` ternaries beside it
 * restate the cell lift. That duplicate is named there rather than hidden, and
 * folding them together is a session-side decision nobody has made yet.
 */
import { cellFieldLabel, type MatchValue, type PredicateClause } from '../data/index.js';
import type { EmissionKind } from '../links/index.js';
import type { Cause } from '../cause/index.js';
import type { SavedClause } from '../def/types.js';
import { copyValue } from '../detach/index.js';
import type { CellValues, DispatchAction, FilterRange, SelectionInfo } from './types.js';

/** The predicate clause a landed point/interval/match probe folds to — ONE spelling for the live path and the replay fold. */
export function probeClause(kind: 'point' | 'interval' | 'match', field: string, value: unknown): PredicateClause {
  if (kind === 'point') return { kind, field, value };
  if (kind === 'match') {
    const body = value as Exclude<MatchValue, null>;
    return { kind, field, values: body.values, ...(body.exclude === true ? { exclude: true } : {}) };
  }
  return { kind, field, value: value as FilterRange };
}

/** The emission kind a select/filter act names: the cell form, the match form, the point, or the interval. */
export function kindOfAct(action: Extract<DispatchAction, { verb: 'select' | 'filter' }>): EmissionKind {
  if (action.verb === 'filter') return 'interval';
  return 'fields' in action ? 'cell' : 'values' in action ? 'match' : 'point';
}

/** One live (or last) clause as the wire's `SelectionInfo` — the same projection for active and cleared selections. */
export function selectionInfoOf(viewId: string, clause: PredicateClause, commitId?: string): SelectionInfo {
  const info: SelectionInfo = (
      clause.kind === 'cell'
        ? {
            viewId,
            field: cellFieldLabel(clause.fields), // display-only joint label (D30)
            kind: 'cell' as const,
            value: clause.value,
            fields: clause.fields,
          }
        : clause.kind === 'match'
          ? {
              viewId,
              field: clause.field,
              kind: 'match' as const,
              // the wire carries the IN-list and its polarity as ONE value (a `MatchValue`) — key order {values, exclude?}
              // matches the commit's own value, which a consumer may compare as JSON (the saved-selection panel does)
              value: { values: clause.values, ...(clause.exclude === true ? { exclude: true } : {}) },
            }
          : {
              viewId,
              field: clause.field,
              kind: clause.kind as 'point' | 'interval',
              value: (clause as { value: unknown }).value, // never a cleared point: one clearing rule drops it from the fold (SET-1)
            }  );
  return commitId === undefined ? info : { ...info, commitId };
}

/** A view's live clause as a saved condition. */
export function clauseOfLive(viewId: string, clause: PredicateClause): SavedClause {
  if (clause.kind === 'cell') return { viewId, kind: 'cell', field: cellFieldLabel(clause.fields), fields: [clause.fields[0], clause.fields[1]], value: copyValue(clause.value) };
  if (clause.kind === 'match') return { viewId, kind: 'match', field: clause.field, value: { values: copyValue(clause.values), ...(clause.exclude === true ? { exclude: true } : {}) } };
  return { viewId, kind: clause.kind, field: clause.field, value: copyValue(clause.value) };
}

/** The ordinary act a saved condition lands as — the same mapping a bring-over uses for a selection recipe. */
export function selectionAction(c: SavedClause, cause: Cause): Extract<DispatchAction, { verb: 'select' | 'filter' }> {
  if (c.kind === 'cell') return { verb: 'select', viewId: c.viewId, fields: c.fields!, values: c.value as CellValues, cause }; // a cell condition always carries its pair
  if (c.kind === 'match') {
    const body = c.value as Exclude<MatchValue, null>;
    return { verb: 'select', viewId: c.viewId, field: c.field, values: body.values, ...(body.exclude === true ? { exclude: true } : {}), cause };
  }
  if (c.kind === 'point') return { verb: 'select', viewId: c.viewId, field: c.field, value: c.value, cause };
  return { verb: 'filter', viewId: c.viewId, field: c.field, range: c.value as FilterRange, cause };
}

/** The kind-faithful clear of a live clause (the same shapes a bring-over's clear-selection recipe lands). */
export function clearAction(viewId: string, clause: PredicateClause, cause: Cause): Extract<DispatchAction, { verb: 'select' | 'filter' }> {
  if (clause.kind === 'cell') return { verb: 'select', viewId, fields: [clause.fields[0], clause.fields[1]], values: null, cause };
  if (clause.kind === 'match') return { verb: 'select', viewId, field: clause.field, values: null, cause };
  if (clause.kind === 'point') return { verb: 'select', viewId, field: clause.field, value: undefined, cause };
  return { verb: 'filter', viewId, field: clause.field, range: null, cause };
}

/** A consumer's own copy of a clause — never the session's live object. A clause is JSON-shaped through every door; one that is not is handed over as a shallow copy rather than thrown on. */
export function copyClause(clause: PredicateClause): PredicateClause {
  try {
    return structuredClone(clause);
  } catch {
    /* v8 ignore next -- unreachable through the JSON-shaped agent and UI doors: only a hand-built clause with a function or symbol value refuses to clone */
    return { ...clause };
  }
}

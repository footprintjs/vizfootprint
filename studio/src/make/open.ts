/**
 * THE DEFINITION BECOMES A DESK — the one door out of the wizard.
 *
 * `parseDashboardDef` then `buildDashboard` then `createSession`, in that order
 * and with no step of its own in between. The order is the point: the parse
 * narrows an `unknown` to a typed definition and hands back SENTENCES, the
 * build judges what only the real columns can prove and throws its own, and
 * only then is there a session. A wizard that built first and asked afterwards
 * would be showing a desk it had not been allowed to show.
 *
 * It is here rather than in `Make.tsx` for the reason `steps.ts` is: a host
 * driving this headlessly — a test, a script, an agent — needs the same door,
 * and a second spelling of "parse, build, open" is a second answer to what a
 * definition has to survive.
 */
import { buildDashboard, parseDashboardDef, DashboardDefError, type Dashboard, type DashboardDef } from 'vizfootprint/def';
import type { InteractionSession } from 'vizfootprint/session';
import { createSessionView, sessionSource, type SessionView } from 'vizfootprint-ui';
import { planFromDef, type MadePlan } from './cells.js';

/** A desk that is open: the dashboard, its session, the store the cockpit reads, and what the cells need. */
export interface MadeDesk {
  readonly dash: Dashboard;
  readonly session: InteractionSession;
  readonly view: SessionView;
  readonly plan: MadePlan;
  /** The definition it was opened from — already narrowed and already built, so it is the one to publish. */
  readonly def: DashboardDef;
}

/** Opened, or every reason it could not be — each a sentence, from whichever door refused it. */
export type OpenedDesk = { readonly ok: true; readonly desk: MadeDesk } | { readonly ok: false; readonly refusals: readonly string[] };

/**
 * What a build door said, as sentences — the one translation from a thrown
 * refusal to something a person reads, exported so a host catching its own
 * `buildDashboard` prints the same thing this door does.
 *
 * `DashboardDefError` carries the list it was raised with, and that is what a
 * person should read: the `Error`'s own message is those same sentences with a
 * prefix and semicolons between them. Anything else that reaches here is said
 * in its own words rather than swallowed.
 */
export function buildRefusals(error: unknown): readonly string[] {
  if (error instanceof DashboardDefError) return error.problems;
  return [error instanceof Error ? error.message : String(error)];
}

/** Parse it, build it, open a session on it. */
export function openDesk(def: unknown): OpenedDesk {
  const parsed = parseDashboardDef(def);
  if (!parsed.ok) return { ok: false, refusals: parsed.problems };
  let dash: Dashboard;
  try {
    dash = buildDashboard(parsed.def);
  } catch (error) {
    return { ok: false, refusals: buildRefusals(error) };
  }
  const session = dash.createSession();
  return { ok: true, desk: { dash, session, view: createSessionView(sessionSource(session), { as: 'user' }), plan: planFromDef(parsed.def), def: parsed.def } };
}

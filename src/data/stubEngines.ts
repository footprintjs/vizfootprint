/**
 * STUB ENGINES — THE TWO THIS VERSION NAMES AND DOES NOT RUN.
 *
 * D24 names three engines behind the data seam. `memory` answers; `wasm` and
 * `server` are typed stubs — declared so the port's shape is honest before the
 * backends exist (`wasmProvider.ts`, `serverProvider.ts`) — and a stub answers
 * only its DECLARED TABLE LIST: every read of a column or a row is refused.
 * This module is the one place that says so, in one sentence, so the build door
 * and the read door tell an author the same thing in the same words instead of
 * each inventing its own.
 *
 * The law: a refusal quotes the offending value and says what is known — and
 * here it also says what to do instead, because "not implemented yet" is a fact
 * about our build order, not an instruction to the person holding a def that
 * will not run. WHY the sentence admits `tables()` rather than claiming the
 * table is wholly dark: a refusal that claims MORE absence than there is sends
 * a reader away from the one thing they could still ask for.
 *
 * First customers: `wasmProvider` / `serverProvider` — the `detail` on every
 * rejection they file for a read this version cannot perform, which is all of
 * them but one. `serverProvider.materializeColumn` speaks in its own words on
 * purpose: it is refused by a DECLARED capability (`canMaterialize: false`)
 * that a real Coordinator behind that provider would refuse too, not by our
 * build order. Also `src/def/buildDashboard.ts` — the build note a table routed
 * to a stub owes its author, and the `lint()` door that throws it.
 */
import type { Engine } from './types.js';

/** The engines this version declares and does not run — data, so both doors read ONE list. */
export const STUB_ENGINES = ['wasm', 'server'] as const;

/** One of those two. (`memory` is the engine that answers; `auto` never survives resolution.) */
export type StubEngine = (typeof STUB_ENGINES)[number];

/** Does this declaration route to an engine that answers no column and no row? */
export function isStubEngine(engine: Engine | undefined): engine is StubEngine {
  return engine !== undefined && (STUB_ENGINES as readonly string[]).includes(engine);
}

/** WHAT the engine does in this version — the clause both doors quote verbatim. */
export function stubEngineSentence(engine: StubEngine): string {
  return `the "${engine}" engine answers no query in this version — it is a typed stub: it names its declared tables and answers nothing else`;
}

/**
 * …and WHAT TO DO instead, spelled for the table that routed there.
 *
 * WHY the sentence does not name a builder: which door an author must call is a
 * fact about the WHOLE def (a table declaring a remote source forces
 * `buildDashboardAsync`), and this remedy knows only the table it is about.
 * Both builders take the same option, so the OPTION is the half that is always
 * true — naming `buildDashboard` here sent an async-built def to a door that
 * refuses it.
 */
export function stubEngineRemedy(table: string): string {
  return `Declare engine "memory" to run "${table}" in this process, or bring the engine yourself: pass { providers: { "${table}": yourProvider } } to the builder you already call`;
}

/** The whole refusal for one table: what happened, then what to do — the order a reader needs them in. */
export function stubEngineRefusal(engine: StubEngine, table: string): string {
  return `${stubEngineSentence(engine)}. ${stubEngineRemedy(table)}`;
}

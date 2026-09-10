/**
 * STUB ENGINES — THE ONE THIS VERSION NAMES AND DOES NOT RUN.
 *
 * D24 names three engines behind the data seam. `memory` answers, `wasm` now
 * answers over a real SQL connection (`wasmProvider.ts` — DuckDB-WASM behind
 * `SqlConnection`), and `server` is still a typed stub: declared so the port's
 * shape is honest before a Mosaic Coordinator exists (`serverProvider.ts`), and
 * a stub answers only its DECLARED TABLE LIST — every read of a column or a row
 * is refused. This module is the one place that says so, in one sentence, so
 * the build door and the read door tell an author the same thing in the same
 * words instead of each inventing its own.
 *
 * WHY the list is data and not a hand-typed name: it SHRANK when the wasm
 * engine started answering (D24 build step 2), and every door that judges
 * "does this declaration route to something that runs?" shrank with it in the
 * same commit — a second list would have kept refusing a table that now runs.
 *
 * The law: a refusal quotes the offending value and says what is known — and
 * here it also says what to do instead, because "not implemented yet" is a fact
 * about our build order, not an instruction to the person holding a def that
 * will not run. WHY the sentence admits `tables()` rather than claiming the
 * table is wholly dark: a refusal that claims MORE absence than there is sends
 * a reader away from the one thing they could still ask for.
 *
 * First customer: `serverProvider` — the `detail` on every rejection it files
 * for a read, which is all of them but one. `serverProvider.materializeColumn`
 * speaks in its own words on purpose: it is refused by a DECLARED capability
 * (`canMaterialize: false`) that a real Coordinator behind that provider would
 * refuse too, not by our build order. Also `src/def/buildDashboard.ts` — the
 * build note a table routed to a stub owes its author, and the `lint()` door
 * that throws it.
 */
import type { Engine } from './types.js';

/** The engines this version declares and does not run — data, so both doors read ONE list. */
export const STUB_ENGINES = ['server'] as const;

/** The one of them. (`memory` and `wasm` answer; `auto` never survives resolution.) */
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

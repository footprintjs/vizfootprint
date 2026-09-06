/**
 * THE WIZARD'S CONTRACT — what a person is building, one step at a time.
 *
 * A `MakeDraft` is everything the four steps collect and the ONLY thing the
 * assembler reads. It is deliberately not a `DashboardDef`: a def is finished
 * and judged, and a draft is neither — it is allowed to be half-declared while
 * somebody is still declaring it. `assembleDef(draft)` is the one place the
 * first becomes the second, and every judgement in `steps.ts` is a statement
 * about a draft that is not yet one.
 *
 * Two laws are visible in these shapes:
 *
 *   • **A column is declared, never guessed.** {@link MakeColumn} extends the
 *     def's own `ColumnDecl` and adds only the name. `describeTable` seeds the
 *     `type` and NOTHING else — the role is the person's, and a draft whose
 *     role is absent is a draft the wizard refuses to move past, rather than
 *     one it quietly fills in. A description is what the data says; a
 *     declaration is what the person says.
 *   • **The definition is data.** Every field here is JSON — the analysis is
 *     the def's builtin RECORD form, never a module with a `run()` — so what
 *     the assembler produces survives `JSON.parse(JSON.stringify(def))`, which
 *     is what lets a published page carry its own definition.
 */
import type { BuiltinAnalysisDecl, ColumnDecl, DashboardDef } from 'vizfootprint/def';
import type { ColumnDescription } from 'vizfootprint/data';

/**
 * The chart kinds this wizard can draw.
 *
 * Three, and the reason is the one this package states everywhere: the wizard
 * has to RENDER what it offers. `vizfootprint`'s encoding plane knows nine
 * chart kinds and would happily judge a heatmap; a wizard that let a person
 * pick one and then drew nothing would be offering a chart it cannot keep.
 * A developer writing their own cells has the whole vocabulary.
 */
export type MakeChartKind = 'bar' | 'line' | 'table';

/** One column, as the person has declared it over `describeTable`'s sniff. */
export interface MakeColumn extends ColumnDecl {
  readonly name: string;
}

/** The absence vocabulary one table declares — the column that carries "there is no value here", and the words it may say. */
export interface MakeAbsence {
  readonly field: string;
  readonly states: readonly string[];
}

/** One chart the person has added: who it is, what kind, and what sits on each of its channels. */
export interface MakeView {
  readonly id: string;
  readonly label: string;
  readonly chartKind: MakeChartKind;
  /** channel → column. Every channel of the kind must carry one before the step will pass. */
  readonly bindings: Readonly<Record<string, string>>;
}

/**
 * One declared analysis: the slot name a person will look for it under, and the
 * builtin record that says which of the four it is and with what options.
 *
 * The record form is the whole reason a wizard can declare an analysis at all —
 * the other two forms of `AnalysisSlot` are functions, and a wizard cannot
 * write a function. See `vizfootprint/src/def/README.md`.
 */
export interface MakeAnalysis {
  readonly id: string;
  readonly decl: BuiltinAnalysisDecl;
}

/** What the four steps collect. Nothing here is judged; `steps.ts` does the judging. */
export interface MakeDraft {
  /** The table's name in the def. One table, and the wizard names it — see `MAKE_TABLE`. */
  readonly table: string;
  /** The CSV text, exactly as it was pasted or read off a file. */
  readonly csv: string;
  readonly columns: readonly MakeColumn[];
  /** The absence vocabulary, when the person declared one. `null` = this table has no absence column. */
  readonly absence: MakeAbsence | null;
  readonly views: readonly MakeView[];
  /** The one declared analysis, when the person chose one. */
  readonly analysis: MakeAnalysis | null;
  /** The dashboard's own words — declared prose, not a heading typed into a shell. */
  readonly title: string;
  readonly caption: string;
}

/** A step's answer: it may begin the next one, or here is every reason it may not — each a sentence naming the thing. */
export type StepVerdict = { readonly ok: true } | { readonly ok: false; readonly refusals: readonly string[] };

/** The four steps, in the order Datawrapper puts them and this wizard walks them. */
export type MakeStepId = 'data' | 'columns' | 'views' | 'desk';

/** What the table said about itself — `describeTable`'s answer, held beside the draft the person is writing over it. */
export interface MakeReading {
  readonly rows: number;
  readonly columns: readonly ColumnDescription[];
}

/** What a published page carries in its payload's data slot: the definition itself, because a made definition is data. */
export interface MadeData {
  readonly def: DashboardDef;
}

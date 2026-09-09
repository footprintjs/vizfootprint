/**
 * THE FOUR STEPS, WITHOUT A SCREEN — the judge, the assembler, and the ceiling.
 *
 * Everything in this file is a pure function over a {@link MakeDraft}. Nothing
 * here imports React, touches a DOM or opens a session, which is what lets a
 * host drive the whole flow headlessly (and lets the suite hold every refusal
 * to its exact sentence without rendering anything).
 *
 * ## The one rule this file keeps about itself
 *
 * **It states no law the library already states.** Two kinds of judgement live
 * here and they are told apart on purpose:
 *
 *   • the WIZARD's own — a person must declare a role before the wizard will
 *     move on, every channel of a chart must carry a column, a chart needs a
 *     name. These are about the ACT of authoring: they exist because a wizard
 *     that filled a blank in for you would be guessing on your behalf, and the
 *     dashboard would then repeat the guess in every sentence it writes.
 *   • the LIBRARY's — is this a legal `DashboardDef`, and may this column sit
 *     on that channel. Those are not restated here for a moment. The draft is
 *     assembled into a def and handed to `parseDashboardDef`; a binding is
 *     handed to `whatFits`. Whatever they say comes back verbatim, so the
 *     sentence a person reads at step two is the same sentence the build door
 *     would have thrown at them at step four.
 *
 * That split is why `assembleDef` is called by the judge itself: the honest way
 * to ask "would this be refused" is to make the thing and ask.
 */
import { BUILTIN_ANALYSES, parseDashboardDef, proposeCharts, whatFits, type BuiltinAnalysisDecl, type BuiltinAnalysisName, type ChartProposal, type ChartProposals, type DashboardDef, type Fit, type FitColumn, type ProposalKind } from 'vizfootprint/def';
import { describeTable, parseCSV } from 'vizfootprint/data';
import type { MakeAbsence, MakeAnalysis, MakeChartKind, MakeColumn, MakeDraft, MakeReading, MakeStepId, MakeView, StepVerdict } from './types.js';

/**
 * The one table's name in the definition this wizard writes.
 *
 * A wizard that asked a person to name their table would be asking a question
 * with no consequence: there is one table, every view reads it, and nothing on
 * screen ever prints the name. So it is stated here rather than collected, and
 * a host assembling its own draft may say otherwise.
 */
export const MAKE_TABLE = 'data';

/** The slot a declared analysis is registered under — the name a person will look for it by in `why`. */
export const MAKE_ANALYSIS_ID = 'the analysis';

/** The chart kinds this wizard offers, and the channels each of them binds. */
export const MAKE_CHART_KINDS: Readonly<Record<MakeChartKind, { readonly channels: readonly string[]; readonly says: string }>> = {
  bar: { channels: ['category'], says: 'one bar per value of a column, counting the rows in view' },
  line: { channels: ['x', 'y'], says: 'a measure summed along a continuous column' },
  table: { channels: [], says: 'the rows themselves, as they are' },
};

/** The kinds in the order the picker offers them. */
export const MAKE_CHART_KIND_NAMES: readonly MakeChartKind[] = ['bar', 'line', 'table'];

/**
 * What each builtin analysis asks for, so the picker is one loop rather than one
 * branch per analysis.
 *
 * `null` means "not offered by THIS wizard", and the map is exhaustive over
 * `BuiltinAnalysisName` so a builtin added to the library has to be answered for
 * here rather than silently appearing in the picker with nothing to fill in.
 */
export type AnalysisOption = { readonly key: string; readonly of: 'column' | 'number' | 'text'; readonly says: string };
export const ANALYSIS_OPTIONS: Readonly<Record<BuiltinAnalysisName, readonly AnalysisOption[] | null>> = {
  groupBy: [
    { key: 'by', of: 'column', says: 'grouped by' },
    { key: 'measure', of: 'column', says: 'averaging' },
  ],
  correlation: [
    { key: 'x', of: 'column', says: 'between' },
    { key: 'y', of: 'column', says: 'and' },
  ],
  regression: [
    { key: 'x', of: 'column', says: 'x' },
    { key: 'y', of: 'column', says: 'y' },
    { key: 'minPoints', of: 'number', says: 'fitted only from at least this many rows' },
  ],
  clustering: [
    { key: 'column', of: 'column', says: 'binning' },
    { key: 'k', of: 'number', says: 'into this many bins' },
  ],
  // the one whose options are WORDS rather than a pick: an expression the
  // person writes, and the name of the column it becomes. The library reads the
  // expression and refuses a token it has no rule for, naming it and where it
  // sits; nothing here judges it.
  formula: [
    { key: 'expression', of: 'text', says: 'working out' },
    { key: 'name', of: 'text', says: 'into a column called' },
  ],
  // The two that read a SECOND table across a DECLARED RELATION. This wizard
  // brings one table — the file the person dropped — so there is no second
  // table to relate it to and no relation to grant the read. Offering them
  // would be offering an act that could only ever be refused.
  layout: null,
  bringOver: null,
  // The declared column. Its whole content is a TREE, and a tree is not
  // something a person fills into three text boxes — the door that builds one
  // is the sheet's, where the table's columns and their types are on screen
  // beside it. The wizard offers the sentence form of the same act (`formula`)
  // and leaves the tree to the desk.
  derive: null,
  // The declared TABLE — the derive act's twin, refused for the SAME reason: its
  // measures are reducer TREES, and its record also carries an op version and a
  // group list, which is not something a person fills into three text boxes.
  // Landing a second table is NOT the objection (`groupBy` above lands one too),
  // and neither is a relation: the session MINTS an aggregate's relation back to
  // its parent from the group column. The desk is where a tree gets written.
  aggregate: null,
};

/**
 * The analyses this wizard can honestly offer: the ones a one-table draft can
 * fill in. Exported for {@link MAKE_CHART_KIND_NAMES}' reason — a flow that can
 * only be driven by a screen is a flow nobody can test, script or drive from an
 * agent, and "which analyses may this wizard be given" is a judgement of the
 * FLOW, not of the drawing.
 */
export const MAKE_ANALYSES: readonly BuiltinAnalysisName[] = BUILTIN_ANALYSES.filter((name) => ANALYSIS_OPTIONS[name] !== null);

// ── the ceiling ─────────────────────────────────────────────────────────────

/** Rows the memory engine is MEASURED comfortable at (see the scheduler measurements). */
export const MEASURED_FINE_ROWS = 90_000;
/** Rows at which the same engine is measured past the fifty-millisecond line. */
export const MEASURED_BREAKS_ROWS = 1_000_000;

/**
 * WHAT THIS DESK CAN CARRY, said before a file is chosen rather than after one
 * is loaded.
 *
 * It is the first thing on the first step on purpose. The number is not a
 * warning invented here: it is what the engine was measured at, and a person
 * bringing a large file deserves to learn that here — where the answer is
 * "bring a smaller slice" — rather than at step three, where the answer is
 * "start again".
 */
export const MAKE_CEILING_SENTENCE =
  'Everything on the desk you are about to make is answered in this browser, by the memory engine: measured comfortable at ninety thousand rows, and past the fifty-millisecond line at a million. Bring a file under ninety thousand rows and every gesture is immediate; bring a bigger one and it will not be, which is worth knowing now rather than at step three.';

/** How a particular file sits against that ceiling. A statement, never a refusal — the person's file is the person's. */
export interface CeilingVerdict {
  readonly level: 'fine' | 'watch' | 'over';
  readonly sentence: string;
}

/** The ceiling, applied to a row count. */
export function ceilingVerdict(rows: number): CeilingVerdict {
  const n = rows.toLocaleString('en-US');
  if (rows <= MEASURED_FINE_ROWS) return { level: 'fine', sentence: `${n} rows — inside the ninety thousand this engine is measured comfortable at.` };
  if (rows < MEASURED_BREAKS_ROWS) {
    return { level: 'watch', sentence: `${n} rows — past the ninety thousand this engine is measured comfortable at, short of the million where it breaks the fifty-millisecond line. Gestures will be slower than immediate.` };
  }
  return { level: 'over', sentence: `${n} rows — at or past the million where this engine breaks the fifty-millisecond line. This desk will be slow, and the honest answer is a smaller slice of the file.` };
}

// ── step 1: bring data ──────────────────────────────────────────────────────

/** What reading the pasted text produced: the description, or every reason there is nothing to describe. */
export type TableReading = { readonly ok: true; readonly reading: MakeReading } | { readonly ok: false; readonly refusals: readonly string[] };

/**
 * Read the CSV and say what is in it — `describeTable`'s answer, with the four
 * things that are not a table refused in a sentence first.
 *
 * The sniffed types come back untouched and are the SEED of step two, never its
 * answer: a description is what the data says, a declaration is what the person
 * says, and this wizard never lets the first stand in for the second.
 */
export function readTable(csv: string): TableReading {
  if (csv.trim().length === 0) return { ok: false, refusals: ['there is nothing to read yet — paste a CSV, or choose a file'] };
  const described = describeTable(csv);
  const refusals: string[] = [];
  // No "this has no columns" arm: a CSV's first line is its header, and text
  // with no first line is text with nothing in it, which the check above already
  // said. What CAN go wrong is a header cell with nothing in it.
  if (described.rows === 0) refusals.push('this CSV has a header and no rows — there is nothing to describe, and nothing to draw');
  // WHY the parser's header and not the description's columns: a repeated header cell is a fact about
  // the TEXT, and the parser collapses it into ONE row key — so `describeTable` names it once, which
  // is the truth about the table and would leave this door with nothing to refuse.
  const seen = new Set<string>();
  for (const name of parseCSV(csv).header) {
    if (name.trim().length === 0) refusals.push('one of the header\u2019s columns has no name — a column nobody can name is a column nobody can bind');
    else if (seen.has(name)) refusals.push(`the column "${name}" is in the header twice — a column is named once, or the two of them cannot be told apart`);
    seen.add(name);
  }
  if (refusals.length > 0) return { ok: false, refusals };
  return { ok: true, reading: described };
}

/** The columns a fresh reading seeds: the sniffed type, and nothing else — no role, because nobody has said one. */
export function seedColumns(reading: MakeReading): readonly MakeColumn[] {
  return reading.columns.map((c) => (c.type === 'unknown' ? { name: c.name } : { name: c.name, type: c.type }));
}

/**
 * What each column READ as, kept beside what the person then DECLARED, so a
 * screen can print both. `{}` before anything has been read — a column with no
 * entry simply says nothing, which is true.
 */
export function sniffedTypes(reading: MakeReading | null): Readonly<Record<string, string>> {
  if (reading === null) return {};
  return Object.fromEntries(reading.columns.map((c) => [c.name, c.type]));
}

/**
 * One column's declaration with its empty slots REMOVED.
 *
 * A `<select>` set back to "not said" hands back `''`, and a label typed and
 * then deleted is `''` too. Neither is a declaration: an empty string in a
 * def's `role` is a refusal from the validator about the empty string, where
 * an ABSENT role is the wizard's own refusal naming the column — which is the
 * sentence a person can act on.
 */
export function declaredColumn(column: MakeColumn): MakeColumn {
  return {
    name: column.name,
    ...(column.type === undefined ? {} : { type: column.type }),
    ...(column.role === undefined ? {} : { role: column.role }),
    ...(column.scale === undefined ? {} : { scale: column.scale }),
    ...(column.label === undefined || column.label.length === 0 ? {} : { label: column.label }),
  };
}

/**
 * The analysis picker's raw strings as the def's builtin RECORD, or `null` when
 * no analysis was chosen.
 *
 * An option left blank is left OUT rather than sent as an empty string, for the
 * reason above: the library's refusal for a MISSING option names the analysis
 * that needed it, and its refusal for an empty one would be about the empty
 * string. The two numeric options are the only ones this file knows by name,
 * and it knows them because a `<input type="number">` hands back text.
 */
export function analysisOf(kind: string, options: Readonly<Record<string, string>>): MakeAnalysis | null {
  if (kind === '') return null;
  const decl: Record<string, unknown> = { builtin: kind };
  for (const [key, value] of Object.entries(options)) {
    if (value === '') continue;
    decl[key] = key === 'k' || key === 'minPoints' ? Number(value) : value;
  }
  return { id: MAKE_ANALYSIS_ID, decl: decl as unknown as BuiltinAnalysisDecl };
}

// ── the assembler ───────────────────────────────────────────────────────────

/** The column declarations a def carries: the absence column is left out, because its role is DERIVED from the vocabulary. */
function columnDecls(draft: MakeDraft): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const column of draft.columns) {
    if (draft.absence !== null && draft.absence.field === column.name) continue;
    const decl: Record<string, string> = {};
    if (column.type !== undefined) decl['type'] = column.type;
    if (column.role !== undefined) decl['role'] = column.role;
    if (column.scale !== undefined) decl['scale'] = column.scale;
    if (column.label !== undefined && column.label.trim().length > 0) decl['label'] = column.label;
    if (Object.keys(decl).length > 0) out[column.name] = decl;
  }
  return out;
}

/** The dashboard's declared words — a slot per sentence the person actually wrote, and no entry at all when they wrote none. */
function proseDecl(draft: MakeDraft): DashboardDef['prose'] {
  const slots: Record<string, unknown> = {};
  const by = { kind: 'human' as const, by: 'the person who made this desk' };
  if (draft.title.trim().length > 0) slots['title'] = { text: draft.title.trim(), author: by, levels: ['construction'] };
  if (draft.caption.trim().length > 0) slots['caption'] = { text: draft.caption.trim(), author: by, levels: ['construction'] };
  if (Object.keys(slots).length === 0) return undefined;
  return [{ viewId: 'dashboard', slots: slots as never }];
}

/**
 * THE DRAFT BECOMES A DEFINITION — the one place that happens, and the reason
 * every judgement above can be honest.
 *
 * What comes out is DATA all the way down: the rows ride as CSV text, the
 * analysis rides as the def's builtin record, the words ride as declared prose.
 * `JSON.parse(JSON.stringify(assembleDef(draft)))` is the same definition, which
 * is what lets a published page carry its own.
 */
export function assembleDef(draft: MakeDraft): DashboardDef {
  const columns = columnDecls(draft);
  const prose = proseDecl(draft);
  const surfaces = draft.views
    .filter((v) => MAKE_CHART_KINDS[v.chartKind].channels.length > 0)
    .map((v) => ({ viewId: v.id, chartKind: v.chartKind, channels: [...MAKE_CHART_KINDS[v.chartKind].channels], initial: { ...v.bindings } }));
  return {
    data: {
      [draft.table]: {
        csv: draft.csv,
        ...(draft.absence === null ? {} : { absence: { field: draft.absence.field, states: [...draft.absence.states] } }),
        ...(Object.keys(columns).length === 0 ? {} : { columns }),
      },
    },
    actors: Object.fromEntries(draft.views.map((v) => [v.id, { actor: 'user' as const, ...(v.label.trim().length === 0 ? {} : { label: v.label.trim() }) }])),
    // A view with no channels declares NO encoding surface, which is what the
    // library means by one: `channels` may not be empty, and a table binds
    // nothing. (The NNDSS demo's sheet is the same shape — an actor with no
    // encodings entry.) `reencode` against it is then an honest refusal rather
    // than a guess at a channel vocabulary it never had.
    ...(surfaces.length === 0 ? {} : { encodings: surfaces }),
    ...(draft.analysis === null ? {} : { analyses: { [draft.analysis.id]: draft.analysis.decl } }),
    ...(prose === undefined ? {} : { prose }),
    defaultTable: draft.table,
  };
}

// ── what fits, per channel ──────────────────────────────────────────────────

/** The columns as the encoding plane holds them: the name plus whatever the person has declared on it. */
export function fitColumns(draft: MakeDraft): readonly FitColumn[] {
  return draft.columns.map((c) => ({ ...c }));
}

/**
 * What may sit on each of a view's channels, and the sentence refusing what may
 * not — `whatFits`, before anything is built, with the person's declarations on
 * top of the sniff.
 */
export function fitsForView(draft: MakeDraft, view: MakeView): Readonly<Record<string, readonly Fit[]>> {
  const others = Object.fromEntries(draft.views.filter((v) => v.id !== view.id).map((v) => [v.id, { ...v.bindings }]));
  return whatFits({
    columns: fitColumns(draft),
    ...(draft.absence === null ? {} : { absence: { field: draft.absence.field, states: [...draft.absence.states] } }),
    chartKind: view.chartKind,
    channels: MAKE_CHART_KINDS[view.chartKind].channels,
    bindings: { ...view.bindings },
    others,
    viewId: view.id,
  });
}

/** The one sentence refusing this binding, or null when it fits. Never a rule of this file's own — `whatFits` says it. */
export function misfit(draft: MakeDraft, view: MakeView, channel: string, field: string): string | null {
  const fits = fitsForView(draft, view)[channel];
  if (fits === undefined) return `a ${view.chartKind} has no ${channel} channel, so nothing can sit on it`;
  const found = fits.find((f) => f.field === field);
  if (found === undefined) return `"${field}" is not a column of this table, so nothing can be put on the ${channel} channel from it`;
  if (found.ok) return null;
  // `Fit.because` is the plane's own contract for a refusal ("the sentence when
  // `ok` is false"), so there is no second sentence to write here — a fallback
  // would be this file inventing one the plane never needed.
  return found.because!;
}

// ── what to offer, before anything is asked ─────────────────────────────────

/** How many charts the wizard offers before it asks a person to build one. */
export const MAKE_PROPOSALS = 6;

/**
 * The kinds this wizard can DRAW, in the shape the library's proposal door
 * wants them.
 *
 * It is passed rather than defaulted for one reason: the library proposes over
 * the requirement tables, where a `bar` binds `x` and `y`, and a made bar binds
 * `category` and counts the rows in view. A proposal this wizard cannot draw is
 * a proposal it must not offer, so it says which kinds it has and what each of
 * them binds. `table` binds nothing and drops out here — there is nothing to
 * propose about the rows themselves.
 */
export const MAKE_PROPOSAL_KINDS: readonly ProposalKind[] = MAKE_CHART_KIND_NAMES.map((chartKind) => ({ chartKind, channels: MAKE_CHART_KINDS[chartKind].channels })).filter(
  (kind) => kind.channels.length > 0,
);

/**
 * THE OFFER — charts this table can carry, worked out from what the person has
 * declared, best first, each carrying the reason it is offered.
 *
 * It states no preference of its own: the ordering is the encoding plane's
 * shipped policy and the sentences are its, exactly as the refusals under the
 * picker are. What this file contributes is the two facts only the wizard knows
 * — which kinds it can draw, and how many offers are worth reading.
 */
export function proposalsFor(draft: MakeDraft): ChartProposals {
  return proposeCharts({
    columns: fitColumns(draft),
    ...(draft.absence === null ? {} : { absence: { field: draft.absence.field, states: [...draft.absence.states] } }),
    kinds: MAKE_PROPOSAL_KINDS,
    limit: MAKE_PROPOSALS,
  });
}

/**
 * A taken proposal as a chart in the draft — the SAME shape the ＋ buttons
 * produce, so there is one path through `judgeStep` and not two.
 *
 * The cast is safe by construction: the only kinds asked for are
 * {@link MAKE_PROPOSAL_KINDS}, which are this wizard's own.
 */
export function viewFromProposal(proposal: ChartProposal, index: number): MakeView {
  return { ...newView(proposal.chartKind as MakeChartKind, index), bindings: { ...proposal.channels } };
}

// ── the judge ───────────────────────────────────────────────────────────────

/** The library's verdict on the draft as a whole, in the library's own sentences. */
function libraryProblems(def: DashboardDef): readonly string[] {
  const parsed = parseDashboardDef(def);
  return parsed.ok ? [] : parsed.problems;
}

/**
 * Step 1: is there a table here at all?
 *
 * A reading IS the answer — the component holds one only when {@link readTable}
 * accepted the text — so the cheap check comes first and the CSV is only walked
 * again when there is nothing to show for it. A host driving this headlessly
 * calls `readTable` itself and passes what it got back.
 */
function judgeData(draft: MakeDraft, reading: MakeReading | null): StepVerdict {
  if (reading !== null) return { ok: true };
  const read = readTable(draft.csv);
  if (!read.ok) return { ok: false, refusals: read.refusals };
  return { ok: false, refusals: ['this table has not been read yet — read it, and this step will show you what arrived'] };
}

/** Step 2: has every column been DECLARED, and does the library accept the declarations? */
function judgeColumns(draft: MakeDraft): StepVerdict {
  const refusals: string[] = [];
  for (const column of draft.columns) {
    if (draft.absence !== null && draft.absence.field === column.name) continue; // its role is derived from the vocabulary
    if (column.role === undefined) {
      refusals.push(
        `"${column.name}" has no declared role — say what it is (an identifier, a dimension or a measure). A column this wizard filled in for you would be a guess the dashboard then repeats in every sentence it writes.`,
      );
    }
  }
  // The library judges the declarations THEMSELVES — the absence vocabulary, the
  // spelling of a role, a label that is not a string — and its sentences come
  // back verbatim. The probe is the draft with everything later stripped off: a
  // def with no views is a legal def, so the only thing under judgement is the
  // `data` this step is about.
  const problems = [...refusals, ...libraryProblems(assembleDef({ ...draft, views: [], analysis: null, title: '', caption: '' }))];
  return problems.length === 0 ? { ok: true } : { ok: false, refusals: problems };
}

/**
 * Step 3: is there a chart, does each one carry a column on every channel it
 * has, and does each of those fit?
 *
 * These are the WIZARD's questions. The definition itself is judged by the door
 * out of this step — `openDesk`, which parses and builds — and its sentences are
 * the library's. Asking the library here as well would judge the same def twice
 * and print whichever answer came first; the honest arrangement is that the
 * step judges what only it knows, and the build door judges the build.
 */
function judgeViews(draft: MakeDraft): StepVerdict {
  const refusals: string[] = [];
  if (draft.views.length === 0) refusals.push('this dashboard has no charts yet — add one, and bind a column to it');
  const seen = new Set<string>();
  for (const view of draft.views) {
    const id = view.id.trim();
    if (id.length === 0) {
      refusals.push('a chart needs a name of its own — every act on it is recorded under that name');
      continue;
    }
    if (seen.has(id)) refusals.push(`two charts are both called "${id}" — a name is what the log calls an act, so it names one chart`);
    seen.add(id);
    for (const channel of MAKE_CHART_KINDS[view.chartKind].channels) {
      const field = view.bindings[channel];
      if (field === undefined || field.length === 0) {
        refusals.push(`"${id}" has nothing on its ${channel} channel — a ${view.chartKind} draws that channel, so it needs a column there`);
        continue;
      }
      const why = misfit(draft, view, channel, field);
      if (why !== null) refusals.push(why);
    }
  }
  return refusals.length === 0 ? { ok: true } : { ok: false, refusals };
}

/**
 * Judge one step. Every step judges before the next may begin, and a refusal is
 * a sentence naming the thing it is about.
 *
 * `desk` is the step a person is ON when the desk is open; there is nothing
 * after it to judge, so it always passes — the judging that mattered happened
 * on the way in (and the last of it is `openDesk`'s), and what happens on the
 * desk is the session's to judge.
 */
export function judgeStep(step: MakeStepId, draft: MakeDraft, reading: MakeReading | null): StepVerdict {
  if (step === 'data') return judgeData(draft, reading);
  if (step === 'columns') return judgeColumns(draft);
  if (step === 'views') return judgeViews(draft);
  return { ok: true };
}

/** The step after this one, or the same step when there is none. The wizard walks forwards; `judgeStep` decides whether it may. */
export const MAKE_STEPS: readonly MakeStepId[] = ['data', 'columns', 'views', 'desk'];

/** An empty draft — a wizard begins with a table name and nothing else. */
export function emptyDraft(): MakeDraft {
  return { table: MAKE_TABLE, csv: '', columns: [], absence: null, views: [], analysis: null, title: '', caption: '' };
}

/** A fresh view of a kind, named for the person and bound to nothing. */
export function newView(kind: MakeChartKind, index: number): MakeView {
  return { id: `${kind}${String(index)}`, label: '', chartKind: kind, bindings: {} };
}

/** The absence vocabulary as a person types it — a comma-separated list, trimmed, empties dropped. Never de-duplicated: repeating a state is the library's refusal to make, not this file's. */
export function parseStates(text: string): readonly string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** The absence declaration a field and a typed vocabulary make, or `null` when no column was named. */
export function absenceOf(field: string, states: string): MakeAbsence | null {
  return field.length === 0 ? null : { field, states: parseStates(states) };
}

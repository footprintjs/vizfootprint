/**
 * THE THREE STEPS A PERSON FILLS IN — bring data, check and describe, visualize.
 *
 * Drawing only. Every judgement these panels show was made in `steps.ts` and
 * every sentence they print came back from there or from the library; nothing
 * in this file decides whether anything is allowed. That separation is what
 * lets the suite hold the rules without a screen and hold the screen without
 * restating a rule.
 *
 * The fourth step has no panel here: it is a desk, and the desk is a whole
 * package of its own.
 */
import { useId, type ReactNode } from 'react';
import type { ColumnDescription, ColumnRole, ColumnScale, ColumnType } from 'vizfootprint/data';
import { BUILTIN_ANALYSES, type BuiltinAnalysisName, type ChartProposal } from 'vizfootprint/def';
import { T } from '../desk/tokens.js';
import { MAKE_CEILING_SENTENCE, MAKE_CHART_KINDS, MAKE_CHART_KIND_NAMES, ceilingVerdict, fitsForView, proposalsFor } from './steps.js';
import type { MakeChartKind, MakeColumn, MakeDraft, MakeReading, MakeView } from './types.js';

/** The type a person may DECLARE, over the sniff. `''` is "I have not said". */
const TYPES: readonly (ColumnType | '')[] = ['', 'string', 'number', 'boolean', 'date', 'unknown'];
/** The roles a person may declare. `absence` is not here: it is DERIVED from the vocabulary, never chosen. */
const ROLES: readonly (ColumnRole | '')[] = ['', 'identifier', 'dimension', 'measure'];
const SCALES: readonly (ColumnScale | '')[] = ['', 'discrete', 'continuous'];

/**
 * What each builtin analysis asks for, so the picker is one loop rather than one
 * branch per analysis.
 *
 * `null` means "not offered by THIS wizard", and the map is exhaustive over
 * `BuiltinAnalysisName` so a builtin added to the library has to be answered for
 * here rather than silently appearing in the picker with nothing to fill in.
 */
type AnalysisOption = { readonly key: string; readonly of: 'column' | 'number' | 'text'; readonly says: string };
const ANALYSIS_OPTIONS: Readonly<Record<BuiltinAnalysisName, readonly AnalysisOption[] | null>> = {
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
};

/** The analyses this wizard can honestly offer: the ones a one-table draft can fill in. */
const MAKE_ANALYSES: readonly BuiltinAnalysisName[] = BUILTIN_ANALYSES.filter((name) => ANALYSIS_OPTIONS[name] !== null);

const field: React.CSSProperties = { display: 'block', fontSize: T.textMd, marginBottom: T.gapSm };
const box: React.CSSProperties = { font: 'inherit', fontSize: T.textLg, padding: '4px 6px', border: `1px solid ${T.rule}`, borderRadius: T.radius, background: T.paper };
const card: React.CSSProperties = { border: `1px solid ${T.rule}`, borderRadius: T.radius, padding: T.pad, marginBottom: T.gap, background: T.paper };
const cell: React.CSSProperties = { padding: '4px 8px', borderBottom: `1px solid ${T.rule}`, textAlign: 'left', fontSize: T.textMd, verticalAlign: 'top' };
// `opacity` rather than a colour: the desk's seventeen tokens do not include a muted
// ink, and a wizard is not a reason to mint an eighteenth name for the whole package.
const note: React.CSSProperties = { fontSize: T.textMd, opacity: 0.72, margin: `${T.gapSm} 0` };

/**
 * A `<select>` over a list of strings, with `''` drawn as "not said".
 *
 * `name` exists because the visible label is often the SHORT word ("its role")
 * and the same short word appears once per column: the accessible name has to
 * say which one, and it is the accessible name a person using a screen reader —
 * and a test — actually hears.
 */
function Choice({ label, name, value, options, onChange, said }: { readonly label: string; readonly name?: string; readonly value: string; readonly options: readonly string[]; readonly onChange: (value: string) => void; readonly said: string }): ReactNode {
  const id = useId();
  return (
    <label htmlFor={id} style={field}>
      {label}{' '}
      <select id={id} aria-label={name ?? label} style={box} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o === '' ? said : o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A value as a person reads it in a sample: a date is its day, everything else is its text. */
function shown(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

/** The least and the greatest, when the column has them. */
function spanOf(column: ColumnDescription): string {
  if (column.extent === undefined) return '';
  return `${shown(column.extent[0])} … ${shown(column.extent[1])}`;
}

// ── step 1 ──────────────────────────────────────────────────────────────────

export interface DataStepProps {
  readonly draft: MakeDraft;
  readonly reading: MakeReading | null;
  readonly onCsv: (text: string) => void;
  readonly onRead: () => void;
}

/**
 * BRING DATA — and, before anything else, what this desk can carry.
 *
 * The ceiling is the first sentence on the page rather than a warning after a
 * large file has been read, because the only useful moment to hear it is before
 * choosing the file.
 */
export function DataStep({ draft, reading, onCsv, onRead }: DataStepProps): ReactNode {
  const pick = (files: FileList | null): void => {
    const file = files === null ? undefined : files[0];
    if (file === undefined) return;
    // `FileReader` rather than `file.text()`: the promise form is the nicer one
    // and is not everywhere this code has to run (jsdom, where the suite lives,
    // has a `File` without it). The same rule the payload codec keeps — use what
    // the SMALLEST runtime has, so the tested path is the shipped path.
    const reader = new FileReader();
    reader.addEventListener('load', () => onCsv(String(reader.result)));
    reader.readAsText(file);
  };
  return (
    <section data-vzf="make-step-data">
      <p style={{ ...note, opacity: 1 }} data-vzf="make-ceiling">
        {MAKE_CEILING_SENTENCE}
      </p>
      <label style={field}>
        Paste a CSV
        <textarea style={{ ...box, display: 'block', width: '100%', minHeight: 140, marginTop: T.gapSm }} value={draft.csv} onChange={(e) => onCsv(e.target.value)} aria-label="the CSV" />
      </label>
      <label style={field}>
        …or choose a file <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => pick(e.target.files)} />
      </label>
      <button type="button" style={{ ...box, cursor: 'pointer' }} onClick={onRead}>
        Read this table
      </button>
      {reading === null ? null : <Description reading={reading} />}
    </section>
  );
}

/** What arrived — every column the table has, in the words `describeTable` used. */
function Description({ reading }: { readonly reading: MakeReading }): ReactNode {
  const verdict = ceilingVerdict(reading.rows);
  return (
    <div style={card} data-vzf="make-description">
      <p style={{ ...note, color: verdict.level === 'fine' ? T.ok : T.stale }} data-vzf="make-ceiling-verdict">
        {verdict.sentence}
      </p>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>
            {['column', 'what it looks like', 'what it holds', 'how many different', 'least … greatest'].map((h) => (
              <th key={h} style={{ ...cell, opacity: 0.72 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reading.columns.map((c) => (
            <tr key={c.name}>
              <td style={cell}>{c.name}</td>
              <td style={cell}>{c.type}</td>
              <td style={cell}>{c.sample.map(shown).join(', ')}</td>
              <td style={cell}>
                {c.distinct}
                {c.distinctCapped ? ' or more — the count stops at the cap' : ''}
              </td>
              <td style={cell}>{spanOf(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── step 2 ──────────────────────────────────────────────────────────────────

export interface ColumnsStepProps {
  readonly draft: MakeDraft;
  /** What each column READ as — printed beside what the person declares, never replaced by it. */
  readonly sniffed: Readonly<Record<string, string>>;
  readonly absenceField: string;
  readonly absenceStates: string;
  readonly onColumn: (name: string, patch: Partial<MakeColumn>) => void;
  readonly onAbsence: (field: string, states: string) => void;
}

/**
 * CHECK AND DESCRIBE — the person declares, over the sniff.
 *
 * The sniffed type is printed beside the declared one rather than replaced by
 * it, because they are two different statements: what the data looks like, and
 * what somebody says it is.
 */
export function ColumnsStep({ draft, sniffed, absenceField, absenceStates, onColumn, onAbsence }: ColumnsStepProps): ReactNode {
  return (
    <section data-vzf="make-step-columns">
      <p style={note}>
        Say what each column IS. Nothing here is filled in for you: a role this wizard guessed at would be a guess the dashboard repeats in every sentence it writes, so a column with no role stops the next step.
      </p>
      <div style={card} data-vzf="make-absence">
        <p style={{ ...note, margin: 0 }}>
          If one column carries “there is no value here”, name it — its role is then DERIVED, not chosen, and the library will refuse to put it on an axis, because “unavailable” is not a low number.
        </p>
        <Choice label="the absence column" value={absenceField} options={['', ...draft.columns.map((c) => c.name)]} said="— none —" onChange={(v) => onAbsence(v, absenceStates)} />
        <label style={field}>
          the words it may say{' '}
          <input style={box} value={absenceStates} onChange={(e) => onAbsence(absenceField, e.target.value)} aria-label="the absence vocabulary" />
        </label>
      </div>
      {draft.columns.map((column) => (
        <div key={column.name} style={card}>
          <strong style={{ fontSize: T.textLg }}>{column.name}</strong>{' '}
          <span style={{ fontSize: T.textMd, opacity: 0.72 }}>reads as {sniffed[column.name]}</span>
          {absenceField === column.name ? (
            <p style={{ ...note, margin: `${T.gapSm} 0 0` }}>the absence column — its role is absence, derived from the vocabulary above</p>
          ) : (
            <div style={{ display: 'flex', gap: T.gap, flexWrap: 'wrap', marginTop: T.gapSm }}>
              <Choice label="is a" name={`${column.name} is a`} value={column.type ?? ''} options={TYPES} said="— as it reads —" onChange={(v) => onColumn(column.name, { type: v === '' ? undefined : (v as ColumnType) })} />
              <Choice label="its role" name={`the role of ${column.name}`} value={column.role ?? ''} options={ROLES} said="— not said —" onChange={(v) => onColumn(column.name, { role: v === '' ? undefined : (v as ColumnRole) })} />
              <Choice label="its scale" name={`the scale of ${column.name}`} value={column.scale ?? ''} options={SCALES} said="— from its type —" onChange={(v) => onColumn(column.name, { scale: v === '' ? undefined : (v as ColumnScale) })} />
              <label style={field}>
                called{' '}
                <input style={box} value={column.label ?? ''} onChange={(e) => onColumn(column.name, { label: e.target.value })} aria-label={`what to call ${column.name}`} />
              </label>
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// ── step 3 ──────────────────────────────────────────────────────────────────

export interface ViewsStepProps {
  readonly draft: MakeDraft;
  readonly analysisKind: string;
  readonly analysisOptions: Readonly<Record<string, string>>;
  readonly onView: (index: number, patch: Partial<MakeView>) => void;
  readonly onAdd: (kind: MakeChartKind) => void;
  readonly onRemove: (index: number) => void;
  readonly onAnalysis: (kind: string, options: Readonly<Record<string, string>>) => void;
  readonly onWords: (patch: { readonly title?: string; readonly caption?: string }) => void;
  /** A person took one of the offered charts. It becomes an ordinary chart in the draft — nothing else happens. */
  readonly onTake: (proposal: ChartProposal) => void;
}

/**
 * VISUALIZE — what this table can carry, offered first; then pick a kind, bind
 * its channels, and say what the dashboard is about.
 *
 * The offer is above the picker because a person who has just declared six
 * columns knows what they MEAN and not yet what they can draw, and the plane
 * knows the second. Nothing is chosen for them: taking one is a click, and the
 * picker underneath is untouched for anybody who wants something else.
 */
export function ViewsStep({ draft, analysisKind, analysisOptions, onView, onAdd, onRemove, onAnalysis, onWords, onTake }: ViewsStepProps): ReactNode {
  const names = draft.columns.map((c) => c.name);
  return (
    <section data-vzf="make-step-views">
      <Offers draft={draft} onTake={onTake} />

      <div style={card}>
        <label style={field}>
          What is this dashboard called?{' '}
          <input style={box} value={draft.title} onChange={(e) => onWords({ title: e.target.value })} aria-label="the dashboard's title" />
        </label>
        <label style={field}>
          And what does it show?{' '}
          <input style={{ ...box, width: '60%' }} value={draft.caption} onChange={(e) => onWords({ caption: e.target.value })} aria-label="the dashboard's summary" />
        </label>
        <p style={{ ...note, margin: 0 }}>Both are declared prose with you as their author — the desk shows them, and says so when a selection has left them behind.</p>
      </div>

      {draft.views.map((view, index) => (
        <ViewCard key={index} draft={draft} view={view} index={index} names={names} onView={onView} onRemove={onRemove} />
      ))}

      <div style={{ display: 'flex', gap: T.gapSm, flexWrap: 'wrap', marginBottom: T.gap }}>
        {MAKE_CHART_KIND_NAMES.map((kind) => (
          <button key={kind} type="button" style={{ ...box, cursor: 'pointer' }} onClick={() => onAdd(kind)}>
            ＋ a {kind} — {MAKE_CHART_KINDS[kind].says}
          </button>
        ))}
      </div>

      <div style={card} data-vzf="make-analysis">
        <Choice label="Run an analysis" value={analysisKind} options={['', ...MAKE_ANALYSES]} said="— none —" onChange={(v) => onAnalysis(v, analysisOptions)} />
        <p style={{ ...note, margin: 0 }}>
          These are the ones a definition can NAME over ONE table, because they are data. Anything else is a developer’s: an analysis with code in it is written in TypeScript and passed to the build, and no wizard can write one for you. The two that read a second table (a layout, and bringing a related table’s columns over) need a declared relation, and a wizard that brought one file has nothing to relate it to.
        </p>
        {(ANALYSIS_OPTIONS[analysisKind as BuiltinAnalysisName] ?? []).map((option) =>
          option.of === 'column' ? (
            <Choice key={option.key} label={option.says} value={analysisOptions[option.key] ?? ''} options={['', ...names]} said="— not said —" onChange={(v) => onAnalysis(analysisKind, { ...analysisOptions, [option.key]: v })} />
          ) : (
            <label key={option.key} style={field}>
              {option.says}{' '}
              <input
                style={option.of === 'text' ? { ...box, width: '60%', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' } : box}
                {...(option.of === 'number' ? { type: 'number' } : {})}
                value={analysisOptions[option.key] ?? ''}
                aria-label={option.says}
                onChange={(e) => onAnalysis(analysisKind, { ...analysisOptions, [option.key]: e.target.value })}
              />
            </label>
          ),
        )}
        {analysisKind === 'formula' ? (
          <p style={{ ...note, margin: 0 }} data-vzf="make-formula-columns">
            {names.length === 0 ? 'this table has no columns yet' : `Arithmetic (+ − × ÷), parentheses, and abs, log, max, min, round. The columns it may read: ${names.join(', ')}.`}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** `x = week · y = cases`, the bindings of a proposal as one line. */
function bindingLine(proposal: ChartProposal): string {
  return Object.entries(proposal.channels)
    .map(([channel, field]) => `${channel} = ${field}`)
    .join(' · ');
}

/**
 * THE OFFER — charts this table can carry, before a person is asked to build
 * one, each with the reason it is offered.
 *
 * Every sentence here came from the library: `proposeCharts` composes
 * `whatFits` with the encoding plane's ranking policy, so the reason a person
 * reads under an offer is the same reason the plane would give an agent. This
 * component decides nothing — not even which offers to show, which is
 * `proposalsFor`'s limit — and it selects nothing: the person still chooses.
 */
function Offers({ draft, onTake }: { readonly draft: MakeDraft; readonly onTake: (proposal: ChartProposal) => void }): ReactNode {
  const { proposals, notEnumerated } = proposalsFor(draft);
  return (
    <div style={card} data-vzf="make-proposals">
      <p style={{ ...note, margin: 0 }}>
        Charts these columns can carry, worked out from what you declared — best first, and nothing is chosen for you. Take one and it becomes an ordinary chart below, which you can then rename, rebind or remove.
      </p>
      {proposals.length === 0 ? (
        <p style={note} data-vzf="make-no-proposals">
          nothing this wizard can draw fits these columns yet — bind a chart yourself below, or go back and declare more.
        </p>
      ) : null}
      {proposals.map((proposal) => (
        <div key={`${proposal.chartKind}:${bindingLine(proposal)}`} style={{ ...card, marginBottom: T.gapSm }} data-vzf="make-proposal">
          <div style={{ display: 'flex', gap: T.gap, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: T.textLg }}>a {proposal.chartKind}</strong>
            <span style={{ fontSize: T.textMd }}>{bindingLine(proposal)}</span>
            <button type="button" style={{ ...box, cursor: 'pointer' }} aria-label={`take the ${proposal.chartKind} of ${bindingLine(proposal)}`} onClick={() => onTake(proposal)}>
              Take this {proposal.chartKind}
            </button>
          </div>
          <ul style={{ ...note, margin: `${T.gapSm} 0 0`, paddingLeft: 18 }}>
            {Object.entries(proposal.reasons).map(([channel, sentence]) => (
              <li key={channel}>{sentence}</li>
            ))}
          </ul>
        </div>
      ))}
      {notEnumerated.map((sentence) => (
        <p key={sentence} style={{ ...note, margin: `${T.gapSm} 0 0` }} data-vzf="make-not-enumerated">
          {sentence}
        </p>
      ))}
    </div>
  );
}

/** One chart being wired: its name, its kind, and a column on each of its channels — with the plane's verdict on every option. */
function ViewCard({ draft, view, index, names, onView, onRemove }: { readonly draft: MakeDraft; readonly view: MakeView; readonly index: number; readonly names: readonly string[]; readonly onView: ViewsStepProps['onView']; readonly onRemove: ViewsStepProps['onRemove'] }): ReactNode {
  const fits = fitsForView(draft, view);
  return (
    <div style={card} data-vzf="make-view">
      <div style={{ display: 'flex', gap: T.gap, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={field}>
          called{' '}
          <input style={box} value={view.id} onChange={(e) => onView(index, { id: e.target.value })} aria-label={`the name of chart ${String(index + 1)}`} />
        </label>
        <label style={field}>
          titled{' '}
          <input style={box} value={view.label} onChange={(e) => onView(index, { label: e.target.value })} aria-label={`the title of chart ${String(index + 1)}`} />
        </label>
        <Choice label="drawn as" name={`how chart ${String(index + 1)} is drawn`} value={view.chartKind} options={[...MAKE_CHART_KIND_NAMES]} said="" onChange={(v) => onView(index, { chartKind: v as MakeChartKind, bindings: {} })} />
        <button type="button" style={{ ...box, cursor: 'pointer', color: T.danger }} onClick={() => onRemove(index)}>
          remove
        </button>
      </div>
      {/* the ENTRIES the plane answered with, in the order it was asked — never a
          lookup by name, which would need a fallback that can never fire */}
      {Object.entries(fits).map(([channel, verdicts]) => (
        <div key={channel}>
          <label style={field}>
            on {channel}{' '}
            <select
              style={box}
              aria-label={`${channel} of ${view.id}`}
              value={view.bindings[channel] ?? ''}
              onChange={(e) => onView(index, { bindings: { ...view.bindings, [channel]: e.target.value } })}
            >
              <option value="">— nothing yet —</option>
              {names.map((name) => {
                const fit = verdicts.find((f) => f.field === name);
                const refused = fit !== undefined && !fit.ok;
                return (
                  <option key={name} value={name} disabled={refused} title={fit?.because ?? ''}>
                    {name}
                    {refused ? ' — refused' : ''}
                  </option>
                );
              })}
            </select>
          </label>
          <ul style={{ ...note, margin: `0 0 ${T.gap}`, paddingLeft: 18 }}>
            {verdicts
              .filter((f) => !f.ok)
              .map((f) => (
                <li key={f.field}>{f.because}</li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

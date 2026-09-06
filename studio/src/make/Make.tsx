/**
 * MAKE — four steps, and at the end a desk whose first commit is yours.
 *
 * The steps are Datawrapper's, and each of them is a door this library already
 * had: bring data (`describeTable`), check and describe (`ColumnDecl`),
 * visualize (`whatFits`), open and publish (`parseDashboardDef` →
 * `buildDashboard` → `Desk`). Nothing here is a new idea about dashboards; it
 * is the shortest path through the ones that exist.
 *
 * ## Authoring is BEFORE the walk
 *
 * `make` writes a definition. It never edits a dashboard that already has a
 * log, and that is not a limitation to be lifted later — it is what keeps the
 * trace meaning anything. A commit says what a person did to a dashboard; if
 * the dashboard could change underneath the log, the log would be a record of
 * acts on something that no longer exists. So the desk at step four is built
 * once, and "change the charts" goes BACK to step three and builds a new one,
 * discarding the acts on the old — out loud, in the menu item's own words.
 *
 * ## One program, two roles
 *
 * The file this wizard publishes is a copy of the page the wizard is running
 * in, with a payload block written into it (see `publish.ts`). So the same
 * bundle opens it — and finding a payload where it found none, it is the desk
 * rather than the wizard. That is the first thing this component checks, and it
 * is why `Make` is the only export a host needs to mount.
 */
import { useState, type ReactNode } from 'react';
import { readStoryPayloadText, encodeStoryPayload, formatBytes } from 'vizfootprint-ui/story/payload';
import type { CockpitMenuItem } from 'vizfootprint-ui';
import { Desk } from '../desk/Desk.js';
import { T, type DeskTokens } from '../desk/tokens.js';
import { useMadeCells } from './cells.js';
import { MadePage } from './MadePage.js';
import { openDesk, type MadeDesk } from './open.js';
import { ColumnsStep, DataStep, ViewsStep } from './panels.js';
import { MADE_FILENAME, downloadHtml, madePayload, publishRefusal, publishedHtml } from './publish.js';
import { MAKE_STEPS, absenceOf, analysisOf, assembleDef, declaredColumn, emptyDraft, judgeStep, newView, readTable, seedColumns, sniffedTypes } from './steps.js';
import type { MakeChartKind, MakeColumn, MakeDraft, MakeReading, MakeStepId, MakeView } from './types.js';

export interface MakeProps {
  /** Restyle the desk the wizard opens. See `../desk/tokens.ts`. */
  readonly tokens?: DeskTokens;
  readonly className?: string;
  /**
   * The id of the element this page mounts into.
   *
   * It is asked for because PUBLISHING empties it: the copy of this page must
   * not carry a snapshot of the wizard's own DOM, which the published page's
   * React would throw away on its first paint after a reader had already seen
   * it. Default `root`, which is what every entry in this family calls it.
   */
  readonly mountId?: string;
  /**
   * The most COMPRESSED bytes a published file may inline, when this host's
   * budget is smaller than the library's ten megabytes.
   *
   * The refusal then names the number that actually applies rather than one
   * nobody is holding to — a page meant to travel as an attachment has a
   * smaller budget than one dropped on a static host. See
   * `vizfootprint-ui/story/payload`.
   */
  readonly ceiling?: number;
}

/** What the four steps are called on screen. */
const STEP_NAMES: Readonly<Record<MakeStepId, string>> = {
  data: '1 · Bring data',
  columns: '2 · Check and describe',
  views: '3 · Visualize',
  desk: '4 · Open, and publish',
};

/**
 * The wizard — or, on a page that already carries a definition, the desk that
 * page was published as.
 */
export function Make(props: MakeProps): ReactNode {
  if (readStoryPayloadText(document) !== null) return <MadePage tokens={props.tokens} className={props.className} />;
  return <Wizard {...props} />;
}

function Wizard({ tokens, className, mountId = 'root', ceiling }: MakeProps): ReactNode {
  const [step, setStep] = useState<MakeStepId>('data');
  const [draft, setDraft] = useState<MakeDraft>(emptyDraft);
  const [reading, setReading] = useState<MakeReading | null>(null);
  const [refusals, setRefusals] = useState<readonly string[]>([]);
  const [made, setMade] = useState<MadeDesk | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The absence vocabulary as it is being TYPED — kept beside the draft because
  // "present, unavail" is a half-written word, not a state called "unavail".
  const [absenceField, setAbsenceField] = useState('');
  const [absenceStates, setAbsenceStates] = useState('present, unavailable, unknown');
  const [analysisKind, setAnalysisKind] = useState('');
  const [analysisOptions, setAnalysisOptions] = useState<Readonly<Record<string, string>>>({});

  // ── step 1 ──
  const setCsv = (csv: string): void => setDraft((d) => ({ ...d, csv }));
  const read = (): void => {
    const answer = readTable(draft.csv);
    if (!answer.ok) {
      setReading(null);
      setRefusals(answer.refusals);
      return;
    }
    setRefusals([]);
    setReading(answer.reading);
    // a fresh reading re-seeds the declarations: they were about another table
    setDraft((d) => ({ ...d, columns: seedColumns(answer.reading), absence: null, views: [] }));
    setAbsenceField('');
  };

  // ── step 2 ──
  const patchColumn = (name: string, patch: Partial<MakeColumn>): void =>
    setDraft((d) => ({ ...d, columns: d.columns.map((c) => (c.name === name ? declaredColumn({ ...c, ...patch }) : c)) }));
  const setAbsence = (field: string, states: string): void => {
    setAbsenceField(field);
    setAbsenceStates(states);
    setDraft((d) => ({ ...d, absence: absenceOf(field, states) }));
  };

  // ── step 3 ──
  const patchView = (index: number, patch: Partial<MakeView>): void => setDraft((d) => ({ ...d, views: d.views.map((v, i) => (i === index ? { ...v, ...patch } : v)) }));
  const addView = (kind: MakeChartKind): void => setDraft((d) => ({ ...d, views: [...d.views, newView(kind, d.views.length + 1)] }));
  const removeView = (index: number): void => setDraft((d) => ({ ...d, views: d.views.filter((_, i) => i !== index) }));
  const setAnalysis = (kind: string, options: Readonly<Record<string, string>>): void => {
    setAnalysisKind(kind);
    setAnalysisOptions(options);
    setDraft((d) => ({ ...d, analysis: analysisOf(kind, options) }));
  };
  const setWords = (patch: { readonly title?: string; readonly caption?: string }): void => setDraft((d) => ({ ...d, ...patch }));

  // ── the walk ──
  const forward = (): void => {
    const verdict = judgeStep(step, draft, reading);
    if (!verdict.ok) {
      setRefusals(verdict.refusals);
      return;
    }
    setRefusals([]);
    const next = MAKE_STEPS[MAKE_STEPS.indexOf(step) + 1]!;
    if (next !== 'desk') {
      setStep(next);
      return;
    }
    const opened = openDesk(assembleDef(draft));
    if (!opened.ok) {
      setRefusals(opened.refusals);
      return;
    }
    setMade(opened.desk);
    setStep('desk');
  };
  const back = (): void => {
    setRefusals([]);
    setStep(MAKE_STEPS[Math.max(0, MAKE_STEPS.indexOf(step) - 1)]!);
  };

  if (made !== null) {
    return (
      <DeskStep
        made={made}
        tokens={tokens}
        className={className}
        mountId={mountId}
        ceiling={ceiling}
        notice={notice}
        onNotice={setNotice}
        onRewrite={() => {
          made.view.dispose();
          setMade(null);
          setNotice(null);
          setStep('views');
        }}
      />
    );
  }

  return (
    <div className={['vzf', 'vzfs', 'vzfs-make', className].filter(Boolean).join(' ')} style={{ padding: 20, maxWidth: 900, margin: '0 auto' }} data-vzf="make">
      <ol style={{ display: 'flex', gap: T.gap, listStyle: 'none', padding: 0, margin: `0 0 ${T.gap}`, flexWrap: 'wrap', fontSize: T.textMd }} data-vzf="make-steps">
        {MAKE_STEPS.map((id) => (
          <li key={id} aria-current={id === step ? 'step' : undefined} style={{ fontWeight: id === step ? 650 : 400, opacity: id === step ? 1 : 0.6 }}>
            {STEP_NAMES[id]}
          </li>
        ))}
      </ol>

      {step === 'data' ? <DataStep draft={draft} reading={reading} onCsv={setCsv} onRead={read} /> : null}
      {step === 'columns' ? <ColumnsStep draft={draft} sniffed={sniffedTypes(reading)} absenceField={absenceField} absenceStates={absenceStates} onColumn={patchColumn} onAbsence={setAbsence} /> : null}
      {step === 'views' ? (
        <ViewsStep draft={draft} analysisKind={analysisKind} analysisOptions={analysisOptions} onView={patchView} onAdd={addView} onRemove={removeView} onAnalysis={setAnalysis} onWords={setWords} />
      ) : null}

      {refusals.length === 0 ? null : (
        <ul role="alert" data-vzf="make-refusals" style={{ color: T.danger, fontSize: T.textLg, lineHeight: T.lineHeight, paddingLeft: 20 }}>
          {refusals.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      <div style={{ display: 'flex', gap: T.gap, marginTop: T.gap }}>
        <button type="button" onClick={back} disabled={step === 'data'} style={buttonStyle}>
          ← Back
        </button>
        <button type="button" onClick={forward} style={buttonStyle}>
          {step === 'views' ? 'Open the desk →' : 'Next →'}
        </button>
      </div>
    </div>
  );
}

const buttonStyle = { font: 'inherit', fontSize: T.textLg, padding: '6px 14px', border: `1px solid ${T.rule}`, borderRadius: T.radius, background: T.paper, cursor: 'pointer' };

interface DeskStepProps {
  readonly made: MadeDesk;
  readonly tokens?: DeskTokens;
  readonly className?: string;
  readonly mountId: string;
  readonly ceiling?: number;
  readonly notice: string | null;
  readonly onNotice: (sentence: string | null) => void;
  readonly onRewrite: () => void;
}

/**
 * STEP FOUR — the desk, and the one act this wizard adds to it.
 *
 * The desk is `vizfootprint-studio/desk`, unchanged and unconfigured: this
 * definition has a session, so it has a time strip, an editor, notes, paths and
 * a commit log without anybody asking. What the wizard adds is two menu items —
 * publish, and go back and write it again.
 */
function DeskStep({ made, tokens, className, mountId, ceiling, notice, onNotice, onRewrite }: DeskStepProps): ReactNode {
  const publish = async (): Promise<void> => {
    const refusal = publishRefusal(document);
    if (refusal !== null) {
      onNotice(refusal);
      return;
    }
    const encoded = await encodeStoryPayload(
      madePayload({ def: made.def, session: made.session, rows: made.plan.rows.length, builtAt: new Date().toISOString().slice(0, 10) }),
      ceiling === undefined ? {} : { ceiling },
    );
    if (!encoded.ok) {
      onNotice(encoded.sentence);
      return;
    }
    downloadHtml(document, publishedHtml(document, encoded.text, mountId), MADE_FILENAME);
    onNotice(`published ${MADE_FILENAME} — ${formatBytes(encoded.sizes.inlined)} of payload in it, carrying ${String(made.session.commits('anywhere').length)} acts and this desk's whole definition`);
  };

  const own = (items: readonly CockpitMenuItem[]): readonly CockpitMenuItem[] => [
    { id: 'publish', label: 'Publish as one file', icon: '⇩', hint: 'a copy of this page with the log, the bookmarks, the pictures and the definition inside it — it opens with no server', onSelect: () => void publish() },
    {
      id: 'rewrite',
      label: 'Change the charts',
      icon: '✎',
      hint: 'authoring happens before the walk: this rebuilds the desk from step three, and the acts on this one are discarded',
      onSelect: onRewrite,
    },
    ...items,
  ];

  return <Desk view={made.view} charts={(projection) => useMadeCells(projection, made.plan)} tokens={tokens} className={className} notice={notice} menu={(_projection, items) => own(items)} />;
}

/**
 * THE SOURCES TAB — every declared table as the def states it, with what the
 * source vouched for and what the last refresh answered. Nothing here is
 * inferred from the rows: the def declared it, the carrier vouched for it, or
 * the journal recorded it — and a table with no source says so in words.
 *
 * Pure rendering over the state (`tables`, `sources`, `columns`, `journal`)
 * plus two doors the host owns: Refresh (a dashboard-level act, journaled)
 * and the data checks (`lintData()` sentences). A read-only cockpit disables
 * the door, never hides the facts.
 */
import { useEffect, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { ColumnView, RefreshOutcomeView, RefreshRecordView, SourceInfoView, TableView } from '../adapter/types.js';

export interface SourcesProps {
  /** Every declared table (`state.tables`). */
  readonly tables: readonly TableView[];
  /** Provenance per table that declared a source (`state.sources`). */
  readonly sources?: Readonly<Record<string, SourceInfoView>>;
  /** The engine's columns per table (`state.columns`) — shown as the columns-as-rows grid. */
  readonly columns?: Readonly<Record<string, readonly ColumnView[]>>;
  /** The data journal's latest records (`state.journal`), oldest first. */
  readonly journal?: readonly RefreshRecordView[];
  /** How many records the journal holds in all (`state.journalTotal`) — beyond the tail, an answer is "not in the latest N", never "never asked". */
  readonly journalTotal?: number;
  /** The data checks (`lintData()` sentences); undefined = not asked yet, [] = nothing to report. */
  readonly checks?: readonly string[];
  /** Why the checks could not be read, when the door refused — shown instead of "not asked yet". */
  readonly checksError?: string;
  /** Refresh the named tables (every table when none is named) — the host calls the dashboard's door. */
  readonly onRefresh?: (tables?: readonly string[]) => void;
  /** True while a refresh is in flight — the doors wait rather than queue a second one. */
  readonly refreshing?: boolean;
  /** Present mode: the facts stay, the doors close. */
  readonly readOnly?: boolean;
  readonly className?: string;
}

export function Sources({ tables, sources = {}, columns = {}, journal = [], journalTotal, checks, checksError, onRefresh, refreshing = false, readOnly = false, className }: SourcesProps): JSX.Element {
  const canRefresh = onRefresh !== undefined && !readOnly && !refreshing;
  const beyondTail = journalTotal !== undefined && journalTotal > journal.length;
  const latest = journal[journal.length - 1];
  // the status line speaks only about a refresh that ran while this panel was open — never an old answer at first paint
  const [announce, setAnnounce] = useState(false);
  useEffect(() => {
    if (refreshing) setAnnounce(true);
  }, [refreshing]);
  return (
    <div className={`vzf vzf-sources${className ? ' ' + className : ''}`} role="region" aria-label="data sources" data-vzf="sources">
      <div className="vzf-sources-head">
        <span className="vzf-sources-count">{tables.length === 0 ? 'no table declared' : `${tables.length} table${tables.length === 1 ? '' : 's'} declared`}</span>
        {onRefresh !== undefined && (
          <button type="button" className="vzf-sources-refresh" aria-disabled={!canRefresh} onClick={() => canRefresh && onRefresh()} title="Re-read every declared source with the version held — a dashboard-level act, written to the data journal">
            {refreshing ? 'refreshing…' : 'Refresh all'}
          </button>
        )}
      </div>
      {/* what the last refresh answered, for assistive tech — the answer lands in each table's row, outside any live region */}
      <span className="vzf-sr-only" role="status">{refreshing ? 'refreshing' : announce && latest !== undefined ? `refresh at ${latest.at}: ${Object.entries(latest.tables).map(([table, o]) => `${table} ${outcomeWord(o)}`).join(', ')}` : ''}</span>
      {tables.map((t) => (
        <TableRow key={t.name} table={t} source={sources[t.name]} columns={columns[t.name] ?? []} last={lastAnswer(journal, t.name)} beyondTail={beyondTail} tail={journal.length} canRefresh={canRefresh} onRefresh={onRefresh} refreshing={refreshing} />
      ))}
      <div className="vzf-sources-checks">
        <span className="vzf-sources-label" id="vzf-sources-checks-label">checks</span>
        {checksError !== undefined ? (
          <span className="vzf-sources-refused">the checks could not be read: {checksError}</span>
        ) : checks === undefined ? (
          <span className="vzf-soft">not asked yet</span>
        ) : checks.length === 0 ? (
          <span className="vzf-soft">the declarations agree with the data</span>
        ) : (
          <ul className="vzf-sources-check-list" aria-labelledby="vzf-sources-checks-label">
            {checks.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function TableRow({ table: t, source, columns, last, beyondTail, tail, canRefresh, onRefresh, refreshing }: { table: TableView; source: SourceInfoView | undefined; columns: readonly ColumnView[]; last: { at: string; outcome: RefreshOutcomeView } | null; beyondTail: boolean; tail: number; canRefresh: boolean; onRefresh: SourcesProps['onRefresh']; refreshing: boolean }): JSX.Element {
  return (
    <section className="vzf-sources-table" aria-label={`table ${t.name}`} data-table={t.name}>
      <div className="vzf-sources-title">
        <b>{t.name}</b>
        <span className="vzf-sources-badge" title="the engine this table routed to">{t.engine}</span>
        {onRefresh !== undefined && 'format' in t.source && (
          <button type="button" className="vzf-sources-refresh vzf-sources-refresh-one" aria-disabled={!canRefresh} onClick={() => canRefresh && onRefresh([t.name])} aria-label={`refresh ${t.name}`} title={`Re-read ${t.name} with the version held`}>
            {refreshing ? '…' : 'refresh'}
          </button>
        )}
      </div>
      <dl className="vzf-sources-facts">
        <dt>from</dt>
        <dd>{sourceWords(t.source)}</dd>
        <dt>vouched for</dt>
        <dd>{source !== undefined ? `${source.rows.toLocaleString()} rows · version ${source.version} · read ${source.retrievedAt}` : <span className="vzf-soft">carried by the definition — no version to move</span>}</dd>
        <dt>row key</dt>
        <dd>{t.key !== undefined ? <code>{t.key}</code> : <span className="vzf-soft">none — a refresh replaces the table; no row is addressable</span>}</dd>
        {t.grain !== undefined && (
          <>
            <dt>grain</dt>
            <dd>{grainWords(t.grain)}</dd>
          </>
        )}
        <dt>absence</dt>
        <dd>{t.absence !== undefined ? <><code>{t.absence.field}</code> speaks {t.absence.states.map((s, i) => <span key={s}>{i > 0 ? ' · ' : ''}<code>{s}</code></span>)}</> : <span className="vzf-soft">not declared — a row that exists is present by construction</span>}</dd>
        <dt>last refresh</dt>
        <dd>{last === null ? <span className="vzf-soft">{beyondTail ? `no answer in the latest ${tail} refreshes` : 'never asked'}</span> : <>{last.at} · {outcomeWords(last.outcome)}</>}</dd>
        <dt>columns</dt>
        <dd>
          <span className="vzf-soft">{t.declaredColumns} declared · {columns.length} listed by the engine</span>
          {columns.length > 0 && (
            <ul className="vzf-sources-columns">
              {columns.slice(0, COLUMNS_SHOWN).map((c) => (
                <li key={c.field}>
                  <code>{c.field}</code> <span className="vzf-soft">{c.type}</span>
                </li>
              ))}
              {columns.length > COLUMNS_SHOWN && <li className="vzf-soft">+{columns.length - COLUMNS_SHOWN} more</li>}
            </ul>
          )}
        </dd>
      </dl>
    </section>
  );
}

/** The latest journal answer for one table in the records given, or null — which the caller reads as "never asked" when the records are the whole journal, and "no answer in the latest N" when they are its tail. */
export function lastAnswer(journal: readonly RefreshRecordView[], table: string): { at: string; outcome: RefreshOutcomeView } | null {
  for (let i = journal.length - 1; i >= 0; i--) {
    const o = journal[i]!.tables[table];
    if (o !== undefined) return { at: journal[i]!.at, outcome: o };
  }
  return null;
}

/** How many engine columns a row lists before "+N more" (placeholder — a wide table is a scroll, not a wall). */
const COLUMNS_SHOWN = 40;

export function sourceWords(source: TableView['source']): string {
  if ('unstated' in source) return 'not stated — the wire carried no readable source for this table';
  if ('inline' in source) return source.inline === 'csv' ? 'CSV text carried by the definition' : `${source.rows ?? 0} inline rows carried by the definition`;
  return `${source.format} via ${source.via}${source.at !== undefined ? ` · ${source.at}` : ''}`;
}

export function grainWords(grain: NonNullable<TableView['grain']>): string {
  const parts = [grain.bucket !== undefined ? `per ${grain.bucket}` : null, grain.reducer !== undefined ? `${grain.reducer} over the bucket` : null, grain.collapsedFrom !== undefined ? `collapsed from ${grain.collapsedFrom}` : null, grain.note ?? null].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : 'stated, without detail';
}

/** One word per answer, for the status line. */
function outcomeWord(o: RefreshOutcomeView): string {
  return 'unchanged' in o ? 'unchanged' : 'refused' in o ? 'refused' : 'changed' in o ? 'changed' : 'unreadable';
}

/** One refresh answer as a sentence: what moved, what was lost, or why it was refused. */
export function outcomeWords(o: RefreshOutcomeView): ReactNode {
  if ('unreadable' in o) return <span className="vzf-sources-refused">an answer the wire could not carry</span>;
  if ('unchanged' in o) return `unchanged · version ${o.version}`;
  if ('refused' in o) return <span className="vzf-sources-refused">refused · {o.reason} — {o.message}</span>;
  const d = o.delta;
  const delta = d.keyed
    ? `by ${d.key}: added ${d.added} · updated ${d.updated} · removed ${d.removed}${d.unkeyed > 0 ? ` · ${d.unkeyed} rows without a usable key` : ''}`
    : d.keyAbsent !== undefined
      ? `replaced ${d.replaced.toLocaleString()} rows — the declared key ${d.keyAbsent} names no column in the new rows; no row is addressable`
      : `replaced ${d.replaced.toLocaleString()} rows — no row key, so no delta`;
  return (
    <>
      changed · {o.from} → {o.to} · {o.rows.toLocaleString()} rows · {delta}
      {o.materialisedLost !== undefined && o.materialisedLost.length > 0 ? <span className="vzf-sources-lost"> · lost with the old rows: {o.materialisedLost.join(', ')} — re-run the analysis</span> : null}
    </>
  );
}

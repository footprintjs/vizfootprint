/**
 * The SHEET page of the gallery — the read-only grid over a REAL in-process
 * session of 90,300 rows (the demo's own scale), wired the way a consumer
 * would: one `createSessionView` store for the state (tables, facets, cursor,
 * version) and `sessionSheetData` for the windows.
 *
 * It is a separate page from the cockpit gallery on purpose: 90k rows in the
 * same document would change every no-scroll assertion the cockpit's smoke
 * makes, and this page's whole job is the grid.
 *
 * The smoke reads two counters off the page: how many WINDOWS the sheet has
 * asked the engine for (the block cache's whole point — one per scroll stop),
 * and how many COMMITS the session holds (a row click must land exactly one).
 */
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sheet, Sources, Workbook, createSessionView, sessionSheetData, sessionSource, useSessionView } from '../src/index.js';
import type { SheetData, SessionView, SessionViewState } from '../src/index.js';
import { buildDashboard } from '../../src/agent/index.js';
import type { InteractionSession } from '../../src/agent/index.js';

const AREAS = ['Alabama', 'Alaska', 'Arizona', 'California', 'Colorado', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois'];
const DISEASES = ['Measles', 'Pertussis', 'Mumps', 'Giardiasis', 'Legionellosis', 'Shigellosis', 'Tularemia'];
const STATES = ['present', 'not-configured', 'unavailable', 'withheld', 'unknown'];

/** The demo's own row count by default; `?rows=` asks for another (400,000 puts the canvas past its cap). */
function askedRows(): number {
  const asked = Number(new URLSearchParams(window.location.search).get('rows'));
  return Number.isInteger(asked) && asked > 0 ? asked : 90_300;
}

/** Deterministic rows — generated, never fetched. */
function sheetRows(count: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const state = STATES[i % 17 === 0 ? 1 + (i % 4) : 0]!;
    rows.push({
      id: `c${String(i)}`,
      jurisdiction: AREAS[i % AREAS.length]!,
      disease: DISEASES[i % DISEASES.length]!,
      week: (i % 52) + 1,
      cases: state === 'present' ? (i * 7) % 400 : null,
      report_state: state,
    });
  }
  return rows;
}

function buildSheetSession(count: number): InteractionSession {
  const rows = sheetRows(count);
  const dashboard = buildDashboard({
    meta: { title: 'vizfootprint-ui sheet gallery' },
    data: {
      cells: {
        // declared as an inline SOURCE, so the table carries a version the sheet's blocks are keyed by
        source: { format: 'rows', via: 'inline', at: rows },
        key: 'id',
        absence: { field: 'report_state', states: STATES },
        columns: {
          id: { role: 'identifier' },
          jurisdiction: { role: 'dimension' },
          disease: { role: 'dimension' },
          week: { role: 'dimension', scale: 'continuous' },
          cases: { role: 'measure' },
        },
      },
    },
    actors: { sheet: { actor: 'user', label: 'Sheet', does: 'pick a row: one cell of the weekly table' } },
    grains: [{ viewId: 'sheet', keys: [] }],
    defaultTable: 'cells',
  });
  return dashboard.createSession({ as: 'user' });
}

declare global {
  interface Window {
    /** How many windows the sheet has asked the engine for — one per scroll stop is the law. */
    __sheetWindows: number;
    /** How many commits the session holds — a row click lands exactly one. */
    __sheetCommits: () => number;
  }
}

function App({ view, data }: { readonly view: SessionView; readonly data: SheetData }): JSX.Element {
  const state: SessionViewState = useSessionView(view);
  const [height, setHeight] = useState(() => window.innerHeight - 120);
  useEffect(() => {
    const onResize = (): void => setHeight(window.innerHeight - 120);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // the sheet is mounted once the state KNOWS the table's version — a sheet mounted
  // before it would ask once for the unknown version and again when it arrives
  const version = state.sources?.['cells']?.version;
  // the sheet's OWN live clause, as a row id — so the row a person picked stays marked
  const picked = state.selections.find((sel) => sel.viewId === 'sheet');
  const selectedRowId = picked !== undefined && (typeof picked.value === 'string' || typeof picked.value === 'number') ? String(picked.value) : undefined;
  return (
    <div className="vzf" style={{ padding: 16, height: '100%', boxSizing: 'border-box' }}>
      <Workbook
        initialTab="sheet"
        sources={<Sources tables={state.tables ?? []} sources={state.sources} columns={state.columns} journal={state.journal} journalTotal={state.journalTotal} />}
        sheet={
          version === undefined ? (
            <p>reading the session…</p>
          ) : (
            <Sheet
              data={data}
              viewId="sheet"
              table="cells"
              height={height}
              version={version}
              cursor={state.cursor}
              {...(selectedRowId !== undefined ? { selectedRowId } : {})}
              onSelect={(field, value) => void view.emit('sheet', { rawValue: value, encoding: { kind: 'point', field } }, 'pick a row')}
            />
          )
        }
      />
    </div>
  );
}

function Page(): JSX.Element {
  const { view, data } = useMemo(() => {
    const session = buildSheetSession(askedRows());
    window.__sheetWindows = 0;
    window.__sheetCommits = () => session.log.records.length;
    const base = sessionSheetData(session, { table: 'cells' });
    // the counting wrapper is the page's, not the port's: the smoke reads it, the library never does
    const counted: SheetData = {
      capabilities: base.capabilities,
      columns: () => base.columns(),
      rows: (window_, opts) => {
        window.__sheetWindows += 1;
        return base.rows(window_, opts);
      },
    };
    return { view: createSessionView(sessionSource(session), { as: 'user' }), data: counted };
  }, []);
  return <App view={view} data={data} />;
}

createRoot(document.getElementById('root')!).render(<Page />);

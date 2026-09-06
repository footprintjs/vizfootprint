/**
 * THE DATA TAB — where the rows came from, and the rows themselves, in one
 * workbook.
 *
 * The split here is the desk's law in miniature. The COLUMNS are derived from
 * `state.columns[table]` — the session holds them, so the desk projects them and
 * the host is never asked to restate a schema the session already knows. The
 * DATA PORT is the host's, because only the host knows where its rows come from:
 * a window endpoint, an in-process session, a file.
 *
 * The adapter is memoized on the SCHEMA's facts, never on the poll's object
 * identity: a new adapter every second would be a new question every second.
 */
import { useMemo, useRef, type ReactNode } from 'react';
import { Sheet, Sources, Workbook, type SessionView, type SessionViewState, type SheetColumn } from 'vizfootprint-ui';
import { T } from '../tokens.js';
import type { DeskData } from '../types.js';

export function DataPanel(props: {
  readonly data: DeskData;
  readonly state: SessionViewState;
  readonly view: SessionView;
  readonly readOnly: boolean;
}): ReactNode {
  const { data, state, view, readOnly } = props;
  const { table } = data;

  // the factory rides a ref so the memo below can key on the SCHEMA alone — a
  // prop identity that changes every render must not re-ask the port
  const build = useRef(data.sheet);
  build.current = data.sheet;

  const schemaKey = JSON.stringify(state.columns[table] ?? []);
  const columns = useMemo<readonly SheetColumn[]>(
    () =>
      (JSON.parse(schemaKey) as { field: string; type: string; role?: string }[]).map((c) => ({
        name: c.field,
        type: c.type as SheetColumn['type'],
        // the role the def declared rides to the header's badge; the KEY comes from the window itself
        ...(c.role !== undefined ? { role: c.role as NonNullable<SheetColumn['role']> } : {}),
      })),
    [schemaKey],
  );
  const sheetData = useMemo(() => build.current(columns), [columns]);

  // the table's version at the cursor: the sheet's blocks are keyed by it, so a refresh empties them
  const version = state.sources?.[table]?.version;
  // the sheet's OWN live clause, as a row id — so the row a person picked stays marked
  const clause = state.selections.find((sel) => sel.viewId === 'sheet');
  const selectedRowId = typeof clause?.value === 'string' || typeof clause?.value === 'number' ? String(clause.value) : undefined;
  const height = Math.max(280, Math.min(520, Math.round(window.innerHeight * 0.82) - 190));
  // a row click is a POINT on the declared key column, with the field it landed on in its own words
  const pick = (field: string, value: unknown): void => void view.emit('sheet', { rawValue: value, encoding: { kind: 'point', field } }, `pick ${field}`);

  return (
    <Workbook
      sources={
        <Sources
          tables={state.tables ?? []}
          sources={state.sources}
          columns={state.columns}
          journal={state.journal}
          journalTotal={state.journalTotal}
          checks={data.checks}
          checksError={data.checksError}
          onRefresh={data.onRefresh}
          refreshing={data.refreshing}
          readOnly={readOnly}
        />
      }
      sheet={
        version === undefined ? (
          <p style={{ fontSize: T.textLg, opacity: 0.8 }}>reading the session…</p>
        ) : (
          <Sheet
            data={sheetData}
            viewId="sheet"
            table={table}
            height={height}
            version={version}
            cursor={state.cursor}
            {...(selectedRowId !== undefined ? { selectedRowId } : {})}
            readOnly={readOnly}
            onSelect={pick}
          />
        )
      }
    />
  );
}

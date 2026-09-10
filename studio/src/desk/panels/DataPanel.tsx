/**
 * THE DATA TAB — where the rows came from, the rows themselves, the tables an
 * act cut from them, and the two things a person may write into any of it.
 *
 * The split here is the desk's law in miniature. The COLUMNS are derived from
 * `state.columns[table]` — the session holds them, so the desk projects them and
 * the host is never asked to restate a schema the session already knows. The
 * DATA PORT is the host's, because only the host knows where its rows come from:
 * a window endpoint, an in-process session, a file. Which tables are HERE is the
 * session's too: the Sources rows carry every table visible at the cursor, so a
 * table an act cut appears and disappears with the cursor and this file keeps no
 * list of its own.
 *
 * The adapter is memoized on the SCHEMA's facts, never on the poll's object
 * identity: a new adapter every second would be a new question every second.
 *
 * The two WRITES on this tab sit above the workbook and not inside the grid,
 * which is the whole of their design: adding a column and cutting a table are
 * ACTS (each lands a commit with a cause, and what it makes belongs to that
 * commit), while editing a cell would be an edit, and the Sheet stays as
 * read-only as it ever was. The desk decides nothing about either — the columns
 * they may read are projected off the session's schema, and the sentence a
 * refusal shows is the session's own.
 */
import { useMemo, useRef, type ReactNode } from 'react';
import { AddAggregate, AddColumn, ExportRows, Sheet, Sources, Workbook, arrangeColumns, sheetFrozenOf, sheetHiddenOf, sheetOrderOf, sheetSortOf, type AddColumnOutcome, type AggregatePick, type SessionView, type SessionViewState, type SheetArrangementProp, type SheetArrangementValues, type SheetColumn, type SheetData } from 'vizfootprint-ui';
import type { SortSpec } from 'vizfootprint/data';
import { T } from '../tokens.js';
import type { DeskData } from '../types.js';

/** One table's rows, ready to draw: the schema the desk projected and the port the host built over it. */
interface TablePort {
  readonly table: string;
  readonly columns: readonly SheetColumn[];
  readonly data: SheetData;
}

/** One column facet as the state serializes it — what the schema key carries and what a port is built from. */
interface Facet {
  readonly field: string;
  readonly type: string;
  readonly role?: string;
}

function sheetColumnsOf(facets: readonly Facet[]): readonly SheetColumn[] {
  return facets.map((c) => ({
    name: c.field,
    type: c.type as SheetColumn['type'],
    // the role the def declared rides to the header's badge; the KEY comes from the window itself
    ...(c.role !== undefined ? { role: c.role as NonNullable<SheetColumn['role']> } : {}),
  }));
}

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

  // the tables an act cut and the cursor can see, projected off the Sources
  // rows — never a list kept here, which would go stale the moment a seek moved
  const cut = (state.tables ?? []).filter((row) => row.derived !== undefined).map((row) => row.name);
  const schemaKey = JSON.stringify([table, ...cut].map((name) => [name, state.columns[name] ?? []]));
  const ports = useMemo<readonly TablePort[]>(
    () =>
      (JSON.parse(schemaKey) as [string, Facet[]][]).map(([name, facets]) => {
        const columns = sheetColumnsOf(facets);
        return { table: name, columns, data: build.current(columns, name) };
      }),
    [schemaKey],
  );
  const here = ports[0]!; // the table this tab is about; the rest are the ones acts cut from it
  // what a formula may READ, and what a group or a fold may: the columns this
  // table has at the cursor. Projected, never restated — a list written here
  // would go stale the moment a refresh changed the schema.
  const numbers = useMemo(() => here.columns.filter((c) => c.type === 'number').map((c) => c.name), [here]);
  const everyColumn = useMemo(() => here.columns.map((c) => c.name), [here]);
  const addColumn = (name: string, expression: string): Promise<AddColumnOutcome> => view.addColumn(name, expression, { table });
  const addAggregate = (name: string, pick: AggregatePick): Promise<AddColumnOutcome> => view.addAggregate(name, pick, { table });
  // ARRANGING the grid is an ACT, not a view preference: every prop lands under the
  // sheet's own layout identity, so a reload and a seek both bring the arrangement
  // back. Read ONCE here and spent below, so the grid and the export beside it can
  // never be looking at two different projections.
  const sortBy = (next: readonly SortSpec[] | undefined): void => void view.setSheetSort('sheet', next);
  const arrangeBy = <P extends SheetArrangementProp>(prop: P, value: SheetArrangementValues[P]): void => void view.setSheetArrangement('sheet', prop, value);
  const sort = sheetSortOf(state.layouts, 'sheet');
  const hidden = sheetHiddenOf(state.layouts, 'sheet');
  const columnOrder = sheetOrderOf(state.layouts, 'sheet');
  const frozen = sheetFrozenOf(state.layouts, 'sheet');
  // THE VISIBLE PROJECTION the export walks — the same columns, in the same order,
  // the grid is showing. The KEY rides here too, off `state.tables[...].key` — the
  // DECLARED key (a fact about the def, not the fold), the same value the window's
  // own `key` resolves to once it has loaded. A window-only key would leave this
  // door blind before the grid's first fetch, and — worse — let a foreign or stale
  // `hidden` naming the key silently drop the row's identity column from the file
  // while the grid keeps refusing to hide it (R3): the declared key is knowable
  // synchronously, so there is no reason to accept that gap.
  const keyField = state.tables?.find((t) => t.name === table)?.key;
  const visible = arrangeColumns(everyColumn, keyField, { order: columnOrder, hidden }).columns;

  // the table's version at the cursor: the sheet's blocks are keyed by it, so a refresh empties them
  const version = state.sources?.[table]?.version;
  // the sheet's OWN live clause, as a row id — so the row a person picked stays marked
  const clause = state.selections.find((sel) => sel.viewId === 'sheet');
  const selectedRowId = typeof clause?.value === 'string' || typeof clause?.value === 'number' ? String(clause.value) : undefined;
  // the drawer's height, less the chrome above the grid — the tab's own header,
  // the workbook's tabs, and the two act strips that now sit over both
  const height = Math.max(280, Math.min(520, Math.round(window.innerHeight * 0.82) - 340));
  // a row click is a POINT on the declared key column, with the field it landed on in its own words
  const pick = (field: string, value: unknown): void => void view.emit('sheet', { rawValue: value, encoding: { kind: 'point', field } }, `pick ${field}`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: T.gap, minHeight: 0 }} data-vzf="desk-data">
      <AddColumn columns={numbers} onAdd={addColumn} readOnly={readOnly} />
      <AddAggregate columns={everyColumn} onAdd={addAggregate} readOnly={readOnly} />
      {/*
        The third strip is NOT an act. Taking the rows away lands no commit, so it
        gets no `readOnly`: Present mode is reading, and a copy is a read. It reads
        the same port, view and order the grid below is showing, so the file is the
        rows a person is actually looking at — and the receipt beside it names the
        cursor they were read at.
      */}
      <ExportRows data={here.data} table={table} viewId="sheet" columns={visible} sort={sort} />
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
              data={here.data}
              viewId="sheet"
              table={table}
              height={height}
              version={version}
              cursor={state.cursor}
              {...(selectedRowId !== undefined ? { selectedRowId } : {})}
              readOnly={readOnly}
              onSelect={pick}
              // the ARRANGEMENT is the TRACE's: read at the cursor, landed as an act
              sort={sort}
              onSort={sortBy}
              hidden={hidden}
              order={columnOrder}
              frozen={frozen}
              onArrange={arrangeBy}
            />
          )
        }
        sheets={ports.slice(1).map((port) => ({
          table: port.table,
          panel: (
            <Sheet
              data={port.data}
              table={port.table}
              height={height}
              // NOTHING versions a table an act cut: no carrier vouched for these
              // rows, so the session answers `null` and the host says the same.
              // The CURSOR is the stamp that moves — the act is at a commit, and
              // seeking past it takes the table with it.
              version={null}
              cursor={state.cursor}
              readOnly={readOnly}
            />
          ),
        }))}
      />
    </div>
  );
}

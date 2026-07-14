/**
 * `<VizTable>` — a sortable HTML table over the crossfiltered rows, row click
 * → point selection by the table's id field. Controlled like its siblings.
 *
 * SELECTION SEMANTICS (design call): DIM, never hide. `selection` is the SAME
 * clause-addressable crossfilter fold {@link VizScatter} takes (RP-1 — it
 * replaced the old flat keep-predicate): a row failing the non-self clauses
 * gets `.vzf-dim`, not removed — the two row-level (non-aggregated) charts
 * in this library share the rule. VizBar/VizMap instead RECOMPUTE their data
 * (a count per category/region) under a crossfilter; a table has no
 * aggregate to recompute, it has actual rows, so it follows VizScatter's
 * precedent, not theirs. Hiding would also make sorted row POSITIONS jump as
 * an unrelated view's selection changes — surprising for a component whose
 * whole point is a stable, scannable order. Dimming keeps every row
 * addressable (a dimmed row is still clickable, still sortable) while making
 * "what's currently included" visually honest. The table's OWN point
 * selection (row outline) also derives from the same fold when `selected`
 * is not explicitly given.
 *
 * Row click emits the R3 point shape `{ rawValue: id, encoding: { kind:
 * 'point', field: idField } }` on the id field; clicking the selected row
 * again clears it (`rawValue: undefined`) — exactly {@link VizBar} /
 * {@link VizMap}'s click-again-clears gesture.
 *
 * Column headers cycle a per-column sort: none -> ascending -> descending ->
 * none; clicking a DIFFERENT column starts fresh at ascending. `aria-sort`
 * reflects the live state so assistive tech reads it as a real sortable
 * table, not just styled markup. Numeric cells render with the shared
 * `.vzf-mono` token (monospace + tabular-nums) so digits align in a column.
 *
 * The consumer supplies which fields to show (`columns`) — the chart never
 * guesses a "sane" column count; that restraint lives at the call site,
 * where the actual data shape is known.
 */
import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ChartEmission } from '../../../src/mosaic/index.js';
import type { RenderSelection } from '../contract/types.js';
import { keepPredicate, selfSelectedValue } from '../contract/selection.js';

/** One row of table data — arbitrary fields, keyed by column name. */
export interface TableRow {
  readonly [field: string]: unknown;
}

export type SortDirection = 'asc' | 'desc';

export interface TableSortState {
  readonly field: string;
  readonly dir: SortDirection;
}

export interface VizTableProps {
  readonly viewId?: string;
  /** ALL rows (already crossfiltered by the consumer is NOT required — dim, never hide; see file header). */
  readonly data: readonly TableRow[];
  /** Which fields to render, in order. Kept sane by the consumer — the chart never guesses a "reasonable" count. */
  readonly columns: readonly string[];
  /** The field a row click selects by. Default `'id'`. */
  readonly idField?: string;
  /** Optional column header override (field -> display label). Defaults to the field name. */
  readonly labels?: Readonly<Record<string, string>>;
  /** The selected row's id (controlled). Omit it and the outline derives from `selection`'s own point clause. */
  readonly selected?: string | null;
  /**
   * The clause-addressable crossfilter selection (RP-1) — rows failing the
   * non-self clauses are DIMMED, never removed (the VizScatter pattern; see
   * file header). Build it with `selectionForView(state.selections, viewId)`.
   */
  readonly selection?: RenderSelection;
  readonly onEmit?: (emission: ChartEmission) => void;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}

/** A cell value as its sort string — nullish sorts as `''` (first), everything else stringifies. */
function sortKeyOf(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** Two numbers compare numerically; everything else (including booleans — "false" < "true" holds under locale compare too) falls back to a locale string compare. */
function compareCell(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return sortKeyOf(a).localeCompare(sortKeyOf(b));
}

function sortRows(data: readonly TableRow[], sort: TableSortState | null): readonly TableRow[] {
  if (!sort) return data;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...data].sort((a, b) => dir * compareCell(a[sort.field], b[sort.field]));
}

/** A cell's display text — nullish reads as an honest em-dash, never a blank that could be misread as an empty string. */
function formatCell(value: unknown): string {
  return value === null || value === undefined ? '—' : String(value);
}

export function VizTable(props: VizTableProps): JSX.Element {
  const {
    viewId = 'table',
    data,
    columns,
    idField = 'id',
    labels,
    selection,
    onEmit,
    width = 520,
    height = 340,
  } = props;

  // explicit `selected` wins; otherwise the outline derives from the fold's own point clause
  const selected = props.selected !== undefined ? props.selected : selection ? selfSelectedValue(selection) : null;
  const keep = useMemo(() => (selection ? keepPredicate(selection) : null), [selection]);

  const [sort, setSort] = useState<TableSortState | null>(null);
  const sorted = useMemo(() => sortRows(data, sort), [data, sort]);
  const visibleCount = keep ? data.filter(keep).length : data.length;

  const cycleSort = (field: string): void => {
    setSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' };
      if (prev.dir === 'asc') return { field, dir: 'desc' };
      return null;
    });
  };
  const onHeaderKey = (e: KeyboardEvent<HTMLTableCellElement>, field: string): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      cycleSort(field);
    }
  };

  const emit = (id: string): void => {
    const emission: ChartEmission =
      selected === id
        ? { rawValue: undefined, encoding: { kind: 'point', field: idField } }
        : { rawValue: id, encoding: { kind: 'point', field: idField } };
    onEmit?.(emission);
  };
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, id: string): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      emit(id);
    }
  };

  const ariaSortFor = (field: string): 'ascending' | 'descending' | 'none' => {
    if (!sort || sort.field !== field) return 'none';
    return sort.dir === 'asc' ? 'ascending' : 'descending';
  };

  return (
    <div
      className={`vzf-chart vzf-table-frame${props.className ? ' ' + props.className : ''}`}
      style={{ width, height }}
      data-vzf-chart="table"
    >
      {data.length === 0 ? (
        <div className="vzf-empty" role="status">
          no rows to show
        </div>
      ) : (
        <>
          {keep && (
            <div className="vzf-table-status vzf-muted" role="status">
              {visibleCount} of {data.length} rows match the current selection
            </div>
          )}
          <div className="vzf-table-scroll" style={{ maxHeight: height }}>
            <table
              className="vzf-table"
              aria-label={`view ${viewId}: sortable rows — click a header to sort, click a row to select`}
            >
              <thead>
                <tr>
                  {columns.map((field) => (
                    <th
                      key={field}
                      scope="col"
                      tabIndex={0}
                      aria-sort={ariaSortFor(field)}
                      aria-label={`sort by ${labels?.[field] ?? field}`}
                      onClick={() => cycleSort(field)}
                      onKeyDown={(e) => onHeaderKey(e, field)}
                    >
                      {labels?.[field] ?? field}
                      {sort?.field === field && (
                        <span className="vzf-sort-arrow" aria-hidden="true">
                          {sort.dir === 'asc' ? ' ▲' : ' ▼'}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => {
                  const id = String(row[idField]);
                  const isSelected = selected === id;
                  const isKept = keep ? keep(row) : true;
                  return (
                    <tr
                      key={id}
                      className={`vzf-table-row${isSelected ? ' vzf-selected' : ''}${isKept ? '' : ' vzf-dim'}`}
                      tabIndex={0}
                      aria-selected={isSelected}
                      aria-label={`row ${id}${isSelected ? ' selected' : ''}`}
                      onClick={() => emit(id)}
                      onKeyDown={(e) => onRowKey(e, id)}
                    >
                      {columns.map((field) => {
                        const value = row[field];
                        return (
                          <td key={field} className={typeof value === 'number' ? 'vzf-mono' : undefined}>
                            {formatCell(value)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

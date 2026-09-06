/**
 * THE FIGURE — the desk's cells, pinned, at the size a story column gives them.
 *
 * This is the SAME cell list the cockpit band mounts, bound to the same session,
 * so a beat moves these. That is the whole point of it living here rather than
 * in a host: a story whose figure was a second set of charts would be a story
 * about a dashboard nobody was looking at.
 *
 * A named cell this desk does not have is REFUSED IN A SENTENCE and the rest are
 * drawn. Not silently dropped: a figure that quietly showed three charts where a
 * story asked for four is a figure that has lied about what it is.
 */
import type { ReactNode } from 'react';
import { ChartFrame, useSessionView, type SessionView } from 'vizfootprint-ui';
import { useDeskProjection } from './projection.js';
import { deskTokenStyle, T, type DeskTokens } from './tokens.js';
import type { DeskChart, DeskCharts } from './types.js';

/** What a figure could draw, and what it was asked for and could not. */
export interface FigurePick {
  readonly cells: readonly DeskChart[];
  readonly missing: readonly string[];
}

/**
 * The cells a figure draws, in the order it named them. `show` omitted = every
 * cell the desk has, in the desk's own order.
 */
export function pickFigureCells(charts: readonly DeskChart[], show?: readonly string[]): FigurePick {
  if (show === undefined) return { cells: charts, missing: [] };
  const byId = new Map(charts.map((c) => [c.id, c]));
  const cells: DeskChart[] = [];
  const missing: string[] = [];
  for (const id of show) {
    const cell = byId.get(id);
    if (cell === undefined) missing.push(id);
    else cells.push(cell);
  }
  return { cells, missing };
}

/** The sentence a figure owes a reader when it was asked for a cell this desk has not got. */
export function figureRefusal(missing: readonly string[]): string | null {
  if (missing.length === 0) return null;
  const named = missing.map((id) => `"${id}"`).join(', ');
  return missing.length === 1
    ? `this figure names ${named}, which is not a cell on this desk — the rest are drawn`
    : `this figure names ${named}, which are not cells on this desk — the rest are drawn`;
}

export interface FigureGridProps extends FigurePick {
  /** How many across. Default 2 — a story column is half a screen wide. */
  readonly columns?: number;
  /** How tall each cell is drawn. Default 190. */
  readonly cellHeight?: number;
}

/**
 * The grid itself, over cells already picked — shared by {@link DeskFigure} and
 * the desk's own Story tab, so the pinned figure a reader scrolls and the one a
 * page carries are the same drawing.
 */
export function FigureGrid({ cells, missing, columns = 2, cellHeight = 190 }: FigureGridProps): ReactNode {
  const refusal = figureRefusal(missing);
  return (
    <>
      {refusal === null ? null : (
        <p role="note" style={{ margin: 0, padding: '6px 8px 0', fontSize: T.textSm, color: T.danger }}>
          {refusal}
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${String(columns)}, 1fr)`, gap: T.gap, padding: T.gap }}>
        {cells.map((cell) => (
          // `display: flex` because `.vzf-chart-frame` is `flex: 1` — a block
          // parent gives it a zero height, ChartFrame measures nothing, and the
          // cell draws nothing at all
          <div key={cell.id} style={{ height: cellHeight, minWidth: 0, display: 'flex' }}>
            <ChartFrame>{cell.render}</ChartFrame>
          </div>
        ))}
      </div>
    </>
  );
}

export interface DeskFigureProps {
  /** The same session the cockpit is bound to. The figure never creates one. */
  readonly view: SessionView;
  readonly charts: DeskCharts;
  /** Which cells, in order. Omitted = all of them. */
  readonly show?: readonly string[];
  /** How many across. Default 2 — a story column is half a screen wide. */
  readonly columns?: number;
  /** How tall each cell is drawn. Default 190. */
  readonly cellHeight?: number;
  readonly tokens?: DeskTokens;
  readonly className?: string;
}

/** A pinned figure has no drawer and no editor, so a cell that asks for one gets nothing — quietly, because there is nothing here that could honour it. */
const nowhere = (): void => undefined;

export function DeskFigure(props: DeskFigureProps): ReactNode {
  const { view, charts, show, columns, cellHeight, tokens, className } = props;
  const state = useSessionView(view);
  // A figure is pinned: it draws what the session holds and authors nothing, so
  // the two chrome acts a cell could ask for have nowhere to go here.
  const { desk } = useDeskProjection({ view, state, readOnly: true, acts: { openAside: nowhere, editChart: nowhere } });
  const picked = pickFigureCells(charts(desk), show);

  return (
    <div className={['vzfs', 'vzfs-figure', className].filter(Boolean).join(' ')} style={deskTokenStyle(tokens)}>
      <FigureGrid {...picked} {...(columns !== undefined ? { columns } : {})} {...(cellHeight !== undefined ? { cellHeight } : {})} />
    </div>
  );
}

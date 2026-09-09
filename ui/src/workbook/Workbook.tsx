/**
 * THE WORKBOOK — the data layer's tabs over one session: **Sources** (where the
 * rows come from and what the carrier vouched for), the **Sheet** (the rows
 * themselves), and one more sheet for every table an ACT cut, each under its
 * own name. Excel's shape, because it is the shape every analyst arrives with;
 * one table's case is simply two tabs.
 *
 * It owns nothing but the chosen tab. The panels are handed in by the host, so
 * the Workbook never learns what a source or a row is — and a cockpit can put
 * anything else in any slot without this file changing. It does not know what
 * makes a table derived either: the host says which extra sheets exist HERE,
 * because which tables are visible is a fact about the cursor and the cursor is
 * the session's.
 */
import { useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

/** Which tab is showing. A cut table's sheet answers to its own name, so a host may open on one. */
export type WorkbookTab = 'sources' | 'sheet' | `sheet:${string}`;

/** The tab id one cut table's sheet answers to — ONE owner, so a host and this strip can never spell it differently. */
export function derivedSheetTab(table: string): WorkbookTab {
  return `sheet:${table}`;
}

/** One more sheet: a table an act cut, and the panel that shows its rows. */
export interface WorkbookSheet {
  /** The table's own name — the tab's label, because that is what a person will look for. */
  readonly table: string;
  readonly panel: ReactNode;
}

export interface WorkbookProps {
  /** Tab 1: the tables. */
  readonly sources: ReactNode;
  /** Tab 2: the rows of the table this workbook is about. */
  readonly sheet: ReactNode;
  /** One tab each, after the Sheet, for the tables an act cut and the cursor can see. */
  readonly sheets?: readonly WorkbookSheet[];
  /** Which tab opens first. Default: Sources — a person reads where the rows came from before reading the rows. */
  readonly initialTab?: WorkbookTab;
  readonly className?: string;
}

/** One tab, ready to draw: what it is called, what it shows, and the id its panel wears. */
interface Leaf {
  readonly id: WorkbookTab;
  readonly label: string;
  /** The DOM half of the id. Positional for a cut table, so a table name is never asked to be an html id. */
  readonly slug: string;
  readonly panel: ReactNode;
}

/** The strip, in order: Sources, the Sheet, then one tab per cut table. */
function leavesOf(sources: ReactNode, sheet: ReactNode, sheets: readonly WorkbookSheet[]): readonly Leaf[] {
  return [
    { id: 'sources', label: 'Sources', slug: 'sources', panel: sources },
    { id: 'sheet', label: 'Sheet', slug: 'sheet', panel: sheet },
    ...sheets.map((cut, at) => ({ id: derivedSheetTab(cut.table), label: cut.table, slug: `sheet-${at + 1}`, panel: cut.panel })),
  ];
}

export function Workbook({ sources, sheet, sheets = [], initialTab = 'sources', className }: WorkbookProps): JSX.Element {
  const [tab, setTab] = useState<WorkbookTab>(initialTab);
  const leaves = leavesOf(sources, sheet, sheets);
  // A cut table's sheet can STOP BEING HERE while it is showing — seek before
  // the act and the table is not one of the tables any more. The strip falls
  // back to the first tab, which is the one that would explain the absence,
  // rather than leaving no tab selected and nothing to walk from.
  const at = leaves.findIndex((leaf) => leaf.id === tab);
  const here = at < 0 ? 0 : at;
  const shown = leaves[here]!;

  // arrow keys walk the strip and select as they go (the cockpit's switcher rule) — one tab is reachable, all are walkable
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setTab(leaves[(here + step + leaves.length) % leaves.length]!.id);
  };

  return (
    <div className={`vzf vzf-workbook${className !== undefined ? ' ' + className : ''}`} data-vzf="workbook">
      <div className="vzf-workbook-tabs" role="tablist" aria-label="the data layer" onKeyDown={onKeyDown}>
        {leaves.map((leaf, index) => (
          <button
            key={leaf.id}
            type="button"
            id={`vzf-workbook-tab-${leaf.slug}`}
            className={`vzf-workbook-tab${index === here ? ' vzf-workbook-tab-on' : ''}`}
            role="tab"
            aria-selected={index === here}
            aria-controls={`vzf-workbook-panel-${leaf.slug}`}
            tabIndex={index === here ? 0 : -1}
            onClick={() => setTab(leaf.id)}
          >
            {leaf.label}
          </button>
        ))}
      </div>
      <div className="vzf-workbook-panel" role="tabpanel" id={`vzf-workbook-panel-${shown.slug}`} aria-labelledby={`vzf-workbook-tab-${shown.slug}`} tabIndex={0}>
        {shown.panel}
      </div>
    </div>
  );
}

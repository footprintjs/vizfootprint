/**
 * THE WORKBOOK — two tabs over one data layer: **Sources** (where the rows
 * come from and what the carrier vouched for) and **Sheet** (the rows
 * themselves). Excel's shape, because it is the shape every analyst arrives
 * with; one table's case is simply two tabs.
 *
 * It owns nothing but the chosen tab. The panels are handed in by the host, so
 * the Workbook never learns what a source or a row is — and a cockpit can put
 * anything else in either slot without this file changing.
 */
import { useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';

export type WorkbookTab = 'sources' | 'sheet';

const TABS: readonly { readonly id: WorkbookTab; readonly label: string }[] = [
  { id: 'sources', label: 'Sources' },
  { id: 'sheet', label: 'Sheet' },
];

export interface WorkbookProps {
  /** Tab 1: the declared tables. */
  readonly sources: ReactNode;
  /** Tab 2: the rows. */
  readonly sheet: ReactNode;
  /** Which tab opens first. Default: Sources — a person reads where the rows came from before reading the rows. */
  readonly initialTab?: WorkbookTab;
  readonly className?: string;
}

export function Workbook({ sources, sheet, initialTab = 'sources', className }: WorkbookProps): JSX.Element {
  const [tab, setTab] = useState<WorkbookTab>(initialTab);

  // arrow keys walk the strip and select as they go (the cockpit's switcher rule) — one tab is reachable, all are walkable
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(at + step + TABS.length) % TABS.length]!;
    setTab(next.id);
  };

  return (
    <div className={`vzf vzf-workbook${className !== undefined ? ' ' + className : ''}`} data-vzf="workbook">
      <div className="vzf-workbook-tabs" role="tablist" aria-label="the data layer" onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            id={`vzf-workbook-tab-${t.id}`}
            className={`vzf-workbook-tab${t.id === tab ? ' vzf-workbook-tab-on' : ''}`}
            role="tab"
            aria-selected={t.id === tab}
            aria-controls={`vzf-workbook-panel-${t.id}`}
            tabIndex={t.id === tab ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="vzf-workbook-panel" role="tabpanel" id={`vzf-workbook-panel-${tab}`} aria-labelledby={`vzf-workbook-tab-${tab}`} tabIndex={0}>
        {tab === 'sources' ? sources : sheet}
      </div>
    </div>
  );
}

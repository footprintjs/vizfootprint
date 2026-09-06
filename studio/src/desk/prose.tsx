/**
 * THE PROSE PLANE, DRAWN — a view's words, the dashboard's summary, and the
 * drafts waiting on a person.
 *
 * Two rules, and both are the library's rather than this module's:
 *
 *   1. **A stale slot is shown, never hidden and never rewritten.** The session
 *      judges every slot at every read against what is on screen; a surface
 *      that quietly dropped the stale ones would be deciding on the reader's
 *      behalf that the words no longer count.
 *   2. **Who wrote it rides with it.** A human, the analyst, or derived by the
 *      library from the chart's own bindings — the author is on the record and
 *      goes on the title attribute, and an agent's line says so out loud.
 */
import type { ReactNode } from 'react';
import { ProseText, type ProseStatusView, type SessionViewState } from 'vizfootprint-ui';
import { T } from './tokens.js';

/**
 * The dashboard's own words and proposals — `describe` with the viewId
 * `dashboard`, as the adapter serves them.
 *
 * Reached through `SessionViewState` rather than by name: the adapter's barrel
 * exports `ProseStatusView` and `ProposalView` but not the record that holds
 * them, so the state IS the door here. (A one-line widening of
 * `ui/src/adapter/index.ts` would give it a name; it is not this packet's file
 * to touch.)
 */
export type DashboardWordsView = NonNullable<SessionViewState['dashboard']>;

/** Where a ref's anchor goes when it is clicked — the four resolvers, in one bag. */
export interface ProseAnchors {
  readonly describeCommit?: (commitId: string) => string | undefined;
  readonly onSeek?: (commitId: string) => void;
  readonly onBookmark?: (beatId: string) => void;
  readonly onSaved?: (savedId: string) => void;
}

/** The author, as a tooltip — kind, who, which model. */
export const authorTitle = (p: ProseStatusView): string =>
  `${p.author.kind}${p.author.by ? ' · ' + p.author.by : ''}${p.author.model ? ' · ' + p.author.model : ''}`;

const slotName = { fontFamily: T.mono, fontSize: T.textXs, opacity: 0.6, marginRight: 4 } as const;

/**
 * A view's visible words. `altShort`/`altLong` are the chart's ACCESSIBLE name
 * — they go to assistive tech through the chart, and printing them here would
 * say everything twice.
 */
export function ProseLines({ lines, anchors }: { readonly lines: readonly ProseStatusView[]; readonly anchors: ProseAnchors }): ReactNode {
  const visible = lines.filter((p) => p.slot !== 'altShort' && p.slot !== 'altLong');
  if (visible.length === 0) return null;
  return (
    <div style={{ marginTop: 6, fontSize: T.textMd, lineHeight: 1.45, whiteSpace: 'normal' }}>
      {visible.map((p) => (
        <div
          key={p.slot}
          style={{ color: p.status === 'stale' ? T.stale : undefined, opacity: p.status === 'derived' ? 0.7 : 0.9 }}
          title={p.status === 'stale' ? `stale — moved: ${p.changed.join(', ')}` : authorTitle(p)}
        >
          <span style={slotName}>{p.slot}</span>{' '}
          <ProseText text={p.text} refs={p.refs} {...anchors} />
          {p.status === 'stale' ? <span style={{ fontSize: T.textXs, opacity: 0.8 }}> stale · {p.changed.join(', ')} moved</span> : null}
          {p.status === 'derived' ? <span style={{ fontSize: T.textXs, opacity: 0.7 }}> derived</span> : null}
          {p.author.kind === 'agent' ? <span style={{ fontSize: T.textXs, opacity: 0.7 }}> by the analyst</span> : null}
        </div>
      ))}
    </div>
  );
}

export interface DashboardSummaryProps {
  /** The dashboard's OWN words and proposals — `describe` with the viewId `dashboard`. */
  readonly dashboard: DashboardWordsView | undefined;
  readonly readOnly: boolean;
  readonly anchors: ProseAnchors;
  readonly onAccept: (proposal: string) => void;
  readonly onDecline: (proposal: string, reason: string) => void;
}

/**
 * The one-line summary of the whole desk, under the time strip — the caption
 * slot of the dashboard's own words, plus any caption a proposer has put on the
 * table. Nothing at all when there is neither: an empty slot with a label is
 * furniture, not information.
 */
export function DashboardSummary({ dashboard, readOnly, anchors, onAccept, onDecline }: DashboardSummaryProps): ReactNode {
  const caption = dashboard?.prose.find((p) => p.slot === 'caption');
  const drafts = (dashboard?.proposals ?? []).filter((p) => p.slot === 'caption' && p.status === 'open');
  if (caption === undefined && drafts.length === 0) return null;
  return (
    <div role="note" style={{ flexBasis: '100%', fontSize: T.textMd, lineHeight: 1.45, display: 'flex', flexWrap: 'wrap', gap: T.gap, alignItems: 'baseline' }} aria-label="dashboard summary">
      {caption !== undefined ? (
        <span style={{ color: caption.status === 'stale' ? T.stale : undefined, opacity: 0.9 }} title={authorTitle(caption)}>
          <span style={slotName}>summary</span>{' '}
          <ProseText text={caption.text} refs={caption.refs} {...anchors} />
          {caption.status === 'stale' ? <span style={{ fontSize: T.textXs, opacity: 0.8 }}> stale · {caption.changed.join(', ')} moved</span> : null}
          {caption.author.kind === 'agent' ? <span style={{ fontSize: T.textXs, opacity: 0.7 }}> by the analyst</span> : null}
        </span>
      ) : null}
      {drafts.map((p) => (
        <span key={p.proposal} style={{ fontSize: T.textSm, background: T.draftBg, border: `1px solid ${T.draftLine}`, borderRadius: T.radius, padding: '2px 8px' }}>
          <span style={{ opacity: 0.7, marginRight: 4 }}>proposed:</span>
          {p.text}
          {!readOnly ? (
            <>
              {' '}
              <button type="button" onClick={() => onAccept(p.proposal)} style={{ font: 'inherit', fontSize: 11.5, marginLeft: 6, cursor: 'pointer' }}>
                accept
              </button>
              <button
                type="button"
                onClick={() => {
                  const reason = window.prompt('Decline because…');
                  if (reason) onDecline(p.proposal, reason);
                }}
                style={{ font: 'inherit', fontSize: 11.5, marginLeft: 4, cursor: 'pointer' }}
              >
                decline
              </button>
            </>
          ) : null}
        </span>
      ))}
    </div>
  );
}

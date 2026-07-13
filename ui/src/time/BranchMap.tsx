/**
 * `<BranchMap>` — the git-graph of the append-only commit DAG. Its own
 * component (composed beside, not inside, the time bar). Pure geometry comes
 * from the adapter's `layoutBranches`: the active lineage rides lane 0 (top),
 * each divergent leaf drops to its own lane, siblings fork downward as smooth
 * curves. Nodes are badged by actor; the cursor and head wear rings; checkpoints
 * fly a flag. Scrolls horizontally within its own box.
 *
 * BR-2 upgrades (all opt-in, old call sites unchanged):
 *   - `paths` labels each lane with its NAMED path (the ref whose tip ends the
 *     lane); the current path's label wears the violet spine accent.
 *   - When any of `onNewPath` / `onBringOver` / `onUndo` / `onCompare` is
 *     provided, clicking a node opens a small GLASS CONTEXT MENU instead of
 *     seeking directly: Jump here · New path here · Bring this step over ·
 *     Undo this step · Compare with current. Items that cannot apply are
 *     disabled WITH the honest reason (e.g. an analysis can't be un-run — the
 *     FDR ledger never refunds alpha). Esc or a click-away closes; the first
 *     item takes focus on open.
 *   - Without those handlers, a click still seeks — the pre-BR-2 behavior.
 */
import { useEffect, useRef, useState } from 'react';
import type { CommitView, CheckpointView, PathView } from '../adapter/types.js';
import { layoutBranches } from '../adapter/stepNav.js';

export interface BranchMapProps {
  readonly commits: readonly CommitView[];
  readonly cursor: string | null;
  readonly head: string | null;
  readonly checkpoints?: readonly CheckpointView[];
  /** Named lane labels (BR-2): each path's name is drawn at its tip's lane. */
  readonly paths?: readonly PathView[];
  readonly onSeek?: (commitId: string) => void;
  /** Start a NEW named path at this commit (context-menu action). */
  readonly onNewPath?: (commitId: string) => void;
  /** Bring this step over to the current position (context-menu action). */
  readonly onBringOver?: (commitId: string) => void;
  /** Undo this step (context-menu action; disabled-with-reason on analyses/notes). */
  readonly onUndo?: (commitId: string) => void;
  /** Compare this commit with the current position (context-menu action). */
  readonly onCompare?: (commitId: string) => void;
  readonly className?: string;
}

const DX = 56;
const DY = 38;
const PADX = 26;
const PADY = 24;
const R = 8;

/** The honest reason a step cannot be undone, or null when it can. */
export function undoBlockReason(commit: CommitView): string | null {
  if (commit.label === 'analysis' || commit.label === 'test') {
    return 'an analysis cannot be un-run — the FDR ledger never refunds alpha';
  }
  if (commit.label === 'note') return 'a note is inert — there is no earlier state to restore';
  return null;
}

interface MenuItem {
  readonly id: string;
  readonly text: string;
  readonly onPick: () => void;
  readonly disabledReason?: string | null;
}

export function BranchMap(props: BranchMapProps): JSX.Element {
  const { commits, cursor, head, checkpoints = [], paths = [], onSeek } = props;
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const hasMenu = props.onNewPath !== undefined || props.onBringOver !== undefined || props.onUndo !== undefined || props.onCompare !== undefined;

  // focus the first enabled item when the menu opens (keyboard path)
  useEffect(() => {
    if (menuFor !== null) menuRef.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, [menuFor]);

  if (commits.length === 0) {
    return <div className="vzf-bm-empty">the branch map sprouts a fork once you seek back and act</div>;
  }
  const { nodes, edges, maxDepth, maxLane } = layoutBranches(commits, head);
  const pos = new Map(nodes.map((n) => [n.node.id, n]));
  const byId = new Map(commits.map((c) => [c.id, c]));
  const ckptAt = new Map(checkpoints.filter((c) => c.commitId).map((c) => [c.commitId!, c.label]));
  // lane labels: only refs whose tip is actually drawn (a stale name can't crash the map)
  const laneLabels = paths.filter((p) => pos.has(p.tip));
  const labelSpace = laneLabels.length > 0 ? Math.max(...laneLabels.map((p) => p.name.length)) * 7.5 + 24 : 0;

  const W = PADX * 2 + maxDepth * DX + 70 + labelSpace;
  const H = PADY * 2 + maxLane * DY + 16;
  /* v8 ignore next -- `pos` is built from `layoutBranches(commits, head).nodes`, which maps 1:1 over this same `commits` array, and xOf is only ever called with ids drawn from `commits`, from `edges` (whose endpoints are also always members of `commits`), or from `laneLabels` (filtered on `pos.has` above); the `?? 0` fallback can't observe a miss without breaking that invariant from outside this component */
  const xOf = (id: string): number => PADX + (pos.get(id)?.depth ?? 0) * DX;
  /* v8 ignore next -- same invariant as xOf above: pos.get(id) is always defined for every id yOf is called with */
  const yOf = (id: string): number => PADY + (pos.get(id)?.lane ?? 0) * DY;

  const open = menuFor !== null ? byId.get(menuFor) : undefined;
  const items: MenuItem[] =
    open === undefined
      ? []
      : [
          ...(onSeek !== undefined
            ? [
                {
                  id: 'jump',
                  text: 'Jump here',
                  onPick: () => onSeek(open.id),
                  disabledReason: open.id === cursor ? 'you are already here' : null,
                },
              ]
            : []),
          ...(props.onNewPath !== undefined ? [{ id: 'new-path', text: 'New path here', onPick: () => props.onNewPath!(open.id) }] : []),
          ...(props.onBringOver !== undefined
            ? [
                {
                  id: 'bring-over',
                  text: 'Bring this step over',
                  onPick: () => props.onBringOver!(open.id),
                  disabledReason: open.id === cursor ? 'this step is already where you are' : null,
                },
              ]
            : []),
          ...(props.onUndo !== undefined
            ? [{ id: 'undo', text: 'Undo this step', onPick: () => props.onUndo!(open.id), disabledReason: undoBlockReason(open) }]
            : []),
          ...(props.onCompare !== undefined ? [{ id: 'compare', text: 'Compare with current', onPick: () => props.onCompare!(open.id) }] : []),
        ];

  const activate = (id: string): void => {
    if (hasMenu) setMenuFor(id);
    else onSeek?.(id);
  };

  return (
    <div className={`vzf-branchmap-wrap${props.className ? ' ' + props.className : ''}`} data-vzf="branch-map">
      <svg className="vzf-branchmap" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="branch map">
        {edges.map((e) => (
          <path
            key={`${e.from}-${e.to}`}
            className="vzf-bm-edge"
            d={`M ${xOf(e.from)} ${yOf(e.from)} C ${xOf(e.from) + DX * 0.5} ${yOf(e.from)}, ${xOf(e.to) - DX * 0.5} ${yOf(e.to)}, ${xOf(e.to)} ${yOf(e.to)}`}
          />
        ))}
        {laneLabels.map((p) => (
          <text
            key={p.name}
            className={`vzf-bm-lane-label${p.active ? ' vzf-active' : ''}`}
            data-lane-label={p.name}
            x={xOf(p.tip) + R + 8}
            y={yOf(p.tip) + 4}
          >
            ⎇ {p.name}
          </text>
        ))}
        {commits.map((c) => {
          const isCursor = c.id === cursor;
          const isHead = c.id === head;
          const rec = byId.get(c.id)!;
          return (
            <g
              key={c.id}
              className="vzf-bm-node"
              data-commit={c.id}
              role="button"
              tabIndex={0}
              aria-haspopup={hasMenu ? 'menu' : undefined}
              aria-label={`${hasMenu ? 'actions for' : 'seek to'} #${c.id} ${c.label} (${c.actor})`}
              onClick={() => activate(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  activate(c.id);
                }
              }}
            >
              <circle
                className={`vzf-bm-dot vzf-${rec.actor}${isCursor ? ' vzf-cursor' : ''}${isHead ? ' vzf-head' : ''}`}
                cx={xOf(c.id)}
                cy={yOf(c.id)}
                r={isCursor ? R + 2 : R}
              />
              {ckptAt.has(c.id) && (
                <text className="vzf-bm-flag" x={xOf(c.id)} y={yOf(c.id) - R - 5} textAnchor="middle">
                  ⚑
                </text>
              )}
              <title>{`#${c.id} ${c.label} (${c.actor})${c.intent ? ': ' + c.intent : ''}`}</title>
            </g>
          );
        })}
      </svg>
      {open !== undefined && (
        <>
          {/* click-away closes; the menu itself sits above this shield */}
          <div className="vzf-ctx-shield" data-vzf="ctx-shield" onClick={() => setMenuFor(null)} />
          <div
            className="vzf-ctx-menu"
            data-vzf="ctx-menu"
            role="menu"
            aria-label={`actions for commit #${open.id}`}
            ref={menuRef}
            style={{ left: xOf(open.id) + 14, top: yOf(open.id) + 10 }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setMenuFor(null);
              }
            }}
          >
            <div className="vzf-ctx-head">
              <span className="vzf-mono">#{open.id}</span> {open.label} <span className={`vzf-badge vzf-${open.actor}`}>{open.actor}</span>
            </div>
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="vzf-ctx-item"
                data-ctx={item.id}
                disabled={item.disabledReason != null}
                title={item.disabledReason ?? undefined}
                onClick={() => {
                  item.onPick();
                  setMenuFor(null);
                }}
              >
                {item.text}
                {item.disabledReason != null && <span className="vzf-ctx-reason">{item.disabledReason}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * `<BranchMap>` — the git-graph of the append-only commit DAG. Its own
 * component (composed beside, not inside, the time bar). Pure geometry comes
 * from the adapter's `layoutBranches`: the active lineage rides lane 0 (top),
 * each divergent leaf drops to its own lane, siblings fork downward as smooth
 * curves. Nodes are badged by actor; the cursor and head wear rings; checkpoints
 * fly a flag. Clicking a node seeks. Scrolls horizontally within its own box.
 */
import type { CommitView, CheckpointView } from '../adapter/types.js';
import { layoutBranches } from '../adapter/stepNav.js';

export interface BranchMapProps {
  readonly commits: readonly CommitView[];
  readonly cursor: string | null;
  readonly head: string | null;
  readonly checkpoints?: readonly CheckpointView[];
  readonly onSeek?: (commitId: string) => void;
  readonly className?: string;
}

const DX = 56;
const DY = 38;
const PADX = 26;
const PADY = 24;
const R = 8;

export function BranchMap(props: BranchMapProps): JSX.Element {
  const { commits, cursor, head, checkpoints = [], onSeek } = props;
  if (commits.length === 0) {
    return <div className="vzf-bm-empty">the branch map sprouts a fork once you seek back and act</div>;
  }
  const { nodes, edges, maxDepth, maxLane } = layoutBranches(commits, head);
  const pos = new Map(nodes.map((n) => [n.node.id, n]));
  const byId = new Map(commits.map((c) => [c.id, c]));
  const ckptAt = new Map(checkpoints.filter((c) => c.commitId).map((c) => [c.commitId!, c.label]));

  const W = PADX * 2 + maxDepth * DX + 70;
  const H = PADY * 2 + maxLane * DY + 16;
  const xOf = (id: string): number => PADX + (pos.get(id)?.depth ?? 0) * DX;
  const yOf = (id: string): number => PADY + (pos.get(id)?.lane ?? 0) * DY;

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
              aria-label={`seek to #${c.id} ${c.label} (${c.actor})`}
              onClick={() => onSeek?.(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSeek?.(c.id);
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
    </div>
  );
}

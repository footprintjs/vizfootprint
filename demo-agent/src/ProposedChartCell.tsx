/**
 * `<ProposedChartCell>` (RP-3) — renders an AGENT-AUTHORED chart in the demo
 * cockpit through the SAME RP-2 vega-lite bridge + `bindRenderer` handshake the
 * gallery's `VegaLiteCell` uses. The bridge never sees React — `mount`/`update`/
 * `unmount` over the RP-1 contract is the whole integration surface.
 *
 * The chart is a proposed HYPOTHESIS to LOOK at: it RECEIVES the crossfilter
 * (its marks dim under every OTHER view's selection via the bridge-injected
 * `__vzfKeep` opacity encode), so it "crossfilters like any other view" in the
 * receiving direction; its own brush is display-only in v1 (a chart:${id}
 * namespace is inert in the session fold).
 *
 * The chart's spec already passed `session.proposeChart`'s governed gate
 * (single-view, no host-owned transforms, real columns), but that gate is
 * bridge-agnostic — a spec can still be one the v1 vega-lite bridge cannot host
 * (e.g. no selection param). `vegaLiteRenderer` throws a typed error in that
 * case; we catch it and show an honest note rather than crashing the cockpit.
 */
import { useEffect, useRef, useState } from 'react';
import type { TopLevelSpec } from 'vega-lite';
import { vegaLiteRenderer } from 'vizfootprint-vega-lite';
import { bindRenderer, type BoundRenderer, type RenderRow, type RenderSelection } from 'vizfootprint-ui';

/* v8 ignore next -- a proposed chart is display-only in v1 (chart:${id} is fold-inert), so the bridge's outbound callbacks never fire under jsdom; real gestures are proven in the gallery + demo-agent browser smokes, out of jsdom's reach */
const noop = (): void => {};

export interface ProposedChartCellProps {
  readonly viewId: string;
  readonly spec: unknown;
  readonly rows: readonly RenderRow[];
  readonly selection: RenderSelection;
  readonly theme: Readonly<Record<string, string>>;
  readonly width: number;
  readonly height: number;
}

export function ProposedChartCell(props: ProposedChartCellProps): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const boundRef = useRef<BoundRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    /* v8 ignore next -- the ref rides the div this same render returns; React attaches it before effects run */
    if (!el) return;
    let bound: BoundRenderer | null = null;
    try {
      const renderer = vegaLiteRenderer(props.spec as TopLevelSpec);
      const res = bindRenderer(renderer, el, {
        viewId: props.viewId,
        // a proposed chart is a hypothesis to view — it RECEIVES crossfilter; its
        // own gestures are display-only in v1 (chart:${id} is fold-inert), so all
        // four outbound verbs are the shared no-op.
        callbacks: { emit: noop, hover: noop, reencodeRequest: noop, navigate: noop },
        /* v8 ignore next 2 -- a spec that reaches here already passed the shape gate (no transforms) and the bridge speaks the host's protocol, so bindRenderer never refuses; the guard keeps the cockpit honest if a future bridge revision changes that */
        onGap: (gap) => setError(gap.detail),
      });
      /* v8 ignore next -- see above: bind never refuses a gated, same-protocol spec */
      if (!res.ok) return;
      bound = res.view;
      boundRef.current = res.view;
    } catch (e) {
      // the v1 bridge cannot host this otherwise-valid spec (e.g. no selection
      // param) — honest note (the typed error stringifies its own reason), never a crash.
      setError(String(e));
      return;
    }
    return () => {
      bound?.unmount();
      boundRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.viewId]);

  useEffect(() => {
    /* v8 ignore next -- ChartFrame only calls render() with a measured, non-zero box; the guard protects a real browser's pre-measure frame, unreachable under the test's fixed layout stub */
    if (props.width < 1 || props.height < 1) return;
    boundRef.current?.update({
      rows: props.rows,
      encodings: {},
      selection: props.selection,
      hover: null,
      theme: props.theme,
      size: { width: props.width, height: props.height },
    });
  }, [props.rows, props.selection, props.theme, props.width, props.height]);

  if (error !== null) {
    return (
      <div className="vzf-proposed-chart-error" style={{ padding: 12, fontSize: 13, opacity: 0.8 }}>
        This agent-proposed chart is ledgered, but the v1 vega-lite bridge cannot render it: {error}
      </div>
    );
  }
  return <div ref={hostRef} className="vzf-proposed-chart" style={{ width: '100%', height: '100%' }} />;
}

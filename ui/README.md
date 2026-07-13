# vizfootprint-ui

The designed, reusable component library for [vizfootprint](../README.md) — a headless
session-view adapter plus React components that render a coordinated, cause-tagged,
branching-provenance dashboard: charts with interactive (re-encodable) axes, a
two-mode time-travel bar, a git-graph branch map, and the honesty panels
(commit log, online-FDR two-truths ledger, gaps, readiness).

Part of the footprintjs family (the explainable-ui / agentthinkingui pattern):
ESM + UMD bundles, React `>=18` as a peer, one stylesheet, `.d.ts` types.

```
npm run build      # dist/vizfootprint-ui.{js,umd.js,css} + types/
npm test           # vitest (jsdom units + a Playwright gallery smoke)
npm run gallery    # http://localhost:5177 — the cockpit on a scripted real session
```

## The cockpit — the flagship layout

`<VizCockpit>` puts everything on ONE screen; neither the page nor the shell
ever scrolls. Three bands:

- **top strip** — time travel: the compact `<TimeTravelBar>` (Explore/Present
  toggle, the commit timeline, and the ⚑ checkpoint button).
- **charts** — fill ALL remaining height. Each chart is a render prop that
  receives its cell's measured size (`<ChartFrame>` does the measuring), so the
  SVG viewBox matches the on-screen box 1:1 — charts scale with the window and
  stay crisp.
- **status strip** — one slim line: a status readout on the left (rows
  selected, provider label), REPORT CHIPS on the right. Each chip carries a
  live badge (commits, discoveries, gap count …) so state is glanceable while
  closed, and opens a large frosted-glass modal hosting the full panel
  (`CommitLog`, `BranchMap`, `FdrLedger`, `ReadinessPanel`, `GapsPanel` —
  unchanged). Chips are just data: add your own (e.g. a 🐛 Debug panel).

![the cockpit](gallery/screenshots/gallery-dashboard.png)

On narrow screens (≤700px) the charts become horizontally swipeable pages
(CSS scroll-snap with dot indicators); the time strip stays pinned top, the
chip strip pinned bottom — still zero vertical page scroll. The shell sizes
itself with `dvh` units so mobile browser chrome is accounted for.

```tsx
<VizCockpit
  top={<TimeTravelBar compact …adapter wiring… />}
  charts={[
    { id: 'scatter', weight: 3, caption: 'drag to brush',
      render: ({ width, height }) => <VizScatter width={width} height={height} … /> },
    { id: 'bar', weight: 2, render: ({ width, height }) => <VizBar width={width} height={height} … /> },
  ]}
  reports={[
    { id: 'commits', title: 'Commit log', icon: '🧾', badge: state.commits.length,
      content: <CommitLog commits={state.commits} onSeek={(id) => void view.seek(id)} /> },
    { id: 'gaps', title: 'Gaps', icon: '⚠️', badge: state.gaps.length,
      content: <GapsPanel heading={false} gaps={state.gaps} /> },
  ]}
  status={`${selected} of ${total} rows selected · provider: ${provider}`}
  readOnly={mode === 'present'}
/>
```

## One modal system — VizModal

Every overlay in the library rides `<VizModal>`: the report chips, the
⚑ checkpoint prompt, and the axis `<EncodingPicker>` — no duplicate modal
systems. It is frosted glass on both themes (a translucent scrim +
`backdrop-filter` blur; the dark palette raises the scrim opacity so contrast
holds over dark content), with real dialog behavior: `role="dialog"
aria-modal`, focus moves in on open (`initialFocus` selector), Tab is trapped
at the edges, Esc / ✕ / a backdrop click close, and focus restores to the
opener. Two sizes: `'large'` (a report surface, ~min(92vw, 1100px) × 82vh) and
`'small'` (a prompt). Any overflow scrolls INSIDE `.vzf-modal-body` — never
the page.

![a report modal](gallery/screenshots/gallery-report-modal.png)

Clicking ⚑ opens the checkpoint namer (`<CheckpointModal>`): one autofocused
field, Enter/Save commits through the adapter's `checkpoint` action, and the
prompt shows which commit the flag will mark.

## The layers (each importable alone)

| module | job |
|---|---|
| `tokens/` | design tokens + theme engine — scoped CSS variables on the `.vzf` root (never `:root`), light+dark via `prefers-color-scheme` with a `data-theme` override that wins both ways |
| `adapter/` | `createSessionView(source)` — the framework-light store (getState/subscribe + action methods) over EITHER a live `InteractionSession` (`sessionSource`) OR a polled `/api/state` endpoint (`pollingSource`); React binds via `useSessionView` |
| `layout/` | `<VizCockpit>` (the flagship — and only — single-screen shell) + `<VizModal>` (the one modal system) + `<VizPanel>`/`<VizCard>` |
| `charts/` | `<VizScatter>`, `<VizBar>` — controlled SVG; emit the R3 `{rawValue, encoding}` shape (charts never build clauses); `<ChartFrame>` measures a cell so charts fill it; axis labels open `<EncodingPicker>` (on VizModal; disabled-with-reason) which fires `onReencode(viewId, channel, field)` — the `reencode` dispatch verb |
| `time/` | `<TimeTravelBar>` with `explore` (full commit timeline + fork-safe ⟵/⟶ step rules, `compact` for the cockpit) and `present` (checkpoint-ONLY story beats, acting disabled, `onReadOnlyChange` up to the shell) + `<CheckpointModal>` + `<BranchMap>` |
| `panels/` | `<CommitLog>` (cause badges, click-to-seek, off-branch dimming), `<FdrLedger>` (two truths + the verbatim honesty line), `<GapsPanel>`, `<ReadinessPanel>` — cockpit hosts these inside report modals, unchanged |

## Quick start

```tsx
import {
  VizCockpit, VizScatter, TimeTravelBar, CommitLog, FdrLedger,
  createSessionView, sessionSource, useSessionView,
} from 'vizfootprint-ui';
import 'vizfootprint-ui/styles.css';

const view = createSessionView(sessionSource(session), { as: 'user' }); // or pollingSource()

function App() {
  const state = useSessionView(view);
  return (
    <VizCockpit
      top={<TimeTravelBar compact
        commits={state.commits} cursor={state.cursor} head={state.head}
        checkpoints={state.checkpoints} onSeek={(id) => void view.seek(id)}
        onCheckpoint={(label) => void view.checkpoint(label)} />}
      charts={[{ id: 'scatter', render: ({ width, height }) => (
        <VizScatter width={width} height={height} data={points}
          columns={state.columns[state.defaultTable]}
          onEmit={(e) => void view.emit('scatter', e)}
          onReencode={(v, c, f) => void view.reencode(v, c, f)} />) }]}
      reports={[
        { id: 'commits', title: 'Commit log', badge: state.commits.length,
          content: <CommitLog commits={state.commits} onSeek={(id) => void view.seek(id)} /> },
        { id: 'ledger', title: 'FDR ledger', badge: state.ledger.discoveries,
          content: <FdrLedger ledger={state.ledger} /> },
      ]}
      status={`cursor ${state.cursor ?? '—'}`}
    />
  );
}
```

## CSS scoping — and its honest limit

Every rule is scoped under the root class `.vzf` at **zero specificity**
(`:where(.vzf …)`), and theme variables land on the component's own element,
so nothing leaks **out** into the host app and two dashboards can wear
different brands on one page. The flip side (the same limitation
agentthinkingui documents): host **global** rules — a bare `button { … }`, a
utility framework's resets — still leak **in**, because `:where()` cannot
out-specify them. A consumer needing hard isolation should mount the dashboard
inside an iframe (a real document boundary); CSS alone cannot promise it.

## Present mode semantics

`present` is the read-only storytelling mode: prev/next traverse only the
**named checkpoints** (in checkpoint order), the current beat's title renders
large, ordinary commits are hidden, the checkpoint composer disappears, and the
bar reports `readOnly` upward so the shell dims and pointer-blocks the acting
surfaces (the cockpit dims its charts band; navigation and the read-only report
chips stay live). The current beat is the checkpoint at the cursor, or — when
the cursor sits between beats — the most recent beat on the cursor's own
lineage.

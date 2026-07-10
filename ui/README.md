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
npm run gallery    # http://localhost:5177 — every component on a scripted real session
```

## The layers (each importable alone)

| module | job |
|---|---|
| `tokens/` | design tokens + theme engine — scoped CSS variables on the `.vzf` root (never `:root`), light+dark via `prefers-color-scheme` with a `data-theme` override that wins both ways |
| `adapter/` | `createSessionView(source)` — the framework-light store (getState/subscribe + action methods) over EITHER a live `InteractionSession` (`sessionSource`) OR a polled `/api/state` endpoint (`pollingSource`); React binds via `useSessionView` |
| `layout/` | `<VizDashboard>` responsive grid shell (top/main/side/bottom slots, scrolls on height — never the page; `readOnly` dims acting slots) + `<VizPanel>`/`<VizCard>` |
| `charts/` | `<VizScatter>`, `<VizBar>` — controlled SVG; emit the R3 `{rawValue, encoding}` shape (charts never build clauses); axis labels open `<EncodingPicker>` (focus-trapped, disabled-with-reason) which fires `onReencode(viewId, channel, field)` — the `reencode` dispatch verb |
| `time/` | `<TimeTravelBar>` with `explore` (full commit timeline + fork-safe ⟵/⟶ step rules) and `present` (checkpoint-ONLY story beats, acting disabled, `onReadOnlyChange` up to the shell) + `<BranchMap>` |
| `panels/` | `<CommitLog>` (cause badges, click-to-seek, off-branch dimming), `<FdrLedger>` (two truths + the verbatim honesty line), `<GapsPanel>`, `<ReadinessPanel>` |

## Quick start

```tsx
import {
  VizDashboard, VizScatter, TimeTravelBar, CommitLog, FdrLedger,
  createSessionView, sessionSource, useSessionView,
} from 'vizfootprint-ui';
import 'vizfootprint-ui/styles.css';

const view = createSessionView(sessionSource(session), { as: 'user' }); // or pollingSource()

function App() {
  const state = useSessionView(view);
  return (
    <VizDashboard
      top={<TimeTravelBar commits={state.commits} cursor={state.cursor} head={state.head}
        checkpoints={state.checkpoints} onSeek={(id) => void view.seek(id)} />}
      main={<VizScatter data={points} columns={state.columns[state.defaultTable]}
        onEmit={(e) => void view.emit('scatter', e)}
        onReencode={(v, c, f) => void view.reencode(v, c, f)} />}
      side={<CommitLog commits={state.commits} onSeek={(id) => void view.seek(id)} />}
      bottom={<FdrLedger ledger={state.ledger} />}
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
slots. The current beat is the checkpoint at the cursor, or — when the cursor
sits between beats — the most recent beat on the cursor's own lineage.

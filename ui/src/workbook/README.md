# workbook — the data layer's two tabs

Sources, then the Sheet: where the rows come from, and the rows. Excel's shape, because it is the shape every analyst arrives with — one table's case is simply two tabs.

```tsx
import { Sheet, Sources, Workbook } from 'vizfootprint-ui';

<Workbook
  sources={<Sources tables={state.tables ?? []} sources={state.sources} columns={state.columns} />}
  sheet={<Sheet data={data} viewId="sheet" table="cells" height={420} version={version} cursor={state.cursor} />}
/>
```

## The laws

- **It owns nothing but the chosen tab.** The panels are handed in as nodes, so the Workbook never learns what a source or a row is, and a cockpit can put anything else in either slot without this file changing.
- **The strip is a real `tablist`.** One tab is in the page's tab order (roving `tabindex`); the arrow keys walk the strip and select as they go — the same rule the cockpit's layout switcher follows. Each tab points at its panel (`aria-controls`), and the panel names its tab back (`aria-labelledby`).
- **The chosen tab is local state, not a commit.** Which tab a person is looking at is a per-viewer convenience, like a scroll position — never something the log should carry.
- **Only the chosen panel is mounted**, so the Sheet asks the engine for windows when it is on screen and not when it is behind a tab.

## Not here, on purpose

One Sheet tab per table (the design's end state) — this version shows the one sheet the host hands it. No tab overflow, no reordering, no per-tab close: two tabs need none of it, and inventing the chrome before the third tab exists would be guessing.

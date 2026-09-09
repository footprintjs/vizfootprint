# workbook — the data layer's tabs

Sources, then the Sheet, then one more sheet for every table an act cut: where the rows come from, the rows, and the rows an act made out of them. Excel's shape, because it is the shape every analyst arrives with — one table's case is simply two tabs.

```tsx
import { Sheet, Sources, Workbook } from 'vizfootprint-ui';

<Workbook
  sources={<Sources tables={state.tables ?? []} sources={state.sources} columns={state.columns} />}
  sheet={<Sheet data={data} viewId="sheet" table="cells" height={420} version={version} cursor={state.cursor} />}
  sheets={cutTables.map((t) => ({ table: t.name, panel: <Sheet data={portFor(t.name)} table={t.name} height={420} version={null} cursor={state.cursor} /> }))}
/>
```

## The laws

- **It owns nothing but the chosen tab.** The panels are handed in as nodes, so the Workbook never learns what a source or a row is, and a cockpit can put anything else in any slot without this file changing.
- **It does not know what makes a table derived either.** The host says which extra sheets exist HERE, because which tables are visible is a fact about the cursor and the cursor is the session's. A tab named `by_region` is a tab the host asked for, and it is gone the moment the host stops asking.
- **A cut table's tab is its own name**, and the id it answers to is `derivedSheetTab(name)` — one owner for that string, so a host opening on a sheet and this strip can never spell it differently. The DOM half of the id is positional (`vzf-workbook-panel-sheet-1`): a table name is never asked to be an html id.
- **A tab that is no longer here falls back to the first one.** Seek before the act and the cut table stops being one of the tables; the strip lands on Sources — the tab that would explain the absence — rather than leaving nothing selected and nothing to walk from.
- **The strip is a real `tablist`.** One tab is in the page's tab order (roving `tabindex`); the arrow keys walk the strip and select as they go — the same rule the cockpit's layout switcher follows. Each tab points at its panel (`aria-controls`), and the panel names its tab back (`aria-labelledby`).
- **The chosen tab is local state, not a commit.** Which tab a person is looking at is a per-viewer convenience, like a scroll position — never something the log should carry.
- **Only the chosen panel is mounted**, so a Sheet asks the engine for windows when it is on screen and not when it is behind a tab.

## Where the code lives

| file | what it owns |
| --- | --- |
| `Workbook.tsx` | the strip, the chosen tab, the fallback when a tab's table has gone, and `derivedSheetTab` — the one spelling of a cut table's tab id |
| `../sheet/AddAggregate.tsx` | the act that MAKES one of those tabs. The Workbook never lands it and never learns it happened; it draws what the host hands over |
| `../../../studio/src/desk/panels/DataPanel.tsx` | the desk's wiring: it projects the cut tables off `state.tables`, asks the host for a port per table, and hands them here |

## Not here, on purpose

No tab overflow, no reordering, no per-tab close, and no tab for a table nobody can see. A person who cuts many tables will want the first three; inventing that chrome before the fourth tab exists would be guessing.

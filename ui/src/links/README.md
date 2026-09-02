# links — the matrix a customer edits

`<LinkMatrix graph={state.links} labels={…} />` draws the link graph the
session serves (`state.links`, layer 4): rows are sources by view and emission
kind, columns are target views, a cell is the response. Three looks, three
facts — a default edge (the rule written out), a declared edge, a declared
`none` — and a blank cell for a silence (no edge at all, only under
`linkDefault: 'none'`).

Give it `onChange` and every cell becomes a select; the host receives one edge
per change and lands it as a `link` commit. The component never talks to a
session, so undo and time travel come from the log like every other act.

Own entry point: `import { LinkMatrix } from 'vizfootprint-ui/links'`. An app
that never edits links never bundles it.

| file | one job |
|---|---|
| `LinkMatrix.tsx` | the table, the three facts, the select when editable; `edgeAt` / `cellOf` for tests and hosts |

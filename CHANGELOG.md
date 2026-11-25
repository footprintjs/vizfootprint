# Changelog

## Unreleased

### Security: the web source stops reading at its size limit

- `httpSource` read a whole body into memory and compared its size with
  `maxBytes` afterwards, for a table and for a resource read without a progress
  observer. A server that declared no length (or a false one, under a fetch
  that does not hold a body to its declared length) could fill the host's
  memory before the read was refused. The body is now read through its
  stream and cut off, with the transfer aborted, at the chunk that crosses the
  cap. What can be held is the cap plus one chunk.
- The `too-large` sentence for such a read now says "arrived and the read was
  stopped there", and the count is what had arrived, not the body's full size.
- A caller's abort signal is honoured between chunks on every read.
- A body chunk that is a raw buffer or another byte view is read as the bytes
  it is; a chunk that is not bytes is refused `malformed`. After a refusal the
  stream itself is cancelled.
- Not covered: a host `fetch` whose response has no WHATWG stream (`body` is
  `null`, or a stream of another kind) is still read whole, and the cap is
  checked afterwards.

### Security: a selection value is never written into the recorded SQL unquoted (behaviour change)

- A point select accepted any value. An array was written into the commit's
  `predicateSQL` as its elements joined by commas with no quoting, so
  `value: ["1) OR (1=1"]` recorded `("category" IN (1) OR (1=1))`; through the
  Mosaic adapter the same text reached the clause the engine filters with. The
  same held for a RegExp, a function and an object with its own `toString`,
  and for those values inside a match list, a cell side, a range bound or a
  walked id list.
- `mosaicDescriptorSQL` now refuses every such value (`TypeError`; a selection
  port answers `unsupported-shape`). A plain record is still rendered as the
  constant `[object Object]`, as the system's own commits always were.
- `session.dispatch` refuses a select or filter whose value is not one plain
  value (string, number, boolean, `null`, a real date) with `guard-failed`, and
  says what to send instead. That covers every form: a point, a list of
  values, a cell, a range, and a walk (the node it starts from, the node a
  path runs to, and every id it reaches).
- A date is rendered only when it is a real `Date` with nothing of its own on
  it, read through the language's own methods. An object placed over
  `Date.prototype` could answer for a date's parts with text of its own, and
  that text reached SQL a database ran.
- A point select with an array value used to land. It is refused: send several
  values as `values`, and a range with the `filter` verb.
- New in `vizfootprint/data`: `isPlainValue`, `isPlainDate`, `notOnePlainValue`.

### Security: the DuckDB worker address is written into its script as data

- The browser arm started DuckDB's worker from a one-line script with the
  worker address pasted between quote marks. An address holding a quote mark
  ended the string, and the rest ran as script in the worker. The address is
  now parsed as an absolute URL and written as one string literal.
- A `bundles.*.mainWorker` that is not an absolute URL is refused with a
  sentence. A relative one never worked: the worker starts from a `blob:` URL,
  which is no base.

### A test records the row it got, and a replay checks it

- A test's commit now carries `ledgerRow` beside its p-value: the position,
  threshold, verdict and budget it got in the error budget where it was made.
  The stored value of every new test commit is larger by that row; logs written
  before this still replay.
- `ReplayResult.tests` gains `rejudged` and `unchecked`. `rejudged` lists each
  test whose row, computed by the replaying session, is not the row the test
  recorded, with both rows and what differs. `unchecked` lists the readable
  tests that carry no readable row. A log replayed into a dashboard with
  another procedure or other settings used to be judged again with nothing to
  show for it; it is still judged by the replaying dashboard, and now says so
  test by test.
- A carried row is named by its recorded row, so a replay no longer needs the
  analysis declared to give the row its original name.
- New types on `vizfootprint/session`: `ReplayedTests`, `RejudgedTest`,
  `LedgerRowDifference`.
- `compare()` and the fold's diff read a test by its act and p-value. The
  ledger row beside it is not state: the same test with the same result on two
  paths is not a change.
- The check compares rows. It is not a signature: a log whose p-value and row
  were both rewritten consistently passes it.

### Correction: a replayed session carries its error budget (behaviour change)

- `session.replay(log)` used to start the replayed session with the full error
  budget although the log held tests. The next test was then judged as the
  first, at the loosest threshold: saving and replaying handed out a fresh
  budget. The recorded p-values are now fed through the budget in arrival
  order, every branch counted, without running any test again.
- Replayed into the dashboard that made the log, the session stands where the
  original stood. The rows are computed by the replaying session: the log does
  not record the procedure, its settings or the original verdicts, so a
  dashboard configured differently gives its own verdicts for the same p-values.
- `ReplayResult` gains `tests: { carried, unreadable }`. A test whose record
  cannot be read is entered at p = 1 and listed in `unreadable` with a reason.
  That is the cautious side under LORD++ and is not guaranteed to be under
  alpha-investing.
- `why({ kind: 'hypothesis' }).fdr` is now present on a replayed session for a
  test the replay re-performs (one that also wrote a column or a table).
- An analysis that is not declared as a test can no longer report a test
  result: `analyze` rejects. It used to spend a budget step with no test commit
  behind it, which no replay could account for.
- A consumer that relied on a replayed session having an empty ledger
  (`overview().fdr.tests === 0`) must stop: that was the fault.

### Correction: error budget is spent only for a test that lands

- An analysis module written by hand (not built by `defineAnalysis`) could
  report a p-value such as `NaN`. The session spent error budget on it and
  landed a test commit no reader can read. The session now refuses it, as
  `defineAnalysis` always has for its own modules. One rule, `isPValue`, is
  asked at every door.
- The budget used to be spent the moment a module reported its result, while
  the module was still running. A module that reported and then failed had
  spent a step with no commit behind it, and one that reported twice had spent
  two steps for one commit. The budget is now spent once, after the run has
  returned a result. A second reported result is refused.
- In each refused case `analyze` rejects, no budget is spent and nothing lands.

### Correction: a `why` answer carries what the record could not establish

- `why()`'s kernel tier gains `kernel.limits` (`KernelSliceLimits`): whether a
  budget cut the slice, how reads were known and counted, which commits took
  untracked input, which read a value from before the run, how many edges are
  not certain, and the record reader's own notes. The answer used to keep the
  commit ids and drop all of it, so a cut or partly-blind chain looked complete.
- `flags.kernelLimitsReported` is `true` when the reader reported any of those,
  including a run where no reads were recorded. `false` means none was
  reported; it is not a claim that the chain is complete.
- Reading an answer is unaffected. Code that BUILDS a `CrossTierSlice` or a
  `WhyFlags` by hand must add the two fields.
- The `viz.why` tool's description tells the agent to report a chain with
  limits as partial.

### Migration: the time-travel bar renders a model (breaking, `vizfootprint-ui`)

- `<TimeTravelBar>` takes one `model` prop in place of `commits`, `cursor`,
  `head`, `bookmarks`, `branches` and `pathName`. It derives nothing from the log.
- New: `timeTravelModel(input)` (data logic, no React), `useTimeTravel(view)`
  (a model and the view's five time actions, ready to spread onto the bar),
  `timeTravelOf(state)` and the types `TimeTravel`, `TimeTravelInput`,
  `TimeTravelModel`, `ExploreModel`, `PresentModel`, `PresentStop`, `RailBar`,
  `RailCoverage`. Each action of the door hands back what the session said
  (`DescribeOutcome`), so a custom bar can tell a reader a seek was refused.
- The demo-agent app now names the path beside the rail, as the gallery and
  the studio desk already did: the door always passes it.
- Correction: a cursor naming a commit that is not in the log used to draw an
  empty rail under "no commits yet". The rail now draws the head's lineage and
  its sentence says the cursor is not among the recorded steps. `RailScope`
  gains `cursorMissing`.
- Correction: "no commits yet" is said only of an empty log.

Migration:
1. With a session view: `const time = useTimeTravel(view)` then
   `<TimeTravelBar {...time} />`; drop the six removed props and the five
   action props you wired by hand.
2. With your own store: `model={timeTravelModel({ commits, cursor, head,
   bookmarks, pathCount: branches.length, pathName })}`.

### Migration: the UI theme is a typed token set (breaking, `vizfootprint-ui`)

- `vizfootprint-ui` has a theme layer: `ThemeTokens` names every design token,
  `slateLight` and `slateDark` are complete shipped themes, and `<VizTheme>`
  replaces the theme as a whole or overrides part of it for a subtree.
- **Removed, with no alias:** `resolveTheme`, `themeStyle`, `themeAttr`,
  `applyTheme`, `ThemeConfig` and `ColorInput`. They reached 27 of the 76
  `--vzf-*` properties the stylesheet names.
- `<VizCockpit theme>` now takes `ThemeTokens`; light or dark is the separate
  `mode` prop.
- Correction: design tokens are declared on the outermost `.vzf` / `.vzf-theme`
  element only. A nested component used to re-declare the defaults on itself,
  so a themed cockpit did not theme a sheet, note or editor placed inside it.
  A nested `data-theme` re-declares only the tokens that differ between light
  and dark.
- The theme rules have zero specificity, so a host rule naming `.vzf` now wins
  whatever the load order and whichever mode is in force.
- `--vzf-zero` and `--vzf-map-empty` have no default declaration. They are read
  with a fallback to `--vzf-ink-faint` and `--vzf-surface-2`. A host that read
  either property itself must add the same fallback; `EMPTY_FILL` is exported
  for the second.
- A theme that names an unknown token, or gives one a value that is not a single
  CSS value, is refused with a `TypeError` naming the token. An empty font
  string used to be skipped and is now refused.
- Behaviour that no longer happens by itself: a single `colors.brand` used to
  derive its deep shade, tint and ink, and `mode: 'dark'` used to mix tints
  toward the dark ground. `<VizCockpit theme={{ colors: { brand } }}>` still
  compiles and now changes the base only. Use `accentColors`.
- `accentColors` picks the ink by contrast. The old rule chose white over many
  mid-tone fills where the dark ink was far more readable. It accepts `#rgb`
  and `#rrggbb` only (4- and 8-digit hex is refused) and returns lower-case
  six-digit hex.

Migration:
1. `themeStyle({ colors: { brand: '#36f' } })` becomes
   `tokensToCSSVars({ colors: accentColors('brand', '#3366ff') })`, or wrap the
   subtree in `<VizTheme tokens={…}>`. With a dark ground pass `'dark'` as the
   third argument. The `{ base, deep, tint }` form becomes the four fields
   written out: `{ brand, brandDeep, brandTint, onBrand }`.
2. `mode: 'dark'` inside the config becomes `mode="dark"` on `<VizTheme>` or
   `<VizCockpit>`; `mode: 'auto'` is the absence of the prop.
3. `fonts` is `fontFamily`; `textScale: 1.2` is `typography: { scale: '1.2' }`.
4. `applyTheme(el, config)` becomes setting each entry of
   `tokensToCSSVars(tokens)` with `el.style.setProperty`, and setting the
   element's `data-theme` attribute yourself when you force a mode.

### Correction: an export refuses a row count it cannot trust

- A data door's `count` that is not a whole, non-negative number of rows refuses
  the export with `reason: 'count'`. It used to be read as 0, so the receipt
  said the view was empty and the file complete while the door had delivered
  rows. A fractional count used to be rounded down, dropping rows silently.
- A count smaller than the rows the door itself answered is refused the same way.
- A count that changes between pages refuses the export with `reason: 'moved'`,
  like a changed version or cursor.
- A page holding more rows than were asked for refuses the export with
  `reason: 'misaligned'`. It used to be cut to fit.
- `ExportWalkRefusal` gains `'count'`. A door that answers the window it was
  asked for, with a count that covers it, is unaffected.

### Correction: an export refuses a row option that is not a number

- `exportWindows` and `exportFromSession` refuse the whole export with
  `reason: 'option'` when `pageRows` or `rowCeiling` is given and is not a
  finite number. `rowCeiling: NaN` used to export an empty body under a receipt
  saying `truncated: false`, and an infinite ceiling was written to the receipt
  as `null`. Finite values are clamped exactly as before; an omitted option
  (`undefined` or `null`) is still the default. A value that coerced to a number
  before — a numeric string, a boxed number — is refused too. `ExportWalkRefusal` gains `'option'`.

### Migration: required routing port (major)

- Routing now requires a consumer-owned scorer, declared policy and decision;
  remove the optional AgentFootprint peer and every runtime import from it.
  The host remains development-only for integration tests and the example app.
- Capture node/policy/scorer facts before callbacks and validate/project foreign
  scores and verdict evidence. Unknown, omitted or duplicate IDs and non-number
  scores produce the existing empty unmatched fallback. Non-number refusal is
  an intentional correction: the previous validator admitted those values.
  Preserve raw NaN/infinity numeric evidence for the supplied decision rule.
- Capture synchronous decisions immediately and asynchronous decisions at their
  first delivery; contain rejecting callbacks without an unhandled rejection.
- Capture asynchronous scores at actual observer delivery too, including Promise
  subtypes that retain and change their payload after the observer returns.
  Native resolution before observer delivery is not a snapshot guarantee.
- The actual packed files now enforce the host-free source/build boundary, and
  a chart-only consumer installs/bundles without that host. Existing route and
  real mock-Agent attribution tests remain; the host-backed tests live outside
  library source and keep their own no-emit type check.

Migration:
1. Create a port with your scorer, complete policy and decision function.
2. Pass it as `routeIntent(phrase, nodes, port, options)`; move old options fourth.
3. Keep any host adapter in application/test code, or remove that package for charts only.

- The preceding compatibility patch accepted AgentFootprint 16 alongside 15;
  the routing-port major above replaces that optional peer with consumer input.
- Correct spacing in the migration documentation and restore literal punctuation
  in the package description.

## 1.0.0 — 2026-11-19

### Migration: next major — stable engine 14 and Foottrace 2.1

This is a breaking host/dependency contract. Viz moves from 0.1.0 to its next major,
1.0.0; all four workspace privacy flags stay unchanged.

- Require the host's `footprintjs ^14.0.0` as a peer and use engine 14.0.0 in development.
  `AnalysisDef.build()` returns the host's chart and Viz executes it, so both must
  resolve one engine. Older engines and the RC-only range are no longer accepted.
  Keep runtime `foottrace ^2.1.0` and the existing one-physical-reader checks.
  The genuine hosted lock selects published Foottrace 2.2.0 within that range.
- Develop and test against published AgentFootprint 15 and the compatible published
  Storydeck 0.14.1 Studio alias. Regenerate the real lock with npm; do not relabel old
  lock entries or substitute source-candidate archives. Preserve main's locked
  development toolchain while updating these packages and their required inputs.
- Replace the stored ContextFootprint 0.1.0 development archive with published 0.1.1.
  Its assertion/comparison API matches the existing tests. The packed comparison
  example copies the actual locked install offline; every comparison, attribution,
  bundle-boundary and cleanup assertion remains in force.
- Required CI checks the commit's locked source graph and keeps all original build,
  type, browser/profile and both four-column 100% coverage gates. It no longer fetches
  sibling producer runs. External compatibility observations cannot block a merge.
  The RC-only per-command byte/compiler snapshots retire; normal lock integrity,
  physical identity, actual compiler tests and source-to-packed-manifest equality
  remain. This is not a claim that normal checks reproduce the retired snapshots.
- Keep only the normal installed-identity import closure and its behavior tests.
  The candidate-only RC route and its fault fixtures never existed on main;
  preserve their unchanged source on `archive/rc-native-input` at
  `75d7e9828b156a6aab4aa2e0e3fec5c607526ba8` rather than adding inactive code.
- Pin the Node 22/24 source and real-browser jobs to supported Ubuntu 24.04.
  The moving `ubuntu-latest` alias selected Ubuntu 26.04, where the locked browser
  install's requested apt fonts were unavailable. The browser tests, 20-minute
  job limits and existing coverage thresholds remain unchanged.
- Retain the actual reviewed-head Viz pack, SHA256 and source/run provenance from
  hosted CI for app snapshot consumption. A successful package build does not prove
  an app uses it.
- Keep main's development tools: Playwright 1.61.1 and Vitest/coverage 4.1.10,
  together with their locked inputs. A whole-lock refresh is a separate tool
  upgrade, not part of this migration. The capped-Sheet test uses the platform's
  one CSS-pixel bottom check and directly asserts that the last row is rendered
  inside the viewport; its canvas, last-row identity and other assertions remain.

### Corrections to the previous migration notes

- The RC notes omitted the host-chart engine ownership contract, assumed source
  producer availability could gate required CI, and retained a sibling comparator
  archive. Those were defects in the notes; the peer and normal-install rules above
  now state the intended boundaries. Historical native fixtures/proofs are retained.
- The earlier notes offered no durable hosted packed snapshot and no changelog.
  The reviewed-head artifact and this migration record supply those missing pieces.

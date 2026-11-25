# Changelog

## Unreleased

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
  whatever the load order.
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

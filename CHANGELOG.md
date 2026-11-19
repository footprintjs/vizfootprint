# Changelog

## Unreleased

### Migration: next major — stable engine 14 and Foottrace 2.1

This is a breaking host/dependency contract and requires the next major; current private snapshot versions stay unchanged in this draft.

- Require the host's `footprintjs ^14.0.0` as a peer and use engine 14.0.0 in development.
  `AnalysisDef.build()` returns the host's chart and Viz executes it, so both must
  resolve one engine. Older engines and the RC-only range are no longer accepted.
  Keep runtime `foottrace ^2.1.0` and the existing one-physical-reader checks.
  The genuine hosted lock selects published Foottrace 2.2.0 within that range.
- Develop and test against published AgentFootprint 15 and the compatible published
  Storydeck 0.14.1 Studio alias. Regenerate the real lock with npm; do not relabel old
  lock entries or substitute source-candidate archives. Private flags and package
  versions stay unchanged; no release, tag or npm publication is part of this draft.
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
- Pin the Node 22/24 source and real-browser jobs to supported Ubuntu 24.04.
  The moving `ubuntu-latest` alias selected Ubuntu 26.04, where the locked browser
  install's requested apt fonts were unavailable. The browser tests, 20-minute
  job limits and existing coverage thresholds remain unchanged.
- Retain the actual reviewed-head Viz pack, SHA256 and source/run provenance from
  hosted CI for app snapshot consumption. A successful package build does not prove
  an app uses it.

### Corrections to the previous migration notes

- The RC notes omitted the host-chart engine ownership contract, assumed source
  producer availability could gate required CI, and retained a sibling comparator
  archive. Those were defects in the notes; the peer and normal-install rules above
  now state the intended boundaries. Historical native fixtures/proofs are retained.
- The earlier notes offered no durable hosted packed snapshot and no changelog.
  The reviewed-head artifact and this migration record supply those missing pieces.

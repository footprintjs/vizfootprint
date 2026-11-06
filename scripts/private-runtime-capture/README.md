# Private runtime capture

This build tool retains one source-qualified private core/UI snapshot from the
immutable source and completed library gate identities in `profile.json`.
It changes no runtime source, package metadata, release route or registry state.
It is a runtime projection, **not** the payload selected by native `npm pack`.

The build-only workflow uses a separate producer checkout and exact library
checkout, native strict npm11.19 installation, and the normal core/UI builds.
`npm ci` includes the source's prepare lifecycle. Complete output trees are
captured with their original package documents and root MIT license. All public
export targets must exist. Sorted deterministic archives are read back against
that full projection; symlinks, dependencies, unsafe members, duplicates,
omissions, extra bytes and changed metadata are refused. UI's normal ESM entry
externalizes the shared core; the separately shipped UMD entry intentionally
inlines it. These are distinct consumption modes.

`capture_test.py` covers the archive contract with synthetic byte fixtures.
`probe.mjs` loads the actual retained pair after extraction, exercises public
profile/session APIs, and checks shared dependency resolution. This is focused
artifact proof. Existing successful Node22/24 library gates are reused; no full
suite, coverage or browser installation is repeated. Application acceptance
and dependency lock changes remain with the consumer's owner.

The workflow uploads both `.tgz` files, the complete `provenance.json` member
inventories, `CAPTURE.json` source/producer/toolchain/run bindings, and
`PROBE.json`. Their origin is recorded as hosted only when actually run in
GitHub Actions. Version labels remain private0.1.0/0.0.0. Nothing is published.

The one-shot producer triggers only on its named source-owner branch and
changes under this folder or its own workflow. It has no dispatch/release
trigger or write permission. Do not rerun a successful capture to recreate
discarded receipts: retain the artifact and review its exact producer/source.

# ContextFootprint dependency

This reviewed archive was built from ContextFootprint commit `5755eb072d19dae4948cc7be3898dc2d43721be4`.
Source repository: https://github.com/footprintjs/contextfootprint.
Version: 0.1.0, private npm package. License and original AgentFootprint attribution
are included in the archive. No npm publication is required for this integration.

Archive: `contextfootprint-0.1.0-5755eb0.tgz`
SHA-256: `a5653cb8d21b37af63a0caf0d612da7eb26571d11ea341c873d105ded9d8fd19`

The manifest pins version 0.1.0 as a DEV-TIME dependency of this repository only.
The library's own assertion shape is `src/data/profile/assertion.types.ts`
(`ProfileAssertion`), structurally ContextFootprint's `Assertion`; the adapter
`src/data/profile/assertion.ts` imports nothing from this package, and the
packed `vizfootprint` archive carries no dependency on it (asserted by
`npm run check:profile-package`). The package is kept here for two reasons: the
compile-time pin that the two shapes stay assignable both ways
(`src/data/profile/assertion.test.ts`), and the comparison example
(`examples/profile-assertion.mjs`), which a host runs after installing
ContextFootprint beside the library — the package check does exactly that,
offline, from this archive. A clean source checkout installs it through the
tracked lockfile, whose resolved path and integrity are pinned; keep that
lockfile, because regenerating it from the manifest alone would query npm for
the private version.

To update: verify the chosen ContextFootprint commit, build and pack it, record
the new commit-qualified filename and hash here, and update the dependency and
lockfile. Then run the Viz regression suite and `npm run check:profile-package`
after the normal build. This script installs Viz's packed archive offline with
an empty npm cache and checks ESM execution and the neutral browser bundle.

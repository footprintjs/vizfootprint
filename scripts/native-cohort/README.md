# Published install identity

This private CI helper observes the normal committed dependency installation.
The workflow calls `node scripts/native-cohort.mjs identity` before and after the
source gates. The historical directory name remains so those callers have one
fixed entry. The command requires this repository's Actions environment and no
API token; it never fetches a producer, installs a package or imports package
runtime code.

The host owns the required engine peer. Viz owns its Foottrace reader dependency.
One physical engine and reader must serve every declared workspace and installed
family owner. Normal and hidden lock entries must agree with the installed
versions and the authored stable ranges. Hidden directories and alias package
manifests participate in the census; workspace links do not replace the separate
scan of each workspace-owned dependency namespace. A declared local bin link may
target an admitted dependency namespace. Unknown workspace declarations and
aliased namespaces refuse rather than imply a complete census.

## Files and callers

| File | Responsibility and caller |
| --- | --- |
| `../native-cohort.mjs` | Fixed identity CLI, called by `.github/workflows/checks.yml`. |
| `published.mjs` | `inspectPublished`, called by the CLI and its focused tests. |
| `installed.mjs` | Physical census and resolved package owners, called by `published.mjs` and census tests. |
| `manifests.mjs` | The closed root/UI/Studio/bridge workspace declarations, used by the census and fixtures. |
| `files.mjs` | Canonical regular-file reads and raw digests, used by the census and published observer. |
| `published-fixture.mjs` | Inert installed metadata for the two focused test files; entry text must never execute. |
| `published.node-test.mjs` | Stable declarations, coherent stale versions, locks, physical copies and required-peer controls. |
| `workspace-census.node-test.mjs` | Four-namespace hidden copy/lock faults, once-only workspace scans, declared bins and namespace refusal. |

Run the focused data-only controls with:

```sh
node --test scripts/native-cohort/*.node-test.mjs
```

The normal path uses committed lock integrity, standard Git cleanliness, the
actual compiler's type/build tests and source-to-packed-manifest equality.
It does not claim to reproduce the retired RC per-command byte/compiler snapshots.
Any additional family-wide mutation guard belongs once in shared CI, not in a
Viz-specific adapter.

The former source-candidate installation route and its dead fault fixtures are
preserved unchanged at `archive/rc-native-input`, source
`75d7e9828b156a6aab4aa2e0e3fec5c607526ba8`. They are not active code or evidence
of the published installation's compatibility. Original archived proof remains
outside this repository; this cleanup neither reruns nor replaces it.

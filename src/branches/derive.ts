/**
 * BR-1 — `deriveBranches`: name every lane of a PRE-EXISTING anonymous log
 * deterministically, so resumed/legacy logs get stable names (same input →
 * same names, byte-for-byte, across calls and serialization round-trips).
 *
 * Rules:
 *   - a LANE is a leaf tip's root→tip path (leaves in log append order);
 *   - the first lane is the default name (`'main'`);
 *   - every other lane names itself from its DIVERGENCE commit — the first
 *     commit on its path not claimed by an earlier lane — via the same
 *     cause-slug the live `BranchRefs` auto-naming uses;
 *   - collisions take counter suffixes (`name-2`, `name-3`, …).
 */

import type { CommitRecord } from '../log/index.js';
import { slugForCommit, uniqueSlug } from './slug.js';
import { chainToRoot, indexById } from './walk.js';

export interface DeriveBranchesOptions {
  /** The first (oldest) lane's name. Default `'main'`. */
  readonly defaultName?: string;
}

/** `{name → tipCommitId}` for every lane of the log. Empty log → `{}`. */
export function deriveBranches(
  records: readonly CommitRecord[],
  opts: DeriveBranchesOptions = {},
): Record<string, string> {
  const byId = indexById(records);
  const hasChild = new Set<string>();
  for (const r of records) {
    if (r.parent !== null) hasChild.add(r.parent);
  }
  const leaves = records.filter((r) => !hasChild.has(r.id)); // append order = deterministic

  const claimed = new Set<string>(); // commit ids already on a named lane
  const taken = new Set<string>(); // names already assigned
  const out: Record<string, string> = {};
  const defaultName = opts.defaultName ?? 'main';

  leaves.forEach((leaf, index) => {
    const path = chainToRoot(byId, leaf.id).reverse(); // root→tip
    let name: string;
    if (index === 0) {
      name = defaultName;
    } else {
      // The divergence commit: the first commit unique to this lane. A leaf is
      // never on another lane's path (it has no children), so the scan always
      // lands — seed with the leaf itself for the type, not as a fallback.
      let divergence: CommitRecord = leaf;
      for (const r of path) {
        if (!claimed.has(r.id)) {
          divergence = r;
          break;
        }
      }
      name = uniqueSlug(slugForCommit(divergence), (n) => taken.has(n));
    }
    taken.add(name);
    for (const r of path) claimed.add(r.id);
    out[name] = leaf.id;
  });
  return out;
}

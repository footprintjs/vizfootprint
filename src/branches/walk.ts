/**
 * BR-1 — parent-tree walkers. Every walk is LOOP-SAFE by `seen`-set guard:
 * the append-only log cannot form a cycle, but this subpath accepts RAW
 * `CommitRecord[]` arrays (legacy / hand-carried logs), so a corrupted parent
 * pointer must terminate, never spin.
 */

import type { CommitRecord } from '../log/index.js';
import type { AncestorResult } from './types.js';

/** Index a raw log by commit id. */
export function indexById(records: readonly CommitRecord[]): Map<string, CommitRecord> {
  return new Map(records.map((r) => [r.id, r]));
}

/**
 * The tip→root parent chain. Loop-safe; stops at a missing id (an unknown tip
 * or a dangling parent pointer walks as far as the records allow — validate
 * ids upstream where absence must be an honest miss).
 */
export function chainToRoot(byId: ReadonlyMap<string, CommitRecord>, tipId: string | null): CommitRecord[] {
  const out: CommitRecord[] = [];
  const seen = new Set<string>();
  let cur: string | null = tipId;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    const rec = byId.get(cur);
    if (!rec) break;
    out.push(rec);
    cur = rec.parent;
  }
  return out;
}

/**
 * The lowest common ancestor of two commit ids KNOWN to exist (validate
 * upstream — `commonAncestor` below is the honest public face). `null` =
 * disjoint roots (no shared history).
 */
export function lcaOf(byId: ReadonlyMap<string, CommitRecord>, a: string, b: string): string | null {
  const ancestorsOfA = new Set(chainToRoot(byId, a).map((r) => r.id));
  for (const rec of chainToRoot(byId, b)) {
    if (ancestorsOfA.has(rec.id)) return rec.id;
  }
  return null;
}

/**
 * The public LCA: same-path yields the upstream commit, siblings yield the
 * fork point, unknown ids are an honest typed miss, disjoint roots are an
 * honest `ancestorId: null`.
 */
export function commonAncestor(records: readonly CommitRecord[], a: string, b: string): AncestorResult {
  const byId = indexById(records);
  const missing = [a, b].filter((id) => !byId.has(id));
  if (missing.length > 0) return { ok: false, reason: 'unknown-commit', missing };
  return { ok: true, ancestorId: lcaOf(byId, a, b) };
}

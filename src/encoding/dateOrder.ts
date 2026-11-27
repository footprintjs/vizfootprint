/**
 * Observed ordering disagreements, not a validity or whole-table safety claim.
 * The caller supplies finite instants from the existing date reader. Each
 * original string occurrence is counted once if any pair disagrees in sign.
 */
export interface DateOrderConflict {
  readonly compared: number;
  readonly conflicted: number;
}
export interface ReadDateString {
  readonly as: string;
  readonly at: number;
}

/** Native text ordering, the same comparison the recorded interval law uses. */
function textOrder(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A monotone run with the same adjacent signs has the same order for ALL pairs
 * by transitivity. This reads actual instants: a uniform spelling is not a
 * shortcut because rollover, DST gaps and signed years can still disagree.
 */
function sameOrder(values: readonly ReadDateString[]): boolean {
  let ascending = true;
  let descending = true;
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1]!;
    const current = values[i]!;
    const text = textOrder(previous.as, current.as);
    if (text !== Math.sign(previous.at - current.at)) return false;
    if (text > 0) ascending = false;
    if (text < 0) descending = false;
    if (!ascending && !descending) return false;
  }
  return true;
}

/**
 * O(n log n) worst case, O(n) storage; sorted common input takes the O(n)
 * shortcut. Sort a copy, never the caller's cells. Equal text is one group,
 * so inclusive cross-group comparisons count equal INSTANTS with distinct
 * spellings without blaming exact duplicates for differing from themselves.
 */
export function dateOrderOf(values: readonly ReadDateString[]): DateOrderConflict | undefined {
  if (sameOrder(values)) return undefined;
  const groups: { as: string; at: number; count: number }[] = [];
  for (const value of [...values].sort((a, b) => textOrder(a.as, b.as))) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.as === value.as) last.count++;
    else groups.push({ ...value, count: 1 });
  }
  const after: number[] = [];
  let minimum = Infinity;
  for (let i = groups.length - 1; i >= 0; i--) {
    after[i] = minimum;
    minimum = Math.min(minimum, groups[i]!.at);
  }
  let maximum = -Infinity;
  let conflicted = 0;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    if (maximum >= group.at || after[i]! <= group.at) conflicted += group.count;
    maximum = Math.max(maximum, group.at);
  }
  return conflicted === 0 ? undefined : { compared: values.length, conflicted };
}

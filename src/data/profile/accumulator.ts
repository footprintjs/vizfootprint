import { profileCell } from './cell.js';
import { ProfileError } from './error.js';
import { PROFILE_QUANTILE_METHODS, PROFILE_STATISTICS } from './operations.types.js';
import type { ProfileColumn, ProfileFieldRequest, ProfileFieldResult, ProfileFrequency,
  ProfileQuantileMethod, ProfileStatistic } from './types.js';

const STATISTICS = new Set<ProfileStatistic>(PROFILE_STATISTICS);

/** Neumaier summation on ordinary inputs. If a partial sum would overflow,
 * retain the same two-term expansion relative to a finite scale instead.
 * This keeps an unrequested overflowing sum from destroying a finite mean.
 * All arithmetic remains IEEE-754 Number arithmetic, not arbitrary precision. */
class CompensatedSum {
  private sum = 0;
  private correction = 0;
  private scale: number | undefined;

  add(value: number): void {
    if (this.scale !== undefined) { this.addScaled(value); return; }
    const next = this.sum + value;
    const error = Number.isFinite(next) ? (Math.abs(this.sum) >= Math.abs(value)
      ? (this.sum - next) + value : (value - next) + this.sum) : Infinity;
    const correction = this.correction + error;
    if (Number.isFinite(next) && Number.isFinite(correction)) {
      this.sum = next; this.correction = correction;
      return;
    }
    const previous = this.sum;
    const residual = this.correction;
    this.sum = 0; this.correction = 0;
    this.scale = Math.max(Math.abs(previous), Math.abs(residual), Math.abs(value));
    this.addScaled(previous); this.addScaled(residual); this.addScaled(value);
  }

  private addScaled(value: number): void {
    const magnitude = Math.abs(value);
    if (magnitude > this.scale!) {
      const ratio = this.scale! / magnitude;
      this.sum *= ratio; this.correction *= ratio; this.scale = magnitude;
    }
    const normalized = value / this.scale!;
    const next = this.sum + normalized;
    this.correction += Math.abs(this.sum) >= Math.abs(normalized)
      ? (this.sum - next) + normalized : (normalized - next) + this.sum;
    this.sum = next;
  }

  total(): number {
    const total = this.sum + this.correction;
    return this.scale === undefined ? total : total * this.scale;
  }

  mean(count: number): number {
    const total = this.total();
    if (Number.isFinite(total)) return total / count;
    return this.scale === undefined
      ? this.sum / count + this.correction / count
      : ((this.sum + this.correction) / count) * this.scale;
  }
}

function positiveLimit(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new ProfileError('INVALID_PROFILE', `${name} must be a positive safe integer.`);
}

/** Stable value ordering, independent of ingestion order and process locale. */
function compareFrequency(a: ProfileFrequency, b: ProfileFrequency): number {
  // profileCell enforces one primitive type per column. Relational comparison
  // gives numeric order, false before true, and code-unit string order.
  return Number(a.value > b.value) - Number(a.value < b.value);
}

function quantile(sorted: readonly number[], p: number, method: ProfileQuantileMethod): number {
  if (method === 'nearest-rank') return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!;
  const position = (sorted.length - 1) * p;
  const index = Math.floor(position);
  const lower = sorted[index]!, upper = sorted[Math.min(index + 1, sorted.length - 1)]!;
  const fraction = position - index;
  // Opposite extreme signs can overflow (upper-lower) despite a finite
  // interpolated answer. Convex terms avoid that intermediate overflow.
  return lower < 0 && upper > 0
    ? lower * (1 - fraction) + upper * fraction
    : lower + (upper - lower) * fraction;
}

/** One pass per field. Scalar moments use constant space; only requested exact
 * quantiles and frequencies retain values, with hard refusal at their caps.
 * finish() returns a detached snapshot and can never turn a failed prefix into
 * a successful result if a caller catches a push error. */
export function createFieldAccumulator(
  column: ProfileColumn,
  request: ProfileFieldRequest,
  options: {
    readonly quantileMethod?: ProfileQuantileMethod;
    readonly maxExactValues: number;
    readonly maxDistinctValues: number;
    /** The host may cap retained slots and characters across all fields. A
     * quantile slot and a frequency key are separate retained allocations. */
    readonly reserve?: (kind: 'exact' | 'frequency', value: number | string | boolean) => void;
  },
): { push(value: unknown): void; finish(): ProfileFieldResult } {
  if (request.field !== column.name)
    throw new ProfileError('INVALID_PROFILE', 'Requested field must match its column declaration.');
  if (!['number', 'string', 'boolean'].includes(column.type))
    throw new ProfileError('INVALID_PROFILE', `Field ${column.name} has an unsupported profile type.`);
  if (request.statistics !== undefined && !Array.isArray(request.statistics))
    throw new ProfileError('INVALID_PROFILE', 'Field statistics must be an array.');
  if (request.frequencies !== undefined && typeof request.frequencies !== 'boolean')
    throw new ProfileError('INVALID_PROFILE', 'Field frequencies must be a boolean.');
  const statistics: ProfileStatistic[] = [...(request.statistics ?? [])];
  if (statistics.some(statistic => !STATISTICS.has(statistic)))
    throw new ProfileError('INVALID_PROFILE', 'Field requests an unsupported statistic.');
  if (statistics.length && (column.type !== 'number' || column.role !== 'measure'))
    throw new ProfileError('INVALID_PROFILE', 'Numeric statistics require a number measure.');
  positiveLimit(options.maxExactValues, 'maxExactValues');
  positiveLimit(options.maxDistinctValues, 'maxDistinctValues');
  const reserve = options.reserve;
  if (reserve !== undefined && typeof reserve !== 'function')
    throw new ProfileError('INVALID_PROFILE', 'Retention reservation must be a function.');
  const method = options.quantileMethod;
  if (method !== undefined && !(PROFILE_QUANTILE_METHODS as readonly unknown[]).includes(method))
    throw new ProfileError('INVALID_PROFILE', 'Unsupported quantile method.');
  const needsQuantiles = statistics.includes('median') || statistics.includes('p95');
  if (needsQuantiles && method === undefined)
    throw new ProfileError('INVALID_PROFILE', 'Exact quantiles require an explicit method.');

  const definition = { ...column };
  const metadata = { field: definition.name, type: definition.type, role: definition.role, meaning: definition.meaning,
    ...(definition.unit === undefined ? {} : { unit: definition.unit }) };
  const maxExactValues = options.maxExactValues, maxDistinctValues = options.maxDistinctValues;
  const exact: number[] | undefined = needsQuantiles ? [] : undefined;
  const counts = request.frequencies ? new Map<string | number | boolean, number>() : undefined;
  const needsDeviation = statistics.includes('stddevPopulation') || statistics.includes('stddevSample');
  const sum = new CompensatedSum();
  let known = 0, unknown = 0, minimum = Infinity, maximum = -Infinity, deviation = 0;
  let failed = false;
  let failure: unknown;

  function latch(error: unknown): never {
    failed = true; failure = error;
    throw error;
  }

  function fail(code: string, message: string): never {
    return latch(new ProfileError(code, message));
  }
  function checkedNumber(value: number, statistic: ProfileStatistic): number {
    if (!Number.isFinite(value)) fail('NUMERIC_OVERFLOW', `Statistic ${statistic} for ${metadata.field} is not finite.`);
    return value === 0 ? 0 : value;
  }

  return {
    push(value) {
      if (failed) throw failure;
      let cell: ReturnType<typeof profileCell>;
      try { cell = profileCell(value, definition); }
      catch (error) { latch(error); }
      if (cell === null) {
        unknown++;
        return;
      }
      // The executor's maxScannedRows bounds both counters before push().
      if (exact && exact.length >= maxExactValues) fail('PROFILE_LIMIT', `Exact values for ${metadata.field} exceed maxExactValues.`);
      // Map avoids object-key collisions such as __proto__; signed zeros are
      // the same measured value and have one canonical presentation.
      const key = cell === 0 ? 0 : cell as string | number | boolean;
      if (counts && !counts.has(key) && counts.size >= maxDistinctValues)
        fail('PROFILE_LIMIT', `Frequencies for ${metadata.field} exceed maxDistinctValues.`);
      try {
        // Reserve before changing counts or retaining either representation.
        // A failed run does not release reservations to continue with a prefix.
        if (exact) reserve?.('exact', key);
        if (counts && !counts.has(key)) reserve?.('frequency', key);
      } catch (error) { latch(error); }
      const previousMean = needsDeviation && known ? sum.mean(known) : 0;
      known++;
      if (counts) counts.set(key, (counts.get(key) ?? 0) + 1);
      if (statistics.length) {
        const number = cell as number;
        sum.add(number);
        minimum = Math.min(minimum, number); maximum = Math.max(maximum, number);
        if (needsDeviation && known > 1) {
          // Welford's population variance recurrence, maintained as its
          // square root. hypot avoids squaring huge or tiny deviations.
          const coefficient = Math.sqrt(known - 1) / known;
          const delta = number - previousMean;
          const contribution = Number.isFinite(delta) ? delta * coefficient
            : number * coefficient - previousMean * coefficient;
          deviation = Math.hypot(deviation * Math.sqrt((known - 1) / known), contribution);
        }
        if (exact) exact.push(number);
      }
    },
    finish() {
      if (failed) throw failure;
      const sorted = exact?.slice().sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      const resultStatistics: Partial<Record<ProfileStatistic, number | null>> = {};
      for (const statistic of statistics) {
        if (known === 0 || statistic === 'stddevSample' && known < 2) { resultStatistics[statistic] = null; continue; }
        let value: number;
        switch (statistic) {
          case 'sum': value = sum.total(); break;
          case 'mean': value = sum.mean(known); break;
          case 'min': value = minimum; break;
          case 'max': value = maximum; break;
          case 'stddevPopulation': value = deviation; break;
          case 'stddevSample': value = deviation * Math.sqrt(known / (known - 1)); break;
          case 'median': value = quantile(sorted!, 0.5, method!); break;
          case 'p95': value = quantile(sorted!, 0.95, method!); break;
        }
        resultStatistics[statistic] = checkedNumber(value, statistic);
      }
      return { ...metadata, known, unknown,
        ...(statistics.length ? { statistics: resultStatistics } : {}),
        ...(counts ? { frequencies: [...counts].map(([value, count]) => ({ value, count })).sort(compareFrequency) } : {}),
      };
    },
  };
}

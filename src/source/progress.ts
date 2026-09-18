/**
 * HOW A RESOURCE READ REPORTS ITSELF — and what a server's declared length may
 * honestly be trusted for. One module, because those are the same question
 * asked twice: the progress TOTAL and the `too-large` TAIL both stand or fall
 * on whether `content-length` counts the bytes a reader is accumulating.
 *
 * **PROGRESS IS A REPORT, NOT A RECORD.** A {@link ResourceProgress} says how a
 * fetch is going. It is transient, it reaches no commit, it is on no wire a
 * session serves, it is not evidence, and **nothing computes from it** — a
 * number a reader is shown must come from the data, and a resource has no data
 * until it is whole (../source/README.md, the law's second half). It is a
 * visible act that claims nothing, which is why an observer that THROWS never
 * changes the read's outcome ({@link reportProgress}).
 *
 * THE MEASURED TRAP, and the reason `total` is optional rather than a number
 * with a zero for "unknown": the 169 MB response this module was written for
 * came back `content-encoding: gzip`, so its `content-length` was the
 * COMPRESSED size while the bytes a reader accumulates are DECODED. A
 * percentage from that pair races past 100%. `content-length` may also be
 * absent altogether (a chunked response) or simply wrong. So bytes-so-far is
 * reported ALWAYS — it is a fact the reader holds — and a total only when the
 * declaration counts the same bytes. "Unknown total" is a first-class answer
 * ({@link DeclaredLength} · `none`), never a zero.
 */

/**
 * One report about a resource read in flight: which resource, how many bytes
 * have arrived, and the total when there is one that can be trusted.
 *
 * `bytes` is the DECODED transfer count — what has actually landed in this
 * process — so it is comparable with `total` exactly when {@link declaredLength}
 * says the declaration is of these same bytes. It is never a cap check and
 * never a size a reader may compute from: the SIZE of a resource is
 * `ResourceInfo.bytes`, which exists only once the bytes are whole.
 */
export interface ResourceProgress {
  /** The declared resource's name, so ONE observer can serve every resource a def declares. */
  readonly resource: string;
  /** How many bytes have arrived so far. Always present: this is the fact the reader holds. */
  readonly bytes: number;
  /**
   * How many bytes there are in all — present ONLY when the server's declaration
   * counts the bytes being counted here. ABSENT means **unknown total**, which is
   * an answer: show a spinner that admits it does not know, never a bar at zero.
   */
  readonly total?: number;
}

/**
 * What a host passes to be told how a read is going (`ResourceSnapshotOptions.onProgress`).
 *
 * A REQUEST, not a guarantee: a carrier reports what its transport can honestly
 * say, and one that hands back a whole body reports once or not at all (the
 * `file` carrier reads through `readFile`; an `inline` payload never arrives at
 * all). Silence is not a stall.
 */
export type ResourceProgressObserver = (progress: ResourceProgress) => void;

/**
 * What a `content-length` can be trusted for, decided once so that the progress
 * total and the `too-large` sentence can never disagree:
 *
 * - `none` — nothing to compare: no declaration, or one that is not a count.
 * - `total` — a count of the very bytes a reader accumulates.
 * - `other-bytes` — a real count, but **of other bytes**: something between the
 *   declaration and this process changes the byte count (`content-encoding`,
 *   a `transfer-encoding`), so it is not a total and must not become one.
 *
 * The last two are both "unknown total" to a progress report, and they are
 * different SENTENCES to a refusal ({@link tooLargeOnArrival}) — which is the
 * whole reason there are three arms and not a number plus a boolean.
 */
export type DeclaredLength = { readonly kind: 'none' } | { readonly kind: 'total'; readonly bytes: number } | { readonly kind: 'other-bytes'; readonly bytes: number; readonly because: string };

/** The headers that mean the bytes on the wire are not the bytes in this process. */
const RECODING_HEADERS = ['content-encoding', 'transfer-encoding'] as const;

/** …and the two values of those that change nothing (absent, or the explicit "no encoding"). */
const UNCHANGED_BY = ['', 'identity'];

/**
 * THE TRUST RULE, in one place. A declaration is a total only when it is a
 * count (a run of digits — a float, a negative, a proxy's doubled `5, 5` and
 * anything else is not one) AND nothing between the server and this reader
 * recodes the body.
 *
 * Refuse on evidence, never on ignorance — the carrier's own law (./README.md,
 * guard 1) applied to a number: a missing `content-encoding` is not a claim
 * that the body was recoded, so the declaration is trusted; a present one is
 * evidence that it was, so the declaration is not.
 */
export function declaredLength(headers: Headers): DeclaredLength {
  const raw = (headers.get('content-length') ?? '').trim();
  if (!/^\d+$/.test(raw)) return { kind: 'none' };
  const bytes = Number(raw);
  for (const header of RECODING_HEADERS) {
    const value = (headers.get(header) ?? '').trim().toLowerCase();
    if (!UNCHANGED_BY.includes(value)) return { kind: 'other-bytes', bytes, because: `the body arrived ${header}: ${value}` };
  }
  return { kind: 'total', bytes };
}

/** The total a progress report may carry — `undefined` for both ways of not knowing. */
export const totalOf = (declared: DeclaredLength): number | undefined => (declared.kind === 'total' ? declared.bytes : undefined);

/**
 * How far along a read is, 0…1 — or `undefined` when there is no total to be far
 * along OF. The ONE owner of that division, so a host never writes
 * `bytes / total` over a pair that does not compare (the gzip trap above).
 *
 * CLAMPED at 1: with a trusted total, more bytes than declared means the server
 * declared wrongly, and a bar past 100% is exactly the lie this packet exists to
 * prevent. A total of zero has no fraction either — a body with no bytes is
 * `unavailable` at the door, never a landing.
 */
export function progressFraction(progress: ResourceProgress): number | undefined {
  if (progress.total === undefined || progress.total <= 0) return undefined;
  return Math.min(1, progress.bytes / progress.total);
}

/**
 * Fire one report. A host's observer that throws is SWALLOWED: a report is not a
 * record, so nothing about the read — the bytes, the version, the refusal —
 * may turn on it. (A refusal mid-read does not retract the reports already made
 * either: each said what had arrived, which was true when it was said.)
 */
export function reportProgress(onProgress: ResourceProgressObserver, progress: ResourceProgress): void {
  try {
    onProgress(progress);
  } catch {
    // deliberately nothing: see above
  }
}

/**
 * The tail of the `too-large` sentence for a body that was refused by what
 * ARRIVED — one owner, so the whole-body read and the progressive one say the
 * same thing about the same declaration.
 *
 * IT USED TO LIE, and that is why it is a function. The sentence said "(the
 * server declared no length)" whenever arrival exceeded the cap, including when
 * the server HAD declared one — which is precisely the gzip case, where the
 * declaration passes the pre-read guard (it counts compressed bytes) and the
 * arrival check is the one that fires.
 */
export function tooLargeOnArrival(size: number, unit: string, declared: DeclaredLength, maxBytes: number): string {
  return `too-large — ${String(size)} ${unit} arrived (${arrivedTail(declared)}), the cap is ${String(maxBytes)}`;
}

/**
 * …and the same refusal made by a PROGRESSIVE read, which does not wait to find
 * out how big the body really is: it says the count it had when it stopped, and
 * says that it stopped, so the number is never read as the body's size.
 *
 * The REASON and the CAP are the same as {@link tooLargeOnArrival}'s — the
 * verdict does not depend on which strategy read the body — and the count
 * honestly differs, because one of them stopped the transfer and the other
 * finished it.
 */
export function tooLargeMidStream(size: number, unit: string, declared: DeclaredLength, maxBytes: number): string {
  return `too-large — ${String(size)} ${unit} arrived and the read was stopped there (${arrivedTail(declared)}), the cap is ${String(maxBytes)}`;
}

/** What the server had said about the length, told truthfully for each of the three cases. */
function arrivedTail(declared: DeclaredLength): string {
  if (declared.kind === 'none') return 'the server declared no length';
  if (declared.kind === 'total') return `the server declared ${String(declared.bytes)}`;
  return `the server declared ${String(declared.bytes)} bytes, but ${declared.because} — that count is not these bytes`;
}

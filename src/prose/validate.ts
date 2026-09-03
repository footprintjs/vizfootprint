/**
 * The ONE prose validator behind the three doors: the def door (a whole
 * `prose[]` list, throws), dispatch (one record, refuses as a gap), lint
 * (every declared slot, listed). Shape first, then the laws: agent-written
 * words state a basis; an agent never states a cause; a basis names only
 * columns on the branch and analyses that are declared.
 */
import { AUTHOR_KINDS, CLAIM_LEVELS, DASHBOARD_PROSE_ID, PROSE_SLOTS, isNoteSubject } from './types.js';
import type { ProseProblem, ProseRecord, ProseSlot } from './types.js';
import { PROSE_SENTENCES, fillProse } from './sentences.js';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * How a refusal names a ref's dead target. A ref carries an ID and may SHOW
 * words, and the sentence says both: the words alone can name a record that
 * does exist (a restore re-identified `p3` to `p5`, the words still say
 * "coastal", and a picture called "coastal" is right there in the list — the
 * old sentence read as if it were missing). With no words the id alone says
 * nothing to a person, so the records that DO exist ride along, the way every
 * other refusal in the house lists them.
 */
function deadRef(id: string, label: string | undefined, noun: 'pictures' | 'beats', names: readonly string[] | undefined): string {
  if (label !== undefined) return `"${label}" (${id})`;
  if (names === undefined) return `"${id}"`;
  return `"${id}" — the ${noun} are ${names.length > 0 ? names.map((n) => `"${n}"`).join(', ') : 'none'}`;
}

/** What the validator may check a basis against; absent = cannot judge (the def door before data), never refuse on ignorance. */
export interface ProseWorld {
  readonly columns?: ReadonlySet<string>;
  readonly analyses?: ReadonlySet<string>;
  /** The views that declare an encoding surface — a derived slot has nothing to derive from on any other. */
  readonly surfaced?: ReadonlySet<string>;
  /** The commit ids the log holds — a ref may only point at one of them. */
  readonly commits?: ReadonlySet<string>;
  /** The tag IDS the store holds — a `beat` ref may only point at one of them (ids, not names: a rename must not turn a good ref bad). */
  readonly beats?: ReadonlySet<string>;
  /** The tag NAMES the store holds, for the refusal sentence when a dead ref shows no words; absent = the sentence names the id alone. */
  readonly beatNames?: readonly string[];
  /** The saved-selection IDS the store holds; absent = not judged. */
  readonly saved?: ReadonlySet<string>;
  /** The picture NAMES the store holds — the same courtesy as {@link ProseWorld.beatNames}. */
  readonly savedNames?: readonly string[];
  /** `proposal` when the record is being proposed for a person to accept; `set` (the default) when it is being stated as the words. */
  readonly mode?: 'set' | 'proposal';
}

/** One record judged: every problem, shape before law. */
export function validateProseRecord(viewId: string, slot: string, raw: unknown, world: ProseWorld = {}): ProseProblem[] {
  const problems: ProseProblem[] = [];
  const at = (rule: string, template: string, extra: Record<string, string | undefined> = {}): void => {
    problems.push({ viewId, slot, rule, sentence: fillProse(template, { view: viewId, slot, slots: PROSE_SLOTS.join(', '), levels: CLAIM_LEVELS.join(', '), kinds: AUTHOR_KINDS.join(', '), ...extra }) });
  };
  if (!(PROSE_SLOTS as readonly string[]).includes(slot)) {
    at('slot', PROSE_SENTENCES.slot);
    return problems;
  }
  if (!isObject(raw)) {
    at('record', PROSE_SENTENCES.record);
    return problems;
  }
  const r = raw;
  const author = isObject(r.author) ? r.author : undefined;
  const kind = author !== undefined && (AUTHOR_KINDS as readonly unknown[]).includes(author.kind) ? (author.kind as ProseRecord['author']['kind']) : undefined;
  if (kind === undefined) at('author', PROSE_SENTENCES.author);
  else {
    for (const field of ['by', 'model', 'at', 'commitId'] as const) {
      if (author![field] !== undefined && typeof author![field] !== 'string') at('author', PROSE_SENTENCES.authorField, { field });
    }
  }
  if (r.text !== undefined && typeof r.text !== 'string') at('text', PROSE_SENTENCES.textType);
  else if (kind === 'derived' && r.text !== undefined) at('text', PROSE_SENTENCES.derivedText);
  else if (kind !== 'derived' && kind !== undefined && (r.text === undefined || r.text.length === 0) && r.role !== 'decorative') at('text', PROSE_SENTENCES.text);
  const levels = r.levels;
  if (levels !== undefined && !(Array.isArray(levels) && levels.every((l) => (CLAIM_LEVELS as readonly unknown[]).includes(l)))) at('levels', PROSE_SENTENCES.levels);
  if (r.role !== undefined && r.role !== 'informative' && r.role !== 'decorative') at('role', PROSE_SENTENCES.role);
  if (r.basis !== undefined && !isObject(r.basis)) at('basis', PROSE_SENTENCES.basis);
  const basis = isObject(r.basis) ? r.basis : undefined;
  if (basis?.columns !== undefined && !(Array.isArray(basis.columns) && basis.columns.every((c) => typeof c === 'string'))) at('basis', PROSE_SENTENCES.basisColumns);
  // a basis is judged by byte-equality against the live filters (an object keyed by view): a list can never match, so it is refused here, not left to go stale
  if (basis?.filters !== undefined && !isObject(basis.filters)) at('basis', PROSE_SENTENCES.basisFilters);
  // the laws
  if (kind === 'agent' && basis === undefined) at('agent-basis', PROSE_SENTENCES.agentBasis);
  if (kind === 'agent' && Array.isArray(levels) && levels.includes('causal')) at('agent-causal', PROSE_SENTENCES.agentCausal);
  // the model's permission follows the kind of claim: a perceived trend is proposed, never stated
  if (kind === 'agent' && world.mode === 'set' && Array.isArray(levels) && levels.includes('trend')) at('agent-trend', PROSE_SENTENCES.agentTrend);
  // the dashboard subject: nothing to derive from, nothing bound — judged before the surface rule so the sentence names the reason
  if (viewId === DASHBOARD_PROSE_ID && kind === 'derived') at('dashboard-derived', PROSE_SENTENCES.dashboardDerived);
  else if (isNoteSubject(viewId) && kind === 'derived') at('note-derived', PROSE_SENTENCES.noteDerived);
  else if (kind === 'derived' && world.surfaced !== undefined && !world.surfaced.has(viewId)) at('derived-surface', PROSE_SENTENCES.derivedSurface);
  if (viewId === DASHBOARD_PROSE_ID && basis?.encodings !== undefined) at('dashboard-encodings', PROSE_SENTENCES.dashboardEncodings);
  if (isNoteSubject(viewId) && basis?.encodings !== undefined) at('note-encodings', PROSE_SENTENCES.noteEncodings);
  if (basis !== undefined && Array.isArray(basis.columns) && world.columns !== undefined) {
    for (const column of basis.columns as unknown[]) {
      if (typeof column === 'string' && !world.columns.has(column)) at('basis-column', PROSE_SENTENCES.basisColumn, { column });
    }
  }
  if (basis !== undefined && typeof basis.analysisId === 'string' && world.analyses !== undefined && !world.analyses.has(basis.analysisId)) {
    at('basis-analysis', PROSE_SENTENCES.basisAnalysis, { analysisId: basis.analysisId });
  }
  // refs: a span inside the text, exactly one target, and a target that exists (judged only when the world names it)
  if (r.refs !== undefined) {
    const shape = (ref: unknown): ref is { span: [number, number]; commit?: unknown; beat?: unknown; saved?: unknown; label?: unknown } =>
      isObject(ref) && Array.isArray(ref.span) && ref.span.length === 2 && ref.span.every((n) => Number.isInteger(n) && (n as number) >= 0) && (ref.label === undefined || typeof ref.label === 'string');
    if (!Array.isArray(r.refs) || !r.refs.every(shape)) at('refs', PROSE_SENTENCES.refs);
    else {
      const length = typeof r.text === 'string' ? r.text.length : 0;
      r.refs.forEach((ref, index) => {
        const [start, end] = ref.span;
        const slots = { index: String(index), start: String(start), end: String(end), length: String(length) };
        if (!(start < end && end <= length)) at('ref-span', PROSE_SENTENCES.refSpan, slots);
        const hasCommit = typeof ref.commit === 'string';
        const hasBeat = typeof ref.beat === 'string';
        const hasSaved = typeof ref.saved === 'string';
        if (Number(hasCommit) + Number(hasBeat) + Number(hasSaved) !== 1) at('ref-target', PROSE_SENTENCES.refTarget, slots);
        if (hasCommit && world.commits !== undefined && !world.commits.has(ref.commit as string)) at('ref-commit', PROSE_SENTENCES.refCommit, { ...slots, commit: ref.commit as string });
        // a ref carries an id and may show words: the sentence names both, and the list of what exists when it shows none
        const shown = typeof ref.label === 'string' && ref.label.length > 0 ? ref.label : undefined;
        if (hasBeat && world.beats !== undefined && !world.beats.has(ref.beat as string)) at('ref-beat', PROSE_SENTENCES.refBeat, { ...slots, beat: deadRef(ref.beat as string, shown, 'beats', world.beatNames) });
        if (hasSaved && world.saved !== undefined && !world.saved.has(ref.saved as string)) at('ref-saved', PROSE_SENTENCES.refSaved, { ...slots, saved: deadRef(ref.saved as string, shown, 'pictures', world.savedNames) });
      });
    }
  }
  return problems;
}

/** The def door: the whole `prose[]` list, as sentences appended to the def validator's list. */
export function validateProseDecls(raw: unknown, views: ReadonlySet<string>, problems: string[], world: ProseWorld = {}): void {
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    problems.push('prose, if present, must be an array of { viewId, slots }');
    return;
  }
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    if (!isObject(entry) || typeof entry.viewId !== 'string' || !isObject(entry.slots)) {
      problems.push(`prose[${index}] must be { viewId, slots: { title?, caption?, altShort?, altLong?, howToRead? } }`);
      return;
    }
    if (!views.has(entry.viewId) && entry.viewId !== DASHBOARD_PROSE_ID) problems.push(fillProse(PROSE_SENTENCES.view, { index: String(index), view: entry.viewId }));
    if (seen.has(entry.viewId)) problems.push(fillProse(PROSE_SENTENCES.repeat, { index: String(index), view: entry.viewId }));
    seen.add(entry.viewId);
    for (const [slot, record] of Object.entries(entry.slots)) {
      for (const p of validateProseRecord(entry.viewId, slot, record, world)) problems.push(`prose[${index}].${slot}: ${p.sentence}`);
    }
  });
}

/** True when any problem is present (a prose record has no coercion — every problem refuses). */
export function proseRefuses(problems: readonly ProseProblem[]): boolean {
  return problems.length > 0;
}

export type { ProseSlot };

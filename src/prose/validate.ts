/**
 * The ONE prose validator behind the three doors: the def door (a whole
 * `prose[]` list, throws), dispatch (one record, refuses as a gap), lint
 * (every declared slot, listed). Shape first, then the laws: agent-written
 * words state a basis; an agent never states a cause; a basis names only
 * columns on the branch and analyses that are declared.
 */
import { AUTHOR_KINDS, CLAIM_LEVELS, PROSE_SLOTS } from './types.js';
import type { ProseProblem, ProseRecord, ProseSlot } from './types.js';
import { PROSE_SENTENCES, fillProse } from './sentences.js';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the validator may check a basis against; absent = cannot judge (the def door before data), never refuse on ignorance. */
export interface ProseWorld {
  readonly columns?: ReadonlySet<string>;
  readonly analyses?: ReadonlySet<string>;
  /** The views that declare an encoding surface — a derived slot has nothing to derive from on any other. */
  readonly surfaced?: ReadonlySet<string>;
  /** The commit ids the log holds — a ref may only point at one of them. */
  readonly commits?: ReadonlySet<string>;
  /** The beats named so far — a ref may only point at one of them. */
  readonly beats?: ReadonlySet<string>;
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
  // the laws
  if (kind === 'agent' && basis === undefined) at('agent-basis', PROSE_SENTENCES.agentBasis);
  if (kind === 'agent' && Array.isArray(levels) && levels.includes('causal')) at('agent-causal', PROSE_SENTENCES.agentCausal);
  if (kind === 'derived' && world.surfaced !== undefined && !world.surfaced.has(viewId)) at('derived-surface', PROSE_SENTENCES.derivedSurface);
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
    const shape = (ref: unknown): ref is { span: [number, number]; commit?: unknown; beat?: unknown; label?: unknown } =>
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
        if (hasCommit === hasBeat) at('ref-target', PROSE_SENTENCES.refTarget, slots);
        if (hasCommit && world.commits !== undefined && !world.commits.has(ref.commit as string)) at('ref-commit', PROSE_SENTENCES.refCommit, { ...slots, commit: ref.commit as string });
        if (hasBeat && world.beats !== undefined && !world.beats.has(ref.beat as string)) at('ref-beat', PROSE_SENTENCES.refBeat, { ...slots, beat: ref.beat as string });
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
    if (!views.has(entry.viewId)) problems.push(fillProse(PROSE_SENTENCES.view, { index: String(index), view: entry.viewId }));
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

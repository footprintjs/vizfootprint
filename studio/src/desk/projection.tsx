/**
 * THE PROJECTION — the session, in the shape a cell reads.
 *
 * Every field here is one of exactly two things, and there is no third kind:
 *
 *   1. **a projection** — an answer the session already computed (`shown`,
 *      `columns`, `fits`, the prose, the labels), copied across; or
 *   2. **an ACT** — a door the desk drives on the host's behalf (`seek`,
 *      `applySaved`, `saveSelection`), whose ANSWER, including its refusal, is
 *      printed in the session's own words and never rewritten.
 *
 * Nothing here re-derives a fact from the commit log. That is the adapter's law
 * one tier up (`ui/src/adapter/README.md`, law 1), and it is the same law: if
 * the library knows a fact, copy it; if it does not, the fact belongs in the
 * library, not in a dashboard shell.
 */
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  bookmarkRefTarget,
  boundField,
  selectionForView,
  type FitView,
  type ProseStatusView,
  type RenderSelection,
  type SessionView,
  type SessionViewState,
} from 'vizfootprint-ui';
import { ProseLines, type ProseAnchors } from './prose.js';
import type { DeskProjection } from './types.js';

/** The two acts the desk's own chrome owns and a cell may ask for. */
export interface DeskActs {
  readonly openAside: (tabId: string) => void;
  readonly editChart: (viewId: string) => void;
}

export interface DeskProjectionResult {
  readonly desk: DeskProjection;
  /** What the desk's OWN acts last said went wrong, or null. */
  readonly notice: string | null;
  /** Where a prose ref's anchor goes — shared by the words, the summary and the notes, so all three resolve alike. */
  readonly anchors: ProseAnchors;
}

export function useDeskProjection(input: {
  readonly view: SessionView;
  readonly state: SessionViewState;
  readonly readOnly: boolean;
  readonly acts: DeskActs;
}): DeskProjectionResult {
  const { view, state, readOnly, acts } = input;
  const [notice, setNotice] = useState<string | null>(null);

  const labels = useMemo(() => Object.fromEntries(state.views.map((v) => [v.viewId, v.label ?? v.viewId])), [state.views]);
  const label = useCallback((viewId: string): string => labels[viewId] ?? viewId, [labels]);

  // What each view SHOWS: followed channels laid over its own. Edits still go to `encodings`.
  const shown = state.effectiveEncodings ?? state.encodings;
  const columns = state.columns[state.defaultTable] ?? [];

  const bound = (viewId: string, channel: string, fallback: string): string => boundField(shown[viewId] ?? {}, channel, fallback);
  const selFor = (self: string | null): RenderSelection => selectionForView(state.selections, self, 'intersect', state.links, state.cleared);
  const fitsOf = (viewId: string): Readonly<Record<string, readonly FitView[]>> | undefined => state.views.find((v) => v.viewId === viewId)?.fits;
  const proseOf = (viewId: string): readonly ProseStatusView[] => state.views.find((v) => v.viewId === viewId)?.prose ?? [];
  const altShort = (viewId: string): string | undefined => proseOf(viewId).find((p) => p.slot === 'altShort')?.text;

  /** The words a commit anchor shows on hover — the same sentence everywhere. */
  const describeCommit = (id: string): string | undefined => {
    const c = state.commits.find((x) => x.id === id);
    return c ? `${c.label}${c.intent ? ' — ' + c.intent : ''}` : undefined;
  };

  /**
   * SEEK TO A NAMED BEAT — the ONE resolver every bookmark anchor uses.
   *
   * The library owns it (`bookmarkRefTarget`): it takes the ID a note's
   * `@[bookmark]` link carries first — renaming a bookmark must leave every note
   * working — and still accepts a label, so words written before bookmark ids
   * keep working. A consumer's own `find` reaches for `commitId` and sends the
   * anchor to the ACT of naming while every other seek goes to the moment NAMED.
   */
  const seekBookmark = (ref: string): void => {
    const commitId = bookmarkRefTarget(state.bookmarks, ref);
    if (commitId !== null) void view.seek(commitId);
  };

  /**
   * A saved picture is saved LOGIC, so both doors go through the library's
   * store, never through a commit. Naming lands nothing; applying lands one
   * ordinary commit per condition and is JUDGED FIRST — a picture that could
   * land nothing clears nothing and says why. Both answers are printed: a
   * refusal is the whole point of judging first, and a partial apply must not
   * read as a clean one.
   */
  const applyPicture = (savedId: string): void => {
    void view
      .applySaved(savedId)
      .then((r) => {
        if (!r.ok) return setNotice(r.sentence);
        setNotice(r.refused.length === 0 ? null : `"${r.name}" came back without ${r.refused.map((c) => `${label(c.viewId)} (${c.rejected})`).join('; ')}`);
      })
      .catch((e: unknown) => setNotice(`the picture was not applied: ${e instanceof Error ? e.message : String(e)}`));
  };
  const savePicture = (name: string, what?: { readonly viewId: string }): void => {
    void view
      .saveSelection(name, what ?? { live: 'all' })
      .then((r) => setNotice(r.ok ? null : r.sentence))
      .catch((e: unknown) => setNotice(`the picture was not saved: ${e instanceof Error ? e.message : String(e)}`));
  };

  const anchors: ProseAnchors = { describeCommit, onSeek: view.seek, onBookmark: seekBookmark, onSaved: applyPicture };

  const words = (viewId: string): ReactNode => <ProseLines lines={proseOf(viewId)} anchors={anchors} />;

  const desk: DeskProjection = {
    state,
    view,
    bound,
    selFor,
    fitsOf,
    shown,
    columns,
    label,
    words,
    proseOf,
    altShort,
    readOnly,
    say: setNotice,
    openAside: acts.openAside,
    editChart: acts.editChart,
    seekBookmark,
    applyPicture,
    savePicture,
    describeCommit,
  };

  return { desk, notice, anchors };
}

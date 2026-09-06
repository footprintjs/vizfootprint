/**
 * THE DESK — a whole provenance dashboard, driven by one session view.
 *
 * What it owns: the time strip and the jump box, the dashboard summary and its
 * drafts, the live-selection chips and the saved pictures, the charts band and
 * every affordance on a cell (the ✎, the ✕, the drag grip, the layout), the
 * editor drawer, the notes, the fork toast and the paths modal, present mode and
 * the slideshow, and the report panels whose words are about the SESSION rather
 * than about anybody's data.
 *
 * What it does not own, and will not guess at: the rows. Every cell is the
 * host's, drawn over the projection this file hands it. See `types.ts` for the
 * law and `../../README.md` for the argument.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BranchPill,
  CommitLog,
  ForkToast,
  PathsModal,
  SavedSelections,
  SelectionChips,
  TimeTravelBar,
  VizCockpit,
  bookmarkTarget,
  currentBookmarkIndex,
  orderedBookmarks,
  useSessionView,
  type CockpitChart,
  type CockpitMenuItem,
  type CockpitReport,
  type SessionView,
} from 'vizfootprint-ui';
import { ChartEditor } from 'vizfootprint-ui/editor';
import { JumpBox } from './JumpBox.js';
import { WindowReadout } from './WindowReadout.js';
import { DashboardSummary } from './prose.js';
import { useNoteCells } from './notes.js';
import { useDeskProjection } from './projection.js';
import { DataPanel } from './panels/DataPanel.js';
import { PathsPanel } from './panels/PathsPanel.js';
import { ProposalsPanel } from './panels/ProposalsPanel.js';
import { SilencesPanel } from './panels/SilencesPanel.js';
import { StoryPanel, useStoryPost } from './panels/StoryPanel.js';
import { deskTokenStyle, T } from './tokens.js';
import type { DeskProps } from './types.js';

/** The editor tab is the desk's own and is always last — a host's tabs come first, as its menu items come after. */
const EDIT_TAB = 'edit';

/**
 * The session, and who is answerable for it.
 *
 * A LIVE view passed in belongs to the host — the story page made the session
 * and will dispose of it. A FACTORY belongs to the desk: it is called once on
 * mount and disposed on unmount, which is the only way a `front` slot can keep
 * its own law (a landing page must not have a poll running behind it).
 */
function useOwnedView(input: SessionView | (() => SessionView)): SessionView {
  const factory = typeof input === 'function' ? input : null;
  // created once, on mount — the factory is not a dependency, it is a constructor
  const created = useMemo(() => (factory === null ? null : factory()), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => created?.dispose(), [created]);
  return created ?? (input as SessionView);
}

export function Desk(props: DeskProps): ReactNode {
  const hasFront = props.front !== undefined;
  const [entered, setEntered] = useState(!hasFront);
  // NOTHING of the desk is mounted until the reader goes in — not the poll, not
  // the charts, not the host's own reads. A landing page that offered a way in
  // while the dashboard was already fetching behind it would be reporting
  // something it did not yet know.
  if (!entered && props.front !== undefined) return <>{props.front(() => setEntered(true))}</>;
  return <DeskBody {...props} />;
}

function DeskBody(props: DeskProps): ReactNode {
  const view = useOwnedView(props.view);
  const state = useSessionView(view);

  const [mode, setMode] = useState<'explore' | 'present'>('explore');
  // Present mode as a slideshow: the dashboard is the slide, prev/next seek the named bookmarks, interactions stay off
  const [showing, setShowing] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [asideTab, setAsideTab] = useState<string>(EDIT_TAB);
  const [asideOpen, setAsideOpen] = useState(false);
  // A fork is only reversible if it is VISIBLE — the pill says which path you
  // are on, the toast says one was just born, and this modal is the way back.
  const [pathsOpen, setPathsOpen] = useState(false);
  const readOnly = mode === 'present';
  /** The one act two affordances share: the pill in the time strip and the fork toast. */
  const openPaths = (): void => setPathsOpen(true);

  const openAside = (tabId: string): void => {
    setAsideTab(tabId);
    setAsideOpen(true);
  };
  const editChart = (viewId: string): void => {
    setEditing(viewId);
    openAside(EDIT_TAB);
  };

  const { desk, notice, anchors } = useDeskProjection({ view, state, readOnly, acts: { openAside, editChart } });
  const notes = useNoteCells({ state, view, readOnly, by: 'you', anchors });

  // Called ONCE, unconditionally, from this body — so a host may (and for a real
  // table should) memoize its arithmetic with hooks inside it.
  const cells = props.charts(desk);

  // SET-1: which views hold a LIVE clause (the ✕ pill on the chart). `cleared` is `null`, whatever the kind.
  const liveViews = useMemo(() => new Set(state.selections.filter((s) => s.value !== null).map((s) => s.viewId)), [state.selections]);
  const chartCells: CockpitChart[] = cells.map((c) => ({
    id: c.id,
    ...(c.weight !== undefined ? { weight: c.weight } : {}),
    ...(c.caption !== undefined ? { caption: c.caption } : {}),
    render: c.render,
    active: liveViews.has(c.id),
    onClear: () => void view.clear(c.id, `clear ${desk.label(c.id)}`),
    onEdit: () => editChart(c.id),
  }));

  // ── the slideshow: the bookmarks are the slides ──
  const bookmarks = orderedBookmarks(state.bookmarks, state.commits, state.head);
  const rawBookmarkIndex = currentBookmarkIndex(state.bookmarks, state.commits, state.cursor, state.head); // -1 = the cursor is off the story
  const bookmarkIndex = Math.max(0, rawBookmarkIndex);
  // a seek is asynchronous: two fast presses target from the bookmark already asked for, never the one still on screen
  const pending = useRef<number | null>(null);
  useEffect(() => {
    if (pending.current === rawBookmarkIndex) pending.current = null;
  }, [rawBookmarkIndex]);
  const goBookmark = (i: number): Promise<void> => {
    const b = bookmarks[i];
    if (b === undefined) return Promise.resolve();
    pending.current = i;
    // a seek that fails must not leave a target the presenter never reached
    return view.seek(bookmarkTarget(b) as string).then(
      () => undefined,
      () => {
        pending.current = null;
      },
    );
  };
  const stepBookmark = (by: number): void => void goBookmark((pending.current ?? bookmarkIndex) + by);
  // entering the show from a cursor that reaches no bookmark begins at the first — never a slide the dashboard is not showing
  const startShow = (): void => {
    setMode('present');
    if (rawBookmarkIndex < 0) void goBookmark(0).then(() => setShowing(true));
    else setShowing(true);
  };
  const dashCaption = state.dashboard?.prose.find((p) => p.slot === 'caption');
  const slideshow =
    showing && mode === 'present' && bookmarks.length > 0
      ? {
          active: true,
          /* v8 ignore next -- `bookmarkIndex` is an index INTO `bookmarks`, clamped at 0, and the slideshow is only built when there is at least one; the empty title cannot be reached */
          title: bookmarks[bookmarkIndex]?.label ?? '',
          ...(dashCaption !== undefined ? { words: dashCaption.text } : {}),
          index: bookmarkIndex,
          count: bookmarks.length,
          onPrev: () => stepBookmark(-1),
          onNext: () => stepBookmark(1),
          onExit: () => setShowing(false),
        }
      : undefined;

  // ── start fresh ──
  // The reset door is the host's (only it knows what a fresh desk means on its
  // own server); what the DESK clears is what the desk owns. Asked first,
  // because a cleared log cannot be walked back to.
  const startFresh = (): void => {
    if (!window.confirm('Clear every commit and start fresh? The data stays; the log is emptied.')) return;
    void Promise.resolve(props.onReset?.())
      .then(() => {
        setAsideOpen(false); // the drawer belonged to the session that just ended
        notes.clear(); // the unsaved notes were opened against a log that no longer exists
        return view.refresh(); // show the empty log now, not at the next poll
      })
      .catch((e: unknown) => desk.say(`the reset did not run: ${e instanceof Error ? e.message : String(e)}`));
  };

  // ── the desk's own menu ──
  const editable = state.views.filter((v) => chartCells.some((c) => c.id === v.viewId));
  const ownMenu: CockpitMenuItem[] = [
    { id: 'edit', label: 'Edit a chart', icon: '✎', hint: 'or hover a chart and press its ✎', onSelect: () => editChart(editing ?? editable[0]?.viewId ?? chartCells[0]?.id ?? '') },
    // the WHOLE picture, every live clause of it — a saved selection is one condition per view, not one view's clause
    {
      id: 'save',
      label: 'Save selection',
      icon: '💾',
      disabled: state.selections.length === 0 || readOnly,
      hint: state.selections.length === 0 ? 'nothing is selected' : `keep all ${String(state.selections.length)} live selections as one named picture`,
      onSelect: () => {
        const name = window.prompt('Save everything selected as…');
        if (name?.trim()) desk.savePicture(name.trim());
      },
    },
    { id: 'paths', label: `Paths${state.paths.list.length > 1 ? ` (${String(state.paths.list.length)})` : ''}`, icon: '⎇', hint: 'every line of work on this desk — switch back to any of them', onSelect: openPaths },
    // A bookmark is only a slide on ITS OWN path: "name a bookmark first" is a
    // lie when you have named three and walked onto another lane, so say which
    // of the two is actually true.
    {
      id: 'present',
      label: mode === 'present' ? 'Back to Explore' : 'Present the bookmarks',
      icon: '▶',
      disabled: mode !== 'present' && bookmarks.length === 0,
      hint: mode === 'present' || bookmarks.length > 0 ? undefined : state.bookmarks.length > 0 ? 'your bookmarks are on another path — switch to it (⎇ Paths) to present them' : 'name a bookmark first — the bookmarks are the slides',
      onSelect: () => {
        if (mode === 'present') {
          setShowing(false);
          setMode('explore');
        } else startShow();
      },
    },
    { id: 'text', label: 'Text tool', icon: '¶', disabled: readOnly, hint: 'a note on the dashboard — its words link to selections, bookmarks and commits', onSelect: notes.open },
    ...(props.onReset === undefined ? [] : [{ id: 'reset', label: 'Start fresh', icon: '↺', disabled: readOnly, hint: 'clear every commit and begin again — the data stays, the log is emptied', onSelect: startFresh } as CockpitMenuItem]),
  ];

  // ── the desk's own reports ──
  const story = props.story;
  const post = useStoryPost(state, story ?? {});
  const ownReports: CockpitReport[] = [
    ...(props.silences === undefined ? [] : [{ id: 'silences', title: 'The silences', icon: '🔇', badge: props.silences.groups.reduce((n, s) => n + s.total, 0), content: <SilencesPanel silences={props.silences} /> }]),
    ...(props.proposals === undefined ? [] : [{ id: 'proposals', title: 'Agent proposals', icon: '⚖️', badge: props.proposals.rows.length, content: <ProposalsPanel proposals={props.proposals} readOnly={readOnly} onDone={() => void view.refresh()} /> }]),
    { id: 'commits', title: 'Commit log', icon: '🧾', badge: state.commits.length, content: <CommitLog commits={state.commits} onSeek={view.seek} /> },
    { id: 'branches', title: 'Paths', icon: '⎇', badge: state.paths.list.length, content: <PathsPanel state={state} view={view} readOnly={readOnly} /> },
    ...(props.data === undefined ? [] : [{ id: 'data', title: 'Data', icon: '▦', badge: state.tables?.length ?? 0, content: <DataPanel data={props.data} state={state} view={view} readOnly={readOnly} /> }]),
    ...(story === undefined ? [] : [{ id: 'story', title: 'Story', icon: '📖', badge: post.meta.bookmarkCount, content: <StoryPanel post={post} session={view} cells={cells} story={story} /> }]),
  ];

  const asideTabs = [
    ...(props.aside ?? []),
    {
      id: EDIT_TAB,
      label: '✎ Edit',
      title: `Edit ${editing !== null ? desk.label(editing) : ''}`,
      render: () => (
        <>
          <label style={{ display: 'block', fontSize: T.textMd, marginBottom: T.pad }}>
            Chart{' '}
            <select value={editing ?? ''} onChange={(e) => setEditing(e.target.value)} style={{ font: 'inherit', fontSize: T.textLg }}>
              {editable.map((v) => (
                <option key={v.viewId} value={v.viewId}>
                  {desk.label(v.viewId)}
                </option>
              ))}
            </select>
          </label>
          {editing !== null && state.views.some((v) => v.viewId === editing) ? (
            <ChartEditor
              view={state.views.find((v) => v.viewId === editing)!}
              links={state.links}
              labels={Object.fromEntries(state.views.map((v) => [v.viewId, desk.label(v.viewId)]))}
              by="you"
              readOnly={readOnly}
              onDescribe={view.describe}
              onReencode={view.reencode}
              onLink={(edge) => void view.link(edge, `${desk.label(edge.source)} ${edge.kind} → ${desk.label(edge.target)}: ${edge.response ?? 'back'}`)}
              onAccept={view.acceptProposal}
              onDecline={view.declineProposal}
            />
          ) : null}
        </>
      ),
    },
  ];
  const openTab = asideTabs.find((t) => t.id === asideTab) ?? asideTabs[asideTabs.length - 1]!;

  return (
    <VizCockpit
      className={['vzfs', props.className].filter(Boolean).join(' ')}
      style={deskTokenStyle(props.tokens)}
      readOnly={readOnly}
      status={props.status ?? <WindowReadout />}
      menu={props.menu === undefined ? ownMenu : props.menu(desk, ownMenu)}
      slideshow={slideshow}
      aside={{
        open: asideOpen,
        title: openTab.title ?? (typeof openTab.label === 'string' ? openTab.label : openTab.id),
        onClose: () => setAsideOpen(false),
        children: (
          <>
            {asideTabs.length > 1 ? (
              <div role="tablist" aria-label="side panel" style={{ display: 'flex', gap: T.gapSm, marginBottom: T.pad }}>
                {asideTabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={openTab.id === t.id}
                    onClick={() => setAsideTab(t.id)}
                    style={{ font: 'inherit', fontSize: T.textMd, padding: '4px 10px', borderRadius: T.radius, border: `1px solid ${T.rule}`, background: openTab.id === t.id ? T.tabOn : T.paper, cursor: 'pointer' }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            ) : null}
            {openTab.render(desk)}
          </>
        ),
      }}
      layout={state.layout}
      onLayoutChange={(change) => void view.setLayout(change)}
      top={
        <div style={{ display: 'flex', alignItems: 'center', gap: T.gap, flexWrap: 'wrap' }}>
          <TimeTravelBar
            compact
            mode={mode}
            onModeChange={setMode}
            commits={state.commits}
            cursor={state.cursor}
            head={state.head}
            bookmarks={state.bookmarks}
            branches={state.branches}
            viewingPast={state.viewingPast}
            // the rail draws ONE path; these two say which, so eleven bars where
            // fifty-three stood reads as a fork and not as data loss
            {...(state.paths.current !== null ? { pathName: state.paths.current } : {})}
            pathPill={<BranchPill paths={state.paths} onClick={openPaths} />}
            onSeek={view.seek}
            onStepBack={view.stepBack}
            onStepForward={view.stepForward}
            onNameBookmark={view.bookmark}
            onPlay={startShow}
            onReturnToNow={view.returnToNow}
          />
          <JumpBox commitIds={state.commits.map((c) => c.id)} onSeek={view.seek} />
          <DashboardSummary
            dashboard={state.dashboard}
            readOnly={readOnly}
            anchors={anchors}
            onAccept={(proposal) => void view.acceptProposal('dashboard', 'caption', proposal)}
            onDecline={(proposal, reason) => void view.declineProposal('dashboard', 'caption', proposal, reason)}
          />
          <SelectionChips
            selections={state.selections}
            cleared={state.cleared}
            links={state.links}
            labels={Object.fromEntries(state.views.map((v) => [v.viewId, desk.label(v.viewId)]))}
            readOnly={readOnly}
            onClear={(id) => void view.clear(id, `clear ${desk.label(id)}`)}
            // NOT point-free, and the one place in this file that is not. The
            // chip strip wires this straight to a DOM handler, so a bare
            // `view.clearAll` receives the click EVENT as its first argument —
            // which `clearAll(intent?)` then tries to file as the commit's
            // words. A forwarding wrapper is only safe where the caller passes
            // the arguments the door actually takes.
            onClearAll={() => void view.clearAll()}
            onSetPolarity={(id, exclude) => void view.setPolarity(id, exclude, `${exclude ? 'exclude' : 'keep'} the ${desk.label(id)} selection`)}
            onSave={(id) => {
              const name = window.prompt(`Save the ${desk.label(id)} selection as…`);
              if (name && name.trim()) desk.savePicture(name.trim(), { viewId: id });
            }}
          />
          <SavedSelections saved={state.saved} selections={state.selections} labels={Object.fromEntries(state.views.map((v) => [v.viewId, desk.label(v.viewId)]))} readOnly={readOnly} onApply={desk.applyPicture} />
        </div>
      }
      toast={
        <>
          {/* the desk's own refusals and the host's own doors, in the same line and the same words */}
          {notice === null ? null : (
            <div role="alert" style={{ padding: T.pad, fontSize: T.textLg }}>
              ⚠ {notice}
            </div>
          )}
          {props.notice === null || props.notice === undefined ? null : (
            <div role="alert" style={{ padding: T.pad, fontSize: T.textLg }}>
              ⚠ {props.notice}
            </div>
          )}
          {/* acting from a past cursor forks: the toast names the new path the moment it is born, and offers the way back */}
          <ForkToast events={state.paths.events} onOpenPaths={openPaths} />
          <PathsModal
            open={pathsOpen}
            onClose={() => setPathsOpen(false)}
            paths={state.paths}
            cursor={state.cursor}
            readOnly={readOnly}
            onSwitch={view.switchPath}
            onRename={view.renamePath}
            onNewPath={view.newPathAt}
            onArchive={view.archivePath}
            onRestore={view.restorePath}
          />
        </>
      }
      // notes join AFTER the charts — the same place a saved arrangement puts
      // anything it has not seen (`orderCharts` puts unknown ids last), so a new
      // note lands in one place either way
      charts={[...chartCells, ...notes.cells]}
      reports={props.reports === undefined ? ownReports : props.reports(desk, ownReports)}
    />
  );
}

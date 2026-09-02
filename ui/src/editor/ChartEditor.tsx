/**
 * `<ChartEditor>` — one chart's editable fields, each an act that lands as a
 * commit through the host (this component never talks to a session — the
 * matrix's law). Three sections, three planes:
 *
 *   - WORDS (the prose plane): every slot the chart may carry, with who wrote
 *     it and whether it went stale; save = `describe`, "back to the
 *     declaration" = `describe` with null. A derived slot is the library's
 *     and reads only.
 *   - CHANNELS (the encoding plane): each channel with the columns that fit
 *     it, refused ones greyed with the session's sentence; a followed channel
 *     belongs to its edge and says so.
 *   - LINKS (the data plane): the edges into and out of this chart, each with
 *     the responses its kind allows; null = back to the rule.
 */
import { useState } from 'react';
import type { LinkGraphView, ProposalView, ProseStatusView, ViewView } from '../adapter/types.js';
import type { LinkEdit } from '../adapter/sessionView.js';
import { responsesFor } from '../links/LinkMatrix.js';

export const EDITOR_SLOTS: readonly ProseStatusView['slot'][] = ['title', 'caption', 'altShort', 'altLong', 'howToRead'];

/** What a slot's record looks like after a person saves it here: the person as author, or a person editing an agent's draft (its basis kept). */
export function editedRecord(text: string, current: ProseStatusView | undefined, by?: string): Record<string, unknown> {
  const fromAgent = current?.author.kind === 'agent' || current?.author.kind === 'humanEdited';
  return {
    text,
    author: { kind: fromAgent ? 'humanEdited' : 'human', ...(by !== undefined ? { by } : {}), ...(fromAgent && current?.author.model !== undefined ? { model: current.author.model } : {}) },
    ...(current !== undefined && current.levels.length > 0 ? { levels: current.levels } : {}),
    ...(fromAgent && current?.basis !== undefined ? { basis: current.basis } : {}),
  };
}

export interface ChartEditorProps {
  readonly view: ViewView;
  readonly links?: LinkGraphView;
  /** viewId → display label. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Who is editing (rides the record's author). */
  readonly by?: string;
  readonly readOnly?: boolean;
  readonly onDescribe?: (viewId: string, slot: ProseStatusView['slot'], record: Readonly<Record<string, unknown>> | null) => void;
  readonly onReencode?: (viewId: string, channel: string, field: string) => void;
  readonly onLink?: (edge: LinkEdit) => void;
  /** The author port: accept an open proposal (by its commit id) — its words land on the slot. */
  readonly onAccept?: (viewId: string, slot: ProseStatusView['slot'], proposal: string) => void;
  /** The author port: decline an open proposal with a reason that stays on the record. */
  readonly onDecline?: (viewId: string, slot: ProseStatusView['slot'], proposal: string, reason: string) => void;
  readonly className?: string;
}

export function ChartEditor({ view, links, labels = {}, by, readOnly = false, onDescribe, onReencode, onLink, onAccept, onDecline, className }: ChartEditorProps): JSX.Element {
  const name = (id: string): string => labels[id] ?? id;
  const prose = new Map((view.prose ?? []).map((p) => [p.slot, p] as const));
  const channels = Object.keys(view.fits ?? view.encoding);
  const shown = view.effective?.bindings ?? view.encoding;
  const edges = (links?.edges ?? []).filter((e) => e.source === view.viewId || e.target === view.viewId);
  return (
    <div className={`vzf vzf-editor${className ? ' ' + className : ''}`} data-vzf="chart-editor">
      <section className="vzf-editor-section" aria-label="words">
        <h4 className="vzf-editor-h">Words</h4>
        {EDITOR_SLOTS.map((slot) => (
          <SlotField key={slot} viewId={view.viewId} slot={slot} current={prose.get(slot)} by={by} readOnly={readOnly} onDescribe={onDescribe} />
        ))}
      </section>
      {(view.proposals ?? []).length > 0 ? (
        <section className="vzf-editor-section" aria-label="proposals">
          <h4 className="vzf-editor-h">Proposals</h4>
          {view.proposals!.map((p) => (
            <ProposalRow key={`${p.slot}:${p.proposal}`} viewId={view.viewId} proposal={p} readOnly={readOnly} onAccept={onAccept} onDecline={onDecline} />
          ))}
        </section>
      ) : null}
      {channels.length > 0 ? (
        <section className="vzf-editor-section" aria-label="channels">
          <h4 className="vzf-editor-h">Channels</h4>
          {channels.map((channel) => {
            const followed = view.effective?.followed[channel];
            const refused = view.effective?.refused[channel];
            const fits = view.fits?.[channel] ?? [];
            const current = shown[channel];
            return (
              <div key={channel} className="vzf-editor-row">
                <label className="vzf-editor-label">
                  <code>{channel}</code>
                  {followed !== undefined ? <span className="vzf-soft"> follows {name(followed.from)}.{followed.sourceChannel}</span> : null}
                </label>
                <select
                  className="vzf-editor-select"
                  aria-label={`${channel} channel`}
                  value={current ?? ''}
                  disabled={readOnly || followed !== undefined || onReencode === undefined}
                  title={followed !== undefined ? `follows ${followed.from} through ${followed.edge} — change the edge, not the channel` : undefined}
                  onChange={(e) => {
                    if (e.target.value !== '' && e.target.value !== current) onReencode?.(view.viewId, channel, e.target.value);
                  }}
                >
                  {current === undefined ? <option value="">(unbound)</option> : null}
                  {fits.length === 0 && current !== undefined ? <option value={current}>{current}</option> : null}
                  {fits.map((f) => (
                    <option key={f.field} value={f.field} disabled={!f.ok} title={f.ok ? undefined : f.because}>
                      {f.field}
                      {f.ok ? '' : ' — ' + (f.because ?? 'does not fit')}
                    </option>
                  ))}
                </select>
                {refused !== undefined ? (
                  <div className="vzf-editor-note" title={refused.sentence}>
                    refused to follow "{refused.field}": {refused.sentence}
                  </div>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}
      {edges.length > 0 ? (
        <section className="vzf-editor-section" aria-label="links">
          <h4 className="vzf-editor-h">Links</h4>
          {edges.map((e) => (
            <div key={e.id} className="vzf-editor-row">
              <label className="vzf-editor-label">
                {name(e.source)} <span className="vzf-mono vzf-soft">{e.kind}</span> → {name(e.target)}
                {e.kind === 'encoding' && e.channels !== undefined ? <span className="vzf-soft"> ({e.channels.map((c) => (c.from === c.to ? c.from : `${c.from}→${c.to}`)).join(', ') || 'no shared channel'})</span> : null}
              </label>
              <select
                className="vzf-editor-select"
                aria-label={`${e.source} ${e.kind} → ${e.target}`}
                value={e.response}
                disabled={readOnly || onLink === undefined}
                onChange={(ev) => onLink?.({ source: e.source, kind: e.kind, target: e.target, response: ev.target.value === 'rule' ? null : (ev.target.value as LinkEdit['response']) })}
              >
                {e.origin === 'edited' ? <option value="rule">{e.kind === 'encoding' ? 'back to the declaration' : 'back to the rule'}</option> : null}
                {responsesFor(e.kind).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <span className={`vzf-editor-origin vzf-editor-${e.origin}`}>{e.origin}</span>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

function ProposalRow({ viewId, proposal: p, readOnly, onAccept, onDecline }: { viewId: string; proposal: ProposalView; readOnly: boolean; onAccept?: ChartEditorProps['onAccept']; onDecline?: ChartEditorProps['onDecline'] }): JSX.Element {
  const [reason, setReason] = useState('');
  const who = `${p.author.kind === 'agent' ? 'the analyst' : p.author.kind}${p.author.model ? ' · ' + p.author.model : ''}`;
  return (
    <div className={`vzf-editor-row vzf-editor-proposal vzf-editor-proposal-${p.status}`} data-proposal={p.proposal}>
      <div className="vzf-editor-label">
        <code>{p.slot}</code> <span className="vzf-soft">proposed by {who}</span>{' '}
        <span className={`vzf-editor-status vzf-editor-${p.status}`}>{p.status}{p.status === 'declined' && p.reason ? ` — ${p.reason}` : ''}</span>
      </div>
      <div className="vzf-editor-draft">{p.text}</div>
      {p.status === 'open' && !readOnly && (onAccept !== undefined || onDecline !== undefined) ? (
        <div className="vzf-editor-actions">
          {onAccept !== undefined ? (
            <button type="button" className="vzf-editor-save" onClick={() => onAccept(viewId, p.slot, p.proposal)}>
              Accept
            </button>
          ) : null}
          {onDecline !== undefined ? (
            <>
              <input className="vzf-editor-reason" aria-label={`reason to decline ${p.slot}`} placeholder="why not" value={reason} onChange={(e) => setReason(e.target.value)} />
              <button type="button" className="vzf-editor-reset" disabled={reason.trim().length === 0} onClick={() => { onDecline(viewId, p.slot, p.proposal, reason.trim()); setReason(''); }}>
                Decline
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SlotField({ viewId, slot, current, by, readOnly, onDescribe }: { viewId: string; slot: ProseStatusView['slot']; current: ProseStatusView | undefined; by?: string; readOnly: boolean; onDescribe?: ChartEditorProps['onDescribe'] }): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? current?.text ?? '';
  const derived = current?.author.kind === 'derived';
  const dirty = draft !== null && draft !== (current?.text ?? '');
  return (
    <div className="vzf-editor-row" data-slot={slot}>
      <label className="vzf-editor-label" htmlFor={`vzf-slot-${viewId}-${slot}`}>
        <code>{slot}</code>
        {current !== undefined ? (
          <span className={`vzf-editor-status vzf-editor-${current.status}`} title={current.status === 'stale' ? `moved: ${current.changed.join(', ')}` : current.author.kind}>
            {' '}
            {current.status === 'stale' ? `stale · ${current.changed.join(', ')} moved` : current.status === 'derived' ? 'derived by the library' : current.author.kind === 'agent' ? 'by the analyst' : current.author.kind}
          </span>
        ) : null}
      </label>
      {derived ? (
        <div className="vzf-editor-derived">{current?.text}</div>
      ) : (
        <textarea id={`vzf-slot-${viewId}-${slot}`} className="vzf-editor-text" rows={slot === 'altLong' ? 4 : 2} value={text} readOnly={readOnly || onDescribe === undefined} onChange={(e) => setDraft(e.target.value)} />
      )}
      {!derived && !readOnly && onDescribe !== undefined ? (
        <div className="vzf-editor-actions">
          <button
            type="button"
            className="vzf-editor-save"
            disabled={!dirty || text.trim().length === 0}
            onClick={() => {
              onDescribe(viewId, slot, editedRecord(text, current, by));
              setDraft(null);
            }}
          >
            Save
          </button>
          {current !== undefined ? (
            <button type="button" className="vzf-editor-reset" onClick={() => { onDescribe(viewId, slot, null); setDraft(null); }}>
              back to the declaration
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

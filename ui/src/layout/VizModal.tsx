/**
 * `<VizModal>` — the ONE modal surface for the whole library. Reports, prompts,
 * and the encoding picker all ride it; there are no duplicate modal systems.
 *
 * The look is FROSTED GLASS on both themes: the backdrop is a translucent scrim
 * (`--vzf-scrim`) with a backdrop blur, and the dialog itself sits on a
 * translucent glass surface (`--vzf-glass`) — the dark palette raises the scrim
 * opacity so contrast holds when blurring over dark content.
 *
 * Behavior (the tested contract, lifted verbatim from the original
 * EncodingPicker modal): `role="dialog" aria-modal` labelled by the title,
 * focus moves IN on open (the `initialFocus` selector first, else the first
 * focusable), Tab is trapped at the edges in both directions, Esc and a
 * backdrop click close, and focus RESTORES to the opener — HTML **or SVG**
 * (an axis label is an SVG node, and the keyboard must come back to it).
 *
 * Two sizes: `'small'` (a prompt — the checkpoint namer, the encoding picker)
 * and `'large'` (a report surface, ~min(92vw, 1100px) × 82vh); in both, any
 * overflow scrolls INSIDE `.vzf-modal-body` — never the page.
 */
import { useCallback, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

export interface VizModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title?: ReactNode;
  /** 'small' (default) = a prompt; 'large' = a report surface. */
  readonly size?: 'small' | 'large';
  /** Stamped as `data-vzf-modal` on the backdrop so tests/consumers can target this modal. */
  readonly name?: string;
  /** CSS selector for the element to receive focus on open (falls back to the first focusable). */
  readonly initialFocus?: string;
  /** Override the generated title id (`aria-labelledby`). */
  readonly titleId?: string;
  /** Optional action row pinned under the body (e.g. Cancel / Save). */
  readonly footer?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])';

export function VizModal(props: VizModalProps): JSX.Element | null {
  const { open, onClose, size = 'small', initialFocus } = props;
  const modalRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<Element | null>(null);
  const autoId = useId();
  const titleId = props.titleId ?? `vzf-modal-title-${autoId}`;

  // focus management: remember the opener, focus in, restore on close
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const target =
      (initialFocus ? modalRef.current?.querySelector<HTMLElement>(initialFocus) : null) ??
      modalRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => {
      // The opener may be an SVG node — every axis label is one. Both HTML and
      // SVG elements carry `focus()` (the HTMLOrSVGElement mixin), so the guard
      // asks for the KIND of element it can focus, not for HTMLElement alone:
      // the old `instanceof HTMLElement` test was false for an SVG opener and
      // dropped keyboard focus on the floor (it fell back to <body>).
      const opener = restoreRef.current;
      if (opener instanceof HTMLElement || opener instanceof SVGElement) opener.focus();
    };
  }, [open, initialFocus]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(modalRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div
      className={`vzf-modal-backdrop vzf-modal-${size}`}
      data-vzf-modal={props.name}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`vzf-modal${props.className ? ' ' + props.className : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={modalRef}
        onKeyDown={onKeyDown}
      >
        <div className="vzf-modal-head">
          <span className="vzf-modal-title" id={titleId}>
            {props.title}
          </span>
          <button type="button" className="vzf-btn vzf-btn-ghost" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="vzf-modal-body">{props.children}</div>
        {props.footer !== undefined && <div className="vzf-modal-foot">{props.footer}</div>}
      </div>
    </div>
  );
}

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredFocus } from './deferredFocus.js';

describe('deferred focus ownership', () => {
  let panel: HTMLElement;
  let input: HTMLInputElement;
  let outside: HTMLButtonElement;
  beforeEach(() => {
    panel = document.createElement('section');
    input = document.createElement('input');
    outside = document.createElement('button');
    panel.append(input);
    document.body.append(panel, outside);
  });
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

  it('returns focus once, permits interactions within the owner, and detaches both listeners', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const focus = vi.spyOn(input, 'focus');
    const owner = createDeferredFocus(panel, input);
    const finish = owner.claim();
    input.dispatchEvent(new Event('focusin', { bubbles: true }));
    panel.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    finish();
    finish();
    owner.cancel();
    expect(document.activeElement).toBe(input);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.filter(([name]) => name === 'focusin')).toHaveLength(1);
    expect(remove.mock.calls.filter(([name]) => name === 'pointerdown')).toHaveLength(1);
  });

  it.each(['focusin', 'pointerdown'])('immediately revokes and detaches on outside %s, even when focus is body', (event) => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const focus = vi.spyOn(input, 'focus');
    const finish = createDeferredFocus(panel, input).claim();
    outside.dispatchEvent(new Event(event, { bubbles: true }));
    expect(remove.mock.calls.filter(([name]) => name === 'focusin')).toHaveLength(1);
    expect(remove.mock.calls.filter(([name]) => name === 'pointerdown')).toHaveLength(1);
    finish();
    expect(focus).not.toHaveBeenCalled();
  });

  it('a new claim revokes the old one without revoking the new owner', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const focus = vi.spyOn(input, 'focus');
    const owner = createDeferredFocus(panel, input);
    const old = owner.claim();
    const current = owner.claim();
    expect(remove.mock.calls.filter(([name]) => name === 'focusin')).toHaveLength(1);
    expect(remove.mock.calls.filter(([name]) => name === 'pointerdown')).toHaveLength(1);
    old();
    expect(focus).not.toHaveBeenCalled();
    current();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('explicit cancellation survives close/reopen of the same panel', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const focus = vi.spyOn(input, 'focus');
    const owner = createDeferredFocus(panel, input);
    const old = owner.claim();
    panel.hidden = true;
    owner.cancel();
    expect(remove.mock.calls.filter(([name]) => name === 'focusin')).toHaveLength(1);
    expect(remove.mock.calls.filter(([name]) => name === 'pointerdown')).toHaveLength(1);
    panel.hidden = false;
    old();
    expect(focus).not.toHaveBeenCalled();
  });

  it.each(['hidden', 'disconnected', 'moved-input', 'disabled'] as const)('cannot return focus to a %s owner/target', (state) => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const focus = vi.spyOn(input, 'focus');
    const finish = createDeferredFocus(panel, input).claim();
    if (state === 'hidden') panel.hidden = true;
    if (state === 'disconnected') panel.remove();
    if (state === 'moved-input') outside.append(input);
    if (state === 'disabled') input.disabled = true;
    finish();
    expect(focus).not.toHaveBeenCalled();
    expect(remove.mock.calls.filter(([name]) => name === 'focusin')).toHaveLength(1);
    expect(remove.mock.calls.filter(([name]) => name === 'pointerdown')).toHaveLength(1);
  });
});

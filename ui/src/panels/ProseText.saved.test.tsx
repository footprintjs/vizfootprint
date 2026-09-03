// @vitest-environment jsdom
/** A ref to a SAVED selection renders as a link whose click applies the saved logic — never a seek. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ProseText } from './ProseText.js';

afterEach(cleanup);

describe('ProseText — a saved-selection ref', () => {
  it('names the saved selection, applies it on click, and never seeks', () => {
    const onSaved = vi.fn();
    const onSeek = vi.fn();
    const { container } = render(<ProseText text="see @[coastal] now" refs={[{ span: [4, 14], saved: 'coastal', label: 'coastal' }]} onSaved={onSaved} onSeek={onSeek} />);
    const ref = container.querySelector('[data-ref-saved="coastal"]') as HTMLElement;
    expect(ref).not.toBeNull();
    expect(ref.textContent).toContain('@[coastal]');
    const clickable = (ref.querySelector('button, a') ?? ref) as HTMLElement;
    fireEvent.click(clickable);
    expect(onSaved).toHaveBeenCalledWith('coastal');
    expect(onSeek).not.toHaveBeenCalled();
    expect(container.innerHTML).toContain('saved selection &quot;coastal&quot;'); // the target is named in the hover words
  });
});

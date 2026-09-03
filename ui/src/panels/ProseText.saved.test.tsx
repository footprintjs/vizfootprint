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

  // The marker a paused surface reads (VizCockpit's read-only): a commit or a
  // beat anchor GOES somewhere and keeps working while acting is paused; a
  // saved-selection anchor APPLIES a selection, which is an act, so it does not.
  it('marks a commit and a beat anchor as seek-only, and a saved-selection anchor as not', () => {
    const { container } = render(
      <ProseText
        text="at #c7 and @[the spike] and @[coastal]"
        refs={[
          { span: [3, 6], commit: 'c7' },
          { span: [11, 22], beat: 't1', label: 'the spike' },
          { span: [27, 37], saved: 'p1', label: 'coastal' },
        ]}
      />,
    );
    const anchorIn = (sel: string): HTMLElement => container.querySelector(`${sel} .vzf-prosetext-anchor`) as HTMLElement;
    expect(anchorIn('[data-ref-commit="c7"]').hasAttribute('data-vzf-seek'), 'a commit anchor only ever seeks').toBe(true);
    expect(anchorIn('[data-ref-beat="t1"]').hasAttribute('data-vzf-seek'), 'so does a beat anchor').toBe(true);
    expect(anchorIn('[data-ref-saved="p1"]').hasAttribute('data-vzf-seek'), 'applying a saved selection is an act, not a seek').toBe(false);
  });
});

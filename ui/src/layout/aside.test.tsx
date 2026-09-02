// @vitest-environment jsdom
/** The cockpit's push-aside: present when given, open reserves its width, closed is hidden from assistive tech, the close button calls back. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { VizCockpit } from './VizCockpit.js';

afterEach(cleanup);

describe('VizCockpit aside', () => {
  it('renders the panel beside the charts, opens and closes, and omits the close button when no handler is given', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<VizCockpit charts={[]} aside={{ open: true, title: 'Edit weeks', onClose, children: <p>fields</p> }} />);
    const aside = container.querySelector('[data-vzf="cockpit-aside"]')!;
    expect(aside.className).toContain('vzf-open');
    expect(aside.getAttribute('aria-hidden')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Edit weeks' }).textContent).toContain('fields');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<VizCockpit charts={[]} aside={{ open: false, title: 'Edit weeks', children: <p>fields</p>, width: 300 }} />);
    const closed = container.querySelector('[data-vzf="cockpit-aside"]')!;
    expect(closed.className).not.toContain('vzf-open');
    expect(closed.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    rerender(<VizCockpit charts={[]} />);
    expect(container.querySelector('[data-vzf="cockpit-aside"]')).toBeNull();
  });
});

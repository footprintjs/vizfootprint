// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AxisLabel } from './AxisLabel.js';

afterEach(cleanup);

describe('AxisLabel', () => {
  it('anchors the affordance box to the right of x when anchor="end"', () => {
    const { container } = render(
      <svg>
        <AxisLabel x={100} y={50} text="price" channel="x" anchor="end" boxWidth={40} onOpen={() => {}} />
      </svg>,
    );
    const rect = container.querySelector('.vzf-axis-affordance')!;
    // anchor === 'end' → bx = x - boxWidth
    expect(rect.getAttribute('x')).toBe('60');
  });

  it('anchors the affordance box at x when anchor="start"', () => {
    const { container } = render(
      <svg>
        <AxisLabel x={100} y={50} text="price" channel="x" anchor="start" boxWidth={40} onOpen={() => {}} />
      </svg>,
    );
    const rect = container.querySelector('.vzf-axis-affordance')!;
    // neither 'middle' nor 'end' → bx = x
    expect(rect.getAttribute('x')).toBe('100');
  });

  it('opens on Enter and on Space, preventing default', () => {
    const onOpen = vi.fn();
    render(
      <svg>
        <AxisLabel x={10} y={10} text="rating" channel="y" onOpen={onOpen} />
      </svg>,
    );
    const g = screen.getByRole('button', { name: /Encode the y axis/ });
    const enterOk = fireEvent.keyDown(g, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('y');
    expect(enterOk).toBe(false); // dispatchEvent returns false when preventDefault() was called

    onOpen.mockClear();
    const spaceOk = fireEvent.keyDown(g, { key: ' ' });
    expect(onOpen).toHaveBeenCalledWith('y');
    expect(spaceOk).toBe(false);
  });

  it('ignores keys other than Enter/Space and does not prevent default', () => {
    const onOpen = vi.fn();
    render(
      <svg>
        <AxisLabel x={10} y={10} text="rating" channel="y" onOpen={onOpen} />
      </svg>,
    );
    const g = screen.getByRole('button', { name: /Encode the y axis/ });
    const ok = fireEvent.keyDown(g, { key: 'a' });
    expect(onOpen).not.toHaveBeenCalled();
    expect(ok).toBe(true); // not prevented
  });

  it('opens on click', () => {
    const onOpen = vi.fn();
    render(
      <svg>
        <AxisLabel x={10} y={10} text="rating" channel="color" onOpen={onOpen} />
      </svg>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Encode the color axis/ }));
    expect(onOpen).toHaveBeenCalledWith('color');
  });
});

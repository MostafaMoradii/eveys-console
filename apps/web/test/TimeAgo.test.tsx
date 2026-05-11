import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeAgo } from '@/components/TimeAgo';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe('TimeAgo', () => {
  it('renders relative time and full UTC in the title attribute', () => {
    render(<TimeAgo iso="2026-05-10T11:48:00.000Z" />);
    const node = screen.getByTestId('time-ago');
    expect(node.textContent).toBe('12m ago');
    expect(node.getAttribute('title')).toBe('2026-05-10 11:48:00 UTC');
  });

  it('renders the em-dash without a title attribute when iso is null', () => {
    render(<TimeAgo iso={null} />);
    const node = screen.getByTestId('time-ago');
    expect(node.textContent).toBe('—');
    expect(node.getAttribute('title')).toBeNull();
  });

  it('renders the em-dash without a title attribute for unparseable iso', () => {
    render(<TimeAgo iso="not-a-date" />);
    const node = screen.getByTestId('time-ago');
    expect(node.textContent).toBe('—');
    expect(node.getAttribute('title')).toBeNull();
  });

  it('applies the className prop', () => {
    render(<TimeAgo iso="2026-05-10T11:00:00.000Z" className="text-xs" />);
    const node = screen.getByTestId('time-ago');
    expect(node.className).toContain('text-xs');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatRelativeTime, formatUptime } from '@/lib/time';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-10T12:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('formatRelativeTime', () => {
  it('returns em-dash for null / undefined / unparseable', () => {
    expect(formatRelativeTime(null)).toBe('—');
    expect(formatRelativeTime(undefined)).toBe('—');
    expect(formatRelativeTime('not-a-date')).toBe('—');
  });

  it('uses second precision under a minute', () => {
    expect(formatRelativeTime('2026-05-10T11:59:30.000Z')).toBe('30s ago');
  });

  it('says "now" for sub-5s', () => {
    expect(formatRelativeTime('2026-05-10T11:59:58.000Z')).toBe('now');
  });

  it('switches to minutes / hours / days as the gap grows', () => {
    expect(formatRelativeTime('2026-05-10T11:55:00.000Z')).toBe('5m ago');
    expect(formatRelativeTime('2026-05-10T09:00:00.000Z')).toBe('3h ago');
    expect(formatRelativeTime('2026-05-08T12:00:00.000Z')).toBe('2d ago');
  });
});

describe('formatUptime', () => {
  it('returns em-dash for null / undefined / unparseable / future', () => {
    expect(formatUptime(null)).toBe('—');
    expect(formatUptime(undefined)).toBe('—');
    expect(formatUptime('not-a-date')).toBe('—');
    // Future timestamp (clock skew) — treat as unknown rather than negative.
    expect(formatUptime('2026-05-10T13:00:00.000Z')).toBe('—');
  });

  it('renders sub-minute as seconds', () => {
    expect(formatUptime('2026-05-10T11:59:15.000Z')).toBe('45s');
  });

  it('renders sub-hour as a single minute count', () => {
    expect(formatUptime('2026-05-10T11:48:00.000Z')).toBe('12m');
  });

  it('renders sub-day as Xh Ym, omitting minutes when 0', () => {
    expect(formatUptime('2026-05-10T09:46:00.000Z')).toBe('2h 14m');
    expect(formatUptime('2026-05-10T09:00:00.000Z')).toBe('3h');
  });

  it('renders multi-day as Xd Yh, omitting hours when 0', () => {
    expect(formatUptime('2026-05-07T08:00:00.000Z')).toBe('3d 4h');
    expect(formatUptime('2026-05-07T12:00:00.000Z')).toBe('3d');
  });
});

// Component tests for DeviceEventsPanel. The panel is a thin wrapper
// around useSubscription + a local 200-row ring, so the tests stub
// useSubscription and drive the ring by re-rendering with new
// `lastDelta` values. We assert on:
//  - empty state copy + spinner role
//  - ordering (newest first)
//  - the detail toggle expands + collapses
//  - the chip variant per kind is the one Badge renders
//  - the 200-row cap drops the oldest event

import { cleanup, render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeltaForQuery, DeviceEvent } from '@eveys-console/protocol';

// The subscription mock is driven per-test: each call to the hook
// returns whatever `currentSubResult` is right now, so a test can
// re-render with a different `lastDelta` to simulate a new event
// arriving. `subscriptionCalls` captures every call so we can assert
// on the query name + params (e.g. cp_id is plumbed through).

interface SubResult {
  loading: boolean;
  error: string | null;
  snapshot: unknown;
  lastDelta: DeltaForQuery | null;
  cursor: string | null;
}

let currentSubResult: SubResult = {
  loading: false,
  error: null,
  snapshot: null,
  lastDelta: null,
  cursor: null,
};

const subscriptionCalls: { query: string; params: Record<string, unknown> }[] = [];

vi.mock('@/hooks/use-subscription', () => ({
  useSubscription: (query: string, params: Record<string, unknown>) => {
    subscriptionCalls.push({ query, params: { ...params } });
    return currentSubResult;
  },
}));

import { DeviceEventsPanel } from '@/components/DeviceEventsPanel';

function makeEvent(over: Partial<DeviceEvent> = {}): DeviceEvent {
  return {
    at: over.at ?? '2026-05-10T11:59:00Z',
    kind: over.kind ?? 'status',
    summary: over.summary ?? 'Connector 1 → Available',
    detail: over.detail ?? { status: 'Available', error_code: null },
    connector_id: over.connector_id ?? 1,
  };
}

function delta(event: DeviceEvent): DeltaForQuery {
  return { kind: 'device-events', append: event };
}

function setSub(over: Partial<SubResult>) {
  currentSubResult = { ...currentSubResult, ...over };
}

beforeEach(() => {
  currentSubResult = {
    loading: false,
    error: null,
    snapshot: null,
    lastDelta: null,
    cursor: null,
  };
  subscriptionCalls.length = 0;
});

afterEach(() => cleanup());

describe('DeviceEventsPanel — wiring', () => {
  it('subscribes to device-events with the cp_id prop', () => {
    render(<DeviceEventsPanel cpId="cp_test" />);
    expect(subscriptionCalls.some((c) => c.query === 'device-events')).toBe(true);
    const call = subscriptionCalls.find((c) => c.query === 'device-events')!;
    expect(call.params).toEqual({ cp_id: 'cp_test' });
  });
});

describe('DeviceEventsPanel — empty state', () => {
  it('renders the waiting copy when no events have arrived', () => {
    render(<DeviceEventsPanel cpId="cp_test" />);
    expect(screen.getByTestId('device-events-empty')).toHaveTextContent('Waiting for events');
    expect(screen.queryByTestId('device-events-list')).not.toBeInTheDocument();
  });

  it('shows an error message when the subscription fails', () => {
    setSub({ error: 'boom' });
    render(<DeviceEventsPanel cpId="cp_test" />);
    expect(screen.getByText(/Couldn't subscribe.*boom/i)).toBeInTheDocument();
  });
});

describe('DeviceEventsPanel — rows', () => {
  it('renders rows newest-first as deltas arrive', () => {
    const { rerender } = render(<DeviceEventsPanel cpId="cp_test" />);
    // First event.
    setSub({ lastDelta: delta(makeEvent({ summary: 'first', at: '2026-05-10T11:00:00Z' })) });
    rerender(<DeviceEventsPanel cpId="cp_test" />);
    // Second event — useSubscription returns a new `lastDelta` reference,
    // which fires the effect that pushes onto the ring.
    setSub({ lastDelta: delta(makeEvent({ summary: 'second', at: '2026-05-10T11:01:00Z' })) });
    rerender(<DeviceEventsPanel cpId="cp_test" />);

    const summaries = screen.getAllByTestId('device-events-summary').map((el) => el.textContent);
    // Newest first: 'second' before 'first'.
    expect(summaries).toEqual(['second', 'first']);
  });

  it('renders a chip per row with the variant for the kind', () => {
    const { rerender } = render(<DeviceEventsPanel cpId="cp_test" />);

    const kinds: DeviceEvent['kind'][] = ['boot', 'status', 'meter', 'tx-started'];
    for (const kind of kinds) {
      setSub({ lastDelta: delta(makeEvent({ kind, summary: `${kind}-row` })) });
      rerender(<DeviceEventsPanel cpId="cp_test" />);
    }

    const rows = screen.getAllByTestId('device-events-row');
    // Newest-first: tx-started, meter, status, boot.
    expect(rows).toHaveLength(4);
    const expectedClasses: Record<DeviceEvent['kind'], string> = {
      boot: 'bg-emerald-500/15',
      status: 'bg-amber-500/15',
      meter: 'bg-secondary',
      'tx-started': 'bg-primary',
    };
    const orderedKinds: DeviceEvent['kind'][] = ['tx-started', 'meter', 'status', 'boot'];
    rows.forEach((row, idx) => {
      const chip = within(row).getByTestId('device-events-chip');
      expect(chip.className).toContain(expectedClasses[orderedKinds[idx]!]);
    });
  });
});

describe('DeviceEventsPanel — detail toggle', () => {
  it('expands and collapses on click', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DeviceEventsPanel cpId="cp_test" />);
    setSub({
      lastDelta: delta(
        makeEvent({
          kind: 'meter',
          summary: 'MeterValues — 2 samples',
          detail: { sample_count: 2, primary_unit: 'WH' },
        }),
      ),
    });
    rerender(<DeviceEventsPanel cpId="cp_test" />);

    expect(screen.queryByTestId('device-events-detail')).not.toBeInTheDocument();
    const toggle = screen.getByTestId('device-events-toggle');
    await user.click(toggle);
    const detail = screen.getByTestId('device-events-detail');
    expect(detail).toHaveTextContent('sample_count');
    expect(detail).toHaveTextContent('2');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(screen.queryByTestId('device-events-detail')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('hides the toggle when detail is empty', () => {
    const { rerender } = render(<DeviceEventsPanel cpId="cp_test" />);
    setSub({ lastDelta: delta(makeEvent({ detail: {} })) });
    rerender(<DeviceEventsPanel cpId="cp_test" />);
    expect(screen.queryByTestId('device-events-toggle')).not.toBeInTheDocument();
  });
});

describe('DeviceEventsPanel — ring cap', () => {
  it('caps the visible rows at 200 and drops the oldest beyond', () => {
    // Render once with the empty state, then push 205 distinct deltas
    // via rerender so the effect runs each time. Each event gets a
    // unique `at` so the assertion can identify which ones survived.
    const { rerender } = render(<DeviceEventsPanel cpId="cp_test" />);
    for (let i = 0; i < 205; i++) {
      // Padding makes the lex order match the numeric order, so the
      // first event (i=0, 'evt-000') is the oldest and the last
      // (i=204, 'evt-204') is the newest.
      const tag = `evt-${String(i).padStart(3, '0')}`;
      setSub({
        lastDelta: delta(
          makeEvent({
            summary: tag,
            // Distinct `at` per event so React's effect treats each
            // delta as a new reference even after the ring caps.
            at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
          }),
        ),
      });
      // Wrap in act() because we're synchronously firing many
      // rerenders that schedule effects; act flushes them in-loop.
      act(() => {
        rerender(<DeviceEventsPanel cpId="cp_test" />);
      });
    }

    const rows = screen.getAllByTestId('device-events-summary').map((el) => el.textContent);
    expect(rows).toHaveLength(200);
    // Newest first → 'evt-204' is at index 0.
    expect(rows[0]).toBe('evt-204');
    // Oldest five (evt-000 .. evt-004) are dropped; oldest survivor is evt-005.
    expect(rows[199]).toBe('evt-005');
    expect(rows).not.toContain('evt-000');
  });
});

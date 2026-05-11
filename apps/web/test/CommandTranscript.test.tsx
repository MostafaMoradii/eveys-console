// Component tests for the CommandTranscript pane. Drives it with a
// hand-built `UseCommandTranscript` value so we can pin the
// per-outcome rendering, the filter chips, pause/clear controls, and
// the JSON toggles without touching the hook.

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CommandTranscript } from '@/components/CommandTranscript';
import type { TranscriptEntry, UseCommandTranscript } from '@/hooks/use-command-transcript';

afterEach(() => cleanup());

function entry(over: Partial<TranscriptEntry>): TranscriptEntry {
  return {
    id: over.id ?? 1,
    startedAt: over.startedAt ?? '2026-05-11T21:00:00.000Z',
    method: over.method ?? 'reset',
    request: over.request ?? { cp_id: 'cp_TEST', type: 'Soft' },
    phase: over.phase ?? 'ok',
    outcome: over.outcome ?? 'accepted',
    response: over.response,
    status: over.status,
    elapsedMs: over.elapsedMs,
    error: over.error,
  };
}

function makeT(over: Partial<UseCommandTranscript> = {}): UseCommandTranscript {
  return {
    entries: over.entries ?? [],
    paused: over.paused ?? false,
    bufferedCount: over.bufferedCount ?? 0,
    send: over.send ?? vi.fn(),
    inFlight: over.inFlight ?? new Set(),
    clear: over.clear ?? vi.fn(),
    pause: over.pause ?? vi.fn(),
    resume: over.resume ?? vi.fn(),
  };
}

describe('CommandTranscript', () => {
  it('renders the empty state when there are no entries', () => {
    render(<CommandTranscript t={makeT()} />);
    expect(screen.getByTestId('transcript-empty')).toBeInTheDocument();
  });

  it('renders one row per entry with the status pill', () => {
    const t = makeT({
      entries: [
        entry({ id: 2, method: 'reserve-now', outcome: 'soft-reject', status: 'Occupied' }),
        entry({ id: 1, method: 'reset', outcome: 'accepted', status: 'Accepted' }),
      ],
    });
    render(<CommandTranscript t={t} />);
    const rows = screen.getAllByTestId('transcript-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute('data-outcome', 'soft-reject');
    expect(rows[0]).toHaveAttribute('data-method', 'reserve-now');
    expect(within(rows[0]!).getByText(/Occupied/i)).toBeInTheDocument();
    expect(within(rows[1]!).getByText(/Accepted/i)).toBeInTheDocument();
  });

  it('Failed-only filter hides accepted rows', async () => {
    const user = userEvent.setup();
    const t = makeT({
      entries: [
        entry({ id: 2, method: 'reserve-now', outcome: 'soft-reject', status: 'Occupied' }),
        entry({ id: 1, method: 'reset', outcome: 'accepted', status: 'Accepted' }),
      ],
    });
    render(<CommandTranscript t={t} />);
    await user.click(screen.getByTestId('transcript-filter-failed'));
    const rows = screen.getAllByTestId('transcript-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-outcome', 'soft-reject');
  });

  it('Show response renders a JSON block when the row has a response', async () => {
    const user = userEvent.setup();
    const t = makeT({
      entries: [
        entry({ id: 1, response: { status: 'Accepted', configurationKey: [{ key: 'X' }] } }),
      ],
    });
    render(<CommandTranscript t={t} />);
    const row = screen.getByTestId('transcript-row');
    await user.click(within(row).getByTestId('transcript-toggle-res'));
    const json = within(row).getByTestId('transcript-res-json');
    expect(json.textContent).toContain('configurationKey');
  });

  it('Pause/Resume + Clear wire through to the hook', async () => {
    const user = userEvent.setup();
    const pause = vi.fn();
    const resume = vi.fn();
    const clear = vi.fn();

    // First render: not paused → Pause button visible.
    const { rerender } = render(
      <CommandTranscript t={makeT({ entries: [entry({})], pause, resume, clear })} />,
    );
    await user.click(screen.getByTestId('transcript-pause'));
    expect(pause).toHaveBeenCalled();
    await user.click(screen.getByTestId('transcript-clear'));
    expect(clear).toHaveBeenCalled();

    // Re-render as paused so the Resume button appears.
    rerender(
      <CommandTranscript
        t={makeT({ entries: [entry({})], paused: true, bufferedCount: 3, pause, resume, clear })}
      />,
    );
    const resumeBtn = screen.getByTestId('transcript-resume');
    expect(resumeBtn.textContent).toContain('+3');
    await user.click(resumeBtn);
    expect(resume).toHaveBeenCalled();
  });

  it('shows the transport-error status for an error-phase entry', () => {
    const t = makeT({
      entries: [
        entry({
          phase: 'error',
          outcome: 'error',
          error: 'ws closed',
          status: 'ws closed',
        }),
      ],
    });
    render(<CommandTranscript t={t} />);
    const row = screen.getByTestId('transcript-row');
    expect(within(row).getByText('ws closed')).toBeInTheDocument();
  });
});

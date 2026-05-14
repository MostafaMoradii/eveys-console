// Tests for the composite DateTimePicker. The calendar grid lives in
// a Radix Portal and react-day-picker measures its container, which
// is flaky in jsdom — so we focus on what we *can* deterministically
// drive: the trigger label, the clear affordance, and the time-input
// commit path (which doesn't require the popover to be open).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DateTimePicker } from '@/components/ui/datetime-picker';

afterEach(() => cleanup());

describe('DateTimePicker — trigger label', () => {
  it('renders the placeholder when value is empty', () => {
    render(<DateTimePicker value="" onChange={vi.fn()} placeholder="Pick…" data-testid="dt" />);
    expect(screen.getByTestId('dt')).toHaveTextContent('Pick…');
  });

  it('renders the formatted date+time when value is a valid ISO', () => {
    render(
      <DateTimePicker
        value="2026-05-10T08:30:00Z"
        onChange={vi.fn()}
        placeholder="Pick…"
        data-testid="dt"
      />,
    );
    // The render format is yyyy-MM-dd HH:mm in the operator's local
    // timezone — the date portion is stable across reasonable TZs
    // since 08:30 UTC stays within May 10 anywhere west of UTC+15:30.
    expect(screen.getByTestId('dt').textContent).toMatch(/2026-05-10/);
  });
});

describe('DateTimePicker — clear', () => {
  it('emits an empty string when the operator clicks the clear chip', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DateTimePicker value="2026-05-10T08:30:00Z" onChange={onChange} data-testid="dt" />);
    await user.click(screen.getByTestId('dt-clear'));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('does not render the clear chip when value is empty', () => {
    render(<DateTimePicker value="" onChange={vi.fn()} data-testid="dt" />);
    expect(screen.queryByTestId('dt-clear')).toBeNull();
  });
});

describe('DateTimePicker — time inputs', () => {
  it('disables the HH/MM inputs when no date is selected yet', async () => {
    const user = userEvent.setup();
    render(<DateTimePicker value="" onChange={vi.fn()} data-testid="dt" />);

    // Open the popover by clicking the trigger.
    await user.click(screen.getByTestId('dt'));

    // The popover content is portalled; the time inputs render but
    // are disabled until a date is picked.
    await waitFor(() => expect(screen.getByTestId('dt-hh')).toBeInTheDocument());
    expect(screen.getByTestId('dt-hh')).toBeDisabled();
    expect(screen.getByTestId('dt-mm')).toBeDisabled();
  });

  it('commits a new HH on blur, keeping the same calendar date', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DateTimePicker value="2026-05-10T08:30:00Z" onChange={onChange} data-testid="dt" />);
    // Open the popover.
    await user.click(screen.getByTestId('dt'));
    const hh = await waitFor(() => screen.getByTestId('dt-hh'));

    // Drive directly via the change + blur events — userEvent.type
    // against a number input with an existing value triggers brittle
    // partial-typed states; the controlled-component contract is the
    // same on .change as it would be after a keypress.
    fireEvent.change(hh, { target: { value: '15' } });
    fireEvent.blur(hh);

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const committed = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(new Date(committed).getHours()).toBe(15);
  });
});

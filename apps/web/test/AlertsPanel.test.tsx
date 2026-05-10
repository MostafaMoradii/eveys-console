// Component tests for AlertsPanel. The component is pure render — no
// fetching, no derivation — so each test feeds it a fixed `alerts`
// prop and asserts on the resulting DOM. We stub the router's `<Link>`
// to a plain anchor so we don't have to mount RouterProvider.

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
    className,
    ...rest
  }: {
    to: string;
    params?: Record<string, unknown>;
    children: React.ReactNode;
    className?: string;
  } & Record<string, unknown>) => {
    let href = to;
    if (params && typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) {
        href = href.replace(`$${k}`, String(v));
      }
    }
    return (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    );
  },
}));

import { AlertsPanel } from '@/components/AlertsPanel';
import type { Alert } from '@/lib/alerts';

afterEach(() => {
  cleanup();
});

describe('AlertsPanel', () => {
  it('renders the empty state when alerts is empty', () => {
    render(<AlertsPanel alerts={[]} />);
    expect(screen.getByTestId('alerts-empty')).toHaveTextContent(/All clear/i);
    expect(screen.queryByTestId('alerts-row')).toBeNull();
    expect(screen.queryByTestId('alerts-count')).toBeNull();
  });

  it('renders the loading state when loading=true', () => {
    render(<AlertsPanel alerts={[]} loading={true} />);
    expect(screen.getByTestId('alerts-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('alerts-empty')).toBeNull();
  });

  it('renders the error state when error is set', () => {
    render(<AlertsPanel alerts={[]} error="boom" />);
    const err = screen.getByTestId('alerts-error');
    expect(err).toHaveTextContent(/Couldn't compute alerts/i);
    expect(err).toHaveTextContent(/boom/);
  });

  it('renders one row per alert and a count badge in the header', () => {
    const alerts: Alert[] = [
      { id: 'a', severity: 'critical', title: 'A', detail: 'a-detail' },
      { id: 'b', severity: 'warning', title: 'B', detail: 'b-detail' },
      { id: 'c', severity: 'info', title: 'C', detail: 'c-detail' },
    ];
    render(<AlertsPanel alerts={alerts} />);
    const rows = screen.getAllByTestId('alerts-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByTestId('alerts-count')).toHaveTextContent('3');
  });

  it('marks each row with a data-severity attribute matching the alert severity', () => {
    const alerts: Alert[] = [
      { id: 'crit', severity: 'critical', title: 'crit', detail: '' },
      { id: 'warn', severity: 'warning', title: 'warn', detail: '' },
      { id: 'info', severity: 'info', title: 'info', detail: '' },
    ];
    render(<AlertsPanel alerts={alerts} />);
    const rows = screen.getAllByTestId('alerts-row');
    const sev = rows.map((r) => r.getAttribute('data-severity'));
    expect(sev).toEqual(['critical', 'warning', 'info']);
    // And each row's icon has an aria-label matching the severity name —
    // the icons themselves are stubs, but our wrapper sets aria-label.
    expect(within(rows[0]!).getByLabelText('critical')).toBeInTheDocument();
    expect(within(rows[1]!).getByLabelText('warning')).toBeInTheDocument();
    expect(within(rows[2]!).getByLabelText('info')).toBeInTheDocument();
  });

  it('renders a cp_id link to the charger detail page when scoped', () => {
    const alerts: Alert[] = [
      { id: 'a', severity: 'warning', title: 'CP_A flapping', detail: '', cp_id: 'CP_A' },
    ];
    render(<AlertsPanel alerts={alerts} />);
    const link = screen.getByTestId('alerts-cp-link');
    expect(link).toHaveAttribute('href', '/inspect/charge-points/CP_A');
    expect(link).toHaveTextContent('CP_A');
  });

  it('does not render a cp_id link when the alert is not scoped to a charger', () => {
    const alerts: Alert[] = [
      { id: 'gw', severity: 'critical', title: 'gateway down', detail: 'gw' },
    ];
    render(<AlertsPanel alerts={alerts} />);
    expect(screen.queryByTestId('alerts-cp-link')).toBeNull();
  });

  it('renders a relative time when `since` is set', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
    const alerts: Alert[] = [
      {
        id: 'a',
        severity: 'warning',
        title: 'CP_A offline 45m',
        detail: '',
        since: '2026-05-10T11:15:00Z',
      },
    ];
    render(<AlertsPanel alerts={alerts} />);
    expect(screen.getByText(/45m ago/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});

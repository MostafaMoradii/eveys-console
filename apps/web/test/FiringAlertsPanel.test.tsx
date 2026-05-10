// Component tests for FiringAlertsPanel. Pure render — the parent
// owns the polling — so each test feeds it a fixed prop set and
// asserts on the resulting DOM. Router <Link> is stubbed to a plain
// anchor so cp_id links render without mounting RouterProvider.

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

import { FiringAlertsPanel } from '@/components/FiringAlertsPanel';
import type { Alert } from '@/lib/alerts';

afterEach(() => {
  cleanup();
});

describe('FiringAlertsPanel', () => {
  it('renders the unavailable hint when unavailable=true', () => {
    render(<FiringAlertsPanel alerts={[]} unavailable={true} />);
    expect(screen.getByTestId('firing-alerts-unavailable')).toHaveTextContent(
      /Alertmanager not configured/i,
    );
    expect(screen.queryByTestId('firing-alerts-row')).toBeNull();
    expect(screen.queryByTestId('firing-alerts-empty')).toBeNull();
    expect(screen.queryByTestId('firing-alerts-count')).toBeNull();
  });

  it('renders the empty state when alerts is empty and not unavailable', () => {
    render(<FiringAlertsPanel alerts={[]} unavailable={false} />);
    expect(screen.getByTestId('firing-alerts-empty')).toHaveTextContent(/No alerts firing/i);
    expect(screen.queryByTestId('firing-alerts-unavailable')).toBeNull();
  });

  it('renders the loading spinner when loading=true', () => {
    render(<FiringAlertsPanel alerts={[]} unavailable={false} loading={true} />);
    expect(screen.getByTestId('firing-alerts-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('firing-alerts-empty')).toBeNull();
  });

  it('renders one row per alert with a count badge in the header', () => {
    const alerts: Alert[] = [
      {
        id: 'fp-a',
        severity: 'critical',
        title: 'GatewayDown',
        detail: 'gateway scrape failing',
        since: '2026-05-10T11:00:00.000Z',
      },
      {
        id: 'fp-b',
        severity: 'warning',
        title: 'ConsoleDown',
        detail: 'console scrape failing',
        since: '2026-05-10T11:05:00.000Z',
      },
    ];
    render(<FiringAlertsPanel alerts={alerts} unavailable={false} />);
    const rows = screen.getAllByTestId('firing-alerts-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByTestId('firing-alerts-count')).toHaveTextContent('2');
  });

  it('marks each row with a data-severity attribute matching the alert', () => {
    const alerts: Alert[] = [
      { id: 'c', severity: 'critical', title: 'C', detail: '' },
      { id: 'w', severity: 'warning', title: 'W', detail: '' },
      { id: 'i', severity: 'info', title: 'I', detail: '' },
    ];
    render(<FiringAlertsPanel alerts={alerts} unavailable={false} />);
    const rows = screen.getAllByTestId('firing-alerts-row');
    expect(rows.map((r) => r.getAttribute('data-severity'))).toEqual([
      'critical',
      'warning',
      'info',
    ]);
    expect(within(rows[0]!).getByLabelText('critical')).toBeInTheDocument();
    expect(within(rows[1]!).getByLabelText('warning')).toBeInTheDocument();
    expect(within(rows[2]!).getByLabelText('info')).toBeInTheDocument();
  });

  it('renders a cp_id link when an alert is scoped to a charger', () => {
    const alerts: Alert[] = [
      {
        id: 'fp',
        severity: 'warning',
        title: 'ChargerOffline',
        detail: '',
        cp_id: 'CP_A',
      },
    ];
    render(<FiringAlertsPanel alerts={alerts} unavailable={false} />);
    const link = screen.getByTestId('firing-alerts-cp-link');
    expect(link).toHaveAttribute('href', '/inspect/charge-points/CP_A');
    expect(link).toHaveTextContent('CP_A');
  });

  it('omits the count badge when in the unavailable / empty / loading states', () => {
    const { unmount } = render(<FiringAlertsPanel alerts={[]} unavailable={true} />);
    expect(screen.queryByTestId('firing-alerts-count')).toBeNull();
    unmount();
    render(<FiringAlertsPanel alerts={[]} unavailable={false} />);
    expect(screen.queryByTestId('firing-alerts-count')).toBeNull();
    cleanup();
    render(<FiringAlertsPanel alerts={[]} unavailable={false} loading={true} />);
    expect(screen.queryByTestId('firing-alerts-count')).toBeNull();
  });
});

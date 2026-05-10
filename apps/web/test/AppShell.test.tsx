// AppShell tests focus on the sign-out confirmation gate. The shell
// has more surface (routing nav, mobile drawer, status pill) but
// those are tested implicitly by the page-level tests that mount it.
// What's worth covering in isolation is the click-to-confirm pattern
// for the destructive Sign-out action.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '@/lib/theme-context';

// Capture setToken so assertions can verify it was/wasn't called.
const setTokenSpy = vi.fn<(t: string | null) => void>();

vi.mock('@/lib/ws-context', () => ({
  useConsoleClient: () => ({
    client: { rpc: vi.fn(), subscribe: vi.fn(), close: vi.fn(), connect: vi.fn() },
    status: 'open',
    token: 'test-token',
    setToken: setTokenSpy,
  }),
}));

// Router stub: the shell uses useRouterState and Link; both need a
// non-crashing mock for this isolated render. The pathname doesn't
// matter for these tests; nav-active styling isn't under test here.
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  Outlet: () => <div data-testid="outlet" />,
  useRouterState: () => ({ location: { pathname: '/' } }),
}));

import { ConsoleShell } from '@/components/AppShell';

function withProviders(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>{node}</ThemeProvider>
    </QueryClientProvider>
  );
}

function renderShell() {
  return render(withProviders(<ConsoleShell />));
}

beforeEach(() => {
  setTokenSpy.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('AppShell — sign-out confirmation', () => {
  it('clicking Sign out opens the dialog without ending the session', async () => {
    const user = userEvent.setup();
    renderShell();

    // The dialog content isn't in the DOM until the button opens it.
    expect(screen.queryByTestId('signout-dialog')).toBeNull();

    await user.click(screen.getByTestId('signout-button'));

    expect(screen.getByTestId('signout-dialog')).toBeInTheDocument();
    expect(screen.getByText('Sign out?')).toBeInTheDocument();
    // Session unchanged at this point.
    expect(setTokenSpy).not.toHaveBeenCalled();
  });

  it('confirming the dialog ends the session', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId('signout-button'));
    await user.click(screen.getByTestId('signout-confirm'));

    expect(setTokenSpy).toHaveBeenCalledTimes(1);
    expect(setTokenSpy).toHaveBeenCalledWith(null);
  });

  it('cancelling the dialog leaves the session intact', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId('signout-button'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(setTokenSpy).not.toHaveBeenCalled();
    // Dialog is dismissed.
    expect(screen.queryByTestId('signout-dialog')).toBeNull();
  });

  it('pressing Escape dismisses the dialog without ending the session', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByTestId('signout-button'));
    expect(screen.getByTestId('signout-dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(setTokenSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('signout-dialog')).toBeNull();
  });

  it('signout button has accessible name even when label is hidden', () => {
    renderShell();
    const btn = screen.getByTestId('signout-button');
    expect(btn.getAttribute('aria-label')).toBe('Sign out');
  });
});

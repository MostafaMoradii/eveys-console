// Tests for CommandsConsole's offline gating. The console hosts the
// per-command form catalogue (covered by CommandsDrawer.test.tsx) +
// a transcript pane (covered by CommandTranscript.test.tsx). What
// THIS file pins is: when the charger is offline, every Send button
// renders disabled and an explanatory banner appears.

import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stub the heavy bits — we're testing the offline gate, not the
// transcript or the WS client.
vi.mock('@/lib/ws-context', () => ({
  useConsoleClient: () => ({
    client: { rpc: vi.fn(), subscribe: vi.fn(), close: vi.fn(), connect: vi.fn() },
    status: 'open',
    token: 'test-token',
    setToken: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-command-transcript', () => ({
  useCommandTranscript: () => ({
    entries: [],
    inFlight: new Set<string>(),
    paused: false,
    bufferedCount: 0,
    send: vi.fn(),
    clear: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  }),
}));

vi.mock('@/components/CommandTranscript', () => ({
  CommandTranscript: () => <div data-testid="mock-transcript" />,
}));

// Stub the API client the GetDiagnostics form references.
vi.mock('@/api/diagnostics-client', () => ({
  issueDiagnostics: vi.fn(),
}));

import { CommandsConsole } from '@/components/CommandsConsole';
import { ToastProvider } from '@/components/ui/toaster';

afterEach(() => cleanup());

function renderWith(node: ReactNode) {
  return render(<ToastProvider>{node}</ToastProvider>);
}

describe('CommandsConsole — offline gating', () => {
  it('omits the offline banner when online is true', () => {
    renderWith(<CommandsConsole cpId="cp_test" online={true} />);
    expect(screen.queryByTestId('commands-offline-banner')).toBeNull();
    // fieldset is rendered but NOT disabled.
    const fs = screen.getByTestId('commands-fieldset') as HTMLFieldSetElement;
    expect(fs.disabled).toBe(false);
  });

  it('omits the offline banner when online is undefined (legacy callers)', () => {
    renderWith(<CommandsConsole cpId="cp_test" />);
    expect(screen.queryByTestId('commands-offline-banner')).toBeNull();
    const fs = screen.getByTestId('commands-fieldset') as HTMLFieldSetElement;
    expect(fs.disabled).toBe(false);
  });

  it('shows the offline banner + disables the fieldset when online is false', () => {
    renderWith(<CommandsConsole cpId="cp_test" online={false} />);
    const banner = screen.getByTestId('commands-offline-banner');
    expect(banner).toHaveTextContent('Charger offline');
    expect(banner).toHaveTextContent('Commands are disabled');
    const fs = screen.getByTestId('commands-fieldset') as HTMLFieldSetElement;
    expect(fs.disabled).toBe(true);
    // A native disabled <fieldset> disables every form control inside,
    // including <button type="submit">. Sample a couple of the Send
    // buttons rendered by the embedded CommandsList.
    const sendButtons = screen
      .getAllByRole('button', { name: /^Send$/i })
      .map((b) => b as HTMLButtonElement);
    expect(sendButtons.length).toBeGreaterThan(3);
    for (const btn of sendButtons) {
      // The button itself may not carry `disabled`; the parent
      // fieldset's `disabled` flag is what the browser honours. Check
      // `closest('fieldset[disabled]')` resolves.
      expect(btn.closest('fieldset[disabled]')).not.toBeNull();
    }
  });
});

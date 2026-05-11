// Tests that the ws-context Provider survives React's StrictMode
// double-effect without aborting the WebSocket handshake — which is
// the bug that left "ws: closed" stuck red on every page reload
// (#83). The actual connect/close timing is the test's whole point;
// don't simplify the tree by dropping <React.StrictMode>.

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Track every ConsoleClient instance constructed during a test so we
// can assert connect/close call counts across the lifecycle.
interface FakeClient {
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const instances: FakeClient[] = [];

vi.mock('@/api/ws-client', () => {
  return {
    ConsoleClient: vi.fn().mockImplementation(() => {
      const inst: FakeClient = { connect: vi.fn(), close: vi.fn() };
      instances.push(inst);
      return inst;
    }),
    // The real types live in this module — the context module imports
    // these as types only, so a no-op named export is enough.
    WS_AUTH_REJECTED_CODE: 4401,
  };
});

import { ConsoleClientProvider } from '@/lib/ws-context';

beforeEach(() => {
  instances.length = 0;
  // Seed localStorage so the provider boots with a token (the connect
  // branch only runs when token is non-null).
  localStorage.setItem('eveys-console.token', 'dev-token');
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe('ConsoleClientProvider — StrictMode lifecycle', () => {
  it('does not close the WS during StrictMode dry-run mount/cleanup/mount', () => {
    render(
      <React.StrictMode>
        <ConsoleClientProvider>
          <span />
        </ConsoleClientProvider>
      </React.StrictMode>,
    );

    // Whichever client is live should have connect() called. The
    // deferred close from StrictMode's cleanup hasn't fired yet
    // (timers are fake) — and once we advance microtasks, the
    // re-mount's connect should have already cancelled the deferred
    // close so close() is never called.
    expect(instances.length).toBeGreaterThan(0);
    const live = instances[instances.length - 1]!;
    expect(live.connect).toHaveBeenCalled();

    // Run any pending setTimeout(0) callbacks.
    vi.runAllTimers();

    // Across all instances ever created in this render, no close()
    // should fire as a result of the StrictMode dry-run.
    const closeCalls = instances.reduce((n, c) => n + c.close.mock.calls.length, 0);
    expect(closeCalls).toBe(0);
  });

  it('closes the WS on real unmount', () => {
    const { unmount } = render(
      <React.StrictMode>
        <ConsoleClientProvider>
          <span />
        </ConsoleClientProvider>
      </React.StrictMode>,
    );

    // Let StrictMode's dry-run settle.
    vi.runAllTimers();

    unmount();
    // The real unmount schedules a close via setTimeout(0); run it.
    vi.runAllTimers();

    const live = instances[instances.length - 1]!;
    expect(live.close).toHaveBeenCalledTimes(1);
  });
});

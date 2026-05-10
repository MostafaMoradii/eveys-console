// Focused unit tests for ConsoleClient close-code handling. The full
// subscribe/snapshot path is exercised end-to-end by FleetPage and
// SystemPage tests; what's worth covering here is the auth-rejected
// branch and the reconnect-vs-give-up decision, since those affect
// session lifecycle and are hard to verify through a UI test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsoleClient, WS_AUTH_REJECTED_CODE, type ConnectionStatus } from '@/api/ws-client';

interface FakeSocket {
  url: string;
  protocols: string | string[] | undefined;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: number;
}

let lastSocket: FakeSocket | null = null;
const originalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  lastSocket = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = function MockWS(
    url: string,
    protocols?: string | string[],
  ): FakeSocket {
    const s: FakeSocket = {
      url,
      protocols,
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
      send: vi.fn(),
      close: vi.fn(),
      readyState: 0,
    };
    lastSocket = s;
    return s;
  } as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ConsoleClient', () => {
  it('fires onAuthRejected and stops reconnecting when server closes with 4401', () => {
    const onAuthRejected = vi.fn();
    const onStatus = vi.fn<(s: ConnectionStatus) => void>();
    const client = new ConsoleClient({
      url: 'ws://localhost:8090/ws',
      token: 'bad-token',
      onStatus,
      onAuthRejected,
    });

    vi.useFakeTimers();
    client.connect();
    expect(lastSocket).not.toBeNull();
    expect(WS_AUTH_REJECTED_CODE).toBe(4401);

    // Simulate the server-side auth rejection.
    lastSocket?.onclose?.({ code: WS_AUTH_REJECTED_CODE, reason: 'unauthenticated' });

    expect(onAuthRejected).toHaveBeenCalledTimes(1);
    // Reconnect timer must NOT have been scheduled — advancing time
    // past any plausible backoff should not produce a new socket.
    const socketBefore = lastSocket;
    vi.advanceTimersByTime(60_000);
    expect(lastSocket).toBe(socketBefore);
  });

  it('schedules a reconnect on a non-auth close', () => {
    const onAuthRejected = vi.fn();
    const client = new ConsoleClient({
      url: 'ws://localhost:8090/ws',
      token: 'good-token',
      onAuthRejected,
    });

    vi.useFakeTimers();
    client.connect();
    const firstSocket = lastSocket;
    expect(firstSocket).not.toBeNull();

    // Server-initiated close that isn't an auth rejection.
    lastSocket?.onclose?.({ code: 1011, reason: 'server error' });

    expect(onAuthRejected).not.toHaveBeenCalled();
    // Reconnect timer is scheduled with backoff; advancing past it
    // should produce a fresh socket.
    vi.advanceTimersByTime(10_000);
    expect(lastSocket).not.toBe(firstSocket);
  });

  it('does not reconnect after explicit close()', () => {
    const client = new ConsoleClient({
      url: 'ws://localhost:8090/ws',
      token: 'good-token',
    });

    vi.useFakeTimers();
    client.connect();
    const firstSocket = lastSocket;

    client.close();
    // Simulate the close event that follows the explicit socket.close().
    lastSocket?.onclose?.({ code: 1000, reason: 'client.close' });

    vi.advanceTimersByTime(60_000);
    expect(lastSocket).toBe(firstSocket);
  });
});

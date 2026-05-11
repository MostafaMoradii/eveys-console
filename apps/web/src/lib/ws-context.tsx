import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { ConsoleClient, type ConnectionDiagnostics, type ConnectionStatus } from '../api/ws-client';
import { CONSOLE_WS_URL as WS_URL } from './console-url';

const TOKEN_KEY = 'eveys-console.token';

interface ConsoleClientContextValue {
  client: ConsoleClient;
  status: ConnectionStatus;
  diagnostics: ConnectionDiagnostics;
  token: string | null;
  setToken: (t: string | null) => void;
}

const INITIAL_DIAG: ConnectionDiagnostics = {
  lastCloseCode: null,
  lastCloseReason: null,
  reconnectAttempt: 0,
};

const ctx = createContext<ConsoleClientContextValue | null>(null);

export function ConsoleClientProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [status, setStatus] = useState<ConnectionStatus>('closed');
  const [diagnostics, setDiagnostics] = useState<ConnectionDiagnostics>(INITIAL_DIAG);

  // setToken is read by the auth-rejected handler created inside useMemo
  // below. Holding the latest function in a ref keeps the handler stable
  // without making `client` depend on it (which would tear down the
  // socket every render).
  const setTokenRef = useRef<(t: string | null) => void>(() => undefined);

  const client = useMemo(() => {
    if (!token) {
      return new ConsoleClient({ url: WS_URL, token: '', onStatus: setStatus });
    }
    return new ConsoleClient({
      url: WS_URL,
      token,
      onStatus: setStatus,
      onDiagnostics: setDiagnostics,
      onAuthRejected: () => {
        // Server rejected the JWT (expired / signed by a previous
        // process / wrong audience). Clear local state so the gate
        // falls back to the login page instead of reconnect-looping.
        // eslint-disable-next-line no-console
        console.warn('[ws] auth rejected — clearing stored token');
        setTokenRef.current(null);
      },
      // eslint-disable-next-line no-console
      log: (m, c) => console.debug('[ws]', m, c),
    });
  }, [token]);

  // React StrictMode (enabled in main.tsx) runs each effect twice in
  // dev: mount → cleanup → mount. A naive `connect()` / `close()`
  // pair aborts the in-flight WS handshake on the dry-run cleanup —
  // the next mount's connect() short-circuits because status is
  // still "connecting", and the aborted socket fires onclose with
  // code 1006 + explicitlyClosed=true, leaving the pill stuck closed.
  //
  // Defer the close. If the next mount runs first, the deferred
  // close is cancelled and the socket lives on. A real unmount still
  // closes within a tick.
  const pendingCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!token) return;
    if (pendingCloseRef.current !== null) {
      clearTimeout(pendingCloseRef.current);
      pendingCloseRef.current = null;
    }
    client.connect();
    return () => {
      pendingCloseRef.current = setTimeout(() => {
        pendingCloseRef.current = null;
        client.close();
      }, 0);
    };
  }, [client, token]);

  const setToken = useCallback((t: string | null) => {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
    setTokenState(t);
  }, []);

  setTokenRef.current = setToken;

  return (
    <ctx.Provider value={{ client, status, diagnostics, token, setToken }}>{children}</ctx.Provider>
  );
}

export function useConsoleClient(): ConsoleClientContextValue {
  const value = useContext(ctx);
  if (!value) throw new Error('useConsoleClient must be used inside ConsoleClientProvider');
  return value;
}

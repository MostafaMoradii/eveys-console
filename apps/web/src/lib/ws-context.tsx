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

import { ConsoleClient, type ConnectionStatus } from '../api/ws-client';
import { CONSOLE_WS_URL as WS_URL } from './console-url';

const TOKEN_KEY = 'eveys-console.token';

interface ConsoleClientContextValue {
  client: ConsoleClient;
  status: ConnectionStatus;
  token: string | null;
  setToken: (t: string | null) => void;
}

const ctx = createContext<ConsoleClientContextValue | null>(null);

export function ConsoleClientProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [status, setStatus] = useState<ConnectionStatus>('closed');

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

  useEffect(() => {
    if (!token) return;
    client.connect();
    return () => client.close();
  }, [client, token]);

  const setToken = useCallback((t: string | null) => {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
    setTokenState(t);
  }, []);

  setTokenRef.current = setToken;

  return <ctx.Provider value={{ client, status, token, setToken }}>{children}</ctx.Provider>;
}

export function useConsoleClient(): ConsoleClientContextValue {
  const value = useContext(ctx);
  if (!value) throw new Error('useConsoleClient must be used inside ConsoleClientProvider');
  return value;
}

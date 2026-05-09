import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ConsoleClient, type ConnectionStatus } from '../api/ws-client';
import { BAAS_WS_URL as WS_URL } from './baas-url';

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

  const client = useMemo(() => {
    if (!token) {
      return new ConsoleClient({ url: WS_URL, token: '', onStatus: setStatus });
    }
    return new ConsoleClient({
      url: WS_URL,
      token,
      onStatus: setStatus,
      // eslint-disable-next-line no-console
      log: (m, c) => console.debug('[ws]', m, c),
    });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    client.connect();
    return () => client.close();
  }, [client, token]);

  const setToken = (t: string | null) => {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
    setTokenState(t);
  };

  return (
    <ctx.Provider value={{ client, status, token, setToken }}>{children}</ctx.Provider>
  );
}

export function useConsoleClient(): ConsoleClientContextValue {
  const value = useContext(ctx);
  if (!value) throw new Error('useConsoleClient must be used inside ConsoleClientProvider');
  return value;
}

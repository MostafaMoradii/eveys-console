// Theme: light / dark / system. Persisted in localStorage.
// `system` follows prefers-color-scheme and re-evaluates on change.

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'eveys-console.theme';

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStored(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function systemPrefersDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyDom(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  if (resolved === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => readStored());
  const [resolved, setResolved] = useState<'light' | 'dark'>(() =>
    readStored() === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : (readStored() as 'light' | 'dark'),
  );

  useEffect(() => {
    const next = mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode;
    setResolved(next);
    applyDom(next);
    localStorage.setItem(STORAGE_KEY, mode);

    if (mode === 'system') {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        const r = mq.matches ? 'dark' : 'light';
        setResolved(r);
        applyDom(r);
      };
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    return undefined;
  }, [mode]);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode: setModeState }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}

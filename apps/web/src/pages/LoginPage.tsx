import { Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { fetchChallenge, login, LoginError, solvePow } from '@/api/auth-client';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useConsoleClient } from '@/lib/ws-context';

type Stage = 'idle' | 'challenge' | 'solving' | 'submitting' | 'error';

export function LoginPage() {
  const { setToken } = useConsoleClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [solveMs, setSolveMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setError(null);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      setStage('challenge');
      const ch = await fetchChallenge();

      setStage('solving');
      const t0 = performance.now();
      const solution = await solvePow(ch.challenge, ch.difficulty, ctrl.signal);
      setSolveMs(Math.round(performance.now() - t0));

      setStage('submitting');
      const result = await login({
        username,
        password,
        challenge: ch.challenge,
        solution,
      });

      setToken(result.token);
      // ws-context will detect the new token and connect; the router will
      // render the Fleet page automatically on next render.
    } catch (err) {
      setStage('error');
      setError(err instanceof LoginError ? err.message : 'Login failed.');
    }
  }

  const submitting = stage === 'challenge' || stage === 'solving' || stage === 'submitting';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-sm border-border/60 shadow-md">
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2 text-brand-orange">
            <ShieldCheck className="h-5 w-5" />
            <CardTitle>OCPP Gateway · System Console</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">
            System-administration console for the gateway. Sign in to view service status,
            configuration, and connected components.
          </p>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="space-y-1">
              <label htmlFor="username" className="text-sm font-medium">
                Username
              </label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                disabled={submitting}
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                disabled={submitting}
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Sign-in failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !username || !password}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {stage === 'idle' || stage === 'error' ? 'Sign in' : null}
              {stage === 'challenge' ? 'Fetching challenge…' : null}
              {stage === 'solving' ? 'Verifying you are human…' : null}
              {stage === 'submitting' ? 'Signing in…' : null}
            </Button>

            <p className="pt-1 text-center text-xs text-muted-foreground">
              Anti-robot proof-of-work runs in your browser. Typical solve:{' '}
              {solveMs != null ? `${solveMs} ms` : '<1 s'}.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

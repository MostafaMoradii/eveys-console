// Login API client. Two calls in sequence:
//   1. /auth/challenge → server-issued PoW challenge.
//   2. compute solution in the browser (SHA-256 leading-zeros).
//   3. /auth/login    → returns JWT.

import { BAAS_BASE_URL as BASE } from '@/lib/baas-url';

interface ChallengeResponse {
  challenge: string;
  difficulty: number;
  expires_at: string;
}

interface LoginResponse {
  token: string;
  expires_at: string;
}

export class LoginError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

export async function fetchChallenge(): Promise<ChallengeResponse> {
  const res = await fetch(`${BASE}/auth/challenge`, { method: 'POST' });
  if (!res.ok) throw new LoginError('challenge fetch failed', 'challenge_failed', res.status);
  return (await res.json()) as ChallengeResponse;
}

export async function login(input: {
  username: string;
  password: string;
  challenge: string;
  solution: string;
}): Promise<LoginResponse> {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const code = body.error ?? `http_${res.status}`;
    const message =
      code === 'invalid_credentials'
        ? 'Username or password is incorrect.'
        : code === 'pow_invalid'
          ? 'Anti-robot check failed. Refresh and try again.'
          : code === 'login_disabled'
            ? 'Login is not configured on this server.'
            : res.status === 429
              ? 'Too many attempts. Wait a minute and try again.'
              : 'Login failed.';
    throw new LoginError(message, code, res.status);
  }
  return (await res.json()) as LoginResponse;
}

// Compute a solution to the server's PoW challenge:
// find a string s such that SHA-256(challenge + ':' + s) has at least
// `difficulty` leading zero BITS. Returns the solution string.
export async function solvePow(
  challenge: string,
  difficulty: number,
  signal?: AbortSignal,
): Promise<string> {
  const encoder = new TextEncoder();
  let counter = 0;
  // The solution must be deterministic per browser session-ish; using the
  // counter alone is fine because the server only checks the resulting
  // hash. We prefix with random bytes so two parallel tabs don't grind on
  // the same nonce.
  const prefix = crypto.randomUUID().slice(0, 8);
  while (true) {
    if (signal?.aborted) throw new Error('aborted');
    const solution = `${prefix}-${counter}`;
    const buf = encoder.encode(`${challenge}:${solution}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    if (hasLeadingZeroBits(digest, difficulty)) return solution;
    counter++;
    // Yield to the event loop occasionally to keep the UI responsive.
    if (counter % 256 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

function hasLeadingZeroBits(digest: Uint8Array, bits: number): boolean {
  let remaining = bits;
  for (const byte of digest) {
    if (remaining <= 0) return true;
    if (remaining >= 8) {
      if (byte !== 0) return false;
      remaining -= 8;
      continue;
    }
    const mask = 0xff << (8 - remaining);
    return (byte & mask) === 0;
  }
  return remaining <= 0;
}

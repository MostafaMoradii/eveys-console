// Typed client for the Console's firing-alerts proxy. The server side
// (`apps/server/src/routes/sys-alerts.ts`) talks to Alertmanager's v2
// API and re-shapes each entry into the same `Alert` type the existing
// client-derived panel renders, so this client returns a plain array
// of those.
//
// The route is fail-soft: on missing config / upstream wobble / parse
// error it returns `{ alerts: [], unavailable: true }` with HTTP 200.
// We surface `unavailable` to the hook so the panel can show its "not
// configured" hint instead of an error toast.

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';
import type { Alert } from '@/lib/alerts';

export interface FiringAlertsResponse {
  alerts: Alert[];
  unavailable: boolean;
}

export async function fetchFiringAlerts(token: string): Promise<FiringAlertsResponse> {
  const res = await fetch(`${BASE}/sys/alerts/firing`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/alerts/firing ${res.status}`);
  return (await res.json()) as FiringAlertsResponse;
}

// ---------------------------------------------------------------------------
// Silences
// ---------------------------------------------------------------------------

export type SilenceStatus = 'active' | 'pending' | 'expired';

export interface SilenceMatcher {
  name: string;
  value: string;
  is_regex: boolean;
  is_equal: boolean;
}

export interface Silence {
  id: string;
  matchers: SilenceMatcher[];
  starts_at: string;
  ends_at: string;
  comment: string;
  created_by: string;
  status: SilenceStatus;
}

export interface SilencesResponse {
  silences: Silence[];
  unavailable: boolean;
}

/** Input for `createSilence`. `starts_at` and `created_by` are optional —
 *  the server fills them with `now()` and the JWT subject when omitted. */
export interface CreateSilenceInput {
  matchers: Array<{ name: string; value: string; is_regex?: boolean; is_equal?: boolean }>;
  starts_at?: string;
  ends_at: string;
  comment?: string;
  created_by?: string;
}

export interface CreateSilenceResult {
  /** Set on success. */
  id?: string;
  /** Set when the upstream is missing or wedged; the UI surfaces a hint
   *  instead of an error toast in that case. */
  unavailable?: boolean;
}

export async function fetchSilences(token: string): Promise<SilencesResponse> {
  const res = await fetch(`${BASE}/sys/alerts/silences`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/alerts/silences ${res.status}`);
  return (await res.json()) as SilencesResponse;
}

export async function createSilence(
  token: string,
  input: CreateSilenceInput,
): Promise<CreateSilenceResult> {
  const res = await fetch(`${BASE}/sys/alerts/silences`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`POST sys/alerts/silences ${res.status}`);
  return (await res.json()) as CreateSilenceResult;
}

export async function expireSilence(token: string, id: string): Promise<void> {
  const res = await fetch(`${BASE}/sys/alerts/silences/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  // The server's "unavailable" envelope arrives as HTTP 200 with a JSON
  // body; success is HTTP 204. Anything else is a real error.
  if (res.status === 204) return;
  if (res.status === 200) {
    // Treat as a silent no-op from the caller's perspective. The next
    // refetch surfaces the unavailable banner.
    return;
  }
  throw new Error(`DELETE sys/alerts/silences ${res.status}`);
}

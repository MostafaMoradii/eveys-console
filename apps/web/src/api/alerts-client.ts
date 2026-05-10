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

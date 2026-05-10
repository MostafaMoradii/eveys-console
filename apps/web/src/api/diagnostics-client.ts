// Diagnostics receiver client. Three calls:
//
//   - issueDiagnostics(token, cpId, command)   → mints a one-use upload URL
//   - fetchDiagnostics(token, cpId)            → per-charger history
//   - deleteDiagnostic(token, id)              → drop the row + file
//
// Downloads are an `<a href>` constructed by the component (the URL
// carries the bearer token in a query param so a vanilla browser
// click can fetch it; the link is only ever generated client-side
// for the operator currently signed in).

import { CONSOLE_BASE_URL as BASE } from '@/lib/console-url';

export type DiagnosticsCommand = 'GetDiagnostics' | 'GetLog';
export type DiagnosticsStatus = 'pending' | 'uploaded' | 'expired' | 'failed';

export interface DiagnosticsArtifact {
  id: number;
  cp_id: string;
  command: DiagnosticsCommand;
  request_id: number;
  /** Unix epoch seconds — the server stores integers, not ISO strings. */
  issued_at: number;
  issued_by: string;
  expires_at: number;
  received_at: number | null;
  file_size: number | null;
  file_sha256: string | null;
  status: DiagnosticsStatus;
}

export interface DiagnosticsList {
  artifacts: DiagnosticsArtifact[];
  next_cursor: null;
}

export interface IssueResult {
  url: string;
  token: string;
  request_id: number;
  command: DiagnosticsCommand;
  expires_at: string;
}

export async function fetchDiagnostics(token: string, cpId: string): Promise<DiagnosticsList> {
  const url = `${BASE}/sys/diagnostics?cp_id=${encodeURIComponent(cpId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sys/diagnostics ${res.status}`);
  return (await res.json()) as DiagnosticsList;
}

export async function issueDiagnostics(
  token: string,
  cpId: string,
  command: DiagnosticsCommand,
  /** Optional explicit request_id — pass-through for GetLog. */
  requestId?: number,
): Promise<IssueResult> {
  const body: { cp_id: string; command: DiagnosticsCommand; request_id?: number } = {
    cp_id: cpId,
    command,
  };
  if (requestId !== undefined) body.request_id = requestId;

  const res = await fetch(`${BASE}/sys/diagnostics/issue`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `sys/diagnostics/issue ${res.status}`;
    try {
      const err = (await res.json()) as { error?: string; detail?: string };
      if (err?.error) message = `${err.error}${err.detail ? `: ${err.detail}` : ''}`;
    } catch {
      /* fall through */
    }
    throw new Error(message);
  }
  return (await res.json()) as IssueResult;
}

export async function deleteDiagnostic(token: string, id: number): Promise<void> {
  const res = await fetch(`${BASE}/sys/diagnostics/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/diagnostics ${res.status}`);
}

/** Build the auth-bearing download URL. The component renders this as
 *  an `<a href>` so a normal browser click triggers the file save. The
 *  URL embeds the bearer in a query param because `<a download>` doesn't
 *  let us set Authorization headers; this is only ever rendered for the
 *  operator currently signed in. */
export function downloadUrl(token: string, id: number): string {
  return `${BASE}/sys/diagnostics/${id}/download?access_token=${encodeURIComponent(token)}`;
}

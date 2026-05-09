// Operator-facing system status. Polled from SystemPage; cheap on the
// server side (one HTTP probe to the gateway + in-memory state).

const BASE = import.meta.env.VITE_BAAS_BASE_URL ?? 'http://127.0.0.1:8090';

export interface ComponentStatus {
  ok: boolean;
  detail?: string;
  latency_ms?: number;
}

export interface SysStatus {
  baas: { uptime_seconds: number; started_at: string };
  gateway: ComponentStatus & {
    version?: string;
    components?: Record<string, string>;
  };
  kafka: ComponentStatus & { topics?: string[]; consumer_running?: boolean };
  connections: { websockets: number };
}

export async function fetchSysStatus(token: string): Promise<SysStatus> {
  const res = await fetch(`${BASE}/sys/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sys/status ${res.status}`);
  return (await res.json()) as SysStatus;
}

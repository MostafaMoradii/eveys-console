// Pure-unit tests for the `computeAlerts` derivation. The helper is
// deterministic given a fixed clock; we feed it small handcrafted
// inputs and assert (rule, severity, id, count, ordering, suppression,
// truncation). No DOM, no React.

import { describe, expect, it } from 'vitest';

import type { ChargePointSummary } from '@eveys-console/protocol';

import type { SysStatus } from '@/api/sys-client';
import { computeAlerts, MAX_ALERTS, type Alert } from '@/lib/alerts';

// ---- fixtures ---------------------------------------------------------

const NOW_ISO = '2026-05-10T12:00:00.000Z';
const NOW_MS = new Date(NOW_ISO).getTime();
const fixedNow = () => NOW_MS;

type Connector = ChargePointSummary['connectors'][number];

function conn(over: Partial<Connector> = {}): Connector {
  return {
    connector_id: 1,
    status: 'Available',
    error_code: 'NoError',
    last_changed_at: null,
    ...over,
  };
}

function cp(over: Partial<ChargePointSummary> = {}): ChargePointSummary {
  return {
    cp_id: 'CP_A',
    online: true,
    pod_id: 'pod-1',
    vendor: 'Eveys',
    model: 'X1',
    firmware_version: '1.0.0',
    serial_number: 'SN1',
    last_boot_at: null,
    last_heartbeat_at: '2026-05-10T11:59:30.000Z',
    last_status: 'Available',
    connectors: [conn()],
    ...over,
  } as ChargePointSummary;
}

function healthySys(over: Partial<SysStatus> = {}): SysStatus {
  return {
    console: { uptime_seconds: 60, started_at: '2026-05-10T11:59:00.000Z' },
    gateway: { ok: true, latency_ms: 50, version: 'test' },
    kafka: { ok: true, consumer_running: true, topics: ['cp.events'] },
    connections: { websockets: 1 },
    ...over,
  };
}

const ids = (alerts: Alert[]) => alerts.map((a) => a.id);

// ---- tests ------------------------------------------------------------

describe('computeAlerts', () => {
  it('returns [] for empty input with no sys_status', () => {
    expect(computeAlerts({ charge_points: [], sys_status: null, now: fixedNow })).toEqual([]);
  });

  it('returns [] when everything is healthy and no chargers (without sys_status it stays quiet)', () => {
    expect(
      computeAlerts({ charge_points: [cp()], sys_status: healthySys(), now: fixedNow }),
    ).toEqual([]);
  });

  it('fires gateway-down when sys_status.gateway.ok === false', () => {
    const alerts = computeAlerts({
      charge_points: [],
      sys_status: healthySys({ gateway: { ok: false, detail: 'connect refused' } }),
      now: fixedNow,
    });
    expect(ids(alerts)).toContain('gateway-down');
    const gw = alerts.find((a) => a.id === 'gateway-down')!;
    expect(gw.severity).toBe('critical');
    expect(gw.detail).toMatch(/connect refused/);
  });

  it('fires kafka-down when sys_status.kafka.ok === false', () => {
    const alerts = computeAlerts({
      charge_points: [],
      sys_status: healthySys({ kafka: { ok: false, detail: 'consumer crashed' } }),
      now: fixedNow,
    });
    expect(ids(alerts)).toContain('kafka-down');
    const k = alerts.find((a) => a.id === 'kafka-down')!;
    expect(k.severity).toBe('critical');
  });

  it('produces one charger-faulted alert per faulted charger, id includes cp_id', () => {
    const alerts = computeAlerts({
      charge_points: [
        cp({
          cp_id: 'CP_A',
          connectors: [conn({ status: 'Faulted', error_code: 'GroundFailure' })],
        }),
        cp({ cp_id: 'CP_B', connectors: [conn({ status: 'Available' })] }),
        cp({ cp_id: 'CP_C', connectors: [conn({ status: 'Faulted', error_code: 'OverVoltage' })] }),
      ],
      sys_status: healthySys(),
      now: fixedNow,
    });
    const faultedIds = ids(alerts).filter((id) => id.startsWith('charger-faulted:'));
    expect(faultedIds).toEqual(['charger-faulted:CP_A', 'charger-faulted:CP_C']);
    expect(alerts.find((a) => a.id === 'charger-faulted:CP_A')?.severity).toBe('critical');
  });

  it('charger-offline-long does NOT fire for a charger that was never online (no last_heartbeat_at)', () => {
    const alerts = computeAlerts({
      charge_points: [cp({ cp_id: 'CP_NEW', online: false, last_heartbeat_at: null })],
      sys_status: healthySys(),
      now: fixedNow,
    });
    expect(ids(alerts).some((id) => id.startsWith('charger-offline-long:'))).toBe(false);
  });

  it('charger-offline-long fires when offline AND last_heartbeat_at > 30 min ago', () => {
    const fortyFiveMinAgo = new Date(NOW_MS - 45 * 60_000).toISOString();
    const alerts = computeAlerts({
      charge_points: [
        cp({ cp_id: 'CP_GONE', online: false, last_heartbeat_at: fortyFiveMinAgo }),
        // 10 min ago — under the threshold, no alert
        cp({
          cp_id: 'CP_BLIP',
          online: false,
          last_heartbeat_at: new Date(NOW_MS - 10 * 60_000).toISOString(),
        }),
      ],
      sys_status: healthySys(),
      now: fixedNow,
    });
    const offlineLong = ids(alerts).filter((id) => id.startsWith('charger-offline-long:'));
    expect(offlineLong).toEqual(['charger-offline-long:CP_GONE']);
    const a = alerts.find((x) => x.id === 'charger-offline-long:CP_GONE')!;
    expect(a.severity).toBe('warning');
    expect(a.title).toMatch(/CP_GONE offline 45m/);
    expect(a.since).toBe(fortyFiveMinAgo);
  });

  it('connector-error-advisory fires for OverCurrentFailure on an Available connector', () => {
    const alerts = computeAlerts({
      charge_points: [
        cp({
          cp_id: 'CP_A',
          connectors: [
            conn({ connector_id: 1, status: 'Available', error_code: 'OverCurrentFailure' }),
          ],
        }),
      ],
      sys_status: healthySys(),
      now: fixedNow,
    });
    expect(ids(alerts)).toContain('connector-advisory:CP_A:1');
    expect(alerts.find((a) => a.id === 'connector-advisory:CP_A:1')?.severity).toBe('warning');
  });

  it('connector-error-advisory does NOT fire when the same connector is Faulted (charger-faulted covers it)', () => {
    const alerts = computeAlerts({
      charge_points: [
        cp({
          cp_id: 'CP_A',
          connectors: [
            conn({ connector_id: 1, status: 'Faulted', error_code: 'OverCurrentFailure' }),
          ],
        }),
      ],
      sys_status: healthySys(),
      now: fixedNow,
    });
    expect(ids(alerts)).toContain('charger-faulted:CP_A');
    expect(ids(alerts).some((id) => id.startsWith('connector-advisory:'))).toBe(false);
  });

  it('gateway-stale fires when latency_ms > 2000', () => {
    const alerts = computeAlerts({
      charge_points: [],
      sys_status: healthySys({ gateway: { ok: true, latency_ms: 2500 } }),
      now: fixedNow,
    });
    expect(ids(alerts)).toContain('gateway-stale');
  });

  it('gateway-stale does NOT fire at latency_ms = 1500', () => {
    const alerts = computeAlerts({
      charge_points: [],
      sys_status: healthySys({ gateway: { ok: true, latency_ms: 1500 } }),
      now: fixedNow,
    });
    expect(ids(alerts)).not.toContain('gateway-stale');
  });

  it('no-charge-points fires when fleet is empty and gateway is healthy', () => {
    const alerts = computeAlerts({
      charge_points: [],
      sys_status: healthySys(),
      now: fixedNow,
    });
    expect(ids(alerts)).toContain('no-charge-points');
    expect(alerts.find((a) => a.id === 'no-charge-points')?.severity).toBe('info');
  });

  it('no-charge-points is suppressed when gateway-down is firing', () => {
    const alerts = computeAlerts({
      charge_points: [],
      sys_status: healthySys({ gateway: { ok: false, detail: 'down' } }),
      now: fixedNow,
    });
    expect(ids(alerts)).toContain('gateway-down');
    expect(ids(alerts)).not.toContain('no-charge-points');
  });

  it('sorts critical → warning → info, then by title ascending within severity', () => {
    const fortyFiveMinAgo = new Date(NOW_MS - 45 * 60_000).toISOString();
    const alerts = computeAlerts({
      charge_points: [
        // Two faulted (both critical), one offline-long (warning), one
        // advisory (warning). Plus the synthetic kafka-down + gateway-down
        // criticals. Title ordering must hold within each tier.
        cp({
          cp_id: 'CP_Z_FAULT',
          connectors: [conn({ status: 'Faulted', error_code: 'GroundFailure' })],
        }),
        cp({
          cp_id: 'CP_A_FAULT',
          connectors: [conn({ status: 'Faulted', error_code: 'GroundFailure' })],
        }),
        cp({
          cp_id: 'CP_OFF',
          online: false,
          last_heartbeat_at: fortyFiveMinAgo,
          connectors: [conn()],
        }),
        cp({
          cp_id: 'CP_ADV',
          connectors: [
            conn({ connector_id: 2, status: 'Available', error_code: 'HighTemperature' }),
          ],
        }),
      ],
      sys_status: healthySys({
        gateway: { ok: false, detail: 'gw' },
        kafka: { ok: false, detail: 'kafka' },
      }),
      now: fixedNow,
    });
    const severities = alerts.map((a) => a.severity);
    // No info row in this case; criticals come before warnings.
    const firstWarning = severities.indexOf('warning');
    const lastCritical = severities.lastIndexOf('critical');
    expect(lastCritical).toBeLessThan(firstWarning);
    // Within criticals, titles should be ascending.
    const criticalTitles = alerts.filter((a) => a.severity === 'critical').map((a) => a.title);
    const sortedCritical = [...criticalTitles].sort();
    expect(criticalTitles).toEqual(sortedCritical);
    // Within warnings, ditto.
    const warningTitles = alerts.filter((a) => a.severity === 'warning').map((a) => a.title);
    const sortedWarning = [...warningTitles].sort();
    expect(warningTitles).toEqual(sortedWarning);
  });

  it('truncates to MAX_ALERTS + 1 synthetic row when more would be returned', () => {
    // 51 faulted chargers will produce 51 critical alerts. We expect
    // 50 + 1 alerts-truncated info row at the end.
    const many = Array.from({ length: MAX_ALERTS + 1 }, (_, i) =>
      cp({
        // pad cp_id so titles sort lexicographically and truncation is
        // deterministic
        cp_id: `CP_${String(i).padStart(3, '0')}`,
        connectors: [conn({ status: 'Faulted', error_code: 'GroundFailure' })],
      }),
    );
    const alerts = computeAlerts({
      charge_points: many,
      sys_status: healthySys(),
      now: fixedNow,
    });
    expect(alerts).toHaveLength(MAX_ALERTS + 1);
    expect(alerts[MAX_ALERTS]!.id).toBe('alerts-truncated');
    expect(alerts[MAX_ALERTS]!.severity).toBe('info');
    expect(alerts[MAX_ALERTS]!.detail).toMatch(/1 additional alert/);
  });

  it('handles missing sys_status gracefully (returns just charger-derived rows)', () => {
    const alerts = computeAlerts({
      charge_points: [
        cp({
          cp_id: 'CP_F',
          connectors: [conn({ status: 'Faulted', error_code: 'GroundFailure' })],
        }),
      ],
      sys_status: null,
      now: fixedNow,
    });
    expect(ids(alerts)).toEqual(['charger-faulted:CP_F']);
  });
});

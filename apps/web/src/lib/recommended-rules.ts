// Curated alert rules an operator can install on the Rules tab with
// one click. These are intentionally conservative — thresholds chosen
// to fire on real problems, not on the first 5-second blip.
//
// Each rule maps 1:1 to a ManagedAlertingRule the server already knows
// how to validate (promtool) + persist (RulesStore). Names are stable
// so install/uninstall is idempotent: installing twice is a no-op,
// uninstalling looks up the rule by name.
//
// Metrics referenced here are emitted by the gateway and the Console
// (see deploy/observability/* and the prom-client wiring in
// apps/server/src/metrics). When a rule references a metric we don't
// currently emit, the rule still installs — Prometheus reports it as
// "no data" until the metric appears, which is the right failure mode
// for a recommendation pack.

import type { ManagedAlertingRule } from '@/api/alerts-client';

export interface RecommendedRule extends ManagedAlertingRule {
  /** One-liner shown next to the install button so the operator
   *  knows why this rule matters without reading the PromQL. */
  rationale: string;
}

export const RECOMMENDED_RULES: RecommendedRule[] = [
  {
    name: 'GatewayDown',
    expr: 'up{job="ocpp-gateway"} == 0',
    duration: '2m',
    severity: 'critical',
    summary: 'OCPP gateway scrape failing for {{ $labels.instance }}',
    description:
      'Prometheus has not scraped the gateway for 2 minutes. The pod is down, unreachable, or wedged.',
    rationale: 'Pages on a hard gateway outage. Two-minute window suppresses scrape blips.',
  },
  {
    name: 'ConsoleDown',
    expr: 'up{job="console"} == 0',
    duration: '2m',
    severity: 'critical',
    summary: 'Console scrape failing for {{ $labels.instance }}',
    description: 'Prometheus has not scraped the Console for 2 minutes.',
    rationale:
      "Pages when the Console itself goes dark — operator can't see the rest of the fleet.",
  },
  {
    name: 'WsDisconnectSpike',
    expr: 'rate(ocpp_ws_disconnects_total[5m]) > 5',
    duration: '5m',
    severity: 'warning',
    summary: 'WS disconnect rate elevated ({{ $value | printf "%.1f" }}/s)',
    description:
      'Chargers are dropping their WebSocket faster than 5/s averaged over 5 minutes. Network blip, gateway restart loop, or a fleet-wide auth issue.',
    rationale: 'Cheap signal for "something is shaking the fleet".',
  },
  {
    name: 'KafkaPublishErrorRate',
    expr: 'rate(kafka_publish_errors_total[5m]) > 0.1',
    duration: '10m',
    severity: 'warning',
    summary: 'Kafka publish errors above threshold ({{ $value | printf "%.2f" }}/s)',
    description:
      'The gateway is failing to publish event envelopes. Downstream consumers (Console broker, webhooks, ClickHouse ingestor) are missing data.',
    rationale: "Quiet failure mode — Kafka errors aren't user-visible without this.",
  },
  {
    name: 'ClickHouseIngestorLag',
    expr: 'kafka_consumer_group_lag{group="clickhouse-ingestor"} > 10000',
    duration: '15m',
    severity: 'warning',
    summary: 'ClickHouse ingestor lag {{ $value }} on partition {{ $labels.partition }}',
    description:
      'Ingestor is falling behind. The Console list page will show stale connectors[] until it catches up.',
    rationale: 'Detail-page "connectors" go stale when this fires.',
  },
  {
    name: 'AuthorizeFallbackActive',
    expr: 'increase(ocpp_authorize_fallback_total[10m]) > 0',
    duration: '10m',
    severity: 'info',
    summary: 'Authorize fallback is accepting offline ({{ $value | printf "%.0f" }} in 10m)',
    description:
      'The backend Authorize endpoint is failing and the gateway is accepting transactions on the offline fallback. Revenue protection — investigate the backend before sessions accumulate.',
    rationale: 'Critical for billing integrity; info severity because charging still works.',
  },
  {
    name: 'FleetFaultRate',
    expr: 'rate(ocpp_status_notifications_total{status="Faulted"}[5m]) > 1',
    duration: '5m',
    severity: 'warning',
    summary: 'Fault rate elevated ({{ $value | printf "%.1f" }}/s) across the fleet',
    description:
      'More than one StatusNotification with status=Faulted per second over 5 minutes. Hardware regression, firmware rollout going badly, or correlated environmental issue.',
    rationale: 'Hardware fleet-health canary.',
  },
  {
    name: 'ConsoleErrorRate',
    expr: 'rate(http_requests_total{job="console",status=~"5.."}[5m]) > 0.5',
    duration: '5m',
    severity: 'critical',
    summary: 'Console 5xx rate {{ $value | printf "%.1f" }}/s',
    description:
      'The Console server is returning HTTP 5xx faster than 0.5/s. Routes are throwing or the upstream gateway is wedged.',
    rationale: 'User-visible failure — pages anyone working in the Console.',
  },
  {
    name: 'ChargerOffline',
    // Per-cp. Fires once per charger that has stopped heartbeating for
    // 10+ minutes. Suitable for small fleets and dev/test where the
    // operator wants to know about a single device. At fleet scale
    // this is noisy on every reboot — pair it with a silence or skip
    // it in favour of FleetHeartbeatMiss.
    expr: 'time() - ocpp_cp_last_heartbeat_seconds > 600',
    duration: '10m',
    severity: 'warning',
    summary: 'Charger {{ $labels.cp_id }} offline (no heartbeat for 10+ min)',
    description:
      'Charger {{ $labels.cp_id }} has not sent a heartbeat for more than 10 minutes. The device is powered off, lost network, or wedged. Check the device locally if accessible.',
    rationale:
      'The single-charger version of FleetHeartbeatMiss — useful for small fleets and dev/test.',
  },
  {
    name: 'FleetHeartbeatMiss',
    expr: 'count(time() - ocpp_cp_last_heartbeat_seconds > 600) > 10',
    duration: '10m',
    severity: 'warning',
    summary: '{{ $value }} chargers have not heartbeat in 10+ minutes',
    description:
      'More than 10 chargers are silently offline (no heartbeat for >10m). A site outage, partial network failure, or backend Authorize regression.',
    rationale: 'Catches "10 chargers in one site went dark" before the customer calls.',
  },
  {
    name: 'GatewayDiskFilling',
    expr: '(node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) < 0.10',
    duration: '15m',
    severity: 'warning',
    summary: 'Gateway disk usage above 90% on {{ $labels.instance }}',
    description:
      'Root filesystem has under 10% free for 15 minutes. Log rotation backed up, runaway crash dumps, or someone forgot to clean /tmp.',
    rationale: 'Generic but always useful — disk-full causes hard-to-debug failures elsewhere.',
  },
];

/** True when a rule with the same `name` is already in the installed
 *  managed list. Used by the UI to swap the "Install" button for an
 *  "Uninstall" button without re-fetching. */
export function isInstalled(name: string, installed: readonly { name: string }[]): boolean {
  return installed.some((r) => r.name === name);
}

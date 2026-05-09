// Per-named-query resolvers. Each one knows:
//   - how to fetch the snapshot from the gateway
//   - which Kafka events affect a subscription with given params
//   - how to render an event into a delta the client can apply
//
// New named queries are added here; the protocol package's enum and
// snapshotForQuery / deltaForQuery shapes are updated in lockstep.

import type {
  ChargePointSummary,
  DeltaForQuery,
  QueryName,
  QueryParams,
  SnapshotForQuery,
} from '@eveys-console/protocol';

import type { GatewayClient } from '../rest/gateway-client.js';
import type { KafkaEvent } from '../kafka/tail.js';
import type { Delta, Snapshot } from './types.js';

interface QueryResolver {
  snapshot(params: QueryParams, gateway: GatewayClient): Promise<Snapshot>;
  deltaFromEvent(params: QueryParams, event: KafkaEvent): Delta | null;
}

const chargePoints: QueryResolver = {
  async snapshot(params, gateway) {
    const filter: { online?: boolean; vendor?: string; limit?: number } = {};
    if (typeof params.online === 'boolean') filter.online = params.online;
    if (typeof params.vendor === 'string') filter.vendor = params.vendor;
    if (typeof params.limit === 'number') filter.limit = params.limit;
    const data = (await gateway.listChargePoints(filter)) as { charge_points: ChargePointSummary[] };
    const cursor = `gw:cp-list:${Date.now()}`;
    const snapshot: SnapshotForQuery = { kind: 'charge-points', rows: data.charge_points };
    return { cursor, snapshot };
  },
  deltaFromEvent(params, event) {
    if (event.topic !== 'cp.boot' && event.topic !== 'cp.status') return null;
    if (!event.cpId) return null;
    // The gateway publishes the full ChargePointSummary on cp.boot / cp.status
    // (per proto/events/v1/events.proto). We forward it as an upsert so
    // FleetPage's table renders the new state immediately. If the row's
    // membership conflicts with the active filter (e.g. the table is
    // online=true and the event reports online=false), apply filter rules:
    const row = event.payload as Partial<ChargePointSummary> | null;
    if (!row || typeof row !== 'object' || typeof row.cp_id !== 'string') return null;

    if (typeof params.online === 'boolean' && typeof row.online === 'boolean') {
      if (row.online !== params.online) {
        return {
          cursor: event.cursor,
          delta: { kind: 'charge-points', op: 'remove', cp_id: row.cp_id },
        };
      }
    }
    if (typeof params.vendor === 'string' && typeof row.vendor === 'string') {
      if (row.vendor !== params.vendor) {
        return {
          cursor: event.cursor,
          delta: { kind: 'charge-points', op: 'remove', cp_id: row.cp_id },
        };
      }
    }

    return {
      cursor: event.cursor,
      delta: {
        kind: 'charge-points',
        op: 'upsert',
        row: row as ChargePointSummary,
      },
    };
  },
};

const chargePoint: QueryResolver = {
  async snapshot(params, gateway) {
    const cpId = stringParam(params, 'cp_id');
    const data = (await gateway.getChargePoint(cpId)) as ChargePointSummary;
    const cursor = `gw:cp:${cpId}:${Date.now()}`;
    return { cursor, snapshot: { kind: 'charge-point', row: data } };
  },
  deltaFromEvent(params, event) {
    const cpId = stringParam(params, 'cp_id');
    if (event.cpId !== cpId) return null;
    if (event.topic !== 'cp.boot' && event.topic !== 'cp.status') return null;
    // Client re-fetches detail on delta; v1 keeps the broker stateless. The
    // delta carries a diff hint via the event payload so the UI can show
    // "this charger's status just changed" without waiting for the refetch.
    const row = event.payload as ChargePointSummary;
    const delta: DeltaForQuery = { kind: 'charge-point', row };
    return { cursor: event.cursor, delta };
  },
};

const transactionsActive: QueryResolver = {
  async snapshot(_params, gateway) {
    const data = (await gateway.listActiveTransactions()) as { transactions: unknown[] };
    const cursor = `gw:tx-active:${Date.now()}`;
    return {
      cursor,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshot: { kind: 'transactions-active', rows: data.transactions as any[] },
    };
  },
  deltaFromEvent(_params, event) {
    if (event.topic !== 'tx.started') return null;
    // protobufjs decodes proto3 snake_case field names to camelCase by
    // default, so the inner payload keys here are transactionId,
    // connectorId, idTag, meterStartWh, chargerReportedAt — not
    // transaction_id etc. Map them to the wire shape the UI expects
    // (TransactionSummary in @eveys-console/protocol).
    const p = event.payload as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') return null;
    const row = {
      transaction_id: Number(p.transactionId ?? 0),
      cp_id: event.cpId ?? '',
      connector_id: Number(p.connectorId ?? 0),
      id_tag: String(p.idTag ?? ''),
      start_at: String(p.chargerReportedAt ?? event.timestamp.toISOString()),
      meter_start: Number(p.meterStartWh ?? 0),
      meter_last: null,
      energy_delivered_wh: null,
      active: true,
      last_seen_seq: 0,
    };
    return {
      cursor: event.cursor,
      delta: { kind: 'transactions-active', op: 'upsert', row },
    };
  },
};

const meterHistory: QueryResolver = {
  async snapshot() {
    // v1: snapshot is empty; meter history grows from the live tail.
    // Phase 2: back this with a ClickHouse-fed paginated read.
    return {
      cursor: `gw:meter:bootstrap:${Date.now()}`,
      snapshot: { kind: 'meter-history', rows: [] },
    };
  },
  deltaFromEvent(params, event) {
    if (event.topic !== 'cp.meter') return null;
    const cpId = stringParam(params, 'cp_id');
    if (event.cpId !== cpId) return null;
    return {
      cursor: event.cursor,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delta: { kind: 'meter-history', append: event.payload as any },
    };
  },
};

const statusHistory: QueryResolver = {
  async snapshot() {
    return {
      cursor: `gw:status:bootstrap:${Date.now()}`,
      snapshot: { kind: 'status-history', rows: [] },
    };
  },
  deltaFromEvent(params, event) {
    if (event.topic !== 'cp.status') return null;
    const cpId = stringParam(params, 'cp_id');
    if (event.cpId !== cpId) return null;
    return {
      cursor: event.cursor,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delta: { kind: 'status-history', append: event.payload as any },
    };
  },
};

const RESOLVERS: Record<QueryName, QueryResolver> = {
  'charge-points': chargePoints,
  'charge-point': chargePoint,
  'transactions-active': transactionsActive,
  'meter-history': meterHistory,
  'status-history': statusHistory,
};

export function resolveQuery(name: QueryName): QueryResolver {
  return RESOLVERS[name];
}

function stringParam(params: QueryParams, key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing or invalid string param: ${key}`);
  }
  return v;
}

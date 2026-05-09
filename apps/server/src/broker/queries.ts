// Per-named-query resolvers. Each one knows:
//   - how to fetch the snapshot from the gateway
//   - which Kafka events affect a subscription with given params
//   - how to render an event into deltas the client can apply
//
// New named queries are added here; the protocol package's enum and
// snapshotForQuery / deltaForQuery shapes are updated in lockstep.
//
// Wire format note: Kafka payloads coming in are protobuf-decoded via
// `protobufjs`, which produces camelCase field names from the
// snake_case .proto source. So the inner payload keys here are
// `transactionId`, `connectorId`, `chargerReportedAt`, etc. The
// protocol's wire shape is snake_case, so each resolver maps between
// the two.

import type {
  ChargePointSummary,
  DeltaForQuery,
  MeterSample,
  QueryName,
  QueryParams,
  SnapshotForQuery,
  StatusEvent,
} from '@eveys-console/protocol';

import type { GatewayClient } from '../rest/gateway-client.js';
import type { KafkaEvent } from '../kafka/tail.js';
import type { Delta, Snapshot } from './types.js';

interface QueryResolver {
  snapshot(params: QueryParams, gateway: GatewayClient): Promise<Snapshot>;
  // Returns zero, one, or many deltas. A single Kafka event can fan
  // out (one MeterValues report with N samples → N appends), or be
  // filtered out entirely by params, or trigger a re-fetch
  // (cp.boot/cp.status → re-read GET /charge-points/:cp_id from the
  // gateway).
  deltasFromEvent(
    params: QueryParams,
    event: KafkaEvent,
    gateway: GatewayClient,
  ): Promise<Delta[]>;
}

const chargePoints: QueryResolver = {
  async snapshot(params, gateway) {
    const filter: { online?: boolean; vendor?: string; limit?: number; cursor?: string } = {};
    if (typeof params.online === 'boolean') filter.online = params.online;
    if (typeof params.vendor === 'string') filter.vendor = params.vendor;
    if (typeof params.limit === 'number') filter.limit = params.limit;
    if (typeof params.cursor === 'string') filter.cursor = params.cursor;
    const data = (await gateway.listChargePoints(filter)) as {
      charge_points: ChargePointSummary[];
      next_cursor?: string | null;
    };
    const cursor = `gw:cp-list:${Date.now()}`;
    const snapshot: SnapshotForQuery = {
      kind: 'charge-points',
      rows: data.charge_points,
      next_cursor: data.next_cursor ?? null,
    };
    return { cursor, snapshot };
  },
  async deltasFromEvent(params, event, gateway) {
    if (event.topic !== 'cp.boot' && event.topic !== 'cp.status') return [];
    if (!event.cpId) return [];

    // The Kafka event payload only carries a small subset of the
    // ChargePointSummary fields. Re-fetch the full row from the
    // gateway so the UI can merge a complete record. Cost: one HTTP
    // call per event. Acceptable while load is low; a future commit
    // will replace this with an in-memory snapshot store fed by the
    // same Kafka tail.
    let row: ChargePointSummary;
    try {
      row = (await gateway.getChargePoint(event.cpId)) as ChargePointSummary;
    } catch {
      return [];
    }

    if (typeof params.online === 'boolean' && row.online !== params.online) {
      return [
        {
          cursor: event.cursor,
          delta: { kind: 'charge-points', op: 'remove', cp_id: row.cp_id },
        },
      ];
    }
    if (typeof params.vendor === 'string' && row.vendor !== params.vendor) {
      return [
        {
          cursor: event.cursor,
          delta: { kind: 'charge-points', op: 'remove', cp_id: row.cp_id },
        },
      ];
    }
    return [
      {
        cursor: event.cursor,
        delta: { kind: 'charge-points', op: 'upsert', row },
      },
    ];
  },
};

const chargePoint: QueryResolver = {
  async snapshot(params, gateway) {
    const cpId = stringParam(params, 'cp_id');
    const data = (await gateway.getChargePoint(cpId)) as ChargePointSummary;
    const cursor = `gw:cp:${cpId}:${Date.now()}`;
    return { cursor, snapshot: { kind: 'charge-point', row: data } };
  },
  async deltasFromEvent(params, event, gateway) {
    const cpId = stringParam(params, 'cp_id');
    if (event.cpId !== cpId) return [];
    if (event.topic !== 'cp.boot' && event.topic !== 'cp.status') return [];

    // Same approach as the list resolver: re-fetch the full row from
    // the gateway so the UI gets a complete update. This page is one
    // charger so the cost is bounded.
    let row: ChargePointSummary;
    try {
      row = (await gateway.getChargePoint(cpId)) as ChargePointSummary;
    } catch {
      return [];
    }
    const delta: DeltaForQuery = { kind: 'charge-point', row };
    return [{ cursor: event.cursor, delta }];
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
  async deltasFromEvent(_params, event) {
    if (event.topic !== 'tx.started') return [];
    const p = event.payload as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') return [];
    // The wire shape mirrors the gateway's GET /api/v1/transactions row.
    // For a delta from a tx.started event we only have a subset; the
    // missing fields (stopped_*, consumed_wh) are null because the
    // session is still open.
    const row = {
      transaction_id: Number(p.transactionId ?? 0),
      cp_id: event.cpId ?? '',
      connector_id: Number(p.connectorId ?? 0),
      id_tag: String(p.idTag ?? ''),
      meter_start_wh: Number(p.meterStartWh ?? 0),
      meter_stop_wh: null,
      consumed_wh: null,
      started_reported_at: String(p.chargerReportedAt ?? event.timestamp.toISOString()),
      started_received_at: event.timestamp.toISOString(),
      stopped_reported_at: null,
      stopped_received_at: null,
      stop_reason: null,
    };
    return [
      {
        cursor: event.cursor,
        delta: { kind: 'transactions-active', op: 'upsert', row },
      },
    ];
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
  async deltasFromEvent(params, event) {
    if (event.topic !== 'cp.meter') return [];
    const cpId = stringParam(params, 'cp_id');
    if (event.cpId !== cpId) return [];

    // CpMeter payload (camelCase): connectorId, transactionId,
    // sampledValues[], chargerReportedAt. One OCPP MeterValues report
    // can carry many sampled values; emit one delta per value so each
    // is independently appendable to the UI's chart.
    const p = event.payload as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') return [];
    const samplesRaw = p.sampledValues;
    const samples = Array.isArray(samplesRaw) ? samplesRaw : [];
    if (samples.length === 0) return [];

    const connectorId = Number(p.connectorId ?? 0);
    const transactionId = p.transactionId != null ? Number(p.transactionId) : null;
    const recordedAt = String(p.chargerReportedAt ?? event.timestamp.toISOString());
    const sourceCpId = event.cpId ?? cpId;

    const out: Delta[] = [];
    for (const sv of samples) {
      if (!sv || typeof sv !== 'object') continue;
      const s = sv as Record<string, unknown>;
      const valueRaw = s.value;
      if (valueRaw == null) continue;
      const value = typeof valueRaw === 'number' ? valueRaw : Number(valueRaw);
      if (!Number.isFinite(value)) continue;

      const sample: MeterSample = {
        cp_id: sourceCpId,
        transaction_id: transactionId,
        connector_id: connectorId,
        measurand: enumToString(s.measurand) ?? 'Energy.Active.Import.Register',
        value,
        unit: enumToString(s.unit),
        recorded_at: recordedAt,
      };
      out.push({
        cursor: event.cursor,
        delta: { kind: 'meter-history', append: sample },
      });
    }
    return out;
  },
};

const statusHistory: QueryResolver = {
  async snapshot() {
    return {
      cursor: `gw:status:bootstrap:${Date.now()}`,
      snapshot: { kind: 'status-history', rows: [] },
    };
  },
  async deltasFromEvent(params, event) {
    if (event.topic !== 'cp.status') return [];
    const cpId = stringParam(params, 'cp_id');
    if (event.cpId !== cpId) return [];

    // CpStatus payload (camelCase): connectorId, status, errorCode,
    // info, vendorId, vendorErrorCode, chargerReportedAt.
    const p = event.payload as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') return [];

    const sample: StatusEvent = {
      cp_id: event.cpId ?? cpId,
      connector_id: Number(p.connectorId ?? 0),
      status: String(p.status ?? ''),
      error_code: nullableString(p.errorCode),
      info: nullableString(p.info),
      reported_at: String(p.chargerReportedAt ?? event.timestamp.toISOString()),
    };
    return [
      {
        cursor: event.cursor,
        delta: { kind: 'status-history', append: sample },
      },
    ];
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

// Empty strings → null. proto strings can't be unset in proto3, so
// "" is the wire representation of "absent" and the protocol's wire
// shape uses nullable strings.
function nullableString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') return String(v);
  if (v === '') return null;
  return v;
}

// protobufjs decodes proto enums to their full string name (e.g.
// "UNIT_WH", "MEASURAND_VOLTAGE"). The wire shape just wants the
// user-readable suffix, so strip the type prefix. Filters out the
// proto3 zero-value "*_UNSPECIFIED" so consumers get null rather
// than a meaningless string.
function enumToString(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  if (v === '' || v.endsWith('_UNSPECIFIED')) return null;
  const idx = v.indexOf('_');
  return idx >= 0 ? v.slice(idx + 1) : v;
}

import { z } from 'zod';

export const queryName = z.enum([
  'charge-points',
  'charge-point',
  'transactions-active',
  'meter-history',
  'status-history',
]);
export type QueryName = z.infer<typeof queryName>;

export const queryParams = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export type QueryParams = z.infer<typeof queryParams>;

// The gateway emits ISO-8601 with explicit +00:00 offset (Python isoformat).
// Use offset:true so zod accepts both `Z` and `±HH:MM`.
const isoTimestamp = z.string().datetime({ offset: true });

export const connectorState = z.object({
  connector_id: z.number().int().nonnegative(),
  status: z.string(),
  error_code: z.string().nullable(),
  last_changed_at: isoTimestamp.nullable(),
});

// Mirrors the gateway's `GET /api/v1/charge-points` row shape (see
// docs/integration/02-gateway-rest-api.md). Anything the gateway can
// omit on a row must be `.nullable()` here, and anything the gateway
// adds in a future minor must be tolerated by the schema (see the
// `.passthrough()` at the bottom — accepts unknown fields rather than
// rejecting the whole row).
export const chargePointSummary = z
  .object({
    cp_id: z.string(),
    online: z.boolean(),
    pod_id: z.string().nullable(),
    vendor: z.string().nullable(),
    model: z.string().nullable(),
    firmware_version: z.string().nullable(),
    serial_number: z.string().nullable(),
    last_boot_at: isoTimestamp.nullable(),
    last_heartbeat_at: isoTimestamp.nullable(),
    last_status: z.string().nullable(),
    last_diagnostics_status: z.string().nullable().optional(),
    last_firmware_status: z.string().nullable().optional(),
    connectors: z.array(connectorState),
  })
  .passthrough();
export type ChargePointSummary = z.infer<typeof chargePointSummary>;

// Mirrors the gateway's transaction row shape (see #129/#130 PR).
// `started_reported_at` is the OCPP timestamp claimed by the charger;
// `started_received_at` is the gateway's wall-clock receive time.
// `meter_*_wh` and `consumed_wh` are integer Wh as the OCPP 1.6 native
// unit. `consumed_wh = meter_stop_wh - meter_start_wh` when stopped.
export const transactionSummary = z
  .object({
    transaction_id: z.number().int(),
    cp_id: z.string(),
    connector_id: z.number().int().nonnegative(),
    id_tag: z.string(),
    meter_start_wh: z.number(),
    meter_stop_wh: z.number().nullable(),
    consumed_wh: z.number().nullable(),
    started_reported_at: isoTimestamp,
    started_received_at: isoTimestamp,
    stopped_reported_at: isoTimestamp.nullable(),
    stopped_received_at: isoTimestamp.nullable(),
    stop_reason: z.string().nullable(),
  })
  .passthrough();
export type TransactionSummary = z.infer<typeof transactionSummary>;

// Live MeterValues sample. Produced server-side by the Console broker
// (one per `sampledValue` in the gateway's Kafka cp.meter event).
export const meterSample = z.object({
  cp_id: z.string(),
  transaction_id: z.number().int().nullable(),
  connector_id: z.number().int().nonnegative(),
  measurand: z.string(),
  value: z.number(),
  unit: z.string().nullable(),
  recorded_at: isoTimestamp,
});
export type MeterSample = z.infer<typeof meterSample>;

// Live StatusNotification, mapped server-side.
export const statusEvent = z.object({
  cp_id: z.string(),
  connector_id: z.number().int().nonnegative(),
  status: z.string(),
  error_code: z.string().nullable(),
  info: z.string().nullable(),
  reported_at: isoTimestamp,
});
export type StatusEvent = z.infer<typeof statusEvent>;

export const snapshotForQuery = z.union([
  z.object({
    kind: z.literal('charge-points'),
    rows: z.array(chargePointSummary),
    // Cursor-paginated snapshot: pass back to subscribe to get the
    // next page. `null` means "you're on the last page".
    next_cursor: z.string().nullable().optional(),
  }),
  z.object({ kind: z.literal('charge-point'), row: chargePointSummary }),
  z.object({ kind: z.literal('transactions-active'), rows: z.array(transactionSummary) }),
  z.object({ kind: z.literal('meter-history'), rows: z.array(meterSample) }),
  z.object({ kind: z.literal('status-history'), rows: z.array(statusEvent) }),
]);
export type SnapshotForQuery = z.infer<typeof snapshotForQuery>;

export const deltaForQuery = z.union([
  z.object({
    kind: z.literal('charge-points'),
    op: z.enum(['upsert', 'remove']),
    row: chargePointSummary.optional(),
    cp_id: z.string().optional(),
  }),
  z.object({ kind: z.literal('charge-point'), row: chargePointSummary }),
  z.object({
    kind: z.literal('transactions-active'),
    op: z.enum(['upsert', 'remove']),
    row: transactionSummary.optional(),
    transaction_id: z.number().int().optional(),
  }),
  z.object({ kind: z.literal('meter-history'), append: meterSample }),
  z.object({ kind: z.literal('status-history'), append: statusEvent }),
]);
export type DeltaForQuery = z.infer<typeof deltaForQuery>;

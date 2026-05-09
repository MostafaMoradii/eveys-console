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

const isoTimestamp = z.string().datetime();

export const connectorState = z.object({
  connector_id: z.number().int().nonnegative(),
  status: z.string(),
  error_code: z.string().nullable(),
  last_changed_at: isoTimestamp.nullable(),
});

export const chargePointSummary = z.object({
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
  last_seen_seq: z.number().int().nonnegative(),
  connectors: z.array(connectorState),
});
export type ChargePointSummary = z.infer<typeof chargePointSummary>;

export const transactionSummary = z.object({
  transaction_id: z.number().int(),
  cp_id: z.string(),
  connector_id: z.number().int().nonnegative(),
  id_tag: z.string(),
  start_at: isoTimestamp,
  meter_start: z.number(),
  meter_last: z.number().nullable(),
  energy_delivered_wh: z.number().nullable(),
  active: z.boolean(),
  last_seen_seq: z.number().int().nonnegative(),
});
export type TransactionSummary = z.infer<typeof transactionSummary>;

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
  z.object({ kind: z.literal('charge-points'), rows: z.array(chargePointSummary) }),
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

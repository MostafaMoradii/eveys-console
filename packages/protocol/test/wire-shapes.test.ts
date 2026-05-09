// Wire-shape regression tests. The fixtures here are real responses
// from the OCPP gateway's REST endpoints, captured live (see
// /Users/mostafa/eveys/ocpp/docs/integration/02-gateway-rest-api.md).
// If a fixture stops parsing, the protocol schema and the gateway have
// drifted apart — fix one or the other; do not weaken the assertion.

import { describe, expect, it } from 'vitest';

import {
  chargePointSummary,
  serverMessage,
  PROTOCOL_VERSION,
  transactionSummary,
} from '../src/index.js';

const REAL_CHARGE_POINT_ROW = {
  cp_id: 'AE0022G1GNAC00617X',
  online: false,
  pod_id: null,
  vendor: 'Eveys',
  model: 'Eveys-22kW-AC',
  firmware_version: '1.0.0',
  serial_number: 'AE0022G1GNAC00617X',
  last_boot_at: '2026-05-09T16:19:40.985217+00:00',
  last_heartbeat_at: '2026-05-09T16:16:37.673342+00:00',
  last_status: 'Available',
  last_diagnostics_status: null,
  last_firmware_status: null,
  connectors: [
    {
      connector_id: 1,
      status: 'Available',
      error_code: 'NoError',
      last_changed_at: '2026-05-09T16:19:41.042000+00:00',
    },
  ],
};

const REAL_TRANSACTION_ROW = {
  transaction_id: 1,
  cp_id: 'AE0022G1GNAC00617X',
  connector_id: 1,
  id_tag: 'RFID_VALID_001',
  meter_start_wh: 1820968,
  meter_stop_wh: null,
  consumed_wh: null,
  started_reported_at: '2026-05-09T10:36:00.489000+00:00',
  started_received_at: '2026-05-09T10:36:00.498751+00:00',
  stopped_reported_at: null,
  stopped_received_at: null,
  stop_reason: null,
};

describe('wire shapes — parse live gateway responses', () => {
  it('chargePointSummary accepts a real /charge-points row', () => {
    const result = chargePointSummary.safeParse(REAL_CHARGE_POINT_ROW);
    expect(result.success).toBe(true);
  });

  it('chargePointSummary accepts +00:00 offset timestamps', () => {
    // Z and ±HH:MM must both parse — the gateway uses Python isoformat
    // (offset) but other producers may emit Z. Both are valid ISO 8601.
    const withZ = { ...REAL_CHARGE_POINT_ROW, last_boot_at: '2026-05-09T16:19:40Z' };
    expect(chargePointSummary.safeParse(withZ).success).toBe(true);
  });

  it('chargePointSummary tolerates new fields the gateway adds later', () => {
    // We use .passthrough() so unknown fields don't break the parse.
    const withExtra = { ...REAL_CHARGE_POINT_ROW, future_field: 'whatever' };
    expect(chargePointSummary.safeParse(withExtra).success).toBe(true);
  });

  it('transactionSummary accepts a real /transactions row', () => {
    const result = transactionSummary.safeParse(REAL_TRANSACTION_ROW);
    expect(result.success).toBe(true);
  });

  it('serverMessage accepts a snapshot envelope with real rows', () => {
    const result = serverMessage.safeParse({
      v: PROTOCOL_VERSION,
      type: 'snapshot',
      subscriptionId: 's-real',
      cursor: 'gw:cp-list:1',
      snapshot: { kind: 'charge-points', rows: [REAL_CHARGE_POINT_ROW] },
    });
    expect(result.success).toBe(true);
  });
});

// Resolver tests for the `device-events` query — the per-charger
// merged stream of cp.boot / cp.status / cp.meter / tx.started.
// We drive the resolver directly (not the full Broker) because the
// only behaviour worth covering here is the topic-to-DeviceEvent
// mapping, the cp_id filter, and the malformed-payload guards.
// Broker plumbing is exercised by broker.test.ts.

import { describe, expect, it } from 'vitest';

import { resolveQuery } from '../src/broker/queries.js';
import type { GatewayClient } from '../src/rest/gateway-client.js';
import type { KafkaEvent } from '../src/kafka/tail.js';

// The resolver doesn't touch the gateway, but the QueryResolver
// signature still demands one. A typed empty object cast through
// `unknown` keeps strict mode happy without pulling in fake
// implementations the resolver never calls.
const gateway = {} as unknown as GatewayClient;

function evt(over: Partial<KafkaEvent> & Pick<KafkaEvent, 'topic'>): KafkaEvent {
  return {
    cpId: 'CP_A',
    cursor: 'k:cursor:0:1',
    timestamp: new Date('2026-05-10T12:00:00Z'),
    payload: {},
    ...over,
  };
}

async function run(params: Record<string, unknown>, event: KafkaEvent) {
  const resolver = resolveQuery('device-events');
  return resolver.deltasFromEvent(params, event, gateway);
}

describe('device-events — snapshot', () => {
  it('returns empty rows with a bootstrap cursor', async () => {
    const resolver = resolveQuery('device-events');
    const snap = await resolver.snapshot({ cp_id: 'CP_A' }, gateway);
    expect(snap.snapshot.kind).toBe('device-events');
    if (snap.snapshot.kind === 'device-events') {
      expect(snap.snapshot.rows).toEqual([]);
    }
    expect(snap.cursor).toMatch(/^gw:device-events:bootstrap:/);
  });
});

describe('device-events — cp_id filter', () => {
  it('returns no deltas when the event is for a different cp_id', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'cp.boot',
        cpId: 'CP_B',
        payload: { vendor: 'ACME', model: 'X1', firmwareVersion: '1.0' },
      }),
    );
    expect(out).toEqual([]);
  });

  it('throws when cp_id param is missing — the WS layer validates this upstream', async () => {
    await expect(run({}, evt({ topic: 'cp.boot' }))).rejects.toThrow(/cp_id/);
  });
});

describe('device-events — cp.boot', () => {
  it('renders the boot summary from vendor/model/firmware', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'cp.boot',
        cursor: 'k:cp.boot:0:1',
        payload: {
          vendor: 'ACME',
          model: 'X1',
          firmwareVersion: '1.2.3',
          serialNumber: 'SN-001',
          chargePointStatus: 'Available',
          chargerReportedAt: '2026-05-10T11:59:30Z',
        },
      }),
    );
    expect(out).toHaveLength(1);
    const d = out[0]!.delta;
    expect(d.kind).toBe('device-events');
    if (d.kind !== 'device-events') return;
    expect(d.append.kind).toBe('boot');
    expect(d.append.summary).toBe('BootNotification — ACME X1 fw 1.2.3');
    expect(d.append.connector_id).toBeNull();
    expect(d.append.at).toBe('2026-05-10T11:59:30Z');
    expect(d.append.detail).toEqual({
      vendor: 'ACME',
      model: 'X1',
      firmware_version: '1.2.3',
      serial_number: 'SN-001',
      charge_point_status: 'Available',
    });
  });

  it('omits missing parts from the summary and nulls empty detail strings', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({ topic: 'cp.boot', payload: { vendor: 'ACME', model: '', firmwareVersion: '' } }),
    );
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.summary).toBe('BootNotification — ACME');
    expect(d.append.detail).toMatchObject({
      vendor: 'ACME',
      model: null,
      firmware_version: null,
      serial_number: null,
      charge_point_status: null,
    });
  });

  it('falls back to the gateway-received timestamp when chargerReportedAt is missing', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'cp.boot',
        timestamp: new Date('2026-05-10T12:30:00.000Z'),
        payload: { vendor: 'ACME', model: 'X1', firmwareVersion: '1.0' },
      }),
    );
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.at).toBe('2026-05-10T12:30:00.000Z');
  });
});

describe('device-events — cp.status', () => {
  it('renders the status summary with the error suffix when non-NoError', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'cp.status',
        payload: {
          connectorId: 2,
          status: 'Faulted',
          errorCode: 'GroundFailure',
          info: 'detected at boot',
          vendorErrorCode: 'E42',
          chargerReportedAt: '2026-05-10T11:58:00Z',
        },
      }),
    );
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.kind).toBe('status');
    expect(d.append.summary).toBe('Connector 2 → Faulted (GroundFailure)');
    expect(d.append.connector_id).toBe(2);
    expect(d.append.detail).toEqual({
      status: 'Faulted',
      error_code: 'GroundFailure',
      vendor_error_code: 'E42',
      info: 'detected at boot',
    });
  });

  it('drops the error suffix when errorCode is NoError', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'cp.status',
        payload: { connectorId: 1, status: 'Available', errorCode: 'NoError' },
      }),
    );
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.summary).toBe('Connector 1 → Available');
  });

  it('drops the error suffix when errorCode is empty (proto3 zero-value)', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'cp.status',
        payload: { connectorId: 1, status: 'Available', errorCode: '' },
      }),
    );
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.summary).toBe('Connector 1 → Available');
    expect(d.append.detail).toMatchObject({
      error_code: null,
      info: null,
      vendor_error_code: null,
    });
  });
});

describe('device-events — cp.meter', () => {
  it('emits one event per MeterValues report regardless of sample count', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'cp.meter',
        payload: {
          connectorId: 1,
          transactionId: 7,
          chargerReportedAt: '2026-05-10T11:59:00Z',
          sampledValues: [
            { value: '230', measurand: 'MEASURAND_VOLTAGE', unit: 'UNIT_V' },
            { value: '16', measurand: 'MEASURAND_CURRENT_IMPORT', unit: 'UNIT_A' },
            {
              value: '5000',
              measurand: 'MEASURAND_ENERGY_ACTIVE_IMPORT_REGISTER',
              unit: 'UNIT_WH',
            },
            { value: '50', measurand: 'MEASURAND_FREQUENCY', unit: 'UNIT_HZ' },
          ],
        },
      }),
    );
    expect(out).toHaveLength(1);
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.kind).toBe('meter');
    expect(d.append.summary).toBe('MeterValues — 4 samples');
    expect(d.append.connector_id).toBe(1);
    expect(d.append.detail).toEqual({
      connector_id: 1,
      transaction_id: 7,
      primary_measurand: 'ENERGY_ACTIVE_IMPORT_REGISTER',
      primary_value: 5000,
      primary_unit: 'WH',
      sample_count: 4,
    });
  });

  it('falls back to the first sample when there is no energy register reading', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'cp.meter',
        payload: {
          connectorId: 1,
          sampledValues: [
            { value: '230', measurand: 'MEASURAND_VOLTAGE', unit: 'UNIT_V' },
            { value: '16', measurand: 'MEASURAND_CURRENT_IMPORT', unit: 'UNIT_A' },
          ],
        },
      }),
    );
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.summary).toBe('MeterValues — 2 samples');
    expect(d.append.detail).toMatchObject({
      primary_measurand: 'VOLTAGE',
      primary_value: 230,
      primary_unit: 'V',
      sample_count: 2,
    });
  });

  it('uses singular "sample" when there is exactly one', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'cp.meter',
        payload: {
          connectorId: 1,
          sampledValues: [{ value: '1', measurand: 'MEASURAND_VOLTAGE' }],
        },
      }),
    );
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.summary).toBe('MeterValues — 1 sample');
  });

  it('returns no deltas when the sample list is empty', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({ topic: 'cp.meter', payload: { connectorId: 1, sampledValues: [] } }),
    );
    expect(out).toEqual([]);
  });
});

describe('device-events — tx.started', () => {
  it('renders the transaction summary', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'tx.started',
        payload: {
          transactionId: 42,
          idTag: 'TAG-001',
          connectorId: 1,
          meterStartWh: 1000,
          chargerReportedAt: '2026-05-10T11:55:00Z',
        },
      }),
    );
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.kind).toBe('tx-started');
    expect(d.append.summary).toBe('Transaction 42 started — id_tag TAG-001');
    expect(d.append.connector_id).toBe(1);
    expect(d.append.detail).toEqual({
      transaction_id: 42,
      id_tag: 'TAG-001',
      connector_id: 1,
      meter_start_wh: 1000,
    });
  });
});

describe('device-events — tx.stopped', () => {
  it('renders the stop summary with reason when present', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'tx.stopped',
        payload: {
          transactionId: 42,
          idTag: 'TAG-001',
          meterStopWh: 5500,
          consumedWh: 4500,
          stopReason: 'Local',
          chargerReportedAt: '2026-05-10T12:05:00Z',
        },
      }),
    );
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.kind).toBe('tx-stopped');
    expect(d.append.summary).toBe('Transaction 42 stopped — Local');
    expect(d.append.detail).toEqual({
      transaction_id: 42,
      id_tag: 'TAG-001',
      meter_stop_wh: 5500,
      consumed_wh: 4500,
      stop_reason: 'Local',
    });
  });

  it('falls back to a reason-less summary when stop_reason is absent', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({
        topic: 'tx.stopped',
        payload: { transactionId: 7, idTag: 'TAG-X', meterStopWh: 100 },
      }),
    );
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    expect(d.append.summary).toBe('Transaction 7 stopped');
  });
});

describe('device-events — robustness', () => {
  it('returns [] for a null payload instead of throwing', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      evt({ topic: 'cp.boot', payload: null as unknown as Record<string, unknown> }),
    );
    expect(out).toEqual([]);
  });

  it('returns [] for an unrecognised topic instead of throwing', async () => {
    const out = await run(
      { cp_id: 'CP_A' },
      // Cast through unknown so a bad topic literal doesn't fail the
      // KafkaEvent discriminated-union type check.
      evt({ topic: 'cp.heartbeat' as unknown as KafkaEvent['topic'], payload: { foo: 'bar' } }),
    );
    expect(out).toEqual([]);
  });

  it('tolerates a cp.status payload with no fields at all', async () => {
    const out = await run({ cp_id: 'CP_A' }, evt({ topic: 'cp.status', payload: {} }));
    expect(out).toHaveLength(1);
    const d = out[0]!.delta;
    if (d.kind !== 'device-events') throw new Error('wrong kind');
    // connectorId missing → coerced to 0; status missing → empty string → null in detail.
    expect(d.append.summary).toBe('Connector 0 → ');
    expect(d.append.detail).toMatchObject({ status: null });
  });
});

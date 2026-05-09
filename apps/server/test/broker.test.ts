// Broker tests using a fake Kafka tail + fake gateway client. The broker
// depends only on a structural subset of each (a `.on(listener)` and
// `.listChargePoints()` / `.getChargePoint()` / `.listActiveTransactions()`),
// so we type the fakes as the same class shape via `as unknown as`.
//
// The broker's `onKafkaEvent` runs resolvers asynchronously, so each
// test emits an event and then awaits a microtask flush before asserting
// on the deliver mock.

import { describe, expect, it, vi } from 'vitest';

import { Broker } from '../src/broker/broker.js';
import type { GatewayClient } from '../src/rest/gateway-client.js';
import type { KafkaEvent, KafkaListener, KafkaTail } from '../src/kafka/tail.js';
import type { Logger } from '../src/logger.js';

class FakeKafka {
  private listeners = new Set<KafkaListener>();
  on(l: KafkaListener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(event: KafkaEvent) {
    for (const l of this.listeners) l(event);
  }
}

interface FakeGatewayOptions {
  online?: boolean;
  vendor?: string;
}

function fakeGateway(opts: FakeGatewayOptions = {}): GatewayClient {
  return {
    listChargePoints: vi.fn().mockResolvedValue({ charge_points: [] }),
    getChargePoint: vi.fn(async (cpId: string) => ({
      cp_id: cpId,
      online: opts.online ?? true,
      pod_id: 'pod-1',
      vendor: opts.vendor ?? 'ACME',
      model: 'X1',
      firmware_version: '1.0',
      serial_number: 'SN1',
      last_boot_at: null,
      last_heartbeat_at: null,
      last_status: 'Available',
      last_seen_seq: 0,
      connectors: [],
    })),
    listActiveTransactions: vi.fn().mockResolvedValue({ transactions: [] }),
    remoteStart: vi.fn(),
    remoteStop: vi.fn(),
    reset: vi.fn(),
  } as unknown as GatewayClient;
}

const silentLog: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => silentLog,
} as unknown as Logger;

// Yield to the microtask queue so async resolvers settle and the broker
// has called `deliver` before we assert. setImmediate ⇒ "after all
// pending microtasks". Two-pass for resolvers that await two promises
// (e.g. the cp re-fetch + the deliver loop).
async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('Broker — subscribe and snapshot', () => {
  it('returns a snapshot for a charge-point subscription', async () => {
    const broker = new Broker(
      new FakeKafka() as unknown as KafkaTail,
      fakeGateway(),
      silentLog,
    );
    broker.start();
    broker.registerConnection('c1', vi.fn());

    const { subscriptionId, snapshot } = await broker.subscribe('c1', 'charge-point', {
      cp_id: 'CP_A',
    });

    expect(subscriptionId).toBeTruthy();
    expect(snapshot.snapshot.kind).toBe('charge-point');
    if (snapshot.snapshot.kind === 'charge-point') {
      expect(snapshot.snapshot.row.cp_id).toBe('CP_A');
    }
  });
});

describe('Broker — charge-point (single) deltas', () => {
  it('delivers a delta when a status event arrives for the subscribed cp', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'charge-point', { cp_id: 'CP_A' });

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_A',
      cursor: 'k:cp.status:0:1',
      timestamp: new Date(),
      payload: { connectorId: 1, status: 'Charging', errorCode: 'NoError' },
    });
    await flushAsync();

    expect(deliver).toHaveBeenCalledOnce();
    const [, delta] = deliver.mock.calls[0]!;
    expect(delta.cursor).toBe('k:cp.status:0:1');
    expect(delta.delta.kind).toBe('charge-point');
    // The resolver re-fetches the row from the gateway; cp_id must
    // match the event's cp_id (the param). The fake gateway echoes it.
    expect(delta.delta.row.cp_id).toBe('CP_A');
  });

  it('does not deliver when the event is for a different cp_id', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'charge-point', { cp_id: 'CP_A' });

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_B',
      cursor: 'k:cp.status:0:2',
      timestamp: new Date(),
      payload: {},
    });
    await flushAsync();

    expect(deliver).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    const { subscriptionId } = await broker.subscribe('c1', 'charge-point', {
      cp_id: 'CP_A',
    });
    broker.unsubscribe('c1', subscriptionId);

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_A',
      cursor: 'k:cp.status:0:3',
      timestamp: new Date(),
      payload: {},
    });
    await flushAsync();

    expect(deliver).not.toHaveBeenCalled();
  });

  it('isolates subscriptions across connections', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliverA = vi.fn();
    const deliverB = vi.fn();
    broker.registerConnection('cA', deliverA);
    broker.registerConnection('cB', deliverB);
    await broker.subscribe('cA', 'charge-point', { cp_id: 'CP_X' });

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_X',
      cursor: 'k:cp.status:0:4',
      timestamp: new Date(),
      payload: {},
    });
    await flushAsync();

    expect(deliverA).toHaveBeenCalledOnce();
    expect(deliverB).not.toHaveBeenCalled();
  });

  it('clears subscriptions on connection drop', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'charge-point', { cp_id: 'CP_A' });
    broker.removeConnection('c1');

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_A',
      cursor: 'k:cp.status:0:5',
      timestamp: new Date(),
      payload: {},
    });
    await flushAsync();

    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('Broker — charge-points (list) deltas', () => {
  it('emits an upsert when a status event arrives', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'charge-points', {});

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_X',
      cursor: 'k:cp.status:0:9',
      timestamp: new Date(),
      payload: { connectorId: 1, status: 'Charging', errorCode: 'NoError' },
    });
    await flushAsync();

    expect(deliver).toHaveBeenCalledOnce();
    const [, d] = deliver.mock.calls[0]!;
    expect(d.delta.kind).toBe('charge-points');
    expect(d.delta.op).toBe('upsert');
    expect(d.delta.row.cp_id).toBe('CP_X');
  });

  it('emits remove when the row no longer matches an online=true filter', async () => {
    const kafka = new FakeKafka();
    // Gateway returns online=false; subscription filter is online=true.
    const broker = new Broker(
      kafka as unknown as KafkaTail,
      fakeGateway({ online: false }),
      silentLog,
    );
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'charge-points', { online: true });

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_Y',
      cursor: 'k:cp.status:0:10',
      timestamp: new Date(),
      payload: {},
    });
    await flushAsync();

    expect(deliver).toHaveBeenCalledOnce();
    const [, d] = deliver.mock.calls[0]!;
    expect(d.delta.op).toBe('remove');
    expect(d.delta.cp_id).toBe('CP_Y');
  });

  it('emits remove when the row no longer matches a vendor filter', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(
      kafka as unknown as KafkaTail,
      fakeGateway({ vendor: 'ACME' }),
      silentLog,
    );
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'charge-points', { vendor: 'OTHER' });

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_Z',
      cursor: 'k:cp.status:0:11',
      timestamp: new Date(),
      payload: {},
    });
    await flushAsync();

    const [, d] = deliver.mock.calls[0]!;
    expect(d.delta.op).toBe('remove');
  });
});

describe('Broker — transactions-active deltas', () => {
  it('decodes a tx.started payload into a transaction summary', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'transactions-active', {});

    kafka.emit({
      topic: 'tx.started',
      cpId: 'CP_T',
      cursor: 'k:tx.started:0:1',
      timestamp: new Date(),
      // protobufjs decodes proto3 snake_case to camelCase.
      payload: {
        transactionId: 42,
        connectorId: 1,
        idTag: 'TAG-001',
        meterStartWh: 100,
        chargerReportedAt: '2026-01-01T12:00:00Z',
      },
    });
    await flushAsync();

    expect(deliver).toHaveBeenCalledOnce();
    const [, d] = deliver.mock.calls[0]!;
    expect(d.delta.kind).toBe('transactions-active');
    expect(d.delta.op).toBe('upsert');
    expect(d.delta.row).toMatchObject({
      transaction_id: 42,
      cp_id: 'CP_T',
      connector_id: 1,
      id_tag: 'TAG-001',
      meter_start_wh: 100,
      meter_stop_wh: null,
      consumed_wh: null,
      started_reported_at: '2026-01-01T12:00:00Z',
      stopped_reported_at: null,
      stop_reason: null,
    });
  });
});

describe('Broker — meter-history deltas', () => {
  it('emits one delta per sampled value in a cp.meter event', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'meter-history', { cp_id: 'CP_M' });

    kafka.emit({
      topic: 'cp.meter',
      cpId: 'CP_M',
      cursor: 'k:cp.meter:0:1',
      timestamp: new Date(),
      payload: {
        connectorId: 1,
        transactionId: 7,
        chargerReportedAt: '2026-01-01T12:00:00Z',
        sampledValues: [
          { value: '1234.5', measurand: 'MEASURAND_VOLTAGE', unit: 'UNIT_V' },
          { value: '230', measurand: 'MEASURAND_CURRENT_IMPORT', unit: 'UNIT_A' },
          {
            value: '5000',
            measurand: 'MEASURAND_ENERGY_ACTIVE_IMPORT_REGISTER',
            unit: 'UNIT_WH',
          },
        ],
      },
    });
    await flushAsync();

    expect(deliver).toHaveBeenCalledTimes(3);
    const calls = deliver.mock.calls.map((c) => c[1].delta);
    expect(calls[0]).toMatchObject({
      kind: 'meter-history',
      append: {
        cp_id: 'CP_M',
        transaction_id: 7,
        connector_id: 1,
        measurand: 'VOLTAGE',
        value: 1234.5,
        unit: 'V',
        recorded_at: '2026-01-01T12:00:00Z',
      },
    });
    expect(calls[1].append.measurand).toBe('CURRENT_IMPORT');
    expect(calls[2].append.measurand).toBe('ENERGY_ACTIVE_IMPORT_REGISTER');
  });

  it('skips samples with non-numeric values', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'meter-history', { cp_id: 'CP_M' });

    kafka.emit({
      topic: 'cp.meter',
      cpId: 'CP_M',
      cursor: 'k:cp.meter:0:2',
      timestamp: new Date(),
      payload: {
        connectorId: 1,
        sampledValues: [
          { value: 'not-a-number' },
          { value: '42' },
          { value: null },
        ],
      },
    });
    await flushAsync();

    expect(deliver).toHaveBeenCalledOnce();
    const [, d] = deliver.mock.calls[0]!;
    expect(d.delta.append.value).toBe(42);
  });

  it('ignores meter events for a different cp_id', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'meter-history', { cp_id: 'CP_M' });

    kafka.emit({
      topic: 'cp.meter',
      cpId: 'CP_OTHER',
      cursor: 'k:cp.meter:0:3',
      timestamp: new Date(),
      payload: { connectorId: 1, sampledValues: [{ value: '1' }] },
    });
    await flushAsync();

    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('Broker — status-history deltas', () => {
  it('emits a status delta with mapped fields', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'status-history', { cp_id: 'CP_S' });

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_S',
      cursor: 'k:cp.status:0:1',
      timestamp: new Date(),
      payload: {
        connectorId: 2,
        status: 'Faulted',
        errorCode: 'GroundFailure',
        info: 'detected at boot',
        chargerReportedAt: '2026-01-01T12:00:00Z',
      },
    });
    await flushAsync();

    expect(deliver).toHaveBeenCalledOnce();
    const [, d] = deliver.mock.calls[0]!;
    expect(d.delta.kind).toBe('status-history');
    expect(d.delta.append).toMatchObject({
      cp_id: 'CP_S',
      connector_id: 2,
      status: 'Faulted',
      error_code: 'GroundFailure',
      info: 'detected at boot',
      reported_at: '2026-01-01T12:00:00Z',
    });
  });

  it('treats empty error_code/info as null', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'status-history', { cp_id: 'CP_S' });

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_S',
      cursor: 'k:cp.status:0:2',
      timestamp: new Date(),
      payload: { connectorId: 1, status: 'Available', errorCode: '', info: '' },
    });
    await flushAsync();

    const [, d] = deliver.mock.calls[0]!;
    expect(d.delta.append.error_code).toBeNull();
    expect(d.delta.append.info).toBeNull();
  });
});

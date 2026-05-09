// Broker tests using a fake Kafka tail + fake gateway client. The broker
// depends only on a structural subset of each (a `.on(listener)` and a
// `.listChargePoints()` / `.getChargePoint()`), so we type the fakes as
// the same class shape via `as unknown as`.

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

function fakeGateway(): GatewayClient {
  return {
    listChargePoints: vi.fn().mockResolvedValue({ charge_points: [] }),
    getChargePoint: vi.fn(async (cpId: string) => ({
      cp_id: cpId,
      online: true,
      pod_id: 'pod-1',
      vendor: 'ACME',
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

describe('Broker', () => {
  it('subscribes a connection and returns a snapshot', async () => {
    const kafka = new FakeKafka();
    const gateway = fakeGateway();
    const broker = new Broker(kafka as unknown as KafkaTail, gateway, silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);

    const { subscriptionId, snapshot } = await broker.subscribe(
      'c1',
      'charge-point',
      { cp_id: 'CP_A' },
    );
    expect(subscriptionId).toBeTruthy();
    expect(snapshot.snapshot.kind).toBe('charge-point');
    if (snapshot.snapshot.kind === 'charge-point') {
      expect(snapshot.snapshot.row.cp_id).toBe('CP_A');
    }
  });

  it('routes a matching kafka event to the subscribing connection', async () => {
    const kafka = new FakeKafka();
    const gateway = fakeGateway();
    const broker = new Broker(kafka as unknown as KafkaTail, gateway, silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'charge-point', { cp_id: 'CP_A' });

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_A',
      cursor: 'k:cp.status:0:1',
      timestamp: new Date(),
      payload: {
        cp_id: 'CP_A',
        online: true,
        pod_id: 'pod-1',
        vendor: 'ACME',
        model: 'X1',
        firmware_version: '1.0',
        serial_number: 'SN1',
        last_boot_at: null,
        last_heartbeat_at: null,
        last_status: 'Charging',
        last_seen_seq: 5,
        connectors: [],
      },
    });

    expect(deliver).toHaveBeenCalledOnce();
    const [, delta] = deliver.mock.calls[0]!;
    expect(delta.cursor).toBe('k:cp.status:0:1');
  });

  it('does not route events for a different cp_id', async () => {
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
      payload: {
        cp_id: 'CP_A',
        online: true,
        pod_id: 'p',
        vendor: null,
        model: null,
        firmware_version: null,
        serial_number: null,
        last_boot_at: null,
        last_heartbeat_at: null,
        last_status: 'X',
        last_seen_seq: 1,
        connectors: [],
      },
    });

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
    // cB has no subscription. Only cA should receive deltas for CP_X.
    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_X',
      cursor: 'k:cp.status:0:4',
      timestamp: new Date(),
      payload: {
        cp_id: 'CP_X',
        online: true,
        pod_id: 'p',
        vendor: null,
        model: null,
        firmware_version: null,
        serial_number: null,
        last_boot_at: null,
        last_heartbeat_at: null,
        last_status: 'Charging',
        last_seen_seq: 1,
        connectors: [],
      },
    });
    expect(deliverA).toHaveBeenCalledOnce();
    expect(deliverB).not.toHaveBeenCalled();
  });

  it('emits an upsert delta on the charge-points list when a status event arrives', async () => {
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
      payload: {
        cp_id: 'CP_X',
        online: true,
        pod_id: 'p',
        vendor: 'ACME',
        model: 'X1',
        firmware_version: '1',
        serial_number: 'S',
        last_boot_at: null,
        last_heartbeat_at: null,
        last_status: 'Charging',
        last_seen_seq: 7,
        connectors: [],
      },
    });

    expect(deliver).toHaveBeenCalledOnce();
    const [, delta] = deliver.mock.calls[0]!;
    expect(delta.delta.kind).toBe('charge-points');
    expect(delta.delta.op).toBe('upsert');
  });

  it('emits a remove delta when a row no longer matches the online filter', async () => {
    const kafka = new FakeKafka();
    const broker = new Broker(kafka as unknown as KafkaTail, fakeGateway(), silentLog);
    broker.start();

    const deliver = vi.fn();
    broker.registerConnection('c1', deliver);
    await broker.subscribe('c1', 'charge-points', { online: true });

    kafka.emit({
      topic: 'cp.status',
      cpId: 'CP_Y',
      cursor: 'k:cp.status:0:10',
      timestamp: new Date(),
      payload: {
        cp_id: 'CP_Y',
        online: false,
        pod_id: null,
        vendor: 'ACME',
        model: 'X1',
        firmware_version: '1',
        serial_number: 'S',
        last_boot_at: null,
        last_heartbeat_at: null,
        last_status: 'Unavailable',
        last_seen_seq: 8,
        connectors: [],
      },
    });

    expect(deliver).toHaveBeenCalledOnce();
    const [, delta] = deliver.mock.calls[0]!;
    expect(delta.delta.op).toBe('remove');
    expect(delta.delta.cp_id).toBe('CP_Y');
  });

  it('removes all subscriptions when the connection is dropped', async () => {
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
      payload: {
        cp_id: 'CP_A',
        online: true,
        pod_id: 'p',
        vendor: null,
        model: null,
        firmware_version: null,
        serial_number: null,
        last_boot_at: null,
        last_heartbeat_at: null,
        last_status: 'X',
        last_seen_seq: 1,
        connectors: [],
      },
    });
    expect(deliver).not.toHaveBeenCalled();
  });
});

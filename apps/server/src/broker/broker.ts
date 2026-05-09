// Subscription broker. Holds per-connection subscription state and translates
// Kafka events into deltas for the connections that care.

import { randomUUID } from 'node:crypto';

import type { Logger } from '../logger.js';
import type { KafkaEvent, KafkaTail } from '../kafka/tail.js';
import type { GatewayClient } from '../rest/gateway-client.js';
import { resolveQuery } from './queries.js';
import type { Delta, Snapshot, Subscription } from './types.js';
import type { QueryName, QueryParams } from '@eveys-console/protocol';

export type DeliveryHandler = (subscriptionId: string, delta: Delta) => void;

interface ConnectionState {
  connectionId: string;
  subscriptions: Map<string, Subscription>;
  deliver: DeliveryHandler;
}

export class Broker {
  private readonly connections = new Map<string, ConnectionState>();
  private detachKafka: (() => void) | null = null;

  constructor(
    private readonly kafka: KafkaTail,
    private readonly gateway: GatewayClient,
    private readonly log: Logger,
  ) {}

  start() {
    if (this.detachKafka) return;
    this.detachKafka = this.kafka.on(this.onKafkaEvent);
  }

  stop() {
    this.detachKafka?.();
    this.detachKafka = null;
    this.connections.clear();
  }

  registerConnection(connectionId: string, deliver: DeliveryHandler) {
    this.connections.set(connectionId, {
      connectionId,
      subscriptions: new Map(),
      deliver,
    });
  }

  removeConnection(connectionId: string) {
    this.connections.delete(connectionId);
  }

  async subscribe(
    connectionId: string,
    query: QueryName,
    params: QueryParams,
  ): Promise<{ subscriptionId: string; snapshot: Snapshot }> {
    const conn = this.connections.get(connectionId);
    if (!conn) throw new Error(`unknown connection ${connectionId}`);

    const subscriptionId = randomUUID();
    const sub: Subscription = { id: subscriptionId, query, params };

    const resolver = resolveQuery(query);
    const snapshot = await resolver.snapshot(params, this.gateway);

    conn.subscriptions.set(subscriptionId, sub);
    return { subscriptionId, snapshot };
  }

  unsubscribe(connectionId: string, subscriptionId: string): boolean {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;
    return conn.subscriptions.delete(subscriptionId);
  }

  private onKafkaEvent = (event: KafkaEvent) => {
    for (const conn of this.connections.values()) {
      for (const sub of conn.subscriptions.values()) {
        const resolver = resolveQuery(sub.query);
        const delta = resolver.deltaFromEvent(sub.params, event);
        if (delta) {
          try {
            conn.deliver(sub.id, delta);
          } catch (err) {
            this.log.warn({ err, connectionId: conn.connectionId }, 'broker.deliver_failed');
          }
        }
      }
    }
  };
}

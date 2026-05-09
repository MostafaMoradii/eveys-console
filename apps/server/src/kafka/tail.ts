// Kafka tail. One consumer group per BaaS deployment; horizontal scaling is
// limited by the topics' partition counts (cp_id-keyed). Fan-out to per-conn
// subscriptions is handled by the broker.

import { Kafka, type Consumer, type EachMessagePayload } from 'kafkajs';

import type { Config } from '../config.js';
import type { Logger } from '../logger.js';

export interface KafkaEvent {
  topic: string;
  cpId: string | null;
  cursor: string;
  payload: unknown;
  timestamp: Date;
}

export type KafkaListener = (event: KafkaEvent) => void;

export class KafkaTail {
  private readonly consumer: Consumer;
  private readonly listeners = new Set<KafkaListener>();
  private running = false;

  constructor(
    private readonly cfg: Config,
    private readonly log: Logger,
  ) {
    const kafka = new Kafka({
      clientId: cfg.KAFKA_CLIENT_ID,
      brokers: cfg.KAFKA_BROKERS,
    });
    this.consumer = kafka.consumer({ groupId: cfg.KAFKA_GROUP_ID });
  }

  async start() {
    if (this.running) return;
    await this.consumer.connect();
    const topics = [
      this.cfg.KAFKA_TOPICS_BOOT,
      this.cfg.KAFKA_TOPICS_STATUS,
      this.cfg.KAFKA_TOPICS_METER,
      this.cfg.KAFKA_TOPICS_TX_STARTED,
    ];
    for (const t of topics) {
      await this.consumer.subscribe({ topic: t, fromBeginning: false });
    }
    this.log.info({ topics }, 'kafka.subscribed');

    await this.consumer.run({ eachMessage: this.handle });
    this.running = true;
  }

  async stop() {
    if (!this.running) return;
    await this.consumer.disconnect();
    this.running = false;
  }

  on(listener: KafkaListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private handle = async ({ topic, partition, message }: EachMessagePayload) => {
    if (!message.value) return;
    let payload: unknown;
    try {
      payload = JSON.parse(message.value.toString('utf8'));
    } catch (err) {
      this.log.warn({ topic, partition, err }, 'kafka.payload_not_json');
      return;
    }
    const cpId = message.key?.toString('utf8') ?? null;
    const cursor = `k:${topic}:${partition}:${message.offset}`;
    const event: KafkaEvent = {
      topic,
      cpId,
      cursor,
      payload,
      timestamp: new Date(Number(message.timestamp)),
    };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        this.log.error({ err, topic }, 'kafka.listener_threw');
      }
    }
  };
}

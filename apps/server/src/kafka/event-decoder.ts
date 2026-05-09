// Decoder for Kafka events published by the gateway. The gateway emits
// protobuf-encoded `eveys.events.v1.EventEnvelope` to every topic
// (cp.connected, cp.boot, cp.status, cp.meter, tx.started). We load the
// vendored .proto at boot via protobufjs and decode each message to a
// plain JS object the broker resolvers can consume.
//
// The vendored proto lives in apps/server/proto/events/v1/events.proto.
// Sync it from the gateway repo when the schema bumps; the schema is
// frozen at v1 per the gateway docs, so this is rare.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import protobuf from 'protobufjs';

const here = dirname(fileURLToPath(import.meta.url));
// `dist/` (compiled) lives next to `proto/`; in dev (`tsx watch`) the
// source path is .../apps/server/src/kafka/, so the proto is two up.
const PROTO_CANDIDATES = [
  resolve(here, '../../proto/events/v1/events.proto'),
  resolve(here, '../proto/events/v1/events.proto'),
];

let envelopeType: protobuf.Type | null = null;

function loadEnvelopeType(): protobuf.Type {
  if (envelopeType) return envelopeType;
  let lastError: unknown;
  for (const path of PROTO_CANDIDATES) {
    try {
      readFileSync(path);
      const root = protobuf.loadSync(path);
      const t = root.lookupType('eveys.events.v1.EventEnvelope');
      envelopeType = t;
      return t;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `failed to load events.proto from any of: ${PROTO_CANDIDATES.join(', ')} — last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export interface DecodedEnvelope {
  event_id: string;
  occurred_at: string;
  cp_id: string;
  schema_version: string;
  trace_id: string;
  // Whichever oneof branch was set; key matches the proto's snake_case
  // field name (cp_connected, cp_boot, cp_status, cp_meter, tx_started,
  // cp_security_event).
  payload: Record<string, unknown> | null;
  payloadKind: string | null;
}

export function decodeEnvelope(bytes: Buffer): DecodedEnvelope {
  const t = loadEnvelopeType();
  const message = t.decode(bytes);
  const obj = t.toObject(message, {
    longs: Number,
    enums: String,
    bytes: String,
    defaults: false,
    arrays: true,
    objects: true,
    oneofs: true,
  }) as Record<string, unknown>;

  // protobufjs sets the `payload` virtual field (from the `oneof
  // payload` declaration) to the name of whichever branch was set.
  const payloadKind = (obj.payload as string) ?? null;
  const payload =
    payloadKind && typeof obj[payloadKind] === 'object'
      ? (obj[payloadKind] as Record<string, unknown>)
      : null;

  return {
    event_id: String(obj.event_id ?? ''),
    occurred_at: String(obj.occurred_at ?? ''),
    cp_id: String(obj.cp_id ?? ''),
    schema_version: String(obj.schema_version ?? ''),
    trace_id: String(obj.trace_id ?? ''),
    payload,
    payloadKind,
  };
}

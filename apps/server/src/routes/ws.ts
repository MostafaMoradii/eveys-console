// WS endpoint. One connection per browser tab. Authenticates via JWT in the
// `Sec-WebSocket-Protocol` header (browsers can't set arbitrary headers on
// new WebSocket() — the standard workaround is the subprotocol). The token
// is the second subprotocol token; the first is "eveys-console-v1".

import { randomUUID } from 'node:crypto';

import type { FastifyRequest } from 'fastify';
import type { WebSocket as FastifyWebSocket } from '@fastify/websocket';
import {
  clientMessage,
  errorPayload,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from '@eveys-console/protocol';

import { expectAudienceAndIssuer } from '../auth/jwt.js';
import type { Broker } from '../broker/broker.js';
import type { GatewayClient } from '../rest/gateway-client.js';

const WS_SUBPROTOCOL = 'eveys-console-v1';

// Loose `app` type to compose with any FastifyInstance; strict typing happens
// at the message handlers, not the registrar.
export async function registerWsRoute(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app: any,
  deps: { broker: Broker; gateway: GatewayClient },
) {
  app.get('/ws', { websocket: true }, async (socket: FastifyWebSocket, req: FastifyRequest) => {
    const cfg = app.config;
    const log = req.log.child({ scope: 'ws' });

    const requestedProtocols =
      req.headers['sec-websocket-protocol']
        ?.split(',')
        .map((s: string) => s.trim())
        .filter(Boolean) ?? [];
    if (!requestedProtocols.includes(WS_SUBPROTOCOL)) {
      log.warn('ws.subprotocol_missing');
      send(socket, errMsg('invalid_message', 'missing eveys-console-v1 subprotocol'));
      socket.close(1002);
      return;
    }
    const tokenProtocol = requestedProtocols.find((p: string) => p.startsWith('bearer.'));
    const token = tokenProtocol?.slice('bearer.'.length) ?? '';

    let principal;
    try {
      const decoded = await app.jwt.verify(token);
      principal = expectAudienceAndIssuer(decoded, cfg);
    } catch (err) {
      log.warn({ err }, 'ws.auth_failed');
      send(socket, errMsg('unauthenticated', 'invalid or expired token'));
      socket.close(4401);
      return;
    }

    const connectionId = randomUUID();
    log.info({ connectionId, sub: principal.sub }, 'ws.opened');

    deps.broker.registerConnection(connectionId, (subscriptionId, delta) => {
      send(socket, {
        v: PROTOCOL_VERSION,
        type: 'delta',
        subscriptionId,
        delta: delta.delta,
        cursor: delta.cursor,
      });
    });

    let alive = true;
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, cfg.WS_PING_INTERVAL_MS);
    socket.on('pong', () => {
      alive = true;
    });

    let messageCount = 0;
    socket.on('message', async (raw: Buffer) => {
      messageCount++;
      let msg: ClientMessage;
      try {
        const json = JSON.parse(raw.toString());
        msg = clientMessage.parse(json);
      } catch (err) {
        log.warn({ err }, 'ws.bad_message');
        send(socket, errMsg('invalid_message', 'envelope failed validation'));
        return;
      }

      try {
        await dispatch(msg);
      } catch (err) {
        log.error({ err, msgType: msg.type }, 'ws.dispatch_failed');
        send(
          socket,
          errMsg('internal_error', err instanceof Error ? err.message : 'internal error', msg.id),
        );
      }
    });

    socket.on('close', (code: number, reason: Buffer) => {
      clearInterval(heartbeat);
      deps.broker.removeConnection(connectionId);
      log.info({ connectionId, code, reason: reason.toString(), messageCount }, 'ws.closed');
    });

    async function dispatch(msg: ClientMessage) {
      switch (msg.type) {
        case 'ping':
          send(socket, {
            v: PROTOCOL_VERSION,
            type: 'pong',
            inReplyTo: msg.id,
            serverTime: new Date().toISOString(),
          });
          return;

        case 'subscribe': {
          const conn = deps.broker;
          const { subscriptionId, snapshot } = await conn.subscribe(
            connectionId,
            msg.query,
            msg.params,
          );
          send(socket, {
            v: PROTOCOL_VERSION,
            type: 'subscription.accepted',
            inReplyTo: msg.id,
            subscriptionId,
          });
          send(socket, {
            v: PROTOCOL_VERSION,
            type: 'snapshot',
            subscriptionId,
            snapshot: snapshot.snapshot,
            cursor: snapshot.cursor,
          });
          return;
        }

        case 'unsubscribe':
          deps.broker.unsubscribe(connectionId, msg.subscriptionId);
          return;

        case 'rpc':
          await handleRpc(msg);
          return;
      }
    }

    async function handleRpc(msg: Extract<ClientMessage, { type: 'rpc' }>) {
      // The RPC namespace mirrors the gateway's command surface 1:1. We
      // accept, forward, and return the gateway's response unmodified.
      let result: unknown;
      switch (msg.method) {
        case 'remote-start': {
          const cpId = requireString(msg.params, 'cp_id');
          result = await deps.gateway.remoteStart(cpId, msg.params);
          break;
        }
        case 'remote-stop': {
          const cpId = requireString(msg.params, 'cp_id');
          result = await deps.gateway.remoteStop(cpId, msg.params);
          break;
        }
        case 'reset': {
          const cpId = requireString(msg.params, 'cp_id');
          result = await deps.gateway.reset(cpId, msg.params);
          break;
        }
        default:
          send(socket, errMsg('invalid_message', `unknown rpc method: ${msg.method}`, msg.id));
          return;
      }
      send(socket, {
        v: PROTOCOL_VERSION,
        type: 'rpc.result',
        inReplyTo: msg.id,
        result,
      });
    }
  });
}

function send(socket: { send: (s: string) => void }, msg: ServerMessage) {
  socket.send(JSON.stringify(msg));
}

function errMsg(
  code: import('@eveys-console/protocol').ErrorCode,
  message: string,
  inReplyTo?: string,
): ServerMessage {
  const base: ServerMessage = {
    v: PROTOCOL_VERSION,
    type: 'error',
    error: errorPayload.parse({ code, message }),
  };
  return inReplyTo ? { ...base, inReplyTo } : base;
}

function requireString(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing or invalid string param: ${key}`);
  }
  return v;
}

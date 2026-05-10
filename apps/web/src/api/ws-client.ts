// Typed WS client for the Console server. One connection per app instance; subscriptions
// are multiplexed over it with stable IDs. Reconnect with backoff; outstanding
// subscriptions are re-issued on reconnect; outstanding RPCs reject with
// 'reconnect' so the caller can retry.

import {
  clientMessage,
  PROTOCOL_VERSION,
  serverMessage,
  type ClientMessage,
  type DeltaForQuery,
  type QueryName,
  type QueryParams,
  type ServerMessage,
  type SnapshotForQuery,
} from '@eveys-console/protocol';

export interface ConsoleClientOpts {
  url: string;
  token: string;
  onStatus?: (status: ConnectionStatus) => void;
  /** Fired exactly once when the server closes the connection with the
   *  custom 4401 code (the WS route's `unauthenticated` reason). The
   *  AppShell uses this to clear the stored token so the user lands on
   *  the login page instead of a silent reconnect loop. */
  onAuthRejected?: () => void;
  log?: (msg: string, ctx?: Record<string, unknown>) => void;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/** Server-side close code emitted when JWT verification fails on
 *  handshake. Defined in `apps/server/src/routes/ws.ts`. */
export const WS_AUTH_REJECTED_CODE = 4401;

export type SubscriptionHandlers = {
  onSnapshot: (snapshot: SnapshotForQuery, cursor: string) => void;
  onDelta: (delta: DeltaForQuery, cursor: string) => void;
  onError?: (message: string) => void;
};

interface PendingSubscribe {
  query: QueryName;
  params: QueryParams;
  handlers: SubscriptionHandlers;
  // Resolved once the server returns subscription.accepted + first snapshot.
  resolveHandle: (h: SubscriptionHandle) => void;
  rejectHandle: (err: Error) => void;
  inFlightId: string;
}

interface ActiveSubscription {
  handle: SubscriptionHandle;
  query: QueryName;
  params: QueryParams;
  handlers: SubscriptionHandlers;
}

export interface SubscriptionHandle {
  subscriptionId: string;
  unsubscribe: () => void;
}

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

export class ConsoleClient {
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = 'closed';
  private nextRequestId = 1;
  private readonly pendingSubscribes = new Map<string, PendingSubscribe>();
  private readonly active = new Map<string, ActiveSubscription>();
  private readonly pendingRpcs = new Map<string, PendingRpc>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private explicitlyClosed = false;

  constructor(private readonly opts: ConsoleClientOpts) {}

  connect() {
    if (this.socket && (this.status === 'open' || this.status === 'connecting')) return;
    this.explicitlyClosed = false;
    this.openSocket();
  }

  close() {
    this.explicitlyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, 'client.close');
  }

  async subscribe(
    query: QueryName,
    params: QueryParams,
    handlers: SubscriptionHandlers,
  ): Promise<SubscriptionHandle> {
    return new Promise((resolve, reject) => {
      const id = this.requestId();
      const pending: PendingSubscribe = {
        query,
        params,
        handlers,
        resolveHandle: resolve,
        rejectHandle: reject,
        inFlightId: id,
      };
      this.pendingSubscribes.set(id, pending);
      this.send({ v: PROTOCOL_VERSION, id, type: 'subscribe', query, params });
    });
  }

  async rpc<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = this.requestId();
      this.pendingRpcs.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.send({ v: PROTOCOL_VERSION, id, type: 'rpc', method, params });
    });
  }

  private requestId(): string {
    return `r-${this.nextRequestId++}`;
  }

  private send(msg: ClientMessage) {
    const validated = clientMessage.parse(msg);
    if (this.socket && this.status === 'open') {
      this.socket.send(JSON.stringify(validated));
    }
    // If not open, the message will be re-issued from active state on reconnect
    // (subscribes) or rejected with 'reconnect' (RPCs). Pending subscribes
    // started before connect are queued in pendingSubscribes; we re-send them
    // when the socket opens.
  }

  private openSocket() {
    this.setStatus('connecting');
    const socket = new WebSocket(this.opts.url, ['eveys-console-v1', `bearer.${this.opts.token}`]);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.setStatus('open');
      this.opts.log?.('ws.open');
      // Re-send all pending subscribes (queued before open) and re-establish
      // active subscriptions (lost across reconnect).
      for (const [id, p] of this.pendingSubscribes) {
        socket.send(
          JSON.stringify({
            v: PROTOCOL_VERSION,
            id,
            type: 'subscribe',
            query: p.query,
            params: p.params,
          }),
        );
      }
      for (const sub of this.active.values()) {
        const id = this.requestId();
        this.pendingSubscribes.set(id, {
          query: sub.query,
          params: sub.params,
          handlers: sub.handlers,
          resolveHandle: () => undefined,
          rejectHandle: () => undefined,
          inFlightId: id,
        });
        socket.send(
          JSON.stringify({
            v: PROTOCOL_VERSION,
            id,
            type: 'subscribe',
            query: sub.query,
            params: sub.params,
          }),
        );
      }
    };

    socket.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = serverMessage.parse(JSON.parse(ev.data));
      } catch (err) {
        this.opts.log?.('ws.bad_server_message', { err: String(err) });
        return;
      }
      this.handleServerMessage(msg);
    };

    socket.onclose = (ev) => {
      this.setStatus('closed');
      this.opts.log?.('ws.close', { code: ev.code, reason: ev.reason });
      this.failPendingRpcsOnDisconnect();
      // 4401 = server rejected the JWT. Reconnecting with the same
      // token is pointless — let the app clear it and bounce to login.
      if (ev.code === WS_AUTH_REJECTED_CODE) {
        this.explicitlyClosed = true;
        this.opts.onAuthRejected?.();
        return;
      }
      if (!this.explicitlyClosed) this.scheduleReconnect();
    };

    socket.onerror = () => {
      this.opts.log?.('ws.error');
    };
  }

  private handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'subscription.accepted': {
        const pending = this.pendingSubscribes.get(msg.inReplyTo);
        if (!pending) return;
        const handle: SubscriptionHandle = {
          subscriptionId: msg.subscriptionId,
          unsubscribe: () => this.unsubscribe(msg.subscriptionId),
        };
        this.active.set(msg.subscriptionId, {
          handle,
          query: pending.query,
          params: pending.params,
          handlers: pending.handlers,
        });
        pending.resolveHandle(handle);
        this.pendingSubscribes.delete(msg.inReplyTo);
        return;
      }
      case 'snapshot': {
        const sub = this.active.get(msg.subscriptionId);
        sub?.handlers.onSnapshot(msg.snapshot, msg.cursor);
        return;
      }
      case 'delta': {
        const sub = this.active.get(msg.subscriptionId);
        sub?.handlers.onDelta(msg.delta, msg.cursor);
        return;
      }
      case 'rpc.result': {
        const rpc = this.pendingRpcs.get(msg.inReplyTo);
        rpc?.resolve(msg.result);
        this.pendingRpcs.delete(msg.inReplyTo);
        return;
      }
      case 'error': {
        const inReplyTo = msg.inReplyTo;
        if (inReplyTo) {
          const pending = this.pendingSubscribes.get(inReplyTo);
          if (pending) {
            pending.rejectHandle(new Error(msg.error.message));
            this.pendingSubscribes.delete(inReplyTo);
          }
          const rpc = this.pendingRpcs.get(inReplyTo);
          if (rpc) {
            rpc.reject(new Error(msg.error.message));
            this.pendingRpcs.delete(inReplyTo);
          }
        }
        return;
      }
      case 'pong':
        return;
    }
  }

  private unsubscribe(subscriptionId: string) {
    const sub = this.active.get(subscriptionId);
    if (!sub) return;
    this.active.delete(subscriptionId);
    if (this.socket && this.status === 'open') {
      this.socket.send(
        JSON.stringify({
          v: PROTOCOL_VERSION,
          id: this.requestId(),
          type: 'unsubscribe',
          subscriptionId,
        }),
      );
    }
  }

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  private failPendingRpcsOnDisconnect() {
    for (const [, rpc] of this.pendingRpcs) {
      rpc.reject(new Error('disconnected'));
    }
    this.pendingRpcs.clear();
  }

  private scheduleReconnect() {
    this.reconnectAttempt++;
    const base = Math.min(30_000, 2 ** this.reconnectAttempt * 250);
    const jitter = Math.random() * 250;
    const delay = base + jitter;
    this.opts.log?.('ws.reconnect.scheduled', { delay, attempt: this.reconnectAttempt });
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }
}

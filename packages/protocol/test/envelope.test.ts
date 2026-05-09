import { describe, expect, it } from 'vitest';

import { clientMessage, PROTOCOL_VERSION, serverMessage } from '../src/index.js';

describe('client envelope', () => {
  it('parses a subscribe message', () => {
    const parsed = clientMessage.parse({
      v: PROTOCOL_VERSION,
      id: 'r-1',
      type: 'subscribe',
      query: 'charge-points',
      params: { online: true },
    });
    expect(parsed.type).toBe('subscribe');
  });

  it('rejects an unknown query name', () => {
    expect(() =>
      clientMessage.parse({
        v: PROTOCOL_VERSION,
        id: 'r-2',
        type: 'subscribe',
        query: 'not-a-query',
        params: {},
      }),
    ).toThrow();
  });

  it('parses an rpc message', () => {
    const parsed = clientMessage.parse({
      v: PROTOCOL_VERSION,
      id: 'r-3',
      type: 'rpc',
      method: 'remote-start',
      params: { cp_id: 'CP_1', id_tag: 'TAG' },
    });
    expect(parsed.type).toBe('rpc');
  });
});

describe('server envelope', () => {
  it('parses a snapshot for charge-points', () => {
    const parsed = serverMessage.parse({
      v: PROTOCOL_VERSION,
      type: 'snapshot',
      subscriptionId: 's-1',
      cursor: 'k:cp.status:42',
      snapshot: { kind: 'charge-points', rows: [] },
    });
    expect(parsed.type).toBe('snapshot');
  });

  it('parses a delta for transactions-active', () => {
    const parsed = serverMessage.parse({
      v: PROTOCOL_VERSION,
      type: 'delta',
      subscriptionId: 's-2',
      cursor: 'k:tx.started:7',
      delta: {
        kind: 'transactions-active',
        op: 'remove',
        transaction_id: 99,
      },
    });
    expect(parsed.type).toBe('delta');
  });
});

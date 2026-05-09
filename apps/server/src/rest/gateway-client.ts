// Thin typed client over the gateway's REST API.
// The full surface is described by the OpenAPI types in @eveys-console/api-types;
// here we only declare the calls the Console actually makes.

import { request } from 'undici';

import type { Logger } from '../logger.js';
import type { Config } from '../config.js';

export class GatewayClient {
  constructor(
    private readonly cfg: Pick<Config, 'GATEWAY_BASE_URL' | 'GATEWAY_TOKEN'>,
    private readonly log: Logger,
  ) {}

  private async json<T>(
    path: string,
    init?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'; body?: unknown },
  ): Promise<T> {
    const url = `${this.cfg.GATEWAY_BASE_URL}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.GATEWAY_TOKEN}`,
      Accept: 'application/json',
    };
    if (init?.body !== undefined) headers['Content-Type'] = 'application/json';

    const start = Date.now();
    const method = init?.method ?? 'GET';
    const reqOpts: Parameters<typeof request>[1] = { method, headers };
    if (init?.body !== undefined) reqOpts.body = JSON.stringify(init.body);
    const res = await request(url, reqOpts);
    const elapsed = Date.now() - start;
    this.log.debug({ path, status: res.statusCode, elapsedMs: elapsed }, 'gateway.call');

    if (res.statusCode >= 400) {
      const text = await res.body.text();
      throw new GatewayError(res.statusCode, text, path);
    }
    return (await res.body.json()) as T;
  }

  health() {
    return this.json<unknown>('/api/v1/health');
  }

  sysConfig() {
    return this.json<unknown>('/api/v1/sys/config');
  }

  listChargePoints(
    params: { online?: boolean; vendor?: string; limit?: number; cursor?: string } = {},
  ) {
    const qs = new URLSearchParams();
    if (params.online !== undefined) qs.set('online', String(params.online));
    if (params.vendor) qs.set('vendor', params.vendor);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.json<unknown>(`/api/v1/charge-points${suffix}`);
  }

  getChargePoint(cpId: string) {
    return this.json<unknown>(`/api/v1/charge-points/${encodeURIComponent(cpId)}`);
  }

  listActiveTransactions() {
    return this.json<unknown>(`/api/v1/transactions?active=true`);
  }

  remoteStart(cpId: string, body: Record<string, unknown>) {
    return this.json<unknown>(
      `/api/v1/charge-points/${encodeURIComponent(cpId)}/commands/remote-start`,
      { method: 'POST', body },
    );
  }

  remoteStop(cpId: string, body: Record<string, unknown>) {
    return this.json<unknown>(
      `/api/v1/charge-points/${encodeURIComponent(cpId)}/commands/remote-stop`,
      { method: 'POST', body },
    );
  }

  reset(cpId: string, body: Record<string, unknown>) {
    return this.json<unknown>(`/api/v1/charge-points/${encodeURIComponent(cpId)}/commands/reset`, {
      method: 'POST',
      body,
    });
  }
}

export class GatewayError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`gateway ${status} on ${path}`);
    this.name = 'GatewayError';
  }
}

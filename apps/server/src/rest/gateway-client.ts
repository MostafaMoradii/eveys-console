// Thin typed client over the gateway's REST API.
// The full surface is described by the OpenAPI types in @eveys-console/api-types;
// here we only declare the calls the Console actually makes.

import { request } from 'undici';

import type { Logger } from '../logger.js';
import type { Config } from '../config.js';
import { recordGatewayRequest, type GatewayOp } from '../metrics/registry.js';

export class GatewayClient {
  constructor(
    private readonly cfg: Pick<Config, 'GATEWAY_BASE_URL' | 'GATEWAY_TOKEN'>,
    private readonly log: Logger,
  ) {}

  private async json<T>(
    op: GatewayOp,
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
    // `op` is a closed enum (see GatewayOp) so the {op,status} label
    // cartesian stays bounded; URL paths never become labels.
    let status: number | 'error' = 'error';
    try {
      const res = await request(url, reqOpts);
      status = res.statusCode;
      const elapsed = Date.now() - start;
      this.log.debug({ path, status: res.statusCode, elapsedMs: elapsed }, 'gateway.call');

      if (res.statusCode >= 400) {
        const text = await res.body.text();
        throw new GatewayError(res.statusCode, text, path);
      }
      return (await res.body.json()) as T;
    } finally {
      recordGatewayRequest(op, status, (Date.now() - start) / 1000);
    }
  }

  health() {
    return this.json<unknown>('health', '/api/v1/health');
  }

  sysConfig() {
    return this.json<unknown>('sys_config', '/api/v1/sys/config');
  }

  sysKpis() {
    return this.json<unknown>('sys_kpis', '/api/v1/sys/kpis');
  }

  // ---- Runtime overrides (admin-config) ---------------------------------
  // These three pair with the gateway's `runtime_overrides` allowlist. The
  // Console exposes them via the `/sys/gateway-admin-config` proxy so
  // operators can flip log_level / webhook URLs / per-CP webhook enables
  // without a redeploy.

  adminConfig() {
    return this.json<unknown>('admin_config', '/api/v1/admin/config');
  }

  patchAdminConfig(updates: Record<string, unknown>) {
    return this.json<unknown>('patch_admin_config', '/api/v1/admin/config', {
      method: 'PATCH',
      body: { updates },
    });
  }

  deleteAdminConfigOverride(key: string) {
    return this.json<unknown>(
      'delete_admin_config_override',
      `/api/v1/admin/config/overrides/${encodeURIComponent(key)}`,
      { method: 'DELETE' },
    );
  }

  listChargePoints(
    params: {
      online?: boolean;
      vendor?: string;
      ocpp_version?: string;
      last_status?: string;
      cp_id_prefix?: string;
      cp_id_contains?: string;
      limit?: number;
      cursor?: string;
      page?: number;
      page_size?: number;
    } = {},
  ) {
    const qs = new URLSearchParams();
    if (params.online !== undefined) qs.set('online', String(params.online));
    if (params.vendor) qs.set('vendor', params.vendor);
    if (params.ocpp_version) qs.set('ocpp_version', params.ocpp_version);
    if (params.last_status) qs.set('last_status', params.last_status);
    if (params.cp_id_prefix) qs.set('cp_id_prefix', params.cp_id_prefix);
    if (params.cp_id_contains) qs.set('cp_id_contains', params.cp_id_contains);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    if (params.page) qs.set('page', String(params.page));
    if (params.page_size) qs.set('page_size', String(params.page_size));
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.json<unknown>('list_charge_points', `/api/v1/charge-points${suffix}`);
  }

  getChargePoint(cpId: string) {
    return this.json<unknown>(
      'get_charge_point',
      `/api/v1/charge-points/${encodeURIComponent(cpId)}`,
    );
  }

  listActiveTransactions() {
    return this.json<unknown>('list_active_transactions', `/api/v1/transactions?active=true`);
  }

  listChargePointTransactions(
    cpId: string,
    params: { active?: boolean; limit?: number; cursor?: string } = {},
  ) {
    const qs = new URLSearchParams();
    if (params.active !== undefined) qs.set('active', String(params.active));
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.cursor) qs.set('cursor', params.cursor);
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.json<unknown>(
      'list_charge_point_transactions',
      `/api/v1/charge-points/${encodeURIComponent(cpId)}/transactions${suffix}`,
    );
  }

  /** Reservation history for one charger. The gateway returns
   *  every status (Pending / Active / Cancelled); the operator UI
   *  filters as needed. */
  listChargePointReservations(
    cpId: string,
    params: { active?: boolean; status?: string; id_tag?: string; limit?: number } = {},
  ) {
    const qs = new URLSearchParams();
    if (params.active !== undefined) qs.set('active', String(params.active));
    if (params.status) qs.set('status', params.status);
    if (params.id_tag) qs.set('id_tag', params.id_tag);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs}` : '';
    return this.json<unknown>(
      'list_charge_point_reservations',
      `/api/v1/charge-points/${encodeURIComponent(cpId)}/reservations${suffix}`,
    );
  }

  // ---- Per-transaction detail + meter-values time-series ----------------
  // The active-transaction list flows through the WS broker as a snapshot.
  // The single-transaction detail page does NOT have a broker query — it
  // polls these two endpoints via REST. See the proxy routes in
  // routes/sys-transactions.ts.

  getTransaction(txId: number) {
    return this.json<unknown>(
      'get_transaction',
      `/api/v1/transactions/${encodeURIComponent(String(txId))}`,
    );
  }

  listMeterValues(
    cpId: string,
    params: {
      from: string;
      to: string;
      measurand?: string;
      connector_id?: number;
      limit?: number;
    },
  ) {
    const qs = new URLSearchParams();
    qs.set('from', params.from);
    qs.set('to', params.to);
    if (params.measurand) qs.set('measurand', params.measurand);
    if (params.connector_id !== undefined) qs.set('connector_id', String(params.connector_id));
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    return this.json<unknown>(
      'list_meter_values',
      `/api/v1/charge-points/${encodeURIComponent(cpId)}/meter-values?${qs.toString()}`,
    );
  }

  /** Verbatim OCPP frame audit for a charger. Both directions by
   *  default; pass `direction` for one side, `action` for one OCPP
   *  action name. The gateway caps the window at 7 days (same as
   *  meter-values + status-history). */
  listCpFrames(
    cpId: string,
    params: {
      from: string;
      to: string;
      direction?: 'inbound' | 'outbound';
      action?: string;
      limit?: number;
    },
  ) {
    const qs = new URLSearchParams();
    qs.set('from', params.from);
    qs.set('to', params.to);
    if (params.direction) qs.set('direction', params.direction);
    if (params.action) qs.set('action', params.action);
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    return this.json<unknown>(
      'list_cp_frames',
      `/api/v1/charge-points/${encodeURIComponent(cpId)}/frames?${qs.toString()}`,
    );
  }

  // ---- OCPP commands -----------------------------------------------------
  // Each method maps to one of the gateway's
  // `POST /api/v1/charge-points/{cp_id}/commands/{slug}` endpoints. The body
  // shapes are 1:1 with what the gateway expects; we don't translate.

  private command(op: GatewayOp, cpId: string, slug: string, body: Record<string, unknown>) {
    return this.json<unknown>(
      op,
      `/api/v1/charge-points/${encodeURIComponent(cpId)}/commands/${slug}`,
      { method: 'POST', body },
    );
  }

  remoteStart(cpId: string, body: Record<string, unknown>) {
    return this.command('command_remote_start', cpId, 'remote-start', body);
  }
  remoteStop(cpId: string, body: Record<string, unknown>) {
    return this.command('command_remote_stop', cpId, 'remote-stop', body);
  }
  reset(cpId: string, body: Record<string, unknown>) {
    return this.command('command_reset', cpId, 'reset', body);
  }
  triggerMessage(cpId: string, body: Record<string, unknown>) {
    return this.command('command_trigger_message', cpId, 'trigger-message', body);
  }
  unlockConnector(cpId: string, body: Record<string, unknown>) {
    return this.command('command_unlock_connector', cpId, 'unlock-connector', body);
  }
  clearCache(cpId: string, body: Record<string, unknown>) {
    return this.command('command_clear_cache', cpId, 'clear-cache', body);
  }
  getConfiguration(cpId: string, body: Record<string, unknown>) {
    return this.command('command_get_configuration', cpId, 'get-configuration', body);
  }
  changeConfiguration(cpId: string, body: Record<string, unknown>) {
    return this.command('command_change_configuration', cpId, 'change-configuration', body);
  }
  reserveNow(cpId: string, body: Record<string, unknown>) {
    return this.command('command_reserve_now', cpId, 'reserve-now', body);
  }
  cancelReservation(cpId: string, body: Record<string, unknown>) {
    return this.command('command_cancel_reservation', cpId, 'cancel-reservation', body);
  }
  getDiagnostics(cpId: string, body: Record<string, unknown>) {
    return this.command('command_get_diagnostics', cpId, 'get-diagnostics', body);
  }
  getLog(cpId: string, body: Record<string, unknown>) {
    return this.command('command_get_log', cpId, 'get-log', body);
  }
  dataTransfer(cpId: string, body: Record<string, unknown>) {
    return this.command('command_data_transfer', cpId, 'data-transfer', body);
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

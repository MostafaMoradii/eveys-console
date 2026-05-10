// /metrics smoke + recorder round-trips.
//
// The registry is module-global (prom-client design), so each test wipes
// cumulative state in beforeEach. We're not testing prom-client itself —
// we're testing that the route is wired, the content-type is right, every
// metric family the issue calls out is present, the recorder functions
// move the right counter line, and `/metrics` does NOT require a JWT.

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  recordAuthLogin,
  recordAuthPowSolve,
  recordGatewayRequest,
  recordKafkaMessage,
  recordWsClose,
  recordWsConnection,
  recordWsMessage,
  resetMetricsForTests,
} from '../src/metrics/registry.js';
import { registerMetricsRoute } from '../src/routes/metrics.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerMetricsRoute(app);
  await app.ready();
  return app;
}

async function scrape(app: FastifyInstance): Promise<string> {
  const res = await app.inject({ method: 'GET', url: '/metrics' });
  expect(res.statusCode).toBe(200);
  return res.body;
}

describe('GET /metrics', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    resetMetricsForTests();
    app = await buildApp();
  });

  it('serves Prometheus text with the right content-type and a non-empty body', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain.*version=0\.0\.4/);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('does not require a JWT (no Authorization header → still 200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('# HELP');
  });

  it('exports default process metrics with eveys_console_ prefix', async () => {
    // The custom collectors are zero-valued until something records them,
    // but they're still defined — touch one so its lines materialise too.
    recordWsConnection(1);
    recordWsConnection(-1);

    const body = await scrape(app);
    // Default Node collectors get the prefix because we configured one;
    // pick a couple that are guaranteed to be emitted on Node 20.
    expect(body).toMatch(/eveys_console_process_cpu_seconds_total/);
    expect(body).toMatch(/eveys_console_nodejs_eventloop_lag_seconds/);
  });

  it('exposes at least one line of every custom metric family', async () => {
    // Force every family to materialise by recording one observation each.
    recordWsConnection(1);
    recordWsMessage('in');
    recordWsClose(1000);
    recordAuthLogin('success');
    recordAuthPowSolve(0.02);
    recordGatewayRequest('list_charge_points', 200, 0.05);
    recordKafkaMessage('cp.status.v1');

    const body = await scrape(app);
    expect(body).toMatch(/eveys_console_ws_connections /);
    expect(body).toMatch(/eveys_console_ws_messages_total\{direction="in"\}/);
    expect(body).toMatch(/eveys_console_ws_close_total\{code="1000"\}/);
    expect(body).toMatch(/eveys_console_auth_login_total\{result="success"\}/);
    expect(body).toMatch(/eveys_console_auth_pow_solve_seconds_bucket/);
    expect(body).toMatch(
      /eveys_console_gateway_request_total\{op="list_charge_points",status="200"\}/,
    );
    expect(body).toMatch(/eveys_console_gateway_request_seconds_bucket/);
    expect(body).toMatch(/eveys_console_kafka_messages_total\{topic="cp\.status\.v1"\}/);
  });

  it('recordWsClose moves the counter for that code', async () => {
    recordWsClose(4401);
    recordWsClose(4401);
    const body = await scrape(app);
    expect(body).toMatch(/eveys_console_ws_close_total\{code="4401"\} 2/);
  });

  it('recordWsConnection increments and decrements the gauge', async () => {
    recordWsConnection(1);
    recordWsConnection(1);
    recordWsConnection(-1);
    const body = await scrape(app);
    expect(body).toMatch(/eveys_console_ws_connections 1/);
  });

  it('recordGatewayRequest produces an op+status label pair', async () => {
    recordGatewayRequest('get_charge_point', 503, 0.123);
    const body = await scrape(app);
    expect(body).toMatch(
      /eveys_console_gateway_request_total\{op="get_charge_point",status="503"\} 1/,
    );
  });
});

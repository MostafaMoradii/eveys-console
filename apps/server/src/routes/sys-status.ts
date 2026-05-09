// System-status endpoint. Aggregates the signals an operator wants on a
// single screen: upstream gateway health, BaaS uptime, Kafka tail status,
// connected-WS count. Cheap to call (≈100ms incl. one HTTP probe to the
// gateway) so the UI can poll it every few seconds.

import type { Broker } from '../broker/broker.js';
import type { Config } from '../config.js';
import type { GatewayClient } from '../rest/gateway-client.js';
import type { KafkaTail } from '../kafka/tail.js';

interface RouteDeps {
  broker: Broker;
  gateway: GatewayClient;
  kafka: KafkaTail;
  startedAt: Date;
}

interface ComponentStatus {
  ok: boolean;
  detail?: string;
  latency_ms?: number;
}

interface SysStatusResponse {
  baas: {
    uptime_seconds: number;
    started_at: string;
  };
  gateway: ComponentStatus & {
    version?: string;
    components?: Record<string, string>;
  };
  kafka: ComponentStatus & {
    topics?: string[];
    consumer_running?: boolean;
  };
  connections: {
    websockets: number;
  };
}

// Loose `app` type to compose with any FastifyInstance.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerSysStatusRoute(app: any, deps: RouteDeps) {
  const requireAuth = async (
    req: { jwtVerify: () => Promise<unknown> },
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
  ) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    return undefined;
  };

  app.get('/sys/status', { preHandler: requireAuth }, async (): Promise<SysStatusResponse> => {
    const baasUptime = Math.floor((Date.now() - deps.startedAt.getTime()) / 1000);

    const gatewayProbe = await probeGatewayHealth(deps.gateway);
    const kafkaState = probeKafka(deps.kafka);

    return {
      baas: {
        uptime_seconds: baasUptime,
        started_at: deps.startedAt.toISOString(),
      },
      gateway: gatewayProbe,
      kafka: kafkaState,
      connections: {
        websockets: deps.broker.connectionCount(),
      },
    };
  });
}

async function probeGatewayHealth(gateway: GatewayClient): Promise<SysStatusResponse['gateway']> {
  const t0 = Date.now();
  try {
    const body = (await gateway.health()) as {
      status?: string;
      version?: string;
      components?: Record<string, string>;
    };
    const latency = Date.now() - t0;
    if (body.status !== 'ok') {
      return {
        ok: false,
        detail: `status=${body.status ?? 'unknown'}`,
        latency_ms: latency,
        ...(body.version !== undefined ? { version: body.version } : {}),
        ...(body.components !== undefined ? { components: body.components } : {}),
      };
    }
    return {
      ok: true,
      latency_ms: latency,
      ...(body.version !== undefined ? { version: body.version } : {}),
      ...(body.components !== undefined ? { components: body.components } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'unreachable',
      latency_ms: Date.now() - t0,
    };
  }
}

function probeKafka(kafka: KafkaTail): SysStatusResponse['kafka'] {
  const running = kafka.isRunning();
  const base: SysStatusResponse['kafka'] = {
    ok: running,
    consumer_running: running,
    topics: kafka.subscribedTopics(),
  };
  if (!running) base.detail = 'consumer not running';
  return base;
}

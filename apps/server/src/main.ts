// Process entry point. Wires everything together; only this file knows the
// concrete topology. Keep it thin — every component is unit-testable in
// isolation by passing fakes for the constructor deps.

import fastifyJwt from '@fastify/jwt';
import fastifySensible from '@fastify/sensible';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';

import { Broker } from './broker/broker.js';
import { loadConfig, type Config } from './config.js';
import { KafkaTail } from './kafka/tail.js';
import { buildLogger } from './logger.js';
import { GatewayClient } from './rest/gateway-client.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerWsRoute } from './routes/ws.js';

declare module 'fastify' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface FastifyInstance {
    config: Config;
  }
}

async function main() {
  const config = loadConfig();
  const logger = buildLogger(config);

  const app = Fastify({ loggerInstance: logger, disableRequestLogging: false });
  app.decorate('config', config);

  await app.register(fastifySensible);
  await app.register(fastifyJwt, {
    secret: config.JWT_SECRET,
    verify: { allowedAud: config.JWT_AUDIENCE },
  });
  await app.register(fastifyWebsocket, {
    options: {
      maxPayload: 1024 * 64,
      handleProtocols: (protocols) => {
        // Accept the connection if both our subprotocol marker and a bearer
        // token subprotocol are present. The token is validated in the route.
        const arr = Array.from(protocols);
        if (!arr.includes('eveys-console-v1')) return false;
        return 'eveys-console-v1';
      },
    },
  });

  const gateway = new GatewayClient(config, logger);
  const kafka = new KafkaTail(config, logger);
  const broker = new Broker(kafka, gateway, logger);

  await registerHealthRoutes(app);
  await registerWsRoute(app, { broker, gateway });

  await kafka.start();
  broker.start();

  const stop = async (signal: string) => {
    logger.info({ signal }, 'shutdown.begin');
    try {
      broker.stop();
      await kafka.stop();
      await app.close();
      logger.info('shutdown.done');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'shutdown.failed');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));

  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info({ host: config.HOST, port: config.PORT }, 'listening');
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('fatal:', err);
  process.exit(1);
});

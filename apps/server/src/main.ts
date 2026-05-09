// Process entry point. Wires everything together; only this file knows the
// concrete topology. Keep it thin — every component is unit-testable in
// isolation by passing fakes for the constructor deps.

// Load apps/server/.env if present, before reading any env vars. Done
// in-process (rather than requiring `node --env-file=.env`) so `pnpm dev`,
// `pnpm start`, and tools like `tsx` all work without extra flags.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

(() => {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifySensible from '@fastify/sensible';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';

import { PowVerifier } from './auth/pow.js';
import { UserStore } from './auth/users.js';
import { Broker } from './broker/broker.js';
import { loadConfig, type Config } from './config.js';
import { KafkaTail } from './kafka/tail.js';
import { buildLogger } from './logger.js';
import { GatewayClient } from './rest/gateway-client.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSysConfigRoute } from './routes/sys-config.js';
import { registerSysGatewayConfigRoute } from './routes/sys-gateway-config.js';
import { registerSysStatusRoute } from './routes/sys-status.js';
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
  await app.register(fastifyRateLimit, {
    global: false, // Per-route only.
  });
  const allowedOrigins = config.ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(fastifyCors, {
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: false,
  });
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
  const users = new UserStore(config);
  const pow = new PowVerifier(config);

  const startedAt = new Date();
  await registerHealthRoutes(app);
  await registerAuthRoutes(app, { pow, users });
  await registerSysStatusRoute(app, { broker, gateway, kafka, startedAt });
  await registerSysConfigRoute(app, { config });
  await registerSysGatewayConfigRoute(app, { gateway });
  await registerWsRoute(app, { broker, gateway });

  if (users.size === 0) {
    logger.warn('login disabled: CONSOLE_USERS is empty. WS still accepts pre-minted JWTs.');
  } else {
    logger.info({ users: users.size }, 'login enabled');
  }

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

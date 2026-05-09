import { z } from 'zod';

const schema = z.object({
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8090),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_PRETTY: z.coerce.boolean().default(false),

  // JWT — for v1 we accept HS256 with a shared secret. Plug an IDP later by
  // switching to RS256 + JWKS; the verify call lives in src/auth/jwt.ts.
  JWT_SECRET: z.string().min(16),
  JWT_AUDIENCE: z.string().default('eveys-console'),
  JWT_ISSUER: z.string().default('eveys-console'),

  // Gateway upstream
  GATEWAY_BASE_URL: z.string().url(),
  GATEWAY_TOKEN: z.string().min(1),

  // Kafka tail
  KAFKA_BROKERS: z
    .string()
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.string()).min(1)),
  KAFKA_CLIENT_ID: z.string().default('eveys-console-baas'),
  KAFKA_GROUP_ID: z.string().default('eveys-console-baas'),
  KAFKA_TOPICS_BOOT: z.string().default('cp.boot'),
  KAFKA_TOPICS_STATUS: z.string().default('cp.status'),
  KAFKA_TOPICS_METER: z.string().default('cp.meter'),
  KAFKA_TOPICS_TX_STARTED: z.string().default('tx.started'),

  // WS hardening
  WS_MAX_SUBSCRIPTIONS_PER_CONN: z.coerce.number().int().positive().default(50),
  WS_PING_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  WS_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

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
  JWT_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 3600),

  // Login users. CSV of `username:bcrypthash` pairs. Empty disables login
  // entirely (the WS still accepts pre-minted JWTs — useful for headless
  // tests / service callers).
  // Generate a hash with `pnpm --filter @eveys-console/server hash-password`.
  CONSOLE_USERS: z.string().default(''),

  // Anti-robot proof-of-work CAPTCHA on the login form.
  // Difficulty = number of leading zero bits the client's hash must have.
  // 16 ≈ 50 ms on a laptop; 20 ≈ 1 s; tune for your threat model.
  AUTH_POW_DIFFICULTY: z.coerce.number().int().min(0).max(28).default(16),
  AUTH_POW_TTL_SECONDS: z.coerce.number().int().positive().default(120),

  // Login rate limit per IP. The WS endpoint has its own limits.
  AUTH_LOGIN_MAX_PER_MIN: z.coerce.number().int().positive().default(5),

  // Comma-separated list of allowed Origin headers on the WS handshake and
  // login routes. Empty = no Origin check (laptop dev). Set to your console
  // hostname(s) in production.
  ALLOWED_ORIGINS: z.string().default(''),

  // Gateway upstream
  GATEWAY_BASE_URL: z.string().url(),
  GATEWAY_TOKEN: z.string().min(1),

  // Kafka tail
  KAFKA_BROKERS: z
    .string()
    .transform((s) =>
      s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1)),
  KAFKA_CLIENT_ID: z.string().default('eveys-console'),
  KAFKA_GROUP_ID: z.string().default('eveys-console'),
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

const PLACEHOLDER_SECRETS = new Set([
  'replace-me-with-a-real-secret-of-at-least-16-bytes',
  'changeme',
  'secret',
  'dev-secret',
]);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const cfg = parsed.data;

  // Refuse to bind a non-loopback interface with a placeholder JWT_SECRET.
  // This is the difference between "vulnerable laptop dev" and "fully open
  // admin endpoint on the public internet". A misconfigured deploy is the
  // dominant failure mode; this trips it before it does damage.
  if (PLACEHOLDER_SECRETS.has(cfg.JWT_SECRET) && !LOOPBACK_HOSTS.has(cfg.HOST)) {
    throw new Error(
      `Refusing to start: JWT_SECRET is a placeholder and HOST=${cfg.HOST} is not loopback.\n` +
        `Set JWT_SECRET to a strong value (e.g. \`openssl rand -base64 48\`) before binding a public interface.`,
    );
  }

  return cfg;
}

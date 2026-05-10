// Per-key metadata for the configuration surface exposed at GET /sys/config.
//
// Co-located with the schema in config.ts so that adding a new key forces a
// matching metadata row at typecheck time (the `keys` array is typed against
// `keyof Config`).
//
// The console reads this to render the Configuration page: description,
// default, accepted range, mutability, restart impact, and whether the
// current value is sensitive (and should be masked in the UI).

import type { Config } from './config.js';

/** Whether changing this key in the deployment requires a process bounce. */
export type RestartImpact =
  | 'none' // value is read every request; change takes effect immediately
  | 'console' // Console process must restart to pick up
  | 'gateway' // change is on the gateway side; restart the gateway
  | 'both';

/** How a key got its current value. */
export type ValueSource =
  | 'env' // came from process.env at boot
  | 'default' // schema default; env var was unset or empty
  | 'computed'; // derived from other inputs

export interface KeyMeta {
  description: string;
  /** Can an operator change this in deployment? `false` = build-time / fixed. */
  mutable: boolean;
  /** What needs to restart for a change to take effect. */
  restart: RestartImpact;
  /** Free-form description of accepted values. */
  range: string;
  /** Stringified default value (or `''` when there is no default). */
  default: string;
  /** Mask the value when rendering. */
  sensitive: boolean;
}

const META: Record<keyof Config, KeyMeta> = {
  HOST: {
    description: 'Network interface the Console server binds to.',
    mutable: true,
    restart: 'console',
    range: 'IPv4/IPv6 address; "0.0.0.0" for all interfaces, "127.0.0.1" for loopback only.',
    default: '0.0.0.0',
    sensitive: false,
  },
  PORT: {
    description: 'TCP port the Console server listens on.',
    mutable: true,
    restart: 'console',
    range: '1–65535',
    default: '8090',
    sensitive: false,
  },
  LOG_LEVEL: {
    description: 'Minimum severity emitted by the structured logger.',
    mutable: true,
    restart: 'console',
    range: 'fatal | error | warn | info | debug | trace',
    default: 'info',
    sensitive: false,
  },
  LOG_PRETTY: {
    description: 'Engage pino-pretty for human-readable logs (dev only).',
    mutable: true,
    restart: 'console',
    range: 'true | false',
    default: 'false',
    sensitive: false,
  },

  JWT_SECRET: {
    description:
      'HS256 signing secret for browser JWTs. Refuses to bind a non-loopback HOST when set to a known placeholder.',
    mutable: true,
    restart: 'console',
    range: '≥ 16 characters. Recommend `openssl rand -base64 48`.',
    default: '',
    sensitive: true,
  },
  JWT_AUDIENCE: {
    description: 'Audience claim minted into login JWTs and required at verify time.',
    mutable: true,
    restart: 'console',
    range: 'free-form string',
    default: 'eveys-console',
    sensitive: false,
  },
  JWT_ISSUER: {
    description: 'Issuer claim minted into login JWTs and required at verify time.',
    mutable: true,
    restart: 'console',
    range: 'free-form string',
    default: 'eveys-console',
    sensitive: false,
  },
  JWT_TTL_SECONDS: {
    description: 'Lifetime of issued JWTs.',
    mutable: true,
    restart: 'console',
    range: 'positive integer (seconds)',
    default: '28800',
    sensitive: false,
  },

  CONSOLE_USERS: {
    description:
      'Comma-separated `username:bcrypthash` pairs. Empty disables the login form (pre-minted JWTs still accepted).',
    mutable: true,
    restart: 'console',
    range:
      'CSV of `user:$2a$…` entries; generate hashes with `pnpm --filter @eveys-console/server hash-password`.',
    default: '',
    sensitive: true,
  },

  AUTH_POW_DIFFICULTY: {
    description:
      'Proof-of-work CAPTCHA difficulty (leading-zero bits required on the client hash). 16 ≈ 50 ms; 20 ≈ 1 s.',
    mutable: true,
    restart: 'console',
    range: '0–28',
    default: '16',
    sensitive: false,
  },
  AUTH_POW_TTL_SECONDS: {
    description: 'How long a minted PoW challenge stays valid before the client must re-fetch.',
    mutable: true,
    restart: 'console',
    range: 'positive integer (seconds)',
    default: '120',
    sensitive: false,
  },
  AUTH_LOGIN_MAX_PER_MIN: {
    description: 'Per-IP rate limit on POST /auth/login.',
    mutable: true,
    restart: 'console',
    range: 'positive integer (requests per minute)',
    default: '5',
    sensitive: false,
  },

  ALLOWED_ORIGINS: {
    description:
      'CSV of Origin headers permitted on the WS handshake and login routes. Empty disables Origin checking (laptop dev).',
    mutable: true,
    restart: 'console',
    range:
      'CSV of fully-qualified origins (e.g. `https://console.example.com,https://console.eu.example.com`)',
    default: '',
    sensitive: false,
  },

  GATEWAY_BASE_URL: {
    description:
      'Base URL of the OCPP gateway REST API. Console uses this for snapshots and to forward RPCs.',
    mutable: true,
    restart: 'console',
    range: 'http(s)://host:port URL.',
    default: '',
    sensitive: false,
  },
  GATEWAY_TOKEN: {
    description: 'Bearer token sent to the gateway on every REST call.',
    mutable: true,
    restart: 'console',
    range: 'opaque token issued by the gateway',
    default: '',
    sensitive: true,
  },

  KAFKA_BROKERS: {
    description: 'CSV of Kafka bootstrap brokers the Console tails for live events.',
    mutable: true,
    restart: 'console',
    range: 'CSV of host:port (e.g. `kafka-0:9092,kafka-1:9092,kafka-2:9092`)',
    default: '',
    sensitive: false,
  },
  KAFKA_CLIENT_ID: {
    description: 'kafkajs `clientId` reported to the brokers.',
    mutable: true,
    restart: 'console',
    range: 'free-form string',
    default: 'eveys-console',
    sensitive: false,
  },
  KAFKA_GROUP_ID: {
    description:
      'Kafka consumer-group id. All Console pods share one group today; a per-pod model is on the multi-pod track.',
    mutable: true,
    restart: 'console',
    range: 'free-form string',
    default: 'eveys-console',
    sensitive: false,
  },
  KAFKA_TOPICS_BOOT: {
    description:
      'Topic the Console tails for BootNotification events. Must match the topic the gateway publishes to (gateway-side: kafka_topic_cp_boot).',
    mutable: true,
    restart: 'console',
    range: 'topic name',
    default: 'cp.boot',
    sensitive: false,
  },
  KAFKA_TOPICS_STATUS: {
    description:
      'Topic the Console tails for StatusNotification events. Must match the topic the gateway publishes to (gateway-side: kafka_topic_cp_status).',
    mutable: true,
    restart: 'console',
    range: 'topic name',
    default: 'cp.status',
    sensitive: false,
  },
  KAFKA_TOPICS_METER: {
    description:
      'Topic the Console tails for MeterValues samples. Must match the topic the gateway publishes to (gateway-side: kafka_topic_cp_meter).',
    mutable: true,
    restart: 'console',
    range: 'topic name',
    default: 'cp.meter',
    sensitive: false,
  },
  KAFKA_TOPICS_TX_STARTED: {
    description:
      'Topic the Console tails for StartTransaction events. Must match the topic the gateway publishes to (gateway-side: kafka_topic_tx_started).',
    mutable: true,
    restart: 'console',
    range: 'topic name',
    default: 'tx.started',
    sensitive: false,
  },

  WS_MAX_SUBSCRIPTIONS_PER_CONN: {
    description: 'Cap on simultaneous subscriptions per WebSocket. Plumbed but not yet enforced.',
    mutable: true,
    restart: 'console',
    range: 'positive integer',
    default: '50',
    sensitive: false,
  },
  WS_PING_INTERVAL_MS: {
    description: 'Server-side ping cadence on the WS connection. Detects half-open peers.',
    mutable: true,
    restart: 'console',
    range: 'positive integer (milliseconds)',
    default: '30000',
    sensitive: false,
  },
  WS_IDLE_TIMEOUT_MS: {
    description: 'Idle disconnect threshold on the WS connection.',
    mutable: true,
    restart: 'console',
    range: 'positive integer (milliseconds)',
    default: '120000',
    sensitive: false,
  },
};

export interface ConfigEntry {
  key: keyof Config;
  /** Stringified current value, or a mask when the key is sensitive. */
  value: string;
  /** When `sensitive` and the underlying value is non-empty, the real value is replaced by `value: '••••••••'`. */
  sensitive: boolean;
  default: string;
  source: ValueSource;
  description: string;
  mutable: boolean;
  restart: RestartImpact;
  range: string;
}

const MASK = '••••••••';

function stringify(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.join(',');
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

/**
 * Build the rendered list. Sensitive values are masked unless the underlying
 * value is empty (in which case `<empty>` is more useful than rows of dots).
 */
export function describeConfig(cfg: Config, env: NodeJS.ProcessEnv = process.env): ConfigEntry[] {
  const out: ConfigEntry[] = [];
  for (const key of Object.keys(META) as (keyof Config)[]) {
    const meta = META[key];
    const raw = cfg[key];
    const rendered = stringify(raw);
    const masked = meta.sensitive && rendered.length > 0 ? MASK : rendered;
    out.push({
      key,
      value: masked,
      sensitive: meta.sensitive,
      default: meta.default,
      source: env[key] !== undefined && env[key] !== '' ? 'env' : 'default',
      description: meta.description,
      mutable: meta.mutable,
      restart: meta.restart,
      range: meta.range,
    });
  }
  return out;
}

export const __forTest = { META, MASK };

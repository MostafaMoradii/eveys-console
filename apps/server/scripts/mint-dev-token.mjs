// Mint a dev JWT signed with JWT_SECRET from .env. Pure dev/local helper —
// production tokens come from your IdP. Pipe into pbcopy / xclip:
//
//   node scripts/mint-dev-token.mjs | pbcopy
//
// Defaults: 8h expiry, sub=dev, roles=[admin].

import { existsSync, readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env');
const env = { ...process.env };
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (env[k] === undefined) env[k] = v;
  }
}

const secret = env.JWT_SECRET;
const audience = env.JWT_AUDIENCE ?? 'eveys-console';
const issuer = env.JWT_ISSUER ?? 'eveys-console';
if (!secret || secret.length < 16) {
  console.error('JWT_SECRET missing or too short. Set it in apps/server/.env first.');
  process.exit(1);
}

const sub = process.env.SUB ?? 'dev';
const ttlSeconds = Number(process.env.TTL_SECONDS ?? 8 * 3600);
const now = Math.floor(Date.now() / 1000);

const header = { alg: 'HS256', typ: 'JWT' };
const payload = {
  sub,
  email: 'dev@local.test',
  roles: ['admin'],
  iss: issuer,
  aud: audience,
  iat: now,
  exp: now + ttlSeconds,
};

const b64url = (input) =>
  Buffer.from(JSON.stringify(input)).toString('base64url');
const signingInput = `${b64url(header)}.${b64url(payload)}`;
const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
process.stdout.write(`${signingInput}.${signature}`);

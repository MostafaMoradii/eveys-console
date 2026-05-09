// Login flow:
//   1. POST /auth/challenge          → { challenge, difficulty, expires_at }
//   2. POST /auth/login              → { username, password, challenge, solution }
//                                      → { token, expires_at }  on success
//                                      → 401 / 429 / 400 on failure
//
// /auth/login is rate-limited per IP. /auth/challenge is not — it's a
// stateless HMAC sign and the rate limiter on /auth/login bounds the
// useful number of challenges per IP anyway.

import { z } from 'zod';

import type { PowVerifier } from '../auth/pow.js';
import type { UserStore } from '../auth/users.js';
import type { Config } from '../config.js';

const loginBody = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(512),
  challenge: z.string().min(1).max(2048),
  solution: z.string().min(1).max(256),
});

interface RouteDeps {
  pow: PowVerifier;
  users: UserStore;
}

// Loose `app` type so we don't tangle with the parent FastifyInstance's
// generic; strict typing happens on the body validators.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerAuthRoutes(app: any, deps: RouteDeps) {
  const cfg = app.config as Config;

  app.post('/auth/challenge', async () => {
    const ch = deps.pow.issue();
    return {
      challenge: ch.challenge,
      difficulty: ch.difficulty,
      expires_at: new Date(ch.expiresAt).toISOString(),
    };
  });

  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: {
          max: cfg.AUTH_LOGIN_MAX_PER_MIN,
          timeWindow: '1 minute',
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (req: any, reply: any) => {
      const parsed = loginBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const { username, password, challenge, solution } = parsed.data;

      const powErr = deps.pow.verify(challenge, solution);
      if (powErr) {
        req.log.warn({ powErr, username }, 'auth.login.pow_failed');
        return reply.code(400).send({ error: 'pow_invalid', detail: powErr });
      }

      if (deps.users.size === 0) {
        req.log.error('auth.login.no_users_configured');
        return reply.code(503).send({ error: 'login_disabled' });
      }

      const user = await deps.users.verify(username, password);
      if (!user) {
        req.log.warn({ username }, 'auth.login.bad_credentials');
        return reply.code(401).send({ error: 'invalid_credentials' });
      }

      const now = Math.floor(Date.now() / 1000);
      const exp = now + cfg.JWT_TTL_SECONDS;
      const token = await app.jwt.sign(
        {
          sub: user.username,
          email: `${user.username}@console.local`, // Principal validator wants an email.
          roles: ['operator'],
          iss: cfg.JWT_ISSUER,
          aud: cfg.JWT_AUDIENCE,
          iat: now,
          exp,
        },
        { expiresIn: cfg.JWT_TTL_SECONDS },
      );

      req.log.info({ username }, 'auth.login.success');
      return {
        token,
        expires_at: new Date(exp * 1000).toISOString(),
      };
    },
  );
}

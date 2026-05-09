import { z } from 'zod';

import type { Config } from '../config.js';

export const principal = z.object({
  sub: z.string().min(1),
  email: z.string().email().optional(),
  roles: z.array(z.string()).default([]),
  iss: z.string(),
  aud: z.string().or(z.array(z.string())),
  exp: z.number().int(),
  iat: z.number().int(),
});
export type Principal = z.infer<typeof principal>;

// Per-connection auth context used by the WS layer + RPC handlers.
export interface AuthContext {
  principal: Principal;
  connectionId: string;
}

export function expectAudienceAndIssuer(p: unknown, cfg: Config): Principal {
  const parsed = principal.parse(p);
  const aud = Array.isArray(parsed.aud) ? parsed.aud : [parsed.aud];
  if (!aud.includes(cfg.JWT_AUDIENCE)) {
    throw new Error(`bad aud: ${parsed.aud}`);
  }
  if (parsed.iss !== cfg.JWT_ISSUER) {
    throw new Error(`bad iss: ${parsed.iss}`);
  }
  return parsed;
}

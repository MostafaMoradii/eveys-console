import { z } from 'zod';

export const errorCode = z.enum([
  'unauthenticated',
  'forbidden',
  'invalid_message',
  'unknown_query',
  'unknown_subscription',
  'rate_limited',
  'upstream_unavailable',
  'internal_error',
  // Command-specific (translated from the gateway's REST error_code).
  // Operators see these in the Commands transcript instead of a raw
  // "gateway 404" — the wording tells them why the command can't
  // possibly land right now and what state to wait for.
  'unknown_cp_id', // gateway has no row for this cp_id (never booted)
  'charger_offline', // cp_id exists but no pod owns the WS right now
  'charger_timeout', // charger online but didn't reply within the timeout
]);
export type ErrorCode = z.infer<typeof errorCode>;

export const errorPayload = z.object({
  code: errorCode,
  message: z.string(),
  request_id: z.string().optional(),
});
export type ErrorPayload = z.infer<typeof errorPayload>;

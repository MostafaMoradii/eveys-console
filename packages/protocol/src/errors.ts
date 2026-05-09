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
]);
export type ErrorCode = z.infer<typeof errorCode>;

export const errorPayload = z.object({
  code: errorCode,
  message: z.string(),
  request_id: z.string().optional(),
});
export type ErrorPayload = z.infer<typeof errorPayload>;

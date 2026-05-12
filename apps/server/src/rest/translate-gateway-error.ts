// Translate a thrown error from a gateway-bound RPC into a Console
// error code + human message the UI can render.
//
// Why this exists: the gateway's REST surface returns its own error
// envelope `{ error, error_code, request_id }` on every 4xx/5xx.
// Without translation those land in the browser as
// "gateway 404 on /api/v1/charge-points/X/commands/Y" — useless to
// operators. With translation, the Commands transcript reads
// "Charger isn't reachable — its WebSocket isn't connected to the
// gateway right now."
//
// The mapping is conservative — anything we don't recognise stays
// `internal_error` so we don't lose visibility into a real bug.
// Lives in its own module so it can be unit-tested without standing
// up a WebSocket harness.

import type { ErrorCode } from '@eveys-console/protocol';

import { GatewayError } from './gateway-client.js';

export interface TranslatedError {
  code: ErrorCode;
  message: string;
}

export function translateGatewayError(err: unknown): TranslatedError {
  if (err instanceof GatewayError) {
    const parsed = tryParseGatewayBody(err.body);
    const code = parsed?.error_code;
    switch (code) {
      case 'UNKNOWN_CP_ID':
        // The gateway uses this code for two distinct conditions
        // (the docstring in src/eveys_ocpp/api/_commands.py claims
        // separation, but the dispatcher in
        // `transport/grpc_server._dispatch_ocpp_call` actually
        // returns NOT_FOUND for both): the charger genuinely never
        // booted, OR the charger booted at some point but its WS
        // isn't held by any pod right now. The latter is dominant
        // in the wild — chargers drop their WS more often than
        // they fail to ever connect. Surface the offline copy
        // because it's the actionable case for an operator who can
        // see the charger in the fleet list. If the cp_id is
        // genuinely typo'd they'll figure it out quickly.
        return {
          code: 'charger_offline',
          message:
            "Charger isn't reachable — its WebSocket isn't connected to the gateway right now. Commands can't land until it reconnects (or if you typed the cp_id, check it).",
        };
      case 'CHARGER_OFFLINE':
        // The cross-pod-bus path emits this 503 when the registry
        // shows a different pod owns the WS but the bus isn't
        // wired (test fixture or single-pod deployment). Not
        // expected on the standalone stack today, but maps cleanly.
        return {
          code: 'charger_offline',
          message:
            "Charger is on a different gateway pod and the cross-pod bus isn't configured. Commands can't land here.",
        };
      case 'CHARGER_TIMEOUT':
        return {
          code: 'charger_timeout',
          message:
            "Charger didn't reply to the command within the gateway timeout. Try again, or check the device.",
        };
      case 'BAD_REQUEST':
        return {
          code: 'invalid_message',
          message: parsed?.error ?? 'Gateway rejected the request as invalid.',
        };
      case 'RATE_LIMITED':
        return {
          code: 'rate_limited',
          message: 'Gateway rate-limited the request. Wait a moment and retry.',
        };
      default:
        // Unknown gateway error_code — surface the gateway's own
        // message text so operators have something to grep.
        return { code: 'upstream_unavailable', message: err.message };
    }
  }
  return {
    code: 'internal_error',
    message: err instanceof Error ? err.message : 'internal error',
  };
}

interface GatewayErrorBody {
  error?: string;
  error_code?: string;
  request_id?: string;
}

export function tryParseGatewayBody(body: string): GatewayErrorBody | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as GatewayErrorBody;
  } catch {
    return null;
  }
}

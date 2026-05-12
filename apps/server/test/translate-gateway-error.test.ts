// Unit tests for the gateway-error → Console-error mapper. Pure
// function; the WS error path funnels every gateway rejection
// through it, so the mapping is what determines whether operators
// see "gateway 404 on /api/v1/..." or "Charger isn't reachable —
// its WebSocket isn't connected".

import { describe, expect, it } from 'vitest';

import { GatewayError } from '../src/rest/gateway-client.js';
import { translateGatewayError } from '../src/rest/translate-gateway-error.js';

function makeError(status: number, errorCode: string, errorText = 'whatever'): GatewayError {
  return new GatewayError(
    status,
    JSON.stringify({ error: errorText, error_code: errorCode, request_id: 'r-1' }),
    '/api/v1/charge-points/CP_X/commands/get-diagnostics',
  );
}

describe('translateGatewayError', () => {
  it('maps UNKNOWN_CP_ID to charger_offline with operator-actionable copy', () => {
    // The gateway uses UNKNOWN_CP_ID for BOTH "never booted" and
    // "booted but WS isn't connected now". The latter dominates,
    // and an operator who sees the charger in the fleet list needs
    // the offline message, not "doesn't know this charger".
    const out = translateGatewayError(makeError(404, 'UNKNOWN_CP_ID'));
    expect(out.code).toBe('charger_offline');
    expect(out.message).toMatch(/WebSocket isn't connected/);
  });

  it('maps CHARGER_OFFLINE (cross-pod-bus 503) to charger_offline', () => {
    const out = translateGatewayError(makeError(503, 'CHARGER_OFFLINE'));
    expect(out.code).toBe('charger_offline');
    expect(out.message).toMatch(/different gateway pod/);
  });

  it('maps CHARGER_TIMEOUT to charger_timeout', () => {
    const out = translateGatewayError(makeError(504, 'CHARGER_TIMEOUT'));
    expect(out.code).toBe('charger_timeout');
    expect(out.message).toMatch(/didn't reply/);
  });

  it('maps BAD_REQUEST to invalid_message with the gateway error text', () => {
    const out = translateGatewayError(makeError(400, 'BAD_REQUEST', 'invalid location: not a URL'));
    expect(out.code).toBe('invalid_message');
    expect(out.message).toBe('invalid location: not a URL');
  });

  it('maps RATE_LIMITED to rate_limited', () => {
    const out = translateGatewayError(makeError(429, 'RATE_LIMITED'));
    expect(out.code).toBe('rate_limited');
    expect(out.message).toMatch(/rate-limited/);
  });

  it('falls through to upstream_unavailable for an unknown gateway error_code', () => {
    const out = translateGatewayError(makeError(418, 'TEAPOT'));
    expect(out.code).toBe('upstream_unavailable');
    // The fallthrough surfaces the GatewayError's own message
    // (the `gateway 418 on /api/v1/...` shape from the ctor).
    expect(out.message).toMatch(/gateway 418/);
  });

  it('falls through to upstream_unavailable when the body is not JSON', () => {
    const err = new GatewayError(500, 'plain text not JSON', '/api/v1/whatever');
    const out = translateGatewayError(err);
    expect(out.code).toBe('upstream_unavailable');
  });

  it('treats a non-GatewayError as internal_error', () => {
    const out = translateGatewayError(new Error('something blew up'));
    expect(out.code).toBe('internal_error');
    expect(out.message).toBe('something blew up');
  });

  it('handles non-Error throws', () => {
    const out = translateGatewayError('a string thrown');
    expect(out.code).toBe('internal_error');
    expect(out.message).toBe('internal error');
  });
});

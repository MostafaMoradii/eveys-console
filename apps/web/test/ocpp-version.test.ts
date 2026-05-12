// Unit tests for the gateway-version formatter. Pure function;
// every UI surface that surfaces ocpp_version (fleet list, detail
// page header, future tabs) routes through this so the format
// stays consistent.

import { describe, expect, it } from 'vitest';

import { formatOcppVersion, supportsGetLog } from '@/lib/ocpp-version';

describe('formatOcppVersion', () => {
  it('strips the `ocpp` prefix and adds a space', () => {
    expect(formatOcppVersion('ocpp1.6')).toBe('OCPP 1.6');
    expect(formatOcppVersion('ocpp2.0.1')).toBe('OCPP 2.0.1');
  });

  it('handles the upper-case prefix too', () => {
    expect(formatOcppVersion('OCPP1.6')).toBe('OCPP 1.6');
  });

  it('prefixes anything that lacks the ocpp head', () => {
    // Future spec rev or hand-edited gateway DB — surface verbatim
    // with the prefix so the badge still labels the column meaning.
    expect(formatOcppVersion('weird-thing')).toBe('OCPP weird-thing');
  });

  it('returns OCPP ? on empty input', () => {
    expect(formatOcppVersion('')).toBe('OCPP ?');
    expect(formatOcppVersion('   ')).toBe('OCPP ?');
  });
});

describe('supportsGetLog', () => {
  it('returns true only for ocpp2+ (where GetLog is core)', () => {
    expect(supportsGetLog('ocpp2.0.1')).toBe(true);
    expect(supportsGetLog('ocpp2.1')).toBe(true);
  });

  it('returns false for ocpp1.6 (GetLog is Security Extensions, profile-only)', () => {
    expect(supportsGetLog('ocpp1.6')).toBe(false);
  });

  it('returns false for null / undefined / empty', () => {
    expect(supportsGetLog(null)).toBe(false);
    expect(supportsGetLog(undefined)).toBe(false);
    expect(supportsGetLog('')).toBe(false);
  });
});

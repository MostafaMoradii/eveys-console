import { describe, expect, it } from 'vitest';

import { formatPowerKw, parseChargerSpec } from '@/lib/charger-spec';

describe('parseChargerSpec', () => {
  it('extracts AC + power from the canonical Eveys AC model', () => {
    expect(parseChargerSpec('Eveys-22kW-AC')).toEqual({ kind: 'AC', power_kw: 22 });
  });

  it('extracts DC + power from the canonical Eveys DC model', () => {
    expect(parseChargerSpec('Eveys-100kW-DC')).toEqual({ kind: 'DC', power_kw: 100 });
  });

  it('handles a DC model with the kind before the power rating', () => {
    expect(parseChargerSpec('Eveys-DC-150kW')).toEqual({ kind: 'DC', power_kw: 150 });
  });

  it('handles a decimal power value', () => {
    expect(parseChargerSpec('Acme 7.4kW AC wallbox')).toEqual({ kind: 'AC', power_kw: 7.4 });
  });

  it('matches case-insensitively', () => {
    expect(parseChargerSpec('vendor-22kw-ac')).toEqual({ kind: 'AC', power_kw: 22 });
  });

  it('returns null fields when the model is null', () => {
    expect(parseChargerSpec(null)).toEqual({ kind: null, power_kw: null });
  });

  it('returns null fields when the model is undefined', () => {
    expect(parseChargerSpec(undefined)).toEqual({ kind: null, power_kw: null });
  });

  it('returns null fields when nothing matches', () => {
    expect(parseChargerSpec('UnknownModelXYZ')).toEqual({ kind: null, power_kw: null });
  });

  it('returns partial result when only kind is present', () => {
    expect(parseChargerSpec('Eveys AC station')).toEqual({ kind: 'AC', power_kw: null });
  });

  it('returns partial result when only power is present', () => {
    expect(parseChargerSpec('Generic 50kW unit')).toEqual({ kind: null, power_kw: 50 });
  });

  it('does not match "AC" or "DC" inside other words (word boundary)', () => {
    // "DCS" or "ACME" should not register as DC/AC. The \b in the
    // regex enforces a word boundary.
    expect(parseChargerSpec('DCS-something').kind).toBeNull();
    expect(parseChargerSpec('ACME charger').kind).toBeNull();
  });
});

describe('formatPowerKw', () => {
  it('renders integer kW with a space', () => {
    expect(formatPowerKw(22)).toBe('22 kW');
    expect(formatPowerKw(100)).toBe('100 kW');
  });

  it('renders fractional kW to one decimal place', () => {
    expect(formatPowerKw(7.4)).toBe('7.4 kW');
    expect(formatPowerKw(11.05)).toBe('11.1 kW');
  });

  it('returns null when power_kw is null', () => {
    expect(formatPowerKw(null)).toBeNull();
  });
});

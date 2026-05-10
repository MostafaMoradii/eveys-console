import { describe, expect, it } from 'vitest';

import type { ChargePointSummary } from '@eveys-console/protocol';

import {
  chargePointFaultLevel,
  connectorFaultLevel,
  countFaults,
  faultedConnectors,
} from '@/lib/fault';
import { describeErrorCode, isErrorCodeKnown, NO_ERROR } from '@/lib/ocpp-errors';

type Connector = ChargePointSummary['connectors'][number];
const conn = (over: Partial<Connector> = {}): Connector => ({
  connector_id: 1,
  status: 'Available',
  error_code: 'NoError',
  last_changed_at: null,
  ...over,
});

describe('connectorFaultLevel', () => {
  it('flags status=Faulted as fault', () => {
    expect(connectorFaultLevel(conn({ status: 'Faulted' }))).toBe('fault');
  });

  it('flags non-NoError error_code on a non-Faulted connector as advisory', () => {
    expect(connectorFaultLevel(conn({ error_code: 'OverCurrentFailure' }))).toBe('advisory');
  });

  it('returns ok for a clean connector', () => {
    expect(connectorFaultLevel(conn())).toBe('ok');
  });

  it('treats null error_code as ok', () => {
    expect(connectorFaultLevel(conn({ error_code: null }))).toBe('ok');
  });
});

describe('chargePointFaultLevel', () => {
  const cp = (connectors: Connector[]): ChargePointSummary =>
    ({
      cp_id: 'CP_X',
      online: true,
      pod_id: 'pod-1',
      vendor: 'Eveys',
      model: 'X1',
      firmware_version: '1.0.0',
      serial_number: 'SN1',
      last_boot_at: null,
      last_heartbeat_at: null,
      last_status: 'Available',
      connectors,
    }) as ChargePointSummary;

  it('takes the worst severity across connectors', () => {
    expect(chargePointFaultLevel(cp([conn(), conn({ connector_id: 2, status: 'Faulted' })]))).toBe(
      'fault',
    );
    expect(
      chargePointFaultLevel(
        cp([conn(), conn({ connector_id: 2, error_code: 'OverCurrentFailure' })]),
      ),
    ).toBe('advisory');
    expect(chargePointFaultLevel(cp([conn(), conn({ connector_id: 2 })]))).toBe('ok');
  });

  it('returns ok for an empty connector list', () => {
    expect(chargePointFaultLevel(cp([]))).toBe('ok');
  });
});

describe('faultedConnectors', () => {
  it('returns only the non-ok connectors, sorted by id', () => {
    const cp = {
      connectors: [
        conn({ connector_id: 3, status: 'Faulted' }),
        conn({ connector_id: 1 }),
        conn({ connector_id: 2, error_code: 'GroundFailure' }),
      ],
    } as ChargePointSummary;
    const out = faultedConnectors(cp);
    expect(out.map((c) => c.connector_id)).toEqual([2, 3]);
  });
});

describe('countFaults', () => {
  it('counts chargers (not connectors) at each severity', () => {
    const c = countFaults([
      // ok
      { connectors: [conn()] } as ChargePointSummary,
      // fault
      { connectors: [conn({ status: 'Faulted' })] } as ChargePointSummary,
      // advisory
      { connectors: [conn({ error_code: 'WeakSignal' })] } as ChargePointSummary,
      // a charger with both — counts once at the worst level
      {
        connectors: [
          conn({ status: 'Faulted' }),
          conn({ connector_id: 2, error_code: 'GroundFailure' }),
        ],
      } as ChargePointSummary,
    ]);
    expect(c).toEqual({ fault: 2, advisory: 1, total: 4 });
  });
});

describe('describeErrorCode', () => {
  it('returns NoError info when given null / undefined / NoError', () => {
    expect(describeErrorCode(null).label).toBe('No error');
    expect(describeErrorCode(undefined).label).toBe('No error');
    expect(describeErrorCode(NO_ERROR).label).toBe('No error');
  });

  it('returns dictionary info for known codes', () => {
    const info = describeErrorCode('GroundFailure');
    expect(info.label).toBe('Ground failure');
    expect(info.severityHint).toBe('critical');
    expect(info.suggestedAction.length).toBeGreaterThan(0);
  });

  it('falls back gracefully for unknown / vendor codes', () => {
    const info = describeErrorCode('VendorXYZError-407');
    // Falls back to using the raw code as the label (not 'NoError').
    expect(info.label).toBe('VendorXYZError-407');
    expect(info.description).toMatch(/vendor-specific or unrecognised/i);
  });
});

describe('isErrorCodeKnown', () => {
  it('reports known codes as known', () => {
    expect(isErrorCodeKnown('GroundFailure')).toBe(true);
    expect(isErrorCodeKnown(NO_ERROR)).toBe(true);
    expect(isErrorCodeKnown(null)).toBe(true);
    expect(isErrorCodeKnown(undefined)).toBe(true);
  });

  it('reports unknown codes as unknown', () => {
    expect(isErrorCodeKnown('VendorXYZError-407')).toBe(false);
  });
});

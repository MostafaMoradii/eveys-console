// Smoke + invariants for the static OCPP 1.6 dictionary. The
// dictionary is the source of staleness for the conformance page,
// so we want loud failures if a future edit drops a profile, leaves
// a summary blank, or breaks the ordering invariants the page
// renderer relies on.

import { describe, expect, it } from 'vitest';

import {
  countByStatus,
  groupByProfile,
  OCPP_MESSAGES,
  OCPP_PROFILES,
  type OcppDirection,
  type OcppProfile,
  type OcppStatus,
} from '@/lib/ocpp-conformance';

const VALID_DIRECTIONS: ReadonlySet<OcppDirection> = new Set([
  'charger-to-csms',
  'csms-to-charger',
]);
const VALID_STATUSES: ReadonlySet<OcppStatus> = new Set([
  'implemented',
  'partial',
  'not-implemented',
]);
const VALID_PROFILES: ReadonlySet<OcppProfile> = new Set(OCPP_PROFILES);

describe('OCPP_MESSAGES dictionary', () => {
  it('has at least one entry', () => {
    expect(OCPP_MESSAGES.length).toBeGreaterThan(0);
  });

  it('every entry has a non-empty summary', () => {
    for (const msg of OCPP_MESSAGES) {
      expect(msg.summary, `missing summary for ${msg.name}`).toBeTruthy();
      expect(msg.summary.trim().length).toBeGreaterThan(0);
    }
  });

  it('every entry has a valid profile / direction / status enum value', () => {
    for (const msg of OCPP_MESSAGES) {
      expect(VALID_PROFILES.has(msg.profile), `bad profile for ${msg.name}`).toBe(true);
      expect(VALID_DIRECTIONS.has(msg.direction), `bad direction for ${msg.name}`).toBe(true);
      expect(VALID_STATUSES.has(msg.status), `bad status for ${msg.name}`).toBe(true);
    }
  });

  it('console command slugs are kebab-case and only set on csms-to-charger entries', () => {
    for (const msg of OCPP_MESSAGES) {
      if (!msg.consoleCommandSlug) continue;
      expect(msg.direction).toBe('csms-to-charger');
      expect(msg.consoleCommandSlug).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('name+direction is unique (DataTransfer is intentionally listed for both directions)', () => {
    const seen = new Set<string>();
    for (const msg of OCPP_MESSAGES) {
      const key = `${msg.name}::${msg.direction}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });
});

describe('groupByProfile', () => {
  it('returns every OCPP profile as a key, even ones with no messages', () => {
    const grouped = groupByProfile(OCPP_MESSAGES);
    for (const profile of OCPP_PROFILES) {
      expect(profile in grouped).toBe(true);
    }
  });

  it('puts each message in exactly one profile group', () => {
    const grouped = groupByProfile(OCPP_MESSAGES);
    const total = OCPP_PROFILES.reduce((acc, p) => acc + grouped[p].length, 0);
    expect(total).toBe(OCPP_MESSAGES.length);

    // Spot-check membership for a known message.
    expect(grouped.Core.some((m) => m.name === 'BootNotification')).toBe(true);
    expect(grouped.SmartCharging.some((m) => m.name === 'SetChargingProfile')).toBe(true);
    expect(grouped.SecurityWhitepaper.some((m) => m.name === 'SignedUpdateFirmware')).toBe(true);
  });

  it('within a profile group, csms-to-charger messages come before charger-to-csms', () => {
    const grouped = groupByProfile(OCPP_MESSAGES);
    for (const profile of OCPP_PROFILES) {
      const directions = grouped[profile].map((m) => m.direction);
      // Once we've seen the first charger-to-csms entry no csms-to-charger
      // entry may follow.
      let sawIncoming = false;
      for (const d of directions) {
        if (d === 'charger-to-csms') sawIncoming = true;
        else if (sawIncoming) {
          throw new Error(`csms-to-charger after charger-to-csms in ${profile}`);
        }
      }
    }
  });

  it('within a direction, messages are sorted alphabetically by name', () => {
    const grouped = groupByProfile(OCPP_MESSAGES);
    for (const profile of OCPP_PROFILES) {
      const outgoing = grouped[profile]
        .filter((m) => m.direction === 'csms-to-charger')
        .map((m) => m.name);
      const incoming = grouped[profile]
        .filter((m) => m.direction === 'charger-to-csms')
        .map((m) => m.name);
      expect(outgoing).toEqual([...outgoing].sort((a, b) => a.localeCompare(b)));
      expect(incoming).toEqual([...incoming].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('Core profile contains the canonical 1.6 base operations', () => {
    const grouped = groupByProfile(OCPP_MESSAGES);
    const core = new Set(grouped.Core.map((m) => m.name));
    for (const expected of [
      'Authorize',
      'BootNotification',
      'Heartbeat',
      'MeterValues',
      'StartTransaction',
      'StatusNotification',
      'StopTransaction',
    ]) {
      expect(core.has(expected), `missing ${expected} from Core`).toBe(true);
    }
  });
});

describe('countByStatus', () => {
  it('totals across all statuses sum to the dictionary length', () => {
    const counts = countByStatus(OCPP_MESSAGES);
    expect(counts.implemented + counts.partial + counts['not-implemented']).toBe(
      OCPP_MESSAGES.length,
    );
  });
});

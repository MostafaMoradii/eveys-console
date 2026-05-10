// OCPP 1.6 conformance dictionary. Hand-curated against the gateway
// source; the entries below correspond to handlers in the gateway's
// src/eveys_ocpp/handlers/v16/ directory (charger-initiated) and the
// @router.post routes in src/eveys_ocpp/api/commands.py
// (gateway-initiated). Status is "implemented", "partial", or
// "not-implemented". The Security Whitepaper additions are bucketed
// into a synthetic SecurityWhitepaper profile so operators can see
// them as a coherent group instead of mixed into Core.
//
// This is a v1 static dictionary — there is no runtime introspection
// endpoint on the gateway. When the gateway grows a new handler,
// this file is the source of staleness; update it deliberately.

export type OcppDirection = 'charger-to-csms' | 'csms-to-charger';

export type OcppStatus = 'implemented' | 'partial' | 'not-implemented';

export type OcppProfile =
  | 'Core'
  | 'FirmwareManagement'
  | 'LocalAuthListManagement'
  | 'Reservation'
  | 'SmartCharging'
  | 'RemoteTrigger'
  | 'SecurityWhitepaper';

export interface OcppMessage {
  /** Spec name, e.g. 'BootNotification'. */
  name: string;
  profile: OcppProfile;
  direction: OcppDirection;
  status: OcppStatus;
  /** One-line operator-facing description (3-12 words). */
  summary: string;
  /** Optional caveat or fallback note worth surfacing in the table. */
  gatewayNote?: string;
  /**
   * For implemented gateway-initiated commands, the route slug operators
   * see in the per-charger CommandsDrawer (e.g. 'remote-start'). This
   * page can't open the drawer (no cp_id context), so the slug is
   * informational + copyable.
   */
  consoleCommandSlug?: string;
}

export const OCPP_PROFILES: readonly OcppProfile[] = [
  'Core',
  'FirmwareManagement',
  'LocalAuthListManagement',
  'Reservation',
  'SmartCharging',
  'RemoteTrigger',
  'SecurityWhitepaper',
] as const;

export const OCPP_PROFILE_LABELS: Record<OcppProfile, string> = {
  Core: 'Core',
  FirmwareManagement: 'Firmware Management',
  LocalAuthListManagement: 'Local Auth List Management',
  Reservation: 'Reservation',
  SmartCharging: 'Smart Charging',
  RemoteTrigger: 'Remote Trigger',
  SecurityWhitepaper: 'Security Whitepaper',
};

export const OCPP_PROFILE_BLURBS: Record<OcppProfile, string> = {
  Core: 'Base operations every charger and CSMS supports.',
  FirmwareManagement: 'Firmware update and diagnostics file workflows.',
  LocalAuthListManagement: 'Pre-loaded RFID lists held on the charger.',
  Reservation: 'Reserve a connector for a specific idTag.',
  SmartCharging: 'Charging profiles and load management.',
  RemoteTrigger: 'Operator-initiated triggers for charger-side messages.',
  SecurityWhitepaper:
    'OCPP 1.6 Security Whitepaper extensions — signed firmware, certificates, security events.',
};

export const OCPP_MESSAGES: readonly OcppMessage[] = [
  // ---- Core: charger -> CSMS ---------------------------------------------
  {
    name: 'Authorize',
    profile: 'Core',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Charger asks the CSMS whether an idTag may charge.',
    gatewayNote:
      'Backed by the Authorize cache; the cache TTL is per-deploy. ' +
      'When the backend Authorize endpoint 404s the gateway can fall ' +
      'back to accept_offline if the matching env flag is set.',
  },
  {
    name: 'BootNotification',
    profile: 'Core',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Charger announces itself on connect; gets heartbeat interval.',
  },
  {
    name: 'DataTransfer',
    profile: 'Core',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Vendor-specific payload from the charger to the CSMS.',
    gatewayNote: 'Accepted and forwarded; vendor handlers are pluggable.',
  },
  {
    name: 'DiagnosticsStatusNotification',
    profile: 'Core',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Charger reports diagnostics-upload progress.',
  },
  {
    name: 'FirmwareStatusNotification',
    profile: 'Core',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Charger reports firmware-update progress.',
    gatewayNote: 'Distinct from the signed variant covered by the Security Whitepaper.',
  },
  {
    name: 'Heartbeat',
    profile: 'Core',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Periodic liveness ping; CSMS returns the canonical time.',
  },
  {
    name: 'MeterValues',
    profile: 'Core',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Periodic energy / current / voltage samples from a connector.',
    gatewayNote: 'Sanity-checked before storage; out-of-range samples are dropped with a warning.',
  },
  {
    name: 'StartTransaction',
    profile: 'Core',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Charger opens a charging session; CSMS returns a transaction id.',
  },
  {
    name: 'StatusNotification',
    profile: 'Core',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Connector status / error transitions.',
  },
  {
    name: 'StopTransaction',
    profile: 'Core',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Charger ends a charging session and reports final meter.',
  },

  // ---- Core: CSMS -> charger ---------------------------------------------
  {
    name: 'ChangeAvailability',
    profile: 'Core',
    direction: 'csms-to-charger',
    status: 'not-implemented',
    summary: 'Set a connector to Operative or Inoperative.',
  },
  {
    name: 'ChangeConfiguration',
    profile: 'Core',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Set a configuration key on the charger.',
    consoleCommandSlug: 'change-configuration',
  },
  {
    name: 'ClearCache',
    profile: 'Core',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Clear the charger-side authorization cache.',
    consoleCommandSlug: 'clear-cache',
  },
  {
    name: 'DataTransfer',
    profile: 'Core',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Vendor-specific payload from the CSMS to the charger.',
    consoleCommandSlug: 'data-transfer',
  },
  {
    name: 'GetConfiguration',
    profile: 'Core',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Read configuration keys from the charger.',
    consoleCommandSlug: 'get-configuration',
  },
  {
    name: 'RemoteStartTransaction',
    profile: 'Core',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Tell the charger to start a session for an idTag.',
    consoleCommandSlug: 'remote-start',
  },
  {
    name: 'RemoteStopTransaction',
    profile: 'Core',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Tell the charger to stop an in-progress session.',
    consoleCommandSlug: 'remote-stop',
  },
  {
    name: 'Reset',
    profile: 'Core',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Soft or Hard reset of the charger.',
    consoleCommandSlug: 'reset',
  },
  {
    name: 'UnlockConnector',
    profile: 'Core',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Release the cable lock on a connector.',
    consoleCommandSlug: 'unlock-connector',
  },

  // ---- Firmware Management -----------------------------------------------
  {
    name: 'GetDiagnostics',
    profile: 'FirmwareManagement',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Tell the charger to upload a diagnostics archive.',
    consoleCommandSlug: 'get-diagnostics',
  },
  {
    name: 'UpdateFirmware',
    profile: 'FirmwareManagement',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Tell the charger to download and install firmware.',
    consoleCommandSlug: 'update-firmware',
  },

  // ---- Local Auth List Management ----------------------------------------
  {
    name: 'GetLocalListVersion',
    profile: 'LocalAuthListManagement',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Read the version number of the charger-side RFID list.',
    consoleCommandSlug: 'get-local-list-version',
  },
  {
    name: 'SendLocalList',
    profile: 'LocalAuthListManagement',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Replace or update the charger-side RFID list.',
    consoleCommandSlug: 'send-local-list',
  },

  // ---- Reservation -------------------------------------------------------
  {
    name: 'CancelReservation',
    profile: 'Reservation',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Cancel a previously issued connector reservation.',
    consoleCommandSlug: 'cancel-reservation',
  },
  {
    name: 'ReserveNow',
    profile: 'Reservation',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Reserve a connector for an idTag until an expiry time.',
    consoleCommandSlug: 'reserve-now',
  },

  // ---- Smart Charging ----------------------------------------------------
  {
    name: 'ClearChargingProfile',
    profile: 'SmartCharging',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Remove charging profiles by id, purpose, stack level or connector.',
    consoleCommandSlug: 'clear-charging-profile',
  },
  {
    name: 'GetCompositeSchedule',
    profile: 'SmartCharging',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Compute the effective charging schedule for a connector + window.',
    consoleCommandSlug: 'get-composite-schedule',
  },
  {
    name: 'SetChargingProfile',
    profile: 'SmartCharging',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Install a charging profile on a connector.',
    consoleCommandSlug: 'set-charging-profile',
  },

  // ---- Remote Trigger ----------------------------------------------------
  {
    name: 'TriggerMessage',
    profile: 'RemoteTrigger',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Ask the charger to send a specific message now (e.g. StatusNotification).',
    consoleCommandSlug: 'trigger-message',
  },

  // ---- Security Whitepaper -----------------------------------------------
  // Section 4 of the OCPP 1.6 Security Whitepaper. The gateway-side
  // implementations live alongside Core but are bucketed here so the
  // page reads as "what we ship on top of base 1.6".
  {
    name: 'CertificateSigned',
    profile: 'SecurityWhitepaper',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Deliver a signed client certificate to the charger.',
    gatewayNote: 'Whitepaper §4.4. Pairs with the charger-side CSR flow.',
    consoleCommandSlug: 'certificate-signed',
  },
  {
    name: 'DeleteCertificate',
    profile: 'SecurityWhitepaper',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Remove a CA certificate from the charger trust store.',
    gatewayNote: 'Whitepaper §4.5.',
    consoleCommandSlug: 'delete-certificate',
  },
  {
    name: 'ExtendedTriggerMessage',
    profile: 'SecurityWhitepaper',
    direction: 'csms-to-charger',
    status: 'not-implemented',
    summary: 'Trigger the signed-firmware / log-status variants.',
    gatewayNote: 'Whitepaper §4.7. The plain TriggerMessage covers most operator needs today.',
  },
  {
    name: 'GetInstalledCertificateIds',
    profile: 'SecurityWhitepaper',
    direction: 'csms-to-charger',
    status: 'not-implemented',
    summary: 'List CA certificates installed on the charger.',
    gatewayNote: 'Whitepaper §4.8.',
  },
  {
    name: 'GetLog',
    profile: 'SecurityWhitepaper',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Tell the charger to upload a security or diagnostics log.',
    gatewayNote: 'Whitepaper §4.9.',
    consoleCommandSlug: 'get-log',
  },
  {
    name: 'InstallCertificate',
    profile: 'SecurityWhitepaper',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Install a CA certificate into the charger trust store.',
    gatewayNote: 'Whitepaper §4.10.',
    consoleCommandSlug: 'install-certificate',
  },
  {
    name: 'LogStatusNotification',
    profile: 'SecurityWhitepaper',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Charger reports log-upload progress.',
    gatewayNote: 'Whitepaper §4.11.',
  },
  {
    name: 'SecurityEventNotification',
    profile: 'SecurityWhitepaper',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Charger reports a security-relevant event (boot, tampering, cert errors).',
    gatewayNote: 'Whitepaper §4.12.',
  },
  {
    name: 'SignCertificate',
    profile: 'SecurityWhitepaper',
    direction: 'charger-to-csms',
    status: 'not-implemented',
    summary: 'Charger submits a CSR for the CSMS to sign.',
    gatewayNote: 'Whitepaper §4.13. Pairs with CertificateSigned on the response side.',
  },
  {
    name: 'SignedFirmwareStatusNotification',
    profile: 'SecurityWhitepaper',
    direction: 'charger-to-csms',
    status: 'implemented',
    summary: 'Charger reports signed-firmware install progress.',
    gatewayNote: 'Whitepaper §4.14.',
  },
  {
    name: 'SignedUpdateFirmware',
    profile: 'SecurityWhitepaper',
    direction: 'csms-to-charger',
    status: 'implemented',
    summary: 'Tell the charger to download a firmware bundle with a signature.',
    gatewayNote: 'Whitepaper §4.15.',
    consoleCommandSlug: 'signed-update-firmware',
  },
];

/**
 * Group OCPP messages by their profile. Within each profile,
 * csms-to-charger messages come first, then charger-to-csms; both
 * groups are sorted alphabetically by name.
 *
 * Every profile in OCPP_PROFILES is present as a key, even if there
 * are no messages in it (empty array). This keeps the table heading
 * pass straightforward in the UI.
 */
export function groupByProfile(
  messages: readonly OcppMessage[],
): Record<OcppProfile, OcppMessage[]> {
  const result: Record<OcppProfile, OcppMessage[]> = {
    Core: [],
    FirmwareManagement: [],
    LocalAuthListManagement: [],
    Reservation: [],
    SmartCharging: [],
    RemoteTrigger: [],
    SecurityWhitepaper: [],
  };
  for (const msg of messages) result[msg.profile].push(msg);
  for (const profile of OCPP_PROFILES) {
    result[profile].sort((a, b) => {
      // csms-to-charger first; then alphabetical by name.
      if (a.direction !== b.direction) {
        return a.direction === 'csms-to-charger' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }
  return result;
}

/** Status counts across the whole dictionary. Used in the page header. */
export function countByStatus(messages: readonly OcppMessage[]): Record<OcppStatus, number> {
  const counts: Record<OcppStatus, number> = {
    implemented: 0,
    partial: 0,
    'not-implemented': 0,
  };
  for (const msg of messages) counts[msg.status] += 1;
  return counts;
}

// OCPP 1.6 ChargePointErrorCode reference + suggested operator action.
// The codes are part of the frozen 1.6 wire spec (StatusNotification.req
// → ChargePointErrorCode). We render `error_code` plus this dictionary
// so the operator gets actionable prose, not just a five-letter code.
//
// `severity` here is purely the dictionary's hint; the runtime severity
// (fault vs advisory vs ok) is derived in `lib/fault.ts` from a
// connector's *combined* status + error_code.

export interface ErrorCodeInfo {
  /** Human-readable name. */
  label: string;
  /** What the code means. */
  description: string;
  /** What the operator typically does next. */
  suggestedAction: string;
  /** How serious this code is on its own — used as a hint when status is
   * not `Faulted` (a non-Faulted charger reporting `OverCurrentFailure`
   * is still actively misbehaving). */
  severityHint: 'critical' | 'warning' | 'info';
}

export const NO_ERROR = 'NoError';

const DICT: Record<string, ErrorCodeInfo> = {
  NoError: {
    label: 'No error',
    description: 'The charger is reporting a healthy connector.',
    suggestedAction: 'No action needed.',
    severityHint: 'info',
  },
  ConnectorLockFailure: {
    label: 'Connector lock failure',
    description: 'The connector cannot lock or unlock the cable mechanically.',
    suggestedAction:
      'Try UnlockConnector remotely; if it persists, dispatch on-site to clear the lock motor.',
    severityHint: 'warning',
  },
  EVCommunicationError: {
    label: 'EV communication error',
    description: 'The charger lost the ISO 15118 / control-pilot conversation with the vehicle.',
    suggestedAction:
      'Often vehicle-side. Ask the driver to unplug and re-plug. If repeated across vehicles, dispatch.',
    severityHint: 'warning',
  },
  GroundFailure: {
    label: 'Ground failure',
    description: 'A ground / earth fault was detected. The charger has interrupted current.',
    suggestedAction:
      'Critical. Do not RemoteStart. Dispatch a qualified electrician — likely a residual-current device tripped.',
    severityHint: 'critical',
  },
  HighTemperature: {
    label: 'High temperature',
    description: 'A temperature sensor on the charger has exceeded its limit.',
    suggestedAction:
      'Allow to cool. If recurring on this unit only, check airflow / ambient. Otherwise check whole-site venting.',
    severityHint: 'warning',
  },
  InternalError: {
    label: 'Internal error',
    description: 'Vendor-internal failure not covered by a more specific code.',
    suggestedAction:
      'Try Soft Reset; if it returns, capture diagnostics with GetDiagnostics or GetLog and dispatch.',
    severityHint: 'warning',
  },
  LocalListConflict: {
    label: 'Local-list conflict',
    description: 'The local Authorize list version on the charger does not match the gateway.',
    suggestedAction:
      'Push a fresh SendLocalList from the gateway, or run GetLocalListVersion to inspect.',
    severityHint: 'info',
  },
  NoError_Legacy: {
    // Some firmwares used "NoError" with different casing; alias to NoError.
    label: 'No error',
    description: 'No fault reported.',
    suggestedAction: 'No action needed.',
    severityHint: 'info',
  },
  OtherError: {
    label: 'Other error',
    description:
      'Unspecified error. The charger may also expose a `vendor_error_code` with detail.',
    suggestedAction:
      'Read `vendor_error_code` and `info` if present. If neither helps, capture diagnostics.',
    severityHint: 'warning',
  },
  OverCurrentFailure: {
    label: 'Over-current failure',
    description: 'Current draw exceeded the rated maximum and the charger interrupted the session.',
    suggestedAction:
      'Critical. Verify the cable, the connector, and the upstream breaker. Do not RemoteStart blindly.',
    severityHint: 'critical',
  },
  OverVoltage: {
    label: 'Over-voltage',
    description: 'Mains voltage exceeded the safe range.',
    suggestedAction:
      'Site-wide issue likely. Check the upstream supply / transformer; coordinate with the DSO.',
    severityHint: 'critical',
  },
  PowerMeterFailure: {
    label: 'Power-meter failure',
    description: "The charger's billing meter is not reporting valid measurements.",
    suggestedAction:
      'Stop sessions on this connector — kWh recorded may be unreliable for billing. Dispatch.',
    severityHint: 'critical',
  },
  PowerSwitchFailure: {
    label: 'Power-switch failure',
    description: 'The contactor that energises the cable failed to operate as expected.',
    suggestedAction:
      'Likely hardware. Soft Reset; if unresolved, dispatch — often a stuck contactor.',
    severityHint: 'critical',
  },
  ReaderFailure: {
    label: 'RFID reader failure',
    description: 'The card / RFID reader is not responding.',
    suggestedAction: 'Drivers cannot tap to start. Try Soft Reset; otherwise dispatch.',
    severityHint: 'warning',
  },
  ResetFailure: {
    label: 'Reset failure',
    description: 'The charger could not complete a Reset request.',
    suggestedAction: 'Hard Reset (stronger than Soft); if that also fails, dispatch.',
    severityHint: 'warning',
  },
  UnderVoltage: {
    label: 'Under-voltage',
    description: 'Mains voltage dropped below the safe range.',
    suggestedAction: 'Site-supply issue. Coordinate with the DSO if persistent.',
    severityHint: 'critical',
  },
  WeakSignal: {
    label: 'Weak cellular signal',
    description: 'The charger reports poor backhaul signal — heartbeat / events may delay.',
    suggestedAction:
      'If the charger is reporting Online, no immediate action. Antenna / SIM check on next visit.',
    severityHint: 'info',
  },
};

/**
 * Look up an error code. Falls back to a synthetic "Unknown / vendor code"
 * entry so the UI never has to handle `undefined`. Empty / null treated as
 * NoError so the operator doesn't see a banner for a healthy charger.
 */
export function describeErrorCode(code: string | null | undefined): ErrorCodeInfo {
  if (!code || code === NO_ERROR) return DICT.NoError!;
  const entry = DICT[code];
  if (entry) return entry;
  return {
    label: code,
    description:
      'Vendor-specific or unrecognised error code. Inspect `vendor_error_code` and `info` fields if present.',
    suggestedAction: 'Read the vendor documentation or run GetDiagnostics for a fuller picture.',
    severityHint: 'warning',
  };
}

export function isErrorCodeKnown(code: string | null | undefined): boolean {
  if (!code || code === NO_ERROR) return true;
  return code in DICT;
}

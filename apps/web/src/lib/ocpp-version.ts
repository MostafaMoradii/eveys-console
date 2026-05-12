// Shared formatting helpers for the gateway's `ocpp_version` field.
//
// The gateway writes the negotiated WS subprotocol verbatim (e.g.
// `ocpp1.6`, `ocpp2.0.1`). Operators want to see "OCPP 1.6" with a
// space; tests want a single source of truth for the format.

/** Render `ocpp1.6` / `ocpp2.0.1` as `OCPP 1.6` / `OCPP 2.0.1`.
 *  An unrecognised shape prints with the "OCPP " prefix so a future
 *  spec revision shows up in the UI even before this helper learns
 *  about it. Empty input → `OCPP ?`. */
export function formatOcppVersion(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'OCPP ?';
  if (trimmed.toLowerCase().startsWith('ocpp')) {
    return `OCPP ${trimmed.slice(4)}`;
  }
  return `OCPP ${trimmed}`;
}

/** True when the charger speaks an OCPP profile that includes GetLog
 *  in core. OCPP 2.0.1 yes; OCPP 1.6 only with the Security
 *  Extensions profile, which has no protocol-level signal — operators
 *  opt into that command behind a UI disclosure rather than relying
 *  on auto-detect. */
export function supportsGetLog(ocppVersion: string | null | undefined): boolean {
  if (!ocppVersion) return false;
  return ocppVersion.toLowerCase().startsWith('ocpp2');
}

// Inline Commands console for the charge-point detail page. Replaces
// the right-anchored Sheet drawer with a two-pane layout: a palette
// of every OCPP command on the left, a live transcript of each send
// + the charger's actual response on the right.
//
// Why this exists:
//   - The drawer's toast said "Command accepted by charger" for every
//     successful send — wrong, because most OCPP responses can be
//     Rejected / Occupied / Unavailable etc and the toast hid that.
//     The transcript shows the actual `status` field with a colour
//     pill, so the operator sees what the charger actually said.
//   - On a real interaction (ReserveNow, ChangeConfiguration) the
//     operator wants to see request + response side-by-side. The
//     transcript renders both with a per-row JSON toggle.
//
// Shares the per-command form catalogue with CommandsDrawer via the
// exported `CommandsList` component there, so we don't have two
// copies of TriggerMessageForm / ReserveNowForm / etc.

import { useState } from 'react';

import type { Reservation } from '@eveys-console/protocol';

import { CommandsList, useIssueUrl } from '@/components/CommandsDrawer';
import { CommandTranscript } from '@/components/CommandTranscript';
import { useCommandTranscript } from '@/hooks/use-command-transcript';
import { useConsoleClient } from '@/lib/ws-context';

export function CommandsConsole({
  cpId,
  online,
  ocppVersion,
  activeReservations,
}: {
  cpId: string;
  /** Charger's current online state. When false, every Send button
   *  in the catalogue renders disabled with a tooltip — the gateway
   *  would 404 anyway, and a disabled button is a louder signal
   *  than a confusing error toast. Undefined keeps the legacy
   *  behaviour (always enabled) for callers that don't track it. */
  online?: boolean;
  /** OCPP subprotocol the charger negotiated. Drives whether
   *  Security-Extension commands (GetLog) render in the main
   *  Diagnostics section or under an "Advanced — 1.6 Security
   *  Extensions" disclosure. Null when the gateway hasn't recorded
   *  a value yet — treated like 1.6. */
  ocppVersion?: string | null;
  /** Active reservations for this charger from the gateway detail
   *  endpoint. Drives the CancelReservation dropdown. */
  activeReservations?: Reservation[];
}) {
  const { client, token } = useConsoleClient();
  const t = useCommandTranscript(client, cpId);
  const issueUrl = useIssueUrl(cpId, token);
  const [getConfigResult, setGetConfigResult] = useState<{
    keys: { key: string; value: string; readonly?: boolean }[];
    unknown: string[];
  } | null>(null);

  // Convert the in-flight Set into the single-string the legacy forms
  // expect. They compare `busy === method` to decide whether to spin
  // the Send button — any method currently in the set renders busy.
  const busyArr = [...t.inFlight];
  const busy = busyArr[0] ?? null;

  const offline = online === false;

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      data-testid="commands-console"
    >
      <div className="flex flex-col gap-6">
        {offline ? (
          <div
            className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
            data-testid="commands-offline-banner"
            role="status"
          >
            <strong className="font-semibold">Charger offline.</strong> Commands are disabled until
            the charger reconnects its WebSocket — sending now would 404 at the gateway.
          </div>
        ) : null}
        {/* Native fieldset disables every input + button it contains
            in one move — saves threading a `disabled` prop through
            ~13 per-command forms. The banner above tells the
            operator why; this just prevents the click. */}
        <fieldset
          disabled={offline}
          className="contents"
          data-testid="commands-fieldset"
          aria-disabled={offline}
        >
          <CommandsList
            busy={busy}
            send={t.send}
            issueUrl={issueUrl}
            getConfigResult={getConfigResult}
            setGetConfigResult={setGetConfigResult}
            ocppVersion={ocppVersion ?? null}
            {...(activeReservations ? { activeReservations } : {})}
          />
        </fieldset>
      </div>
      {/* Sticky on large screens so the transcript stays visible
          while the operator scrolls through the command palette. */}
      <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)]">
        <CommandTranscript t={t} />
      </div>
    </div>
  );
}

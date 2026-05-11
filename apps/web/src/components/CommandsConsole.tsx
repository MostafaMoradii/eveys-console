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

import { CommandsList, useIssueUrl } from '@/components/CommandsDrawer';
import { CommandTranscript } from '@/components/CommandTranscript';
import { useCommandTranscript } from '@/hooks/use-command-transcript';
import { useConsoleClient } from '@/lib/ws-context';

export function CommandsConsole({ cpId }: { cpId: string }) {
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

  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
      data-testid="commands-console"
    >
      <div className="flex flex-col gap-6">
        <CommandsList
          busy={busy}
          send={t.send}
          issueUrl={issueUrl}
          getConfigResult={getConfigResult}
          setGetConfigResult={setGetConfigResult}
        />
      </div>
      {/* Sticky on large screens so the transcript stays visible
          while the operator scrolls through the command palette. */}
      <div className="lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)]">
        <CommandTranscript t={t} />
      </div>
    </div>
  );
}

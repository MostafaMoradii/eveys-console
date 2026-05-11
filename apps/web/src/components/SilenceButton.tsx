// Per-row "Silence" action for the Firing alerts panel. Renders an
// inline button; clicking opens a small floating menu of preset
// durations + a "Custom..." form. Selecting a preset (or confirming
// custom) fires `createSilence` with a single exact matcher on the
// alert's fingerprint.
//
// Matcher choice — fingerprint vs alertname:
//
//   Alertmanager v2 emits a `fingerprint` field per alert; that
//   fingerprint is a stable hash of the labelset. Silencing on
//   `fingerprint=<value>` mutes exactly that alert instance and
//   nothing else. By contrast, silencing on `alertname=...` mutes
//   every instance of the same rule across the fleet — useful for
//   bulk mutes but the wrong default for "silence this row".
//
//   The fingerprint IS a label as far as the silence matcher is
//   concerned. The Alertmanager docs are explicit about this in v0.27
//   (and we ship v0.27 in deploy/observability). No fallback needed.
//
// No confirmation dialog: presets are a deliberate two-click affair
// (open menu → pick), and the operator can hit "Expire now" on the
// silence panel below within seconds if they fat-fingered it.

import { BellOff, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useCreateSilence } from '@/hooks/use-silence-mutations';
import { parseDurationMs } from '@/lib/duration';

interface Props {
  /** Alertmanager fingerprint for this alert. */
  alertId: string;
  /** Used as a fallback label in the silence comment so an operator
   *  reading the silences panel later can recognise what they muted. */
  alertTitle: string;
}

interface Preset {
  label: string;
  ms: number;
}

// Common windows: a deploy (30 m), a debug session (2 h), a working day
// (8 h), and an overnight (1 d). 30 days is the absolute ceiling
// (enforced in parseDurationMs) — silences should be temporary; if you
// want a permanent suppression, that's an inhibition rule, not a
// silence.
const PRESETS: Preset[] = [
  { label: '30m', ms: 30 * 60_000 },
  { label: '2h', ms: 2 * 3_600_000 },
  { label: '8h', ms: 8 * 3_600_000 },
  { label: '1d', ms: 86_400_000 },
];

export function SilenceButton({ alertId, alertTitle }: Props) {
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customDuration, setCustomDuration] = useState('');
  const [customComment, setCustomComment] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const mutation = useCreateSilence();

  // Close on outside click; harmless for the no-menu state since
  // `open=false` short-circuits the effect.
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCustom(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const submit = (durationMs: number, comment: string) => {
    const ends_at = new Date(Date.now() + durationMs).toISOString();
    mutation.mutate(
      {
        matchers: [
          {
            name: 'fingerprint',
            value: alertId,
            is_regex: false,
            is_equal: true,
          },
        ],
        ends_at,
        comment: comment.trim() || `silenced ${alertTitle}`,
      },
      {
        onSuccess: () => {
          setOpen(false);
          setShowCustom(false);
          setCustomDuration('');
          setCustomComment('');
          setCustomError(null);
        },
      },
    );
  };

  const onPreset = (p: Preset) => submit(p.ms, '');

  const onCustomSubmit = () => {
    const ms = parseDurationMs(customDuration);
    if (ms === null) {
      setCustomError('Use a number + unit: s, m, h, or d (e.g. 30m, 2h, 1d). Max 30d.');
      return;
    }
    setCustomError(null);
    submit(ms, customComment);
  };

  return (
    <div className="relative" ref={containerRef} data-testid="silence-button-root">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        disabled={mutation.isPending}
        onClick={() => setOpen((v) => !v)}
        data-testid="silence-button"
      >
        {mutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <BellOff className="h-3.5 w-3.5" />
        )}
        Silence
      </Button>
      {open ? (
        <div
          role="menu"
          data-testid="silence-menu"
          className="absolute right-0 z-10 mt-1 min-w-[10rem] rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {!showCustom ? (
            <>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  data-testid={`silence-preset-${p.label}`}
                  onClick={() => onPreset(p)}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className="block w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                data-testid="silence-custom-open"
                onClick={() => setShowCustom(true)}
              >
                Custom...
              </button>
            </>
          ) : (
            <div className="space-y-2 p-2 text-sm" data-testid="silence-custom-form">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Duration</span>
                <input
                  type="text"
                  inputMode="text"
                  placeholder="e.g. 1h"
                  value={customDuration}
                  onChange={(e) => setCustomDuration(e.target.value)}
                  className="h-8 rounded border bg-background px-2 text-sm"
                  data-testid="silence-custom-duration"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Comment (optional)</span>
                <textarea
                  rows={2}
                  value={customComment}
                  onChange={(e) => setCustomComment(e.target.value)}
                  className="rounded border bg-background px-2 py-1 text-sm"
                  data-testid="silence-custom-comment"
                />
              </label>
              {customError ? (
                <p className="text-xs text-destructive" data-testid="silence-custom-error">
                  {customError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setShowCustom(false);
                    setCustomError(null);
                  }}
                  data-testid="silence-custom-cancel"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={mutation.isPending}
                  onClick={onCustomSubmit}
                  data-testid="silence-custom-confirm"
                >
                  Confirm
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

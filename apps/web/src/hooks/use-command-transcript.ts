// Page-lifetime ring buffer of OCPP commands the operator sent and
// the charger's responses. Replaces the "Command accepted by charger"
// toast: the transcript is the feedback. The hook returns a `send`
// helper with the same signature CommandsDrawer used, plus an
// `entries` array the transcript pane renders.
//
// State model:
//   - Each entry is identified by a monotonic counter so the UI can
//     key React rows without relying on timestamps (which can repeat
//     within the same millisecond on a fast click).
//   - On `send(method, params)`, append a `pending` entry and the
//     return value of `client.rpc(...)` populates `response` /
//     `status` / `elapsed_ms` / `phase` when it resolves. RPC reject
//     populates `error` instead.
//   - `clear()` empties the list; `pause()` / `resume()` buffer
//     incoming completions and apply them on resume.

import { useCallback, useRef, useState } from 'react';

import type { ConsoleClient } from '@/api/ws-client';

const RING_CAP = 200;

export type TranscriptPhase = 'pending' | 'ok' | 'error';

/** Coarse outcome bucket derived from the charger response. Mirrors
 *  the OCPP spec's three families (Accepted / soft-reject /
 *  hard-reject) so the UI can colour-code without inspecting per-
 *  command-specific fields. */
export type TranscriptOutcome =
  | 'accepted'
  | 'rejected'
  | 'soft-reject' // Occupied / Unavailable / Faulted / NotImplemented / NotSupported / Failed
  | 'pending'
  | 'error';

export interface TranscriptEntry {
  /** Monotonic counter — stable React key. */
  id: number;
  startedAt: string;
  method: string;
  request: Record<string, unknown>;
  phase: TranscriptPhase;
  response?: unknown;
  /** Compact one-line label derived from the response shape. */
  status?: string;
  /** Coarse bucket for colour-coding. */
  outcome: TranscriptOutcome;
  elapsedMs?: number;
  error?: string;
}

export interface UseCommandTranscript {
  entries: TranscriptEntry[];
  paused: boolean;
  bufferedCount: number;
  send: (
    method: string,
    params: Record<string, unknown>,
    onResult?: (result: unknown) => void,
  ) => Promise<void>;
  /** Method names currently in-flight; the forms use this to disable
   *  the Send button while a request is pending. Mirrors the legacy
   *  `busy` string from CommandsDrawer. */
  inFlight: Set<string>;
  clear: () => void;
  pause: () => void;
  resume: () => void;
}

interface InternalState {
  entries: TranscriptEntry[];
  inFlight: Set<string>;
}

const INITIAL_STATE: InternalState = {
  entries: [],
  inFlight: new Set(),
};

export function useCommandTranscript(
  client: Pick<ConsoleClient, 'rpc'>,
  cpId: string,
): UseCommandTranscript {
  const [state, setState] = useState<InternalState>(INITIAL_STATE);
  const [paused, setPaused] = useState(false);
  // Pending-completion buffer: when paused, completions queue here
  // and apply on resume. Keyed by entry id so a second send for the
  // same method doesn't clobber the first.
  const pauseBufferRef = useRef<Map<number, Partial<TranscriptEntry>>>(new Map());
  const nextIdRef = useRef(1);

  const applyCompletion = useCallback(
    (id: number, method: string, patch: Partial<TranscriptEntry>) => {
      setState((prev) => ({
        ...prev,
        entries: prev.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
        inFlight: dropMethodIfNoOtherPending(prev, id, method),
      }));
    },
    [],
  );

  const send = useCallback(
    async (method: string, params: Record<string, unknown>, onResult?: (r: unknown) => void) => {
      const id = nextIdRef.current++;
      const startedAt = new Date().toISOString();
      const startMs = performance.now();
      const request = { cp_id: cpId, ...params };
      setState((prev) => {
        const nextEntries = [
          {
            id,
            startedAt,
            method,
            request,
            phase: 'pending' as TranscriptPhase,
            outcome: 'pending' as TranscriptOutcome,
          },
          ...prev.entries,
        ];
        const trimmed =
          nextEntries.length > RING_CAP ? nextEntries.slice(0, RING_CAP) : nextEntries;
        const inFlight = new Set(prev.inFlight);
        inFlight.add(method);
        return { entries: trimmed, inFlight };
      });

      try {
        const response = await client.rpc(method, request);
        const elapsedMs = Math.round(performance.now() - startMs);
        const { status, outcome } = describeResponse(response);
        const patch: Partial<TranscriptEntry> = {
          phase: 'ok',
          response,
          status,
          outcome,
          elapsedMs,
        };
        if (paused) {
          pauseBufferRef.current.set(id, patch);
          // Drop the method from inFlight even while paused — the
          // form should re-enable so the operator can fire a second
          // command without waiting for Resume.
          setState((prev) => ({
            ...prev,
            inFlight: dropMethodIfNoOtherPending(prev, id, method),
          }));
        } else {
          applyCompletion(id, method, patch);
        }
        onResult?.(response);
      } catch (err) {
        const elapsedMs = Math.round(performance.now() - startMs);
        const message = err instanceof Error ? err.message : 'rpc failed';
        const patch: Partial<TranscriptEntry> = {
          phase: 'error',
          outcome: 'error',
          error: message,
          status: message,
          elapsedMs,
        };
        if (paused) {
          pauseBufferRef.current.set(id, patch);
          setState((prev) => ({
            ...prev,
            inFlight: dropMethodIfNoOtherPending(prev, id, method),
          }));
        } else {
          applyCompletion(id, method, patch);
        }
      }
    },
    [client, cpId, paused, applyCompletion],
  );

  const clear = useCallback(() => {
    setState((prev) => ({ ...prev, entries: [] }));
    pauseBufferRef.current.clear();
  }, []);

  const pause = useCallback(() => setPaused(true), []);

  const resume = useCallback(() => {
    const buffered = pauseBufferRef.current;
    pauseBufferRef.current = new Map();
    setPaused(false);
    if (buffered.size === 0) return;
    setState((prev) => ({
      ...prev,
      entries: prev.entries.map((e) => {
        const patch = buffered.get(e.id);
        return patch ? { ...e, ...patch } : e;
      }),
    }));
  }, []);

  return {
    entries: state.entries,
    paused,
    bufferedCount: pauseBufferRef.current.size,
    send,
    inFlight: state.inFlight,
    clear,
    pause,
    resume,
  };
}

/** Map a charger response (shape varies per command) to a short
 *  human-readable status + coarse outcome bucket. Falls back to
 *  "OK" / accepted for shapes we don't recognise (e.g. Unlock's
 *  Unlocked, GetConfiguration's keys list). The full response is
 *  always available on the entry; this is just the colour cue. */
function describeResponse(response: unknown): { status: string; outcome: TranscriptOutcome } {
  if (response == null || typeof response !== 'object') {
    return { status: 'OK', outcome: 'accepted' };
  }
  const r = response as Record<string, unknown>;
  const raw = r.status;
  if (typeof raw !== 'string') {
    return { status: 'OK', outcome: 'accepted' };
  }
  const lower = raw.toLowerCase();
  if (lower === 'accepted' || lower === 'unlocked') {
    return { status: raw, outcome: 'accepted' };
  }
  if (lower === 'rejected' || lower === 'unknowntransaction') {
    return { status: raw, outcome: 'rejected' };
  }
  // Occupied / Unavailable / Faulted / NotImplemented / NotSupported / Failed
  // — all soft-rejects that mean "the charger said no, but not a hard error".
  return { status: raw, outcome: 'soft-reject' };
}

/** Compute the next `inFlight` set after an entry completes. A second
 *  pending entry for the same method should keep the method in the
 *  set; only drop it when no other pending entry uses it. */
function dropMethodIfNoOtherPending(
  prev: InternalState,
  completedId: number,
  method: string | undefined,
): Set<string> {
  if (!method) return prev.inFlight;
  const stillPending = prev.entries.some(
    (e) => e.id !== completedId && e.method === method && e.phase === 'pending',
  );
  if (stillPending) return prev.inFlight;
  const next = new Set(prev.inFlight);
  next.delete(method);
  return next;
}

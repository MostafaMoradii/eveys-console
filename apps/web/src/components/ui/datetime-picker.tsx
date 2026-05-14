// Composite date + time picker. Calendar grid for the date, two
// numeric inputs for HH:MM. Stores its value as an ISO-8601 string so
// callers can pass straight through to URL search params; emits the
// same form on every commit.
//
// Why a composite rather than the native <input type="datetime-local">:
// the native control is locale-inconsistent across Chromium/Safari/
// Firefox (12h vs 24h, where the AM/PM shows up, keyboard nav), and
// the on-screen UX is unsalvageable on mobile Safari. The Radix-
// anchored Popover + react-day-picker pair gives us a deterministic
// month grid + a familiar HH:MM input pair.

import { format } from 'date-fns';
import { CalendarDays, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export interface DateTimePickerProps {
  /** ISO-8601 string, or empty string when unset. */
  value: string;
  /** Called with an ISO-8601 string on commit, or '' when cleared. */
  onChange: (next: string) => void;
  placeholder?: string;
  /** Forwarded to the trigger button. */
  className?: string;
  /** Used in tests + a11y. */
  'data-testid'?: string;
  /** Disabled state — typically when an upstream filter would make
   *  the picker meaningless (e.g. the Live toggle on the Tx page). */
  disabled?: boolean;
  /** Optional minimum / maximum constraints. */
  fromDate?: Date;
  toDate?: Date;
}

const DISPLAY_FORMAT = 'yyyy-MM-dd HH:mm';

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick a date and time',
  className,
  disabled,
  fromDate,
  toDate,
  ...rest
}: DateTimePickerProps) {
  const parsed = useMemo<Date | undefined>(() => {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }, [value]);

  // Local hour/minute strings so the operator can be in the middle of
  // typing "08" without the input rejecting it as not-yet a valid
  // 24h value.
  const [hh, setHh] = useState<string>(parsed ? pad2(parsed.getHours()) : '00');
  const [mm, setMm] = useState<string>(parsed ? pad2(parsed.getMinutes()) : '00');
  useEffect(() => {
    if (parsed) {
      setHh(pad2(parsed.getHours()));
      setMm(pad2(parsed.getMinutes()));
    }
  }, [parsed]);

  const [open, setOpen] = useState(false);

  const commit = (date: Date, hours: number, minutes: number) => {
    const d = new Date(date);
    d.setHours(hours, minutes, 0, 0);
    onChange(d.toISOString());
  };

  const onSelectDate = (d: Date | undefined) => {
    if (!d) return;
    const hours = clamp(Number(hh) || 0, 0, 23);
    const minutes = clamp(Number(mm) || 0, 0, 59);
    commit(d, hours, minutes);
  };

  const onTimeBlur = () => {
    if (!parsed) return;
    const hours = clamp(Number(hh) || 0, 0, 23);
    const minutes = clamp(Number(mm) || 0, 0, 59);
    setHh(pad2(hours));
    setMm(pad2(minutes));
    commit(parsed, hours, minutes);
  };

  const displayLabel = parsed ? format(parsed, DISPLAY_FORMAT) : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          type="button"
          disabled={disabled}
          className={cn(
            'h-9 w-full justify-start gap-2 font-normal',
            !parsed && 'text-muted-foreground',
            className,
          )}
          data-testid={rest['data-testid']}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-xs">{displayLabel}</span>
          {parsed ? (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onChange('');
                setOpen(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange('');
                  setOpen(false);
                }
              }}
              className="ml-auto inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm hover:bg-muted"
              aria-label="Clear date"
              data-testid={rest['data-testid'] ? `${rest['data-testid']}-clear` : undefined}
            >
              <X className="h-3 w-3" />
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={parsed}
          onSelect={onSelectDate}
          {...(fromDate ? { startMonth: fromDate } : {})}
          {...(toDate ? { endMonth: toDate } : {})}
          {...(fromDate || toDate
            ? {
                disabled: (d: Date) =>
                  (fromDate ? d < fromDate : false) || (toDate ? d > toDate : false),
              }
            : {})}
        />
        <div className="flex items-center justify-end gap-2 border-t px-3 py-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Time</span>
          <Input
            type="number"
            min={0}
            max={23}
            value={hh}
            onChange={(e) => setHh(e.currentTarget.value)}
            onBlur={onTimeBlur}
            className="h-8 w-14 text-center text-xs"
            aria-label="Hours (00–23)"
            data-testid={rest['data-testid'] ? `${rest['data-testid']}-hh` : undefined}
            disabled={!parsed}
          />
          <span className="text-xs text-muted-foreground">:</span>
          <Input
            type="number"
            min={0}
            max={59}
            value={mm}
            onChange={(e) => setMm(e.currentTarget.value)}
            onBlur={onTimeBlur}
            className="h-8 w-14 text-center text-xs"
            aria-label="Minutes (00–59)"
            data-testid={rest['data-testid'] ? `${rest['data-testid']}-mm` : undefined}
            disabled={!parsed}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(Math.max(n, lo), hi);
}

// shadcn-style Calendar — thin wrapper around react-day-picker so the
// day grid picks up the project's foreground / muted / border tokens
// instead of the library defaults. Used inside DateTimePicker; not a
// stand-alone surface today.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';

import { cn } from '@/lib/utils';

export function Calendar({ className, classNames, ...props }: DayPickerProps) {
  return (
    <DayPicker
      showOutsideDays
      className={cn('p-2', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'space-y-3',
        month_caption: 'flex justify-center pt-1 relative items-center text-sm font-medium',
        caption_label: 'text-sm font-medium',
        nav: 'space-x-1 flex items-center',
        button_previous: cn(
          'absolute left-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md',
          'opacity-70 hover:opacity-100 hover:bg-muted',
        ),
        button_next: cn(
          'absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-md',
          'opacity-70 hover:opacity-100 hover:bg-muted',
        ),
        month_grid: 'w-full border-collapse space-y-1',
        weekdays: 'flex',
        weekday: 'text-muted-foreground rounded-md w-8 font-normal text-[0.7rem]',
        week: 'flex w-full mt-1',
        day: cn('h-8 w-8 p-0 text-center text-xs', 'aria-selected:opacity-100'),
        day_button: cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md',
          'hover:bg-muted focus:bg-muted focus:outline-none',
        ),
        selected: cn(
          '[&_button]:bg-foreground [&_button]:text-background',
          '[&_button:hover]:bg-foreground [&_button:hover]:text-background',
        ),
        today: '[&_button]:bg-muted/50',
        outside: 'text-muted-foreground/60',
        disabled: 'text-muted-foreground/40 cursor-not-allowed',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'right' ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          ),
      }}
      {...props}
    />
  );
}

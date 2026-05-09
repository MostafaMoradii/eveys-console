// Native <select> styled to match the rest of the shadcn/Tailwind
// theme. Plain HTML so the footprint stays small; no Radix dropdown
// primitive required for the simple cases (single-pick string enums).
//
// For richer combobox / autocomplete needs we'd add a Radix-based
// component instead.

import { forwardRef, type SelectHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ' +
          'ring-offset-background focus:outline-none focus:border-ring ' +
          'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';

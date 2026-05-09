import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTheme, type ThemeMode } from '@/lib/theme-context';
import { cn } from '@/lib/utils';

const ITEMS: { mode: ThemeMode; label: string; icon: LucideIcon }[] = [
  { mode: 'light', label: 'Light', icon: Sun },
  { mode: 'dark', label: 'Dark', icon: Moon },
  { mode: 'system', label: 'System', icon: Monitor },
];

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-background p-1">
      {ITEMS.map(({ mode: m, label, icon: Icon }) => (
        <Button
          key={m}
          variant="ghost"
          size="sm"
          aria-label={label}
          aria-pressed={mode === m}
          onClick={() => setMode(m)}
          className={cn(
            'touch-target h-7 w-7 p-0',
            mode === m && 'bg-accent text-accent-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </Button>
      ))}
    </div>
  );
}

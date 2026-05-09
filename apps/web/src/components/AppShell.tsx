import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Bolt, List, Receipt } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useConsoleClient } from '@/lib/ws-context';
import { cn } from '@/lib/utils';

export function ConsoleShell() {
  const { status, token, setToken } = useConsoleClient();
  const router = useRouterState();
  const path = router.location.pathname;

  const statusVariant =
    status === 'open' ? 'success' : status === 'connecting' ? 'warning' : 'destructive';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b bg-background px-4">
        <div className="flex items-center gap-2">
          <Bolt className="h-5 w-5" />
          <span className="font-semibold">Eveys Console</span>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={statusVariant}>{status}</Badge>
          <Input
            placeholder="Bearer JWT"
            className="h-8 w-[280px] text-xs"
            value={token ?? ''}
            onChange={(e) => setToken(e.currentTarget.value || null)}
          />
        </div>
      </header>

      <div className="flex flex-1">
        <nav className="w-56 border-r bg-background p-2">
          <NavItem to="/" label="Fleet overview" icon={<List className="h-4 w-4" />} active={path === '/'} />
          <NavItem
            to="/transactions"
            label="Active transactions"
            icon={<Receipt className="h-4 w-4" />}
            active={path.startsWith('/transactions')}
          />
          <p className="mt-4 px-2 text-xs text-muted-foreground">
            Drill into a charger from the Fleet view.
          </p>
        </nav>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

interface NavItemProps {
  to: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
}

function NavItem({ to, label, icon, active }: NavItemProps) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
      )}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

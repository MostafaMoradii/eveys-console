import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Activity, Bolt, LogOut, Menu, Plug, Receipt } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ThemeToggle } from '@/components/ThemeToggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useConsoleClient } from '@/lib/ws-context';
import { cn } from '@/lib/utils';

export function ConsoleShell() {
  const { status, setToken } = useConsoleClient();
  const router = useRouterState();
  const path = router.location.pathname;

  // Drawer state for the mobile hamburger. Auto-close on route change
  // so tapping a nav item dismisses the drawer.
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    setDrawerOpen(false);
  }, [path]);

  const statusVariant =
    status === 'open' ? 'success' : status === 'connecting' ? 'warning' : 'destructive';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-14 items-center justify-between border-b bg-background px-4">
        <div className="flex items-center gap-2">
          {/* Hamburger trigger — visible below `lg`. The persistent
              sidebar takes over at `lg+`. */}
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 lg:hidden"
                aria-label="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetHeader className="border-b p-4">
                <SheetTitle className="flex items-center gap-2 text-base">
                  <Bolt className="h-4 w-4 text-brand-orange" />
                  OCPP Gateway
                </SheetTitle>
                <SheetDescription>System Console</SheetDescription>
              </SheetHeader>
              <div className="p-2">
                <NavContents path={path} />
              </div>
            </SheetContent>
          </Sheet>

          <Bolt className="h-5 w-5 text-brand-orange" />
          <span className="font-semibold">OCPP Gateway · System Console</span>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={statusVariant} className="text-xs">
            ws: {status}
          </Badge>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setToken(null)}
            className="gap-1"
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="text-xs">Sign out</span>
          </Button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Persistent sidebar — hidden below `lg`; the Sheet covers
            navigation there. */}
        <nav className="hidden w-56 border-r bg-background p-2 lg:block">
          <NavContents path={path} />
        </nav>

        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

// Same nav contents in both the persistent sidebar and the mobile
// drawer. Path passed in so each NavItem can compute `active` against
// the current router state.
function NavContents({ path }: { path: string }) {
  return (
    <>
      <NavSection title="System">
        <NavItem
          to="/"
          label="Status"
          icon={<Activity className="h-4 w-4" />}
          active={path === '/'}
        />
      </NavSection>

      <NavSection title="Inspect">
        <NavItem
          to="/inspect/charge-points"
          label="Charge points"
          icon={<Plug className="h-4 w-4" />}
          active={path.startsWith('/inspect/charge-points')}
        />
        <NavItem
          to="/inspect/transactions"
          label="Transactions"
          icon={<Receipt className="h-4 w-4" />}
          active={path === '/inspect/transactions'}
        />
      </NavSection>
    </>
  );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
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

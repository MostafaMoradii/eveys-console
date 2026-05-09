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
                className="touch-target h-8 w-8 p-0 lg:hidden"
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
          {/* Wordmark hides below `sm` — the page heading in the
              main area is enough at that size, and the bolt icon
              keeps the brand cue. */}
          <span className="hidden font-semibold sm:inline">OCPP Gateway · System Console</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <ConnectionStatusIndicator status={status} variant={statusVariant} />
          <ThemeToggle />
          {/* Sign-out: full pill with icon+label at `sm+`, icon-only
              below. The aria-label keeps it accessible either way. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setToken(null)}
            className="gap-1 px-2 sm:px-3"
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden text-xs sm:inline">Sign out</span>
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

// Connection status: full labelled badge ("ws: open") at `sm+`,
// colour-coded dot below. Variant maps the same way in either form
// — dot colour comes from the variant token so the brand palette
// owns it.
function ConnectionStatusIndicator({
  status,
  variant,
}: {
  status: string;
  variant: 'success' | 'warning' | 'destructive';
}) {
  const dotColour =
    variant === 'success'
      ? 'bg-success'
      : variant === 'warning'
        ? 'bg-amber-500'
        : 'bg-destructive';
  return (
    <>
      {/* `sm+`: labelled pill, same as before. */}
      <Badge variant={variant} className="hidden text-xs sm:inline-flex">
        ws: {status}
      </Badge>
      {/* below `sm`: dot with title for long-press / hover. The
          aria-label gives screen readers the full status. */}
      <span
        className={cn('inline-block h-2 w-2 shrink-0 rounded-full sm:hidden', dotColour)}
        role="img"
        aria-label={`WebSocket ${status}`}
        title={`WebSocket: ${status}`}
      />
    </>
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

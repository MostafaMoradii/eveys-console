// Manual TanStack Router route tree. The console is laid out for a
// system-administration audience; the OCPP/charge-point views are
// intentionally one level down under /inspect.

import { createRootRoute, createRoute } from '@tanstack/react-router';

import { ConsoleShell } from './components/AppShell';
import { ChargerDetailPage } from './pages/ChargerDetailPage';
import { FleetPage } from './pages/FleetPage';
import { SystemPage } from './pages/SystemPage';
import { TransactionsPage } from './pages/TransactionsPage';

export const rootRoute = createRootRoute({ component: ConsoleShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: SystemPage,
});

const inspectChargePointsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inspect/charge-points',
  component: FleetPage,
});

const chargerDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inspect/charge-points/$cpId',
  component: ChargerDetailPage,
});

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inspect/transactions',
  component: TransactionsPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  inspectChargePointsRoute,
  chargerDetailRoute,
  transactionsRoute,
]);

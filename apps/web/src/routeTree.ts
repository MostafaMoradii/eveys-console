// Manual TanStack Router route tree. Avoids the file-based-routing build
// plugin so we don't carry a heavyweight codegen dependency for three routes.
// If the route count grows past ~15, switch to file-based routing on a Node
// version that supports it.

import { createRootRoute, createRoute } from '@tanstack/react-router';

import { ConsoleShell } from './components/AppShell';
import { ChargerDetailPage } from './pages/ChargerDetailPage';
import { FleetPage } from './pages/FleetPage';
import { TransactionsPage } from './pages/TransactionsPage';

export const rootRoute = createRootRoute({ component: ConsoleShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: FleetPage,
});

const chargerDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/charge-points/$cpId',
  component: ChargerDetailPage,
});

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transactions',
  component: TransactionsPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  chargerDetailRoute,
  transactionsRoute,
]);

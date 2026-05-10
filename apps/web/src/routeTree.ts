// Manual TanStack Router route tree. The console is laid out for a
// system-administration audience; the OCPP/charge-point views are
// intentionally one level down under /inspect.

import { createRootRoute, createRoute } from '@tanstack/react-router';

import { ConsoleShell } from './components/AppShell';
import { ChargerDetailPage } from './pages/ChargerDetailPage';
import { FleetPage } from './pages/FleetPage';
import { OcppConformancePage } from './pages/OcppConformancePage';
import { SystemConfigPage } from './pages/SystemConfigPage';
import { SystemPage } from './pages/SystemPage';
import { TransactionDetailPage } from './pages/TransactionDetailPage';
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

const transactionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inspect/transactions/$txId',
  component: TransactionDetailPage,
});

const sysConfigRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sys/config',
  component: SystemConfigPage,
});

const ocppConformanceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sys/ocpp-conformance',
  component: OcppConformancePage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  inspectChargePointsRoute,
  chargerDetailRoute,
  transactionsRoute,
  transactionDetailRoute,
  sysConfigRoute,
  ocppConformanceRoute,
]);

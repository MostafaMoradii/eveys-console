// Tests for ReservationsPanel — focuses on the two surfaces the panel
// exists to deliver:
//   1. Status badges + reservation_id rendering (so an operator can
//      read off the id for CancelReservation).
//   2. The heuristic reservation → transaction join (id_tag + time
//      window).

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Reservation } from '@eveys-console/protocol';
import type { TransactionRow } from '@/api/transactions-client';

const fetchReservations = vi.fn();
const fetchAllChargePointTransactions = vi.fn();

vi.mock('@/api/reservations-client', () => ({
  fetchChargePointReservations: (...args: unknown[]) => fetchReservations(...args),
}));
vi.mock('@/api/transactions-client', () => ({
  fetchAllChargePointTransactions: (...args: unknown[]) => fetchAllChargePointTransactions(...args),
}));
vi.mock('@/lib/ws-context', () => ({
  useConsoleClient: () => ({
    client: { rpc: vi.fn(), subscribe: vi.fn(), close: vi.fn(), connect: vi.fn() },
    status: 'open',
    token: 'test-token',
    setToken: vi.fn(),
  }),
}));

import { ReservationsPanel, matchTransaction } from '@/components/ReservationsPanel';

function renderWithRouter(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute({ component: () => ui });
  // Stub the tx detail route so the <Link> in the panel resolves.
  const txDetail = createRoute({
    getParentRoute: () => rootRoute,
    path: '/inspect/transactions/$txId',
    component: () => null,
  });
  const routeTree = rootRoute.addChildren([txDetail]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchReservations.mockReset();
  fetchAllChargePointTransactions.mockReset();
  fetchAllChargePointTransactions.mockResolvedValue({ transactions: [], truncated: false });
});
afterEach(() => cleanup());

describe('matchTransaction', () => {
  const baseRes: Reservation = {
    reservation_id: 7,
    connector_id: 1,
    id_tag: 'TAG_A',
    parent_id_tag: null,
    expiry_date: '2026-05-12T10:30:00Z',
    status: 'Active',
    created_at: '2026-05-12T10:00:00Z',
    updated_at: '2026-05-12T10:00:00Z',
  };
  const baseTx: TransactionRow = {
    transaction_id: 99,
    cp_id: 'cp_a',
    connector_id: 1,
    id_tag: 'TAG_A',
    meter_start_wh: 0,
    meter_stop_wh: null,
    started_at: '2026-05-12T10:05:00Z',
    stopped_at: null,
    stop_reason: null,
    open: true,
  };

  it('matches a tx that started within the reservation window with the same id_tag', () => {
    expect(matchTransaction(baseRes, [baseTx])).toEqual(baseTx);
  });

  it('does not match a tx with a different id_tag', () => {
    expect(matchTransaction(baseRes, [{ ...baseTx, id_tag: 'TAG_B' }])).toBeNull();
  });

  it('does not match a tx that started before the reservation', () => {
    expect(
      matchTransaction(baseRes, [{ ...baseTx, started_at: '2026-05-12T09:00:00Z' }]),
    ).toBeNull();
  });

  it('matches a tx that started slightly past expiry (within 60s grace)', () => {
    expect(matchTransaction(baseRes, [{ ...baseTx, started_at: '2026-05-12T10:30:30Z' }])).toEqual({
      ...baseTx,
      started_at: '2026-05-12T10:30:30Z',
    });
  });

  it('does not match a tx that started >60s past expiry', () => {
    expect(
      matchTransaction(baseRes, [{ ...baseTx, started_at: '2026-05-12T10:31:30Z' }]),
    ).toBeNull();
  });
});

describe('ReservationsPanel', () => {
  it('renders one row per reservation with status badge and id', async () => {
    const futureIso = new Date(Date.now() + 60 * 60_000).toISOString();
    fetchReservations.mockResolvedValue({
      reservations: [
        {
          reservation_id: 42,
          connector_id: 1,
          id_tag: 'TAG_A',
          parent_id_tag: null,
          expiry_date: futureIso,
          status: 'Active',
          created_at: '2026-05-12T10:00:00Z',
          updated_at: '2026-05-12T10:00:00Z',
        },
        {
          reservation_id: 43,
          connector_id: 2,
          id_tag: 'TAG_B',
          parent_id_tag: null,
          expiry_date: '2026-05-12T09:00:00Z',
          status: 'Cancelled',
          created_at: '2026-05-12T08:30:00Z',
          updated_at: '2026-05-12T08:45:00Z',
        },
      ],
      next_cursor: null,
    });
    renderWithRouter(<ReservationsPanel cpId="cp_a" />);
    expect(await screen.findByTestId('reservation-row-42')).toBeInTheDocument();
    expect(screen.getByTestId('reservation-row-43')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('renders an Active row past its expiry as Expired', async () => {
    fetchReservations.mockResolvedValue({
      reservations: [
        {
          reservation_id: 99,
          connector_id: 1,
          id_tag: 'TAG_A',
          parent_id_tag: null,
          // Year-old expiry, still status=Active in the gateway. The
          // gateway never flips Active rows; the panel derives the
          // Expired label client-side.
          expiry_date: '2025-01-01T00:00:00Z',
          status: 'Active',
          created_at: '2024-12-31T23:00:00Z',
          updated_at: '2024-12-31T23:00:00Z',
        },
      ],
      next_cursor: null,
    });
    renderWithRouter(<ReservationsPanel cpId="cp_a" />);
    expect(await screen.findByTestId('reservation-row-99')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('shows the empty-state copy when the gateway returns no reservations', async () => {
    fetchReservations.mockResolvedValue({ reservations: [], next_cursor: null });
    renderWithRouter(<ReservationsPanel cpId="cp_a" />);
    expect(await screen.findByText(/No reservations on record/i)).toBeInTheDocument();
  });

  it('links a reservation to its matching transaction', async () => {
    fetchReservations.mockResolvedValue({
      reservations: [
        {
          reservation_id: 7,
          connector_id: 1,
          id_tag: 'TAG_A',
          parent_id_tag: null,
          expiry_date: '2026-05-12T10:30:00Z',
          status: 'Active',
          created_at: '2026-05-12T10:00:00Z',
          updated_at: '2026-05-12T10:00:00Z',
        },
      ],
      next_cursor: null,
    });
    fetchAllChargePointTransactions.mockResolvedValue({
      transactions: [
        {
          transaction_id: 99,
          cp_id: 'cp_a',
          connector_id: 1,
          id_tag: 'TAG_A',
          meter_start_wh: 0,
          meter_stop_wh: null,
          started_at: '2026-05-12T10:05:00Z',
          stopped_at: null,
          stop_reason: null,
          open: true,
        },
      ],
      truncated: false,
    });
    renderWithRouter(<ReservationsPanel cpId="cp_a" />);
    expect(await screen.findByText('#99')).toBeInTheDocument();
  });
});

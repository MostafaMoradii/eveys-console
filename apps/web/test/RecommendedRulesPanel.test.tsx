// Focused tests for the Recommended-rules panel. The hook layer is
// mocked the same way ManagedRulesPanel.test.tsx mocks it — we just
// pin the install / uninstall behaviour and the installed-count badge.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ManagedAlertingRule } from '@/api/alerts-client';
import { ToastProvider } from '@/components/ui/toaster';
import { ThemeProvider } from '@/lib/theme-context';

let stub: {
  rules: ManagedAlertingRule[];
  validationSkipped: boolean;
  loading: boolean;
  error: string | null;
} = { rules: [], validationSkipped: false, loading: false, error: null };

const createMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock('@/hooks/use-managed-rules', () => ({
  useManagedRules: () => stub,
  useCreateManagedRule: () => ({
    mutate: createMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useUpdateManagedRule: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
  useDeleteManagedRule: () => ({
    mutate: deleteMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

import { RecommendedRulesPanel } from '@/components/RecommendedRulesPanel';
import { RECOMMENDED_RULES } from '@/lib/recommended-rules';

function withProviders(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ThemeProvider>
        <ToastProvider>{node}</ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  stub = { rules: [], validationSkipped: false, loading: false, error: null };
  createMutate.mockClear();
  deleteMutate.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('RecommendedRulesPanel', () => {
  it('renders one row per curated rule', () => {
    render(withProviders(<RecommendedRulesPanel />));
    const rows = screen.getAllByTestId('recommended-rule-row');
    expect(rows.length).toBe(RECOMMENDED_RULES.length);
  });

  it('shows 0 of N installed when no overlap with managed rules', () => {
    render(withProviders(<RecommendedRulesPanel />));
    expect(screen.getByTestId('recommended-rules-count')).toHaveTextContent(
      `0 / ${RECOMMENDED_RULES.length} installed`,
    );
  });

  it('marks a recommended rule as installed when the managed list already contains its name', () => {
    const sample = RECOMMENDED_RULES[0]!;
    stub = {
      rules: [
        {
          name: sample.name,
          // The other fields can be different — match is by name only.
          expr: 'whatever',
          duration: '5m',
          severity: 'warning',
          summary: 'whatever',
          description: '',
        },
      ],
      validationSkipped: false,
      loading: false,
      error: null,
    };
    render(withProviders(<RecommendedRulesPanel />));
    const row = screen
      .getAllByTestId('recommended-rule-row')
      .find((el) => el.getAttribute('data-rule-name') === sample.name)!;
    expect(row).toBeTruthy();
    expect(row.querySelector('[data-testid="recommended-rule-installed"]')).toBeInTheDocument();
  });

  it('install button calls createMutate with the curated rule body', async () => {
    const user = userEvent.setup();
    render(withProviders(<RecommendedRulesPanel />));
    const installButtons = screen.getAllByTestId('install-recommended-rule');
    await user.click(installButtons[0]!);
    expect(createMutate).toHaveBeenCalledTimes(1);
    const payload = createMutate.mock.calls[0]![0];
    const expected = RECOMMENDED_RULES[0]!;
    expect(payload).toMatchObject({
      name: expected.name,
      expr: expected.expr,
      severity: expected.severity,
    });
  });

  it('uninstall button calls deleteMutate with the rule name', async () => {
    const user = userEvent.setup();
    const sample = RECOMMENDED_RULES[0]!;
    stub = {
      rules: [
        {
          name: sample.name,
          expr: sample.expr,
          duration: sample.duration,
          severity: sample.severity,
          summary: sample.summary,
          description: sample.description,
        },
      ],
      validationSkipped: false,
      loading: false,
      error: null,
    };
    render(withProviders(<RecommendedRulesPanel />));
    const uninstalls = screen.getAllByTestId('uninstall-recommended-rule');
    await user.click(uninstalls[0]!);
    expect(deleteMutate).toHaveBeenCalledWith(sample.name, expect.anything());
  });
});

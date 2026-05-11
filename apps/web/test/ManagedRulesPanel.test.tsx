// Focused tests for the managed-rules panel. Mirrors the structure of
// ChannelsPanel.test.tsx — mock the hook layer, exercise the resting
// states + the Add / Edit / Delete flows.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
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
const updateMutate = vi.fn();
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
    mutate: updateMutate,
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

import { ManagedRulesPanel } from '@/components/ManagedRulesPanel';

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

function renderPanel() {
  return render(withProviders(<ManagedRulesPanel />));
}

beforeEach(() => {
  stub = { rules: [], validationSkipped: false, loading: false, error: null };
  createMutate.mockClear();
  updateMutate.mockClear();
  deleteMutate.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ManagedRulesPanel — resting states', () => {
  it('shows the empty state when no rules are configured', () => {
    renderPanel();
    expect(screen.getByTestId('managed-rules-empty')).toBeInTheDocument();
  });

  it('shows the loading hint when the hook is loading', () => {
    stub.loading = true;
    renderPanel();
    expect(screen.getByTestId('managed-rules-loading')).toBeInTheDocument();
  });

  it('shows the error alert when the hook errors', () => {
    stub.error = 'GET sys/alerts/rules/managed 500';
    renderPanel();
    expect(screen.getByTestId('managed-rules-error')).toBeInTheDocument();
  });

  it('renders the validation-skipped banner when the server reports it', () => {
    stub.validationSkipped = true;
    renderPanel();
    expect(screen.getByTestId('managed-rules-validation-skipped')).toBeInTheDocument();
  });

  it('renders one row per rule with severity badge + expression', () => {
    stub.rules = [
      {
        name: 'HighErrorRate',
        expr: 'rate(http_5xx[5m]) > 0.5',
        duration: '5m',
        severity: 'critical',
        summary: 'errors elevated',
        description: '',
      },
    ];
    renderPanel();
    const row = screen.getByTestId('managed-rule-row');
    expect(row.getAttribute('data-rule-name')).toBe('HighErrorRate');
    expect(within(row).getByText('critical')).toBeInTheDocument();
    expect(within(row).getByText('rate(http_5xx[5m]) > 0.5')).toBeInTheDocument();
  });
});

describe('ManagedRulesPanel — add', () => {
  it('opens the form on Add and submits trimmed values', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('add-managed-rule-button'));
    expect(screen.getByTestId('managed-rule-dialog')).toBeInTheDocument();

    await user.type(screen.getByTestId('managed-rule-name'), '  HighErrorRate  ');
    // userEvent.type interprets `[` and `{` as key-prefix specials;
    // escape with `[[` / `{{` so the literal characters land in the
    // textarea verbatim.
    await user.type(screen.getByTestId('managed-rule-expr'), 'rate(http_5xx[[5m]) > 0.5');
    // Duration defaults to 5m; clear+retype to make sure trimming works
    const dur = screen.getByTestId('managed-rule-duration') as HTMLInputElement;
    await user.clear(dur);
    await user.type(dur, '  10m  ');
    await user.selectOptions(screen.getByTestId('managed-rule-severity'), 'critical');
    await user.type(screen.getByTestId('managed-rule-summary'), 'errors elevated');

    await user.click(screen.getByTestId('submit-managed-rule'));

    expect(createMutate).toHaveBeenCalledTimes(1);
    const payload = createMutate.mock.calls[0]?.[0] as ManagedAlertingRule;
    expect(payload).toMatchObject({
      name: 'HighErrorRate',
      expr: 'rate(http_5xx[5m]) > 0.5',
      duration: '10m',
      severity: 'critical',
      summary: 'errors elevated',
    });
  });

  it('disables Add until name and expr are non-empty', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByTestId('add-managed-rule-button'));
    const submit = screen.getByTestId('submit-managed-rule');
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId('managed-rule-name'), 'X');
    expect(submit).toBeDisabled();
    await user.type(screen.getByTestId('managed-rule-expr'), 'up == 0');
    expect(submit).not.toBeDisabled();
  });
});

describe('ManagedRulesPanel — edit', () => {
  it('pre-fills the form and disables the name field', async () => {
    const user = userEvent.setup();
    stub.rules = [
      {
        name: 'Existing',
        expr: 'up == 0',
        duration: '5m',
        severity: 'warning',
        summary: 'down',
        description: 'long form',
      },
    ];
    renderPanel();
    await user.click(screen.getByTestId('edit-managed-rule-button'));
    expect((screen.getByTestId('managed-rule-name') as HTMLInputElement).value).toBe('Existing');
    expect((screen.getByTestId('managed-rule-name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByTestId('managed-rule-expr') as HTMLTextAreaElement).value).toBe('up == 0');
  });

  it('submits update mutation with new values', async () => {
    const user = userEvent.setup();
    stub.rules = [
      {
        name: 'Existing',
        expr: 'up == 0',
        duration: '5m',
        severity: 'warning',
        summary: 'down',
        description: '',
      },
    ];
    renderPanel();
    await user.click(screen.getByTestId('edit-managed-rule-button'));
    await user.selectOptions(screen.getByTestId('managed-rule-severity'), 'critical');
    await user.click(screen.getByTestId('submit-managed-rule'));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    const payload = updateMutate.mock.calls[0]?.[0] as ManagedAlertingRule;
    expect(payload.severity).toBe('critical');
    expect(payload.name).toBe('Existing');
  });
});

describe('ManagedRulesPanel — delete', () => {
  it('confirms via AlertDialog before firing the delete mutation', async () => {
    const user = userEvent.setup();
    stub.rules = [
      {
        name: 'Doomed',
        expr: 'up == 0',
        duration: '5m',
        severity: 'warning',
        summary: '',
        description: '',
      },
    ];
    renderPanel();
    await user.click(screen.getByTestId('delete-managed-rule-button'));
    expect(screen.getByTestId('delete-managed-rule-dialog')).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('delete-managed-rule-confirm'));
    expect(deleteMutate).toHaveBeenCalledWith('Doomed', expect.anything());
  });
});

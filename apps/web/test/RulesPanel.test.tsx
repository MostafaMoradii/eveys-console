// Focused tests for the Rules tab. The hook is mocked so the panel
// renders deterministic state without standing up React Query against
// the proxy.

import { cleanup, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RuleGroup } from '@/api/alerts-client';
import { ThemeProvider } from '@/lib/theme-context';

let stub: {
  groups: RuleGroup[];
  unavailable: boolean;
  loading: boolean;
  error: string | null;
} = { groups: [], unavailable: false, loading: false, error: null };

vi.mock('@/hooks/use-rules', () => ({
  useRules: () => stub,
}));

import { RulesPanel } from '@/components/RulesPanel';

function renderPanel() {
  return render(
    <ThemeProvider>
      <RulesPanel />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  stub = { groups: [], unavailable: false, loading: false, error: null };
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-11T12:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function ruleGroup(over: Partial<RuleGroup> = {}): RuleGroup {
  return {
    name: 'eveys-console',
    file: '/etc/prometheus/alerts.yml',
    interval: 15,
    rules: [
      {
        name: 'ConsoleDown',
        type: 'alerting',
        expr: 'up{job="eveys-console"} == 0',
        duration: '5m',
        severity: 'warning',
        summary: 'Console scrape failing',
        description: 'Prometheus has not scraped the Console for 5 minutes.',
        state: 'inactive',
        last_evaluation: '2026-05-11T11:59:30.000Z',
        evaluation_time: '0.001',
        health: 'ok',
      },
    ],
    ...over,
  };
}

describe('RulesPanel — resting states', () => {
  it('shows the loading hint when the hook is loading', () => {
    stub.loading = true;
    renderPanel();
    expect(screen.getByTestId('rules-loading')).toBeInTheDocument();
  });

  it('shows the unavailable hint when Prometheus is not configured', () => {
    stub.unavailable = true;
    renderPanel();
    expect(screen.getByTestId('rules-unavailable')).toBeInTheDocument();
  });

  it('shows the empty hint when no groups are loaded', () => {
    renderPanel();
    expect(screen.getByTestId('rules-empty')).toBeInTheDocument();
  });

  it('shows the error alert when the hook errors', () => {
    stub.error = 'GET sys/alerts/rules 500';
    renderPanel();
    expect(screen.getByTestId('rules-error')).toBeInTheDocument();
  });
});

describe('RulesPanel — rendering', () => {
  it('renders a group card with rules inside', () => {
    stub.groups = [ruleGroup()];
    renderPanel();
    const group = screen.getByTestId('rule-group');
    expect(group.getAttribute('data-group-name')).toBe('eveys-console');
    expect(within(group).getByTestId('rule-row')).toBeInTheDocument();
  });

  it('renders the rule name, expression and severity badge', () => {
    stub.groups = [ruleGroup()];
    renderPanel();
    expect(screen.getByText('ConsoleDown')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
    const expr = screen.getByTestId('rule-expr');
    expect(expr.textContent).toContain('up{job="eveys-console"}');
  });

  it('attaches state as a data-attr so test filters can match by state', () => {
    stub.groups = [ruleGroup({ rules: [{ ...ruleGroup().rules[0]!, state: 'firing' }] })];
    renderPanel();
    const row = screen.getByTestId('rule-row');
    expect(row.getAttribute('data-rule-state')).toBe('firing');
  });

  it('renders the relative-time last-evaluated hint', () => {
    stub.groups = [ruleGroup()];
    renderPanel();
    expect(screen.getByText(/last evaluated/i)).toBeInTheDocument();
  });
});

// Focused tests for the page-level Alertmanager docs strip. The strip
// is a static explainer with a single open/close toggle and no
// external data, so the assertions are minimal: collapsed-by-default,
// toggle shows the body, body covers the four tabs.

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { AlertmanagerDocsStrip } from '@/components/AlertmanagerDocsStrip';

afterEach(() => cleanup());

describe('AlertmanagerDocsStrip', () => {
  it('starts collapsed (toggle reads Show; body has the hidden class)', () => {
    const { container } = render(<AlertmanagerDocsStrip />);
    expect(screen.getByTestId('alertmanager-docs-toggle')).toHaveTextContent('Show');
    // jsdom doesn't honour CSS, so use the class as the contract for
    // collapsed state. (Same shape RecommendedRulesPanel uses.)
    const hidden = container.querySelector('.hidden');
    expect(hidden).not.toBeNull();
  });

  it('expands on click and covers Firing / Silences / Channels / Rules', async () => {
    const user = userEvent.setup();
    render(<AlertmanagerDocsStrip />);
    await user.click(screen.getByTestId('alertmanager-docs-toggle'));
    expect(screen.getByTestId('alertmanager-docs-toggle')).toHaveTextContent('Hide');
    // Body now visible — assert it explains each tab. Several tab
    // names appear more than once (in the "What each tab does" list
    // and again in the "First-time setup" steps), so use getAllByText.
    expect(screen.getByText(/severity ladder/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Firing/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Silences/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Channels/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Rules/).length).toBeGreaterThan(0);
  });

  it('links to the upstream Alertmanager docs', () => {
    render(<AlertmanagerDocsStrip />);
    const link = screen.getByRole('link', { name: /prometheus\.io\/docs\/alerting/i });
    expect(link).toHaveAttribute(
      'href',
      'https://prometheus.io/docs/alerting/latest/alertmanager/',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

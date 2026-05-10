// Component tests for OcppConformancePage. The page is purely
// client-side over the static dictionary, so no transport mocks
// needed — we render and drive the filter UI.

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { OcppConformancePage } from '@/pages/OcppConformancePage';
import { OCPP_MESSAGES, OCPP_PROFILES, OCPP_PROFILE_LABELS } from '@/lib/ocpp-conformance';

afterEach(() => {
  cleanup();
});

describe('OcppConformancePage — initial render', () => {
  it('renders the page heading', () => {
    render(<OcppConformancePage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /OCPP 1\.6 conformance/i }),
    ).toBeInTheDocument();
  });

  it('renders a section heading for every profile that has at least one message', () => {
    render(<OcppConformancePage />);
    for (const profile of OCPP_PROFILES) {
      const messagesInProfile = OCPP_MESSAGES.filter((m) => m.profile === profile);
      if (messagesInProfile.length === 0) continue;
      const label = OCPP_PROFILE_LABELS[profile];
      expect(
        screen.getByRole('heading', { level: 3, name: new RegExp(`^${label}$`) }),
        `missing heading for ${label}`,
      ).toBeInTheDocument();
    }
  });

  it('renders one row per message in the dictionary', () => {
    render(<OcppConformancePage />);
    for (const msg of OCPP_MESSAGES) {
      const row = screen.getByTestId(`row-${msg.name}-${msg.direction}`);
      expect(row).toBeInTheDocument();
      expect(within(row).getByText(msg.name)).toBeInTheDocument();
    }
  });

  it('renders the totals badges with the right counts', () => {
    render(<OcppConformancePage />);
    const implemented = OCPP_MESSAGES.filter((m) => m.status === 'implemented').length;
    const partial = OCPP_MESSAGES.filter((m) => m.status === 'partial').length;
    const notImpl = OCPP_MESSAGES.filter((m) => m.status === 'not-implemented').length;
    expect(screen.getByTestId('total-implemented')).toHaveTextContent(`${implemented} implemented`);
    expect(screen.getByTestId('total-partial')).toHaveTextContent(`${partial} partial`);
    expect(screen.getByTestId('total-not-implemented')).toHaveTextContent(
      `${notImpl} not implemented`,
    );
  });
});

describe('OcppConformancePage — status badge variants', () => {
  it('"implemented" badge uses the success colour token', () => {
    render(<OcppConformancePage />);
    // BootNotification is unambiguously implemented.
    const badge = screen.getByTestId('badge-BootNotification-charger-to-csms');
    expect(badge.className).toMatch(/emerald/);
  });

  it('"not implemented" badge uses the muted colour token', () => {
    render(<OcppConformancePage />);
    // ChangeAvailability is intentionally listed as not-implemented.
    const badge = screen.getByTestId('badge-ChangeAvailability-csms-to-charger');
    expect(badge.className).toMatch(/bg-muted|muted-foreground/);
  });
});

describe('OcppConformancePage — filters', () => {
  it('search filter narrows the visible rows by name', async () => {
    const user = userEvent.setup();
    render(<OcppConformancePage />);
    expect(screen.queryByTestId('row-BootNotification-charger-to-csms')).toBeInTheDocument();

    const input = screen.getByLabelText(/Search OCPP messages by name/i);
    await user.type(input, 'firmware');

    // Heartbeat should no longer match.
    expect(screen.queryByTestId('row-Heartbeat-charger-to-csms')).not.toBeInTheDocument();
    // Firmware-y messages should still show.
    expect(
      screen.getByTestId('row-FirmwareStatusNotification-charger-to-csms'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('row-UpdateFirmware-csms-to-charger')).toBeInTheDocument();
  });

  it('profile chip toggles a profile off and on', async () => {
    const user = userEvent.setup();
    render(<OcppConformancePage />);
    // Smart charging row visible by default.
    expect(screen.getByTestId('row-SetChargingProfile-csms-to-charger')).toBeInTheDocument();

    // Click the SmartCharging chip — should hide its rows.
    await user.click(screen.getByRole('button', { name: 'Smart Charging' }));
    expect(screen.queryByTestId('row-SetChargingProfile-csms-to-charger')).not.toBeInTheDocument();

    // Click again to re-enable.
    await user.click(screen.getByRole('button', { name: 'Smart Charging' }));
    expect(screen.getByTestId('row-SetChargingProfile-csms-to-charger')).toBeInTheDocument();
  });

  it('status filter narrows to only implemented / partial / not-implemented', async () => {
    const user = userEvent.setup();
    render(<OcppConformancePage />);

    // Switch to "not implemented" — the not-implemented messages should
    // be the only ones rendered.
    await user.click(screen.getByRole('radio', { name: /not implemented/i }));
    expect(screen.queryByTestId('row-BootNotification-charger-to-csms')).not.toBeInTheDocument();
    expect(screen.getByTestId('row-ChangeAvailability-csms-to-charger')).toBeInTheDocument();

    // Switch back to "all" — Boot is back.
    await user.click(screen.getByRole('radio', { name: /^all$/i }));
    expect(screen.getByTestId('row-BootNotification-charger-to-csms')).toBeInTheDocument();
  });

  it('renders a friendly empty message when filters cull every row', async () => {
    const user = userEvent.setup();
    render(<OcppConformancePage />);
    const input = screen.getByLabelText(/Search OCPP messages by name/i);
    await user.type(input, 'definitely-not-an-ocpp-message');
    expect(screen.getByText(/No messages match the current filters/i)).toBeInTheDocument();
  });
});

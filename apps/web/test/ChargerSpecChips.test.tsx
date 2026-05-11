import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ChargerSpecChips } from '@/components/ChargerSpecChips';

afterEach(() => {
  cleanup();
});

describe('ChargerSpecChips', () => {
  it('renders AC + power chips for a known AC model', () => {
    render(<ChargerSpecChips model="Eveys-22kW-AC" />);
    const wrapper = screen.getByTestId('charger-spec-chips');
    expect(wrapper.textContent).toContain('AC');
    expect(wrapper.textContent).toContain('22 kW');
  });

  it('renders DC + power chips for a known DC model', () => {
    render(<ChargerSpecChips model="Eveys-100kW-DC" />);
    const wrapper = screen.getByTestId('charger-spec-chips');
    expect(wrapper.textContent).toContain('DC');
    expect(wrapper.textContent).toContain('100 kW');
  });

  it('renders nothing when the model is null', () => {
    render(<ChargerSpecChips model={null} />);
    expect(screen.queryByTestId('charger-spec-chips')).toBeNull();
  });

  it('renders nothing when the model has no recognisable parts', () => {
    render(<ChargerSpecChips model="UnknownXYZ" />);
    expect(screen.queryByTestId('charger-spec-chips')).toBeNull();
  });

  it('renders only the kind chip when only kind is present', () => {
    render(<ChargerSpecChips model="Eveys AC unit" />);
    const wrapper = screen.getByTestId('charger-spec-chips');
    expect(wrapper.textContent).toContain('AC');
    expect(wrapper.textContent).not.toContain('kW');
  });

  it('renders only the power chip when only power is present', () => {
    render(<ChargerSpecChips model="Generic 50kW unit" />);
    const wrapper = screen.getByTestId('charger-spec-chips');
    expect(wrapper.textContent).toContain('50 kW');
    expect(wrapper.textContent).not.toMatch(/\bAC\b|\bDC\b/);
  });
});

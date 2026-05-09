// Reactively reports whether the viewport is below a given Tailwind
// breakpoint (`sm` = 640 px, `md` = 768 px, `lg` = 1024 px, `xl` =
// 1280 px). Listens to `window.matchMedia` so it updates on resize
// and on orientation change.
//
// Used by pages that pick a different layout strategy at a
// breakpoint than CSS media queries can express — e.g. forcing
// grid view, swapping a Table for a Card list, or moving a
// filter bar into a Sheet.

import { useEffect, useState } from 'react';

const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export function useIsBelow(breakpoint: Breakpoint): boolean {
  const [below, setBelow] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < BREAKPOINTS[breakpoint];
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${BREAKPOINTS[breakpoint] - 1}px)`);
    const onChange = () => setBelow(mql.matches);
    setBelow(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [breakpoint]);

  return below;
}

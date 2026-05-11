import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Radix popovers (Dropdown, Select, etc) need their own
        // background token so the Portal-rendered subtree doesn't
        // inherit body's background. Otherwise dropdowns render
        // see-through over whatever sits behind them.
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
        brand: {
          orange: 'hsl(var(--brand-orange))',
          cloud: 'hsl(var(--brand-cloud))',
          slate: 'hsl(var(--brand-slate))',
          blue: 'hsl(var(--brand-blue))',
          green: 'hsl(var(--brand-green))',
          red: 'hsl(var(--brand-red))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // Inter for body / UI (loaded from @fontsource-variable/inter in
      // index.css); Clash Display for headings (CDN). Both fall back to
      // the system font stack so the page doesn't blink to a serif
      // while the webfont resolves.
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Clash Display', 'Inter Variable', 'system-ui', 'sans-serif'],
      },
    },
  },
  // Some popover utilities only appear inside Radix portals which the
  // Tailwind scanner has missed before — pin them so a fresh build
  // can't drop them.
  safelist: [
    'bg-popover',
    'text-popover-foreground',
    'bg-accent',
    'text-accent-foreground',
    'bg-destructive',
    'text-destructive-foreground',
  ],
  plugins: [animate],
} satisfies Config;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      // Intently colour palette — eggshell whites, warm grays, charcoal
      colors: {
        intently: {
          cream:   '#F8F6F1',   // page background
          paper:   '#F2EFE9',   // card backgrounds
          cloud:   '#E8E4DC',   // borders, dividers
          stone:   '#C4BFB5',   // dividers/borders only (too low contrast for text)
          pebble:  '#5C5854',   // secondary text (≥ 5.2:1 on paper/cream)
          slate:   '#3A3A37',   // body text
          ink:     '#2C2C2A',   // headings, CTAs
          moss:    '#1D9E75',   // success, "included" labels
        },
      },
      fontFamily: {
        // Cormorant for editorial display moments (dish names, headlines)
        display: ['var(--font-display)', 'Georgia', 'serif'],
        // DM Sans for clean UI text
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      // Fluid spacing rhythm
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
      },
      animation: {
        'fade-up':    'fadeUp 0.85s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
        'fade-in':    'fadeIn 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
}

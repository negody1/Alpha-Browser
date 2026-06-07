/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts}'],
  theme: {
    extend: {
      colors: {
        bg: '#0E1116',
        surface: '#161B22',
        'surface-hover': '#1D2530',
        accent: '#7A4DFF',
        'accent-soft': '#9B6CFF',
        'text-primary': '#F5F7FA',
        'text-secondary': '#97A3B6',
      },
      borderRadius: {
        alpha: '14px',
        'alpha-lg': '18px',
      },
    },
  },
  plugins: [],
};

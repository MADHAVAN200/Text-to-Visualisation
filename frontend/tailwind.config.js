/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: '#0f172a',      // Slate 900
        darkSidebar: '#1e293b', // Slate 800
        darkBorder: '#334155',  // Slate 700
        accentBlue: '#3b82f6',  // Blue 500
        accentGreen: '#10b981', // Emerald 500
        accentAmber: '#f59e0b', // Amber 500
        glassBg: 'rgba(30, 41, 59, 0.7)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50:'#fdf4ff',100:'#fae8ff',500:'#a855f7',600:'#9333ea',700:'#7e22ce',900:'#581c87' },
        ma:    { 50:'#eff6ff',500:'#3b82f6',600:'#2563eb',700:'#1d4ed8' },
        pn:    { 50:'#f0fdf4',500:'#22c55e',600:'#16a34a',700:'#15803d' },
      },
      fontFamily: { sans: ['Inter','system-ui','sans-serif'] },
    },
  },
  plugins: [],
}

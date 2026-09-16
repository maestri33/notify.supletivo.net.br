/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      colors: {
        brand: {
          green: '#00734d',
          'green-deep': '#005238',
          yellow: '#ffc400',
          'yellow-soft': '#ffd75e',
          blue: '#002776',
          'blue-deep': '#001a52',
          ink: '#0b1220',
          'ink-soft': '#121d33',
          paper: '#ffffff',
          'paper-soft': '#f5f7f3',
        },
      },
      fontFamily: {
        display: ['"Archivo Black"', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

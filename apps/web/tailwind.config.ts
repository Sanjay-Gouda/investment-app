import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        corgi: {
          DEFAULT: '#E8822A',
          fg: '#1a1a1a',
        },
      },
    },
  },
  plugins: [],
};

export default config;

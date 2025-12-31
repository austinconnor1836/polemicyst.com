import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      colors: {
        'accent-1': '#FAFAFA',
        'accent-2': '#EAEAEA',
        'accent-7': '#333',
        success: '#0070f3',
        cyan: '#79FFE1',
      },
      spacing: {
        28: '7rem',
      },
      letterSpacing: {
        tighter: '-.04em',
      },
      fontSize: {
        '5xl': '2.5rem',
        '6xl': '2.75rem',
        '7xl': '4.5rem',
        '8xl': '6.25rem',
      },
      boxShadow: {
        sm: '0 5px 10px rgba(0, 0, 0, 0.12)',
        md: '0 8px 30px rgba(0, 0, 0, 0.12)',
      },
      keyframes: {
        'dialog-overlay-in': {
          '0%': { opacity: '0', backdropFilter: 'blur(0px) saturate(1) contrast(1)' },
          '100%': { opacity: '1', backdropFilter: 'blur(4px) saturate(1.12) contrast(1.06)' },
        },
        'dialog-overlay-out': {
          '0%': { opacity: '1', backdropFilter: 'blur(4px) saturate(1.12) contrast(1.06)' },
          '100%': { opacity: '0', backdropFilter: 'blur(0px) saturate(1) contrast(1)' },
        },
        'dialog-vignette-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'dialog-vignette-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        'dialog-halo': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '60%': { opacity: '1', transform: 'scale(1)' },
          '100%': { opacity: '0.9', transform: 'scale(1)' },
        },
        'dialog-content-in': {
          '0%': {
            opacity: '0',
            transform:
              'translate(-50%, -50%) translate3d(0, 18px, 0) rotateX(12deg) rotateZ(-0.6deg) scale(0.90)',
            filter: 'blur(12px)',
            boxShadow: '0 0px 0px rgba(0,0,0,0)',
          },
          '55%': {
            opacity: '1',
            transform:
              'translate(-50%, -50%) translate3d(0, 0px, 0) rotateX(0deg) rotateZ(0deg) scale(1.03)',
            filter: 'blur(0px)',
            boxShadow: '0 18px 60px rgba(0,0,0,0.22)',
          },
          '78%': {
            transform:
              'translate(-50%, -50%) translate3d(0, 0px, 0) rotateX(0deg) rotateZ(0deg) scale(0.995)',
            boxShadow: '0 14px 50px rgba(0,0,0,0.20)',
          },
          '90%': {
            transform:
              'translate(-50%, -50%) translate3d(0, 0px, 0) rotateX(0deg) rotateZ(0deg) scale(1.006)',
            boxShadow: '0 15px 52px rgba(0,0,0,0.205)',
          },
          '100%': {
            opacity: '1',
            transform:
              'translate(-50%, -50%) translate3d(0, 0px, 0) rotateX(0deg) rotateZ(0deg) scale(1)',
            filter: 'blur(0px)',
            boxShadow: '0 14px 50px rgba(0,0,0,0.20)',
          },
        },
        'dialog-content-out': {
          '0%': {
            opacity: '1',
            transform:
              'translate(-50%, -50%) translate3d(0, 0px, 0) rotateX(0deg) rotateZ(0deg) scale(1)',
            filter: 'blur(0px)',
            boxShadow: '0 14px 50px rgba(0,0,0,0.20)',
          },
          '45%': {
            opacity: '1',
            transform:
              'translate(-50%, -50%) translate3d(0, 0px, 0) rotateX(0deg) rotateZ(0deg) scale(0.99)',
            filter: 'blur(0px)',
            boxShadow: '0 10px 40px rgba(0,0,0,0.16)',
          },
          '100%': {
            opacity: '0',
            transform:
              'translate(-50%, -50%) translate3d(0, 14px, 0) rotateX(8deg) rotateZ(0.35deg) scale(0.95)',
            filter: 'blur(8px)',
            boxShadow: '0 0px 0px rgba(0,0,0,0)',
          },
        },
        'dialog-shine': {
          '0%': { opacity: '0', transform: 'translateX(-12%)' },
          '30%': { opacity: '0.08' },
          '100%': { opacity: '0', transform: 'translateX(12%)' },
        },
      },
      animation: {
        'dialog-overlay-in': 'dialog-overlay-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'dialog-overlay-out': 'dialog-overlay-out 200ms cubic-bezier(0.4, 0, 1, 1) both',
        'dialog-vignette-in': 'dialog-vignette-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'dialog-vignette-out': 'dialog-vignette-out 200ms cubic-bezier(0.4, 0, 1, 1) both',
        'dialog-halo': 'dialog-halo 620ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'dialog-content-in': 'dialog-content-in 560ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'dialog-content-out': 'dialog-content-out 240ms cubic-bezier(0.4, 0, 1, 1) both',
        'dialog-shine': 'dialog-shine 700ms cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;

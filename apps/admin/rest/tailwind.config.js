const v3Colors = require('../../tailwind-v3-colors');

// Escala de texto de la v3 con interlineado en rem. La v4 lo define como razón sin
// unidades (1.25 / 0.875...), y un hijo con text-[13px] heredaba otro interlineado (US-86).
const v3FontSize = {
  xs: ['0.75rem', { lineHeight: '1rem' }],
  sm: ['0.875rem', { lineHeight: '1.25rem' }],
  base: ['1rem', { lineHeight: '1.5rem' }],
  lg: ['1.125rem', { lineHeight: '1.75rem' }],
  xl: ['1.25rem', { lineHeight: '1.75rem' }],
  '2xl': ['1.5rem', { lineHeight: '2rem' }],
  '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
  '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
  '5xl': ['3rem', { lineHeight: '1' }],
  '6xl': ['3.75rem', { lineHeight: '1' }],
  '7xl': ['4.5rem', { lineHeight: '1' }],
  '8xl': ['6rem', { lineHeight: '1' }],
  '9xl': ['8rem', { lineHeight: '1' }],
};

// <alpha-value> lo entienden la v3 y la v4; la v4 no acepta colores definidos como
// función (US-86). Las variables siguen en formato "r, g, b".
function withOpacity(variableName) {
  return `rgba(var(${variableName}), <alpha-value>)`;
}

module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        '3xl': '1900px',
      },
      fontFamily: {
        // body: ['Open Sans', 'system-ui', 'sans-serif'],
        // heading: ['Open Sans', 'system-ui', 'sans-serif'],
        body: [`Inter, sans-serif`],
        heading: [`Inter, sans-serif`],
      },
      colors: {
        ...v3Colors,
        light: withOpacity('--color-light'),
        dark: withOpacity('--color-dark'),
        accent: withOpacity('--color-accent'),
        'muted-black': withOpacity('--color-muted-black'),
        'base-dark': withOpacity('--text-base-dark'),
        'accent-hover': withOpacity('--color-accent-hover'),
        'accent-300': withOpacity('--color-accent-300'),
        'accent-400': withOpacity('--color-accent-400'),
        'accent-500': withOpacity('--color-accent-500'),
        'accent-600': withOpacity('--color-accent-600'),
        'accent-700': withOpacity('--color-accent-700'),
        'border-50': withOpacity('--color-border-50'),
        'border-100': withOpacity('--color-border-100'),
        'border-200': withOpacity('--color-border-200'),
        'border-base': withOpacity('--color-border-base'),
        'border-400': withOpacity('--color-border-400'),
        'gray-50': withOpacity('--color-gray-50'),
        'gray-100': withOpacity('--color-gray-100'),
        'gray-200': withOpacity('--color-gray-200'),
        'gray-300': withOpacity('--color-gray-300'),
        'gray-400': withOpacity('--color-gray-400'),
        'gray-500': withOpacity('--color-gray-500'),
        'gray-600': withOpacity('--color-gray-600'),
        'gray-700': withOpacity('--color-gray-700'),
        'gray-800': withOpacity('--color-gray-800'),
        'gray-900': withOpacity('--color-gray-900'),
        'orange-50': withOpacity('--color-orange-50'),
        'orange-100': withOpacity('--color-orange-100'),
        'orange-200': withOpacity('--color-orange-200'),
        'orange-300': withOpacity('--color-orange-300'),
        'orange-400': withOpacity('--color-orange-400'),
        'orange-500': withOpacity('--color-orange-500'),
        'orange-600': withOpacity('--color-orange-600'),
        'orange-700': withOpacity('--color-orange-700'),
        'orange-800': withOpacity('--color-orange-800'),
        'orange-900': withOpacity('--color-orange-900'),
        social: {
          facebook: '#3b5998',
          'facebook-hover': '#35508a',
          twitter: '#1da1f2',
          instagram: '#e1306c',
          youtube: '#ff0000',
          google: '#4285f4',
          'google-hover': '#3574de',
        },
        status: {
          pending: withOpacity('--color-pending'),
          processing: withOpacity('--color-processing'),
          complete: withOpacity('--color-complete'),
          canceled: withOpacity('--color-canceled'),
          failed: withOpacity('--color-failed'),
          'out-for-delivery': withOpacity('--color-out-for-delivery'),
        },
      },

      textColor: {
        body: withOpacity('--text-base'),
        'body-dark': withOpacity('--text-base-dark'),
        muted: withOpacity('--text-muted'),
        'muted-light': withOpacity('--text-muted-light'),
        heading: withOpacity('--text-heading'),
        'sub-heading': withOpacity('--text-sub-heading'),
        bolder: withOpacity('--text-text-bolder'),
      },

      height: {
        13: '3.125rem',
        double: '200%',
      },
      maxWidth: {
        5: '1.25rem',
      },
      maxHeight: {
        5: '1.25rem',
      },
      spacing: {
        22: '5.5rem',
      },

      borderRadius: {
        DEFAULT: '5px',
      },

      boxShadow: {
        base: 'rgba(0, 0, 0, 0.16) 0px 4px 16px',
        translatePanel: '0px 15px 50px rgba(71, 92, 111, 0.15)',
        chatBox:
          '0px 1px 3px rgba(0, 0, 0, 0.1), 0px 1px 2px -1px rgba(0, 0, 0, 0.1)',
        cardAction:
          '0 0 0 1px #8898aa1a, 0 15px 35px #31315d1a, 0 5px 15px #00000014',
        chat: '0px 1px 2px rgba(0, 0, 0, 0.08)',
        box: '0 10px 15px -3px rgb(0 0 0 / 0.05), 0 4px 6px -4px rgb(0 0 0 / 0.05)',
        promptSuggestion: '0px 2px 6px rgba(59, 74, 92, 0.1)',
        avatar: '0px 1px 2px rgba(0, 0, 0, 0.12)',
        shopLogo: '2px 4px 16px rgba(0, 0, 0, 0.08)',
        shopTransferCard: '0px 2px 6px 0px rgba(75, 85, 99, 0.04)',
        shopTransferTable: '0px 2px 4px 0px rgba(75, 85, 99, 0.05)',
      },
      dropShadow: {
        shopLogo: '2px 4px 16px rgba(0, 0, 0, 0.08)',
      },
      gridTemplateColumns: {
        fit: 'repeat(auto-fit, minmax(0, 1fr))',
      },
      fontSize: {
        ...v3FontSize,
        h1: 'var(--h1)',
        h2: 'var(--h2)',
        h3: 'var(--h3)',
        h4: 'var(--h4)',
        h5: 'var(--h5)',
        h6: 'var(--h6)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('@tailwindcss/forms'),
    // tailwindcss-rtl no carga en la v4: ms-/me-/ps-/pe-/start-/end- son nativas (US-86).
  ],
};

/**
 * Centralized Table Theme & Configuration for vInfiSSO
 * Defines common design tokens, contrast ratios, and responsive styling
 * for all data tables across Light Mode and Dark Mode.
 */

export const TABLE_CONFIG = {
  // Density and sizing
  headHeight: '48px',
  rowMinHeight: '52px',
  fontSize: '13.5px',
  headFontSize: '12.5px',

  // Pagination defaults
  defaultPerPage: 15,
  rowsPerPageOptions: [10, 15, 25, 50, 100],

  // Color Tokens for Light Mode and Dark Mode
  themes: {
    light: {
      name: 'vinfiLight',
      tableBg: '#ffffff',
      containerBorder: '#e2e8f0', // Slate-200
      
      // Header styling
      headBg: '#f1f5f9', // Slate-100: distinct header contrast
      headText: '#1e293b', // Slate-800
      headBorder: '#cbd5e1', // Slate-300: crisp separation line

      // Row styling
      rowBg: '#ffffff',
      rowStripedBg: '#f8fafc', // Slate-50: subtle zebra striping
      rowText: '#0f172a', // Slate-900: strong legible text
      rowBorder: '#e2e8f0', // Slate-200: clearly delineated rows

      // HOVER STATE (High-visibility: never pale/washed out)
      hoverBg: '#e0f2fe', // Sky-100: crystal clear, noticeable highlight
      hoverText: '#0369a1', // Sky-800
      hoverBorder: '#38bdf8', // Sky-400: sharp border outline
      hoverBoxShadow: 'inset 3px 0 0 #0284c7', // Distinctive left accent indicator

      // SELECTED STATE
      selectedBg: '#bae6fd', // Sky-200
      selectedText: '#0369a1',
      selectedBorder: '#0284c7',

      // Context action bar
      contextBg: '#0284c7',
      contextText: '#ffffff',

      // Pagination
      paginationBg: '#f8fafc',
      paginationText: '#475569',
      paginationBorder: '#e2e8f0',
      pageButtonHover: 'rgba(2, 132, 199, 0.12)',

      // Mobile Card view
      cardBg: '#ffffff',
      cardBorder: '#e2e8f0',
      cardSubBg: '#f8fafc',
      cardShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
      cardHoverBorder: '#38bdf8',

      // Toolbar
      toolbarBg: '#f8fafc',
      toolbarBorder: '#e2e8f0',
    },

    dark: {
      name: 'vinfiDark',
      tableBg: '#0f172a',
      containerBorder: 'rgba(255, 255, 255, 0.08)',

      // Header styling
      headBg: '#1e293b', // Slate-800
      headText: '#f1f5f9',
      headBorder: 'rgba(255, 255, 255, 0.10)',

      // Row styling
      rowBg: '#0f172a',
      rowStripedBg: '#131e36',
      rowText: '#f8fafc',
      rowBorder: 'rgba(255, 255, 255, 0.06)',

      // HOVER STATE (Cyan glow: never blind/white)
      hoverBg: 'rgba(56, 189, 248, 0.15)', // Sky-400 translucent glow
      hoverText: '#ffffff',
      hoverBorder: 'rgba(56, 189, 248, 0.40)',
      hoverBoxShadow: 'inset 3px 0 0 #38bdf8', // Distinctive left accent indicator

      // SELECTED STATE
      selectedBg: 'rgba(6, 182, 212, 0.22)',
      selectedText: '#38bdf8',
      selectedBorder: '#06b6d4',

      // Context action bar
      contextBg: '#0891b2',
      contextText: '#ffffff',

      // Pagination
      paginationBg: '#0f172a',
      paginationText: '#94a3b8',
      paginationBorder: 'rgba(255, 255, 255, 0.08)',
      pageButtonHover: 'rgba(56, 189, 248, 0.15)',

      // Mobile Card view
      cardBg: '#1e293b',
      cardBorder: 'rgba(255, 255, 255, 0.08)',
      cardSubBg: 'rgba(0, 0, 0, 0.25)',
      cardShadow: 'none',
      cardHoverBorder: '#06b6d4',

      // Toolbar
      toolbarBg: '#131d31',
      toolbarBorder: 'rgba(255, 255, 255, 0.08)',
    },
  },
};

/**
 * Returns the theme tokens for the specified mode
 */
export function getTableTheme(isDarkMode = true) {
  return isDarkMode ? TABLE_CONFIG.themes.dark : TABLE_CONFIG.themes.light;
}

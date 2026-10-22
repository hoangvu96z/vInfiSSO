import { createTheme } from 'react-data-table-component';
import { TABLE_CONFIG } from '../../config/tableTheme';

// Register the light and dark react-data-table-component themes once on import.
createTheme(TABLE_CONFIG.themes.dark.name, {
  text: {
    primary: TABLE_CONFIG.themes.dark.rowText,
    secondary: TABLE_CONFIG.themes.dark.paginationText,
  },
  background: {
    default: TABLE_CONFIG.themes.dark.tableBg,
  },
  context: {
    background: TABLE_CONFIG.themes.dark.contextBg,
    text: TABLE_CONFIG.themes.dark.contextText,
  },
  divider: {
    default: TABLE_CONFIG.themes.dark.rowBorder,
  },
  button: {
    default: '#38bdf8',
    hover: TABLE_CONFIG.themes.dark.pageButtonHover,
    focus: 'rgba(56, 189, 248, 0.25)',
    disabled: 'rgba(255, 255, 255, 0.2)',
  },
  sortFocus: {
    default: '#38bdf8',
  },
  highlightOnHover: {
    default: TABLE_CONFIG.themes.dark.hoverBg,
    text: TABLE_CONFIG.themes.dark.hoverText,
  },
  selected: {
    default: TABLE_CONFIG.themes.dark.selectedBg,
    text: TABLE_CONFIG.themes.dark.selectedText,
  },
  striped: {
    default: TABLE_CONFIG.themes.dark.rowStripedBg,
    text: TABLE_CONFIG.themes.dark.rowText,
  },
}, 'dark');

createTheme(TABLE_CONFIG.themes.light.name, {
  text: {
    primary: TABLE_CONFIG.themes.light.rowText,
    secondary: TABLE_CONFIG.themes.light.paginationText,
  },
  background: {
    default: TABLE_CONFIG.themes.light.tableBg,
  },
  context: {
    background: TABLE_CONFIG.themes.light.contextBg,
    text: TABLE_CONFIG.themes.light.contextText,
  },
  divider: {
    default: TABLE_CONFIG.themes.light.rowBorder,
  },
  button: {
    default: '#0284c7',
    hover: TABLE_CONFIG.themes.light.pageButtonHover,
    focus: 'rgba(2, 132, 199, 0.2)',
    disabled: 'rgba(0, 0, 0, 0.2)',
  },
  sortFocus: {
    default: '#0284c7',
  },
  highlightOnHover: {
    default: TABLE_CONFIG.themes.light.hoverBg,
    text: TABLE_CONFIG.themes.light.hoverText,
  },
  selected: {
    default: TABLE_CONFIG.themes.light.selectedBg,
    text: TABLE_CONFIG.themes.light.selectedText,
  },
  striped: {
    default: TABLE_CONFIG.themes.light.rowStripedBg,
    text: TABLE_CONFIG.themes.light.rowText,
  },
}, 'light');

export function buildCustomStyles(t, isDarkMode) {
  return {
    table: {
      style: {
        backgroundColor: 'transparent',
      },
    },
    tableWrapper: {
      style: {
        display: 'table',
        width: '100%',
      },
    },
    headRow: {
      style: {
        backgroundColor: t.headBg,
        borderTopLeftRadius: '8px',
        borderTopRightRadius: '8px',
        borderBottomWidth: '2px',
        borderBottomColor: t.headBorder,
        minHeight: TABLE_CONFIG.headHeight,
      },
    },
    headCells: {
      style: {
        color: t.headText,
        fontSize: TABLE_CONFIG.headFontSize,
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        paddingLeft: '14px',
        paddingRight: '14px',
      },
    },
    rows: {
      style: {
        backgroundColor: t.rowBg,
        color: t.rowText,
        borderBottomWidth: '1px',
        borderBottomColor: t.rowBorder,
        minHeight: TABLE_CONFIG.rowMinHeight,
        fontSize: TABLE_CONFIG.fontSize,
        transition: 'background-color 0.15s ease, box-shadow 0.15s ease',
        '&:hover': {
          backgroundColor: `${t.hoverBg} !important`,
          color: `${t.hoverText} !important`,
          boxShadow: t.hoverBoxShadow,
        },
      },
      highlightOnHoverStyle: {
        backgroundColor: `${t.hoverBg} !important`,
        color: `${t.hoverText} !important`,
        borderBottomColor: t.hoverBorder,
        outline: `1px solid ${t.hoverBorder} !important`,
        boxShadow: t.hoverBoxShadow,
      },
    },
    contextMenu: {
      style: {
        backgroundColor: t.contextBg,
        color: t.contextText,
        fontSize: '13px',
        fontWeight: '600',
        borderRadius: '8px 8px 0 0',
      },
    },
    pagination: {
      style: {
        backgroundColor: t.paginationBg,
        color: t.paginationText,
        borderTopWidth: '1px',
        borderTopColor: t.paginationBorder,
        fontSize: '12.5px',
        minHeight: '48px',
      },
      pageButtonsStyle: {
        borderRadius: '50%',
        height: '32px',
        width: '32px',
        padding: '6px',
        margin: '2px',
        cursor: 'pointer',
        transition: '0.2s',
        color: t.paginationText,
        fill: t.paginationText,
        backgroundColor: 'transparent',
        '&:disabled': {
          cursor: 'unset',
          color: isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
          fill: isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
        },
        '&:hover:not(:disabled)': {
          backgroundColor: t.pageButtonHover,
        },
      },
    },
    subHeader: {
      style: {
        padding: 0,
        backgroundColor: 'transparent',
        marginBottom: '12px',
      },
    },
  };
}

export const paginationComponentOptions = {
  rowsPerPageText: 'Dòng / trang:',
  rangeSeparatorText: 'trên',
  selectAllRowsItem: true,
  selectAllRowsItemText: 'Tất cả',
};

export const contextMessage = {
  singular: 'dòng',
  plural: 'dòng',
  message: 'đã chọn',
};

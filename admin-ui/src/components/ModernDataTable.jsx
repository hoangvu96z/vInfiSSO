import React, { useMemo } from 'react';
import DataTable, { createTheme } from 'react-data-table-component';
import { Spin } from 'antd';

// Register custom dark theme for react-data-table-component
createTheme('vinfiDark', {
  text: {
    primary: '#f1f5f9',
    secondary: '#94a3b8',
  },
  background: {
    default: 'transparent',
  },
  context: {
    background: '#0891b2',
    text: '#ffffff',
  },
  divider: {
    default: 'rgba(255, 255, 255, 0.07)',
  },
  button: {
    default: '#38bdf8',
    hover: 'rgba(56, 189, 248, 0.15)',
    focus: 'rgba(56, 189, 248, 0.25)',
    disabled: 'rgba(255, 255, 255, 0.2)',
  },
  sortFocus: {
    default: '#38bdf8',
  },
}, 'dark');

createTheme('vinfiLight', {
  text: {
    primary: '#0f172a',
    secondary: '#64748b',
  },
  background: {
    default: 'transparent',
  },
  context: {
    background: '#0284c7',
    text: '#ffffff',
  },
  divider: {
    default: 'rgba(0, 0, 0, 0.06)',
  },
  button: {
    default: '#0284c7',
    hover: 'rgba(2, 132, 199, 0.1)',
    focus: 'rgba(2, 132, 199, 0.2)',
    disabled: 'rgba(0, 0, 0, 0.2)',
  },
  sortFocus: {
    default: '#0284c7',
  },
}, 'light');

export default function ModernDataTable({
  columns = [],
  data = [],
  loading = false,
  isDarkMode = true,
  selectableRows = false,
  onSelectedRowsChange,
  clearSelectedRows = false,
  contextActions,
  subHeader,
  subHeaderComponent,
  pagination = true,
  paginationPerPage = 15,
  paginationRowsPerPageOptions = [10, 15, 25, 50, 100],
  noDataText = 'Không tìm thấy dữ liệu phù hợp',
  ...rest
}) {
  const customStyles = useMemo(() => ({
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
        backgroundColor: isDarkMode ? '#1e293b' : '#f1f5f9',
        borderTopLeftRadius: '8px',
        borderTopRightRadius: '8px',
        borderBottomWidth: '1.5px',
        borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
        minHeight: '46px',
      },
    },
    headCells: {
      style: {
        color: isDarkMode ? '#e2e8f0' : '#1e293b',
        fontSize: '12.5px',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        paddingLeft: '14px',
        paddingRight: '14px',
      },
    },
    rows: {
      style: {
        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
        color: isDarkMode ? '#f8fafc' : '#0f172a',
        borderBottomWidth: '1px',
        borderBottomColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
        minHeight: '52px',
        fontSize: '13.5px',
        transition: 'background-color 0.15s ease',
        '&:hover': {
          backgroundColor: isDarkMode ? 'rgba(6, 182, 212, 0.08) !important' : 'rgba(6, 182, 212, 0.05) !important',
        },
      },
      highlightOnHoverStyle: {
        backgroundColor: isDarkMode ? 'rgba(6, 182, 212, 0.08)' : 'rgba(6, 182, 212, 0.05)',
        borderBottomColor: isDarkMode ? 'rgba(6, 182, 212, 0.2)' : 'rgba(6, 182, 212, 0.2)',
        outline: isDarkMode ? '1px solid rgba(6, 182, 212, 0.25)' : '1px solid rgba(6, 182, 212, 0.2)',
      },
    },
    contextMenu: {
      style: {
        backgroundColor: isDarkMode ? '#0891b2' : '#0284c7',
        color: '#ffffff',
        fontSize: '13px',
        fontWeight: '600',
        borderRadius: '8px 8px 0 0',
      },
    },
    pagination: {
      style: {
        backgroundColor: isDarkMode ? '#0f172a' : '#ffffff',
        color: isDarkMode ? '#94a3b8' : '#64748b',
        borderTopWidth: '1px',
        borderTopColor: isDarkMode ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.07)',
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
        color: isDarkMode ? '#94a3b8' : '#64748b',
        fill: isDarkMode ? '#94a3b8' : '#64748b',
        backgroundColor: 'transparent',
        '&:disabled': {
          cursor: 'unset',
          color: isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
          fill: isDarkMode ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.2)',
        },
        '&:hover:not(:disabled)': {
          backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
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
  }), [isDarkMode]);

  const paginationComponentOptions = useMemo(() => ({
    rowsPerPageText: 'Dòng / trang:',
    rangeSeparatorText: 'trên',
    selectAllRowsItem: true,
    selectAllRowsItemText: 'Tất cả',
  }), []);

  const contextMessage = useMemo(() => ({
    singular: 'dòng',
    plural: 'dòng',
    message: 'đã chọn',
  }), []);

  return (
    <div
      className="modern-datatable-wrapper"
      style={{
        border: `1px solid ${isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'}`,
        borderRadius: 10,
        overflow: 'hidden',
        background: isDarkMode ? '#0f172a' : '#ffffff',
      }}
    >
      <style>{`
        .modern-datatable-wrapper input[type="checkbox"] {
          accent-color: #06b6d4 !important;
          width: 16px !important;
          height: 16px !important;
          cursor: pointer !important;
          border-radius: 4px;
        }
        .modern-datatable-wrapper .rdt_TableHeadRow {
          border-bottom: 1.5px solid ${isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'} !important;
        }
        .modern-datatable-wrapper .rdt_TableRow {
          border-bottom: 1px solid ${isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'} !important;
        }
      `}</style>
      <DataTable
        columns={columns}
        data={data}
        theme={isDarkMode ? 'vinfiDark' : 'vinfiLight'}
        customStyles={customStyles}
        pagination={pagination}
        paginationPerPage={paginationPerPage}
        paginationRowsPerPageOptions={paginationRowsPerPageOptions}
        paginationComponentOptions={paginationComponentOptions}
        selectableRows={selectableRows}
        onSelectedRowsChange={onSelectedRowsChange}
        clearSelectedRows={clearSelectedRows}
        contextActions={contextActions}
        contextMessage={contextMessage}
        subHeader={subHeader}
        subHeaderComponent={subHeaderComponent}
        progressPending={loading}
        progressComponent={
          <div style={{ padding: '36px 0', textAlign: 'center' }}>
            <Spin tip="Đang tải dữ liệu..." />
          </div>
        }
        noDataComponent={
          <div style={{ padding: '36px 0', textAlign: 'center', color: isDarkMode ? '#64748b' : '#94a3b8' }}>
            {noDataText}
          </div>
        }
        highlightOnHover
        pointerOnHover
        responsive
        {...rest}
      />
    </div>
  );
}

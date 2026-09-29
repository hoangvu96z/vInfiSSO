import React, { useMemo, useState, useEffect, useCallback } from 'react';
import DataTable, { createTheme } from 'react-data-table-component';
import { Spin, Button, Segmented, Space, Tag } from 'antd';
import { TableOutlined, AppstoreOutlined } from '@ant-design/icons';
import { TABLE_CONFIG, getTableTheme } from '../config/tableTheme';

// Register custom themes for react-data-table-component using common design tokens
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

/**
 * Fallback Card Renderer for any table when renderMobileCard is not passed
 */
function AutoMobileCard({ row, columns, isDarkMode }) {
  const t = getTableTheme(isDarkMode);
  const visibleCols = (columns || []).filter(
    (c) => c.name && !['thao tác', 'action', 'chọn', ''].includes(c.name.trim().toLowerCase())
  );
  const actionCol = (columns || []).find((c) =>
    ['thao tác', 'action'].includes((c.name || '').trim().toLowerCase())
  );

  const primaryCol = visibleCols[0];
  const secondaryCol = visibleCols[1];
  const otherCols = visibleCols.slice(2);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {primaryCol && (
            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: t.rowText }}>
              {primaryCol.cell
                ? primaryCol.cell(row)
                : primaryCol.selector
                ? primaryCol.selector(row)
                : row[primaryCol.field]}
            </div>
          )}
          {secondaryCol && (
            <div>
              {secondaryCol.cell
                ? secondaryCol.cell(row)
                : secondaryCol.selector
                ? secondaryCol.selector(row)
                : row[secondaryCol.field]}
            </div>
          )}
        </div>
        {actionCol && (
          <div onClick={(e) => e.stopPropagation()}>
            {actionCol.cell ? actionCol.cell(row) : null}
          </div>
        )}
      </div>

      {otherCols.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 6,
            fontSize: '0.82rem',
            background: t.cardSubBg,
            border: `1px solid ${t.rowBorder}`,
            padding: '8px 10px',
            borderRadius: 6,
          }}
        >
          {otherCols.map((col, idx) => (
            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: '0.7rem', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.02em', color: t.paginationText }}>
                {col.name}
              </span>
              <div style={{ fontWeight: 500, wordBreak: 'break-word', color: t.rowText }}>
                {col.cell ? col.cell(row) : col.selector ? col.selector(row) : row[col.field]}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  paginationPerPage = TABLE_CONFIG.defaultPerPage,
  paginationRowsPerPageOptions = TABLE_CONFIG.rowsPerPageOptions,
  paginationServer = false,
  paginationTotalRows,
  onChangePage,
  noDataText = 'Không tìm thấy dữ liệu phù hợp',
  keyField = 'id',
  renderMobileCard,
  showViewToggle = true,
  defaultViewMode, // 'auto' | 'card' | 'table'
  ...rest
}) {
  const t = useMemo(() => getTableTheme(isDarkMode), [isDarkMode]);

  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  const [viewMode, setViewMode] = useState(() => {
    if (defaultViewMode) return defaultViewMode;
    return typeof window !== 'undefined' && window.innerWidth < 768 ? 'card' : 'table';
  });

  const [selectedRowKeys, setSelectedRowKeys] = useState(new Set());
  const [cardPage, setCardPage] = useState(1);

  // Monitor resize for mobile state
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Clear selection if parent demands it
  useEffect(() => {
    if (clearSelectedRows) {
      setSelectedRowKeys(new Set());
    }
  }, [clearSelectedRows]);

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
  }), [isDarkMode, t]);

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

  // Selection handlers
  const handleDataTableSelection = useCallback((state) => {
    const keys = new Set((state.selectedRows || []).map((r) => r[keyField] ?? r.id));
    setSelectedRowKeys(keys);
    onSelectedRowsChange?.(state);
  }, [keyField, onSelectedRowsChange]);

  const toggleRow = useCallback((row) => {
    const key = row[keyField] ?? row.id;
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      const selectedRows = data.filter((r) => next.has(r[keyField] ?? r.id));
      onSelectedRowsChange?.({
        allSelected: selectedRows.length === data.length && data.length > 0,
        selectedCount: selectedRows.length,
        selectedRows,
      });
      return next;
    });
  }, [data, keyField, onSelectedRowsChange]);

  // Card view pagination calculations
  const perPage = paginationPerPage || TABLE_CONFIG.defaultPerPage;
  const totalCount = paginationServer ? (paginationTotalRows || 0) : data.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const cardDisplayData = paginationServer
    ? data
    : data.slice((cardPage - 1) * perPage, cardPage * perPage);

  const handleCardPageChange = (newPage) => {
    setCardPage(newPage);
    if (onChangePage) {
      onChangePage(newPage, totalCount);
    }
  };

  const isAllCardPageSelected =
    cardDisplayData.length > 0 &&
    cardDisplayData.every((r) => selectedRowKeys.has(r[keyField] ?? r.id));

  const toggleSelectAllCardPage = () => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (isAllCardPageSelected) {
        cardDisplayData.forEach((r) => next.delete(r[keyField] ?? r.id));
      } else {
        cardDisplayData.forEach((r) => next.add(r[keyField] ?? r.id));
      }
      const selectedRows = data.filter((r) => next.has(r[keyField] ?? r.id));
      onSelectedRowsChange?.({
        allSelected: selectedRows.length === data.length && data.length > 0,
        selectedCount: selectedRows.length,
        selectedRows,
      });
      return next;
    });
  };

  return (
    <div
      className="modern-datatable-wrapper"
      style={{
        border: `1px solid ${t.containerBorder}`,
        borderRadius: 10,
        overflow: 'hidden',
        background: t.tableBg,
      }}
    >
      <style>{`
        /* Force CSS variables in react-data-table-component v8 */
        .modern-datatable-wrapper {
          --rdt-color-bg: ${t.tableBg} !important;
          --rdt-color-text-primary: ${t.rowText} !important;
          --rdt-color-highlight: ${t.hoverBg} !important;
          --rdt-color-highlight-text: ${t.hoverText} !important;
          --rdt-color-selected: ${t.selectedBg} !important;
          --rdt-color-selected-text: ${t.selectedText} !important;
          --rdt-color-divider: ${t.rowBorder} !important;
        }

        .modern-datatable-wrapper input[type="checkbox"] {
          accent-color: #0284c7 !important;
          width: 16px !important;
          height: 16px !important;
          cursor: pointer !important;
          border-radius: 4px;
        }

        .modern-datatable-wrapper .rdt_TableHeadRow,
        .modern-datatable-wrapper .rdt_headRow {
          border-bottom: 2px solid ${t.headBorder} !important;
          background-color: ${t.headBg} !important;
        }

        .modern-datatable-wrapper .rdt_TableRow,
        .modern-datatable-wrapper .rdt_row {
          border-bottom: 1px solid ${t.rowBorder} !important;
          background-color: ${t.rowBg} !important;
          color: ${t.rowText} !important;
          transition: background-color 0.15s ease, box-shadow 0.15s ease, outline 0.15s ease !important;
        }

        /* Zebra striping for enhanced table readability */
        .modern-datatable-wrapper .rdt_TableRow:nth-child(even),
        .modern-datatable-wrapper .rdt_row:nth-child(even) {
          background-color: ${t.rowStripedBg} !important;
        }

        /* CRITICAL HOVER FIX: High-contrast, clear, visible hover in both Light & Dark modes */
        .modern-datatable-wrapper .rdt_rowHighlight:hover,
        .modern-datatable-wrapper .rdt_TableRow:hover,
        .modern-datatable-wrapper .rdt_row:hover {
          background-color: ${t.hoverBg} !important;
          color: ${t.hoverText} !important;
          outline: 1px solid ${t.hoverBorder} !important;
          box-shadow: ${t.hoverBoxShadow} !important;
          z-index: 2;
        }

        /* SELECTED ROW STATE */
        .modern-datatable-wrapper .rdt_rowSelected,
        .modern-datatable-wrapper .rdt_TableRow.selected,
        .modern-datatable-wrapper .rdt_row.selected {
          background-color: ${t.selectedBg} !important;
          color: ${t.selectedText} !important;
          outline: 1px solid ${t.selectedBorder} !important;
          box-shadow: inset 3px 0 0 ${t.selectedBorder} !important;
        }

        /* Touch & scroll styling for mobile tables */
        .modern-datatable-wrapper .rdt_responsiveWrapper,
        .modern-datatable-wrapper .rdt_responsiveWrapperScroll {
          -webkit-overflow-scrolling: touch !important;
        }

        .modern-datatable-wrapper ::-webkit-scrollbar {
          height: 6px;
          width: 6px;
        }
        .modern-datatable-wrapper ::-webkit-scrollbar-track {
          background: ${isDarkMode ? '#0b1120' : '#f1f5f9'};
        }
        .modern-datatable-wrapper ::-webkit-scrollbar-thumb {
          background: ${isDarkMode ? '#334155' : '#cbd5e1'};
          border-radius: 4px;
        }
        .modern-datatable-wrapper ::-webkit-scrollbar-thumb:hover {
          background: ${isDarkMode ? '#475569' : '#94a3b8'};
        }
      `}</style>

      {/* TOP TOOLBAR: VIEW SWITCHER & QUICK CONTEXT ACTIONS */}
      {showViewToggle && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            background: t.toolbarBg,
            borderBottom: `1px solid ${t.toolbarBorder}`,
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {viewMode === 'card' && selectableRows && (
              <Button size="small" onClick={toggleSelectAllCardPage} style={{ fontSize: '0.78rem' }}>
                {isAllCardPageSelected ? 'Bỏ chọn trang' : `Chọn tất cả (${cardDisplayData.length})`}
              </Button>
            )}

            {selectedRowKeys.size > 0 && (
              <Space size="small" align="center">
                <Tag color="cyan">Đã chọn {selectedRowKeys.size} dòng</Tag>
                {contextActions}
              </Space>
            )}

            {viewMode === 'table' && isMobile && (
              <span style={{ fontSize: '0.75rem', color: isDarkMode ? '#38bdf8' : '#0284c7', opacity: 0.9 }}>
                👉 Vuốt ngang để xem đủ cột
              </span>
            )}
          </div>

          <Segmented
            size="small"
            value={viewMode}
            onChange={(val) => setViewMode(val)}
            options={[
              {
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
                    <AppstoreOutlined /> Thẻ
                  </span>
                ),
                value: 'card',
              },
              {
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}>
                    <TableOutlined /> Bảng
                  </span>
                ),
                value: 'table',
              },
            ]}
          />
        </div>
      )}

      {/* RENDER VIEW: CARD MODE VS TABLE MODE */}
      {viewMode === 'card' ? (
        <div>
          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center' }}>
              <Spin tip="Đang tải dữ liệu..." />
            </div>
          ) : cardDisplayData.length === 0 ? (
            <div
              style={{
                padding: '36px 0',
                textAlign: 'center',
                color: t.paginationText,
              }}
            >
              {noDataText}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
              {cardDisplayData.map((row, index) => {
                const key = row[keyField] ?? row.id ?? index;
                const isSelected = selectedRowKeys.has(key);

                return (
                  <div
                    key={key}
                    onClick={() => {
                      if (selectableRows) toggleRow(row);
                    }}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: isSelected
                        ? t.selectedBg
                        : t.cardBg,
                      border: isSelected
                        ? `1.5px solid ${t.selectedBorder}`
                        : `1px solid ${t.cardBorder}`,
                      boxShadow: isSelected
                        ? (isDarkMode ? '0 0 12px rgba(6, 182, 212, 0.25)' : '0 0 8px rgba(2, 132, 199, 0.2)')
                        : t.cardShadow,
                      cursor: selectableRows ? 'pointer' : 'default',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      {selectableRows && (
                        <div style={{ paddingTop: 3 }} onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(row)}
                            style={{
                              accentColor: isDarkMode ? '#06b6d4' : '#0284c7',
                              width: 17,
                              height: 17,
                              cursor: 'pointer',
                            }}
                          />
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {renderMobileCard ? (
                          renderMobileCard(row, {
                            isSelected,
                            toggleRow: () => toggleRow(row),
                            index,
                          })
                        ) : (
                          <AutoMobileCard row={row} columns={columns} isDarkMode={isDarkMode} />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* CARD VIEW PAGINATION */}
          {pagination && totalCount > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 14px',
                borderTop: `1px solid ${t.paginationBorder}`,
                background: t.paginationBg,
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <span style={{ fontSize: '0.78rem', opacity: 0.7, color: t.paginationText }}>
                Hiển thị {(cardPage - 1) * perPage + 1} -{' '}
                {Math.min(cardPage * perPage, totalCount)} trên {totalCount}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Button
                  size="small"
                  disabled={cardPage <= 1 || loading}
                  onClick={() => handleCardPageChange(cardPage - 1)}
                >
                  ← Trước
                </Button>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, padding: '0 4px', color: t.rowText }}>
                  {cardPage} / {totalPages}
                </span>
                <Button
                  size="small"
                  disabled={cardPage >= totalPages || loading}
                  onClick={() => handleCardPageChange(cardPage + 1)}
                >
                  Sau →
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* TABLE MODE */
        <DataTable
          columns={columns}
          data={data}
          theme={isDarkMode ? TABLE_CONFIG.themes.dark.name : TABLE_CONFIG.themes.light.name}
          customStyles={customStyles}
          pagination={pagination}
          paginationPerPage={paginationPerPage}
          paginationRowsPerPageOptions={paginationRowsPerPageOptions}
          paginationComponentOptions={paginationComponentOptions}
          paginationServer={paginationServer}
          paginationTotalRows={paginationTotalRows}
          onChangePage={onChangePage}
          selectableRows={selectableRows}
          onSelectedRowsChange={handleDataTableSelection}
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
            <div
              style={{
                padding: '36px 0',
                textAlign: 'center',
                color: t.paginationText,
              }}
            >
              {noDataText}
            </div>
          }
          highlightOnHover
          pointerOnHover
          responsive
          keyField={keyField}
          {...rest}
        />
      )}
    </div>
  );
}

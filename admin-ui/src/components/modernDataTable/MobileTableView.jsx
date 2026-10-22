import React from 'react';
import { Button, Spin } from 'antd';
import AutoMobileCard from './AutoMobileCard';

export default function MobileTableView({
  loading,
  cardDisplayData,
  noDataText,
  t,
  renderMobileCard,
  columns,
  isDarkMode,
  selectedRowKeys,
  keyField,
  selectableRows,
  toggleRow,
  pagination,
  totalCount,
  cardPage,
  perPage,
  totalPages,
  handleCardPageChange,
}) {
  return (
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
  );
}

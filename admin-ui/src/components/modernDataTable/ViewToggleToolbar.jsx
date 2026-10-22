import React from 'react';
import { Button, Segmented, Space, Tag } from 'antd';
import { AppstoreOutlined, TableOutlined } from '@ant-design/icons';

export default function ViewToggleToolbar({
  showViewToggle,
  t,
  viewMode,
  setViewMode,
  selectableRows,
  toggleSelectAllCardPage,
  isAllCardPageSelected,
  cardDisplayData,
  selectedRowKeys,
  contextActions,
  isMobile,
  isDarkMode,
}) {
  if (!showViewToggle) return null;

  return (
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
  );
}

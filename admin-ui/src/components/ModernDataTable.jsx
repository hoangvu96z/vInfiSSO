import React, { useMemo, useState, useEffect, useCallback } from 'react';
import DataTable from 'react-data-table-component';
import { Spin } from 'antd';
import { TABLE_CONFIG, getTableTheme } from '../config/tableTheme';
import {
  buildCustomStyles,
  contextMessage,
  paginationComponentOptions,
} from './modernDataTable/tableThemes';
import MobileTableView from './modernDataTable/MobileTableView';
import ScopedTableStyles from './modernDataTable/ScopedTableStyles';
import ViewToggleToolbar from './modernDataTable/ViewToggleToolbar';

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
  paginationPage = 1,
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

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (clearSelectedRows) {
      setSelectedRowKeys(new Set());
    }
  }, [clearSelectedRows]);

  useEffect(() => {
    if (paginationServer) setCardPage(paginationPage);
  }, [paginationPage, paginationServer]);

  const customStyles = useMemo(() => buildCustomStyles(t, isDarkMode), [isDarkMode, t]);

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

  const perPage = paginationPerPage || TABLE_CONFIG.defaultPerPage;
  const totalCount = paginationServer ? (paginationTotalRows || 0) : data.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
  const currentPage = paginationServer ? paginationPage : cardPage;
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
      <ScopedTableStyles t={t} isDarkMode={isDarkMode} />

      <ViewToggleToolbar
        showViewToggle={showViewToggle}
        t={t}
        viewMode={viewMode}
        setViewMode={setViewMode}
        selectableRows={selectableRows}
        toggleSelectAllCardPage={toggleSelectAllCardPage}
        isAllCardPageSelected={isAllCardPageSelected}
        cardDisplayData={cardDisplayData}
        selectedRowKeys={selectedRowKeys}
        contextActions={contextActions}
        isMobile={isMobile}
        isDarkMode={isDarkMode}
      />

      {viewMode === 'card' ? (
        <MobileTableView
          loading={loading}
          cardDisplayData={cardDisplayData}
          noDataText={noDataText}
          t={t}
          renderMobileCard={renderMobileCard}
          columns={columns}
          isDarkMode={isDarkMode}
          selectedRowKeys={selectedRowKeys}
          keyField={keyField}
          selectableRows={selectableRows}
          toggleRow={toggleRow}
          pagination={pagination}
          totalCount={totalCount}
          cardPage={currentPage}
          perPage={perPage}
          totalPages={totalPages}
          handleCardPageChange={handleCardPageChange}
        />
      ) : (
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
          paginationDefaultPage={paginationPage}
          paginationResetDefaultPage={paginationServer && paginationPage === 1}
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

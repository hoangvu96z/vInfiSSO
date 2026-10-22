import React from 'react';

export default function ScopedTableStyles({ t, isDarkMode }) {
  return (
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
  );
}

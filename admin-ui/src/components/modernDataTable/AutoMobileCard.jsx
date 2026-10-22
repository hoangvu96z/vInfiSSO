import React from 'react';
import { getTableTheme } from '../../config/tableTheme';

/** Fallback card renderer used when a table does not provide renderMobileCard. */
export default function AutoMobileCard({ row, columns, isDarkMode }) {
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

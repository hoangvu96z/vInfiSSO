function csvCell(value) {
  const text = value == null ? '' : String(value);
  const safeText = /^[\s]*[=+@\-\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function serializeCsv(rows, columns) {
  const header = columns.map((column) => csvCell(column.label)).join(',');
  const body = rows.map((row) =>
    columns
      .map((column) => csvCell(column.value(row)))
      .join(','),
  );
  return `\uFEFF${[header, ...body].join('\r\n')}`;
}

export function downloadCsv(rows, columns, fileName) {
  if (!rows.length) return false;
  const blob = new Blob([serializeCsv(rows, columns)], {
    type: 'text/csv;charset=utf-8',
  });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = `${fileName}.csv`;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
  return true;
}

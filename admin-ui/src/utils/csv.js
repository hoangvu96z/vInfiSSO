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

export async function collectPaginatedRows(fetchPage, pageSize = 100) {
  const rows = [];
  const seenIds = new Set();
  let expectedTotal;

  for (let page = 1; expectedTotal === undefined || rows.length < expectedTotal; page += 1) {
    const result = await fetchPage(page, pageSize);
    if (!result || !Array.isArray(result.rows)) {
      throw new TypeError('Paginated export must return a rows array');
    }

    if (expectedTotal === undefined && Number.isFinite(Number(result.total))) {
      expectedTotal = Math.max(0, Number(result.total));
    }
    if (result.rows.length === 0) break;

    for (const row of result.rows) {
      const id = row?.id ?? row?.userId;
      if (id == null) {
        throw new TypeError('Paginated export rows must include an id or userId');
      }

      const key = String(id);
      if (!seenIds.has(key)) {
        seenIds.add(key);
        rows.push(row);
      }
    }
    if (expectedTotal === undefined && result.rows.length < pageSize) break;
  }

  return rows;
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

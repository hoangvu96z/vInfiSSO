import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPaginatedRows, serializeCsv } from './csv.js';

test('collectPaginatedRows fetches every filtered page until the reported total', async () => {
  const calls = [];
  const rows = await collectPaginatedRows(async (page, limit) => {
    calls.push([page, limit]);
    return page === 1
      ? { rows: [{ id: 1 }, { id: 2 }], total: 5 }
      : page === 2
        ? { rows: [{ id: 3 }, { id: 4 }], total: 5 }
        : { rows: [{ id: 5 }], total: 5 };
  }, 2);

  assert.deepEqual(rows.map((row) => row.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(calls, [[1, 2], [2, 2], [3, 2]]);
});

test('collectPaginatedRows stops when a later page is empty even if totals changed', async () => {
  let calls = 0;
  const rows = await collectPaginatedRows(async () => {
    calls += 1;
    return calls === 1
      ? { rows: [{ id: 1 }], total: 3 }
      : { rows: [], total: 3 };
  }, 1);

  assert.deepEqual(rows, [{ id: 1 }]);
  assert.equal(calls, 2);
});

test('collectPaginatedRows deduplicates overlapping pages by record identity', async () => {
  let calls = 0;
  const rows = await collectPaginatedRows(async () => {
    calls += 1;
    if (calls === 1) {
      return { rows: [{ id: 'a' }, { userId: 'b' }], total: 4 };
    }
    if (calls === 2) {
      return { rows: [{ userId: 'b' }, { userId: 'c' }], total: 4 };
    }
    return { rows: [], total: 4 };
  }, 2);

  assert.deepEqual(rows, [{ id: 'a' }, { userId: 'b' }, { userId: 'c' }]);
  assert.equal(calls, 3);
});

test('collectPaginatedRows rejects rows without a stable identity', async () => {
  await assert.rejects(
    collectPaginatedRows(async () => ({ rows: [{ email: 'member@example.test' }], total: 1 })),
    /must include an id or userId/,
  );
});

test('CSV keeps formula-like values escaped', () => {
  const csv = serializeCsv([{ value: '=1+1' }], [
    { label: 'Value', value: (row) => row.value },
  ]);

  assert.match(csv, /'=1\+1/);
});

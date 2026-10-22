import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuotaStats } from './quotaStats.js';

test('normalizes the quota stats response returned by the admin endpoint', () => {
  assert.deepEqual(normalizeQuotaStats({
    today: '42',
    thisMonth: 830,
    planDistribution: [
      { plan: 'free', count: '12' },
      { plan: 'pro', count: 3 },
    ],
    topUsers: [
      { userId: 'user-1', dailyCount: '9', bonusUsedToday: 2 },
    ],
  }), {
    today: 42,
    thisMonth: 830,
    planDistribution: [
      { plan: 'free', count: 12 },
      { plan: 'pro', count: 3 },
    ],
    topUsers: [
      { userId: 'user-1', dailyCount: 9, bonusUsedToday: 2 },
    ],
  });
});

test('uses safe defaults for missing and malformed quota stats fields', () => {
  assert.deepEqual(normalizeQuotaStats({
    today: null,
    thisMonth: 'not-a-number',
    planDistribution: [{ plan: '', count: -1 }, null],
    topUsers: [{ dailyCount: undefined, bonusUsedToday: 'invalid' }],
  }), {
    today: 0,
    thisMonth: 0,
    planDistribution: [
      { plan: 'unknown', count: 0 },
      { plan: 'unknown', count: 0 },
    ],
    topUsers: [
      { userId: '', dailyCount: 0, bonusUsedToday: 0 },
    ],
  });
  assert.deepEqual(normalizeQuotaStats(null), {
    today: 0,
    thisMonth: 0,
    planDistribution: [],
    topUsers: [],
  });
});

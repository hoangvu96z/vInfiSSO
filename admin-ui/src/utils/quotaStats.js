function toCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

const safeArr = (value) => (Array.isArray(value) ? value : []);

export function normalizeQuotaStats(data) {
  return {
    today: toCount(data?.today),
    thisMonth: toCount(data?.thisMonth),
    planDistribution: safeArr(data?.planDistribution).map((item) => ({
      plan: typeof item?.plan === 'string' && item.plan.trim() ? item.plan : 'unknown',
      count: toCount(item?.count),
    })),
    topUsers: safeArr(data?.topUsers).map((user) => ({
      userId: typeof user?.userId === 'string' ? user.userId : '',
      dailyCount: toCount(user?.dailyCount),
      bonusUsedToday: toCount(user?.bonusUsedToday),
    })),
  };
}

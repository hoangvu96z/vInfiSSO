import { MeOverviewController } from './me-overview.controller';
import { StreakService } from './streak.service';

describe('MeOverviewController', () => {
  it('returns the known app links and streaks scoped to the authenticated user', async () => {
    const getStreak = jest.fn((userId: string, appId: string) =>
      Promise.resolve({
        ownerId: userId,
        streak:
          appId === 'tarot'
            ? {
                currentStreak: 3,
                longestStreak: 5,
                totalReadings: 8,
                lastActiveDate: '2026-10-22',
                streakFreezeUsed: false,
                dailyCardDate: '2026-10-22',
                dailyCardId: 17,
              }
            : null,
      }),
    );
    const streakService = { get: getStreak } as unknown as StreakService;
    const controller = new MeOverviewController(streakService);

    const result = await controller.getOverview({ id: 'user-a' } as never);

    expect(getStreak).toHaveBeenCalledTimes(3);
    expect(getStreak).toHaveBeenCalledWith('user-a', 'iching');
    expect(getStreak).toHaveBeenCalledWith('user-a', 'tarot');
    expect(getStreak).toHaveBeenCalledWith('user-a', 'tuvi');
    expect(getStreak).not.toHaveBeenCalledWith('user-a', 'talk');
    expect(result.apps).toEqual([
      { id: 'iching', label: 'IChingNow', href: '/kinhdich/', streak: null },
      {
        id: 'tarot',
        label: 'TarotNow',
        href: '/tarot/',
        streak: {
          currentStreak: 3,
          longestStreak: 5,
          totalReadings: 8,
          lastActiveDate: '2026-10-22',
          streakFreezeUsed: false,
          dailyCardDate: '2026-10-22',
          dailyCardId: 17,
        },
      },
      { id: 'tuvi', label: 'TuViNow', href: '/tuvi/', streak: null },
      { id: 'talk', label: 'TalkWithMe', href: '/talk/', streak: null },
      { id: 'note', label: 'NoteNow', href: '/note/', streak: null },
    ]);
    expect(JSON.stringify(result)).not.toContain('user-a');
  });
});

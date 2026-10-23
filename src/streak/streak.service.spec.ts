import { BadRequestException, ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StreakSnapshotDto } from './dto/streak-write.dto';
import { StreakService } from './streak.service';

const ownerId = '00000000-0000-4000-8000-000000000001';

function dateAtUtcOffset(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function snapshot(
  overrides: Partial<StreakSnapshotDto & { ownerId: string }> = {},
): StreakSnapshotDto & { ownerId: string } {
  return {
    ownerId,
    currentStreak: 2,
    longestStreak: 5,
    totalReadings: 10,
    lastActiveDate: '2026-10-22',
    streakFreezeUsed: false,
    dailyCardDate: '2026-10-22',
    dailyCardId: 'major-8',
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    current_streak: 2,
    longest_streak: 5,
    total_readings: 10,
    last_active_date: '2026-10-22',
    streak_freeze_used: false,
    daily_card_date: '2026-10-22',
    daily_card_id: 'major-8',
    ...overrides,
  };
}

describe('StreakService', () => {
  it('rejects writes whose declared owner differs from the authenticated user', async () => {
    const query = jest.fn();
    const service = new StreakService({ query } as unknown as DataSource);

    await expect(
      service.upsert(
        ownerId,
        'iching',
        snapshot({ ownerId: 'other-user' }) as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects unsupported app ids before querying the database', async () => {
    const query = jest.fn();
    const service = new StreakService({ query } as unknown as DataSource);

    await expect(service.get(ownerId, 'another-app')).rejects.toThrow(
      'không hợp lệ',
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('counts the first activity as day one and binds the event to authenticated owner and app', async () => {
    const queries: Array<{ sql: string; parameters: unknown[] }> = [];
    const manager = {
      query: jest.fn((sql: string, parameters: unknown[]) => {
        queries.push({ sql, parameters });
        if (sql.includes('INSERT INTO streak_activity_events'))
          return Promise.resolve([{ event_id: 'event-id' }]);
        if (sql.includes('UPDATE user_streaks SET'))
          return Promise.resolve([
            row({
              current_streak: 1,
              longest_streak: 5,
              total_readings: 11,
              last_active_date: '2026-10-23',
              streak_freeze_used: false,
            }),
          ]);
        return Promise.resolve([
          row({
            current_streak: 0,
            longest_streak: 5,
            total_readings: 10,
            last_active_date: null,
            streak_freeze_used: false,
          }),
        ]);
      }),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (manager: { query: jest.Mock }) => unknown) =>
          callback(manager),
      ),
    };
    const service = new StreakService(dataSource as unknown as DataSource);

    const result = await service.recordActivity(ownerId, 'iching', {
      ownerId,
      eventId: '00000000-0000-4000-8000-000000000002',
      activityDate: '2026-10-23',
      snapshot: snapshot({
        currentStreak: 0,
        longestStreak: 5,
        totalReadings: 10,
        lastActiveDate: null,
      }),
    });

    expect(result.streak.currentStreak).toBe(1);
    expect(result.streak.totalReadings).toBe(11);
    expect(queries[0].parameters.slice(0, 2)).toEqual([ownerId, 'iching']);
    expect(queries[1].parameters.slice(0, 2)).toEqual([ownerId, 'iching']);
    expect(queries[1].parameters[2]).toBe(
      '00000000-0000-4000-8000-000000000002',
    );
  });

  it('preserves a consumed streak freeze on a second same-day activity', async () => {
    const state = row({ streak_freeze_used: true, current_streak: 4 });
    const manager = {
      query: jest.fn((sql: string, parameters: unknown[] = []) => {
        void parameters;
        if (sql.includes('INSERT INTO streak_activity_events'))
          return Promise.resolve([{ event_id: 'event-id' }]);
        if (sql.includes('UPDATE user_streaks SET'))
          return Promise.resolve([state]);
        return Promise.resolve([state]);
      }),
    };
    const service = new StreakService({
      transaction: (callback: (manager: { query: jest.Mock }) => unknown) =>
        callback(manager),
    } as unknown as DataSource);

    await service.recordActivity(ownerId, 'tarot', {
      ownerId,
      eventId: '00000000-0000-4000-8000-000000000003',
      activityDate: '2026-10-22',
      snapshot: snapshot({ currentStreak: 4, streakFreezeUsed: true }),
    });

    const update = manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE user_streaks SET'),
    );
    expect(update?.[1]?.[6]).toBe(true);
    expect(update?.[1]?.[2]).toBe(4);
  });

  it('does not increment a duplicate event id twice', async () => {
    const manager = {
      query: jest.fn((sql: string) => {
        if (sql.includes('INSERT INTO streak_activity_events'))
          return Promise.resolve([]);
        return Promise.resolve([row({ total_readings: 11 })]);
      }),
    };
    const service = new StreakService({
      transaction: (callback: (manager: { query: jest.Mock }) => unknown) =>
        callback(manager),
    } as unknown as DataSource);

    const result = await service.recordActivity(ownerId, 'tuvi', {
      ownerId,
      eventId: '00000000-0000-4000-8000-000000000004',
      activityDate: '2026-10-22',
      snapshot: snapshot({ totalReadings: 11 }),
    });

    expect(result.duplicate).toBe(true);
    expect(result.streak.totalReadings).toBe(11);
    expect(
      manager.query.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE user_streaks SET'),
      ),
    ).toBe(false);
  });

  it('rejects materially future and implausibly old activity dates before a transaction', async () => {
    const transaction = jest.fn();
    const service = new StreakService({ transaction } as unknown as DataSource);
    const base = {
      ownerId,
      eventId: '00000000-0000-4000-8000-000000000005',
      snapshot: snapshot(),
    };

    await expect(
      service.recordActivity(ownerId, 'iching', {
        ...base,
        activityDate: dateAtUtcOffset(2),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.recordActivity(ownerId, 'iching', {
        ...base,
        activityDate: dateAtUtcOffset(-3651),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('accepts a client-local date one day ahead of UTC', async () => {
    const manager = {
      query: jest.fn((sql: string) => {
        if (sql.includes('INSERT INTO streak_activity_events'))
          return Promise.resolve([]);
        return Promise.resolve([
          row({
            current_streak: 1,
            longest_streak: 5,
            total_readings: 10,
            last_active_date: dateAtUtcOffset(1),
          }),
        ]);
      }),
    };
    const transaction = jest.fn(
      (callback: (manager: { query: jest.Mock }) => unknown) =>
        callback(manager),
    );
    const service = new StreakService({ transaction } as unknown as DataSource);

    await expect(
      service.recordActivity(ownerId, 'iching', {
        ownerId,
        eventId: '00000000-0000-4000-8000-000000000006',
        activityDate: dateAtUtcOffset(1),
        snapshot: snapshot({ lastActiveDate: dateAtUtcOffset(1) }),
      }),
    ).resolves.toMatchObject({ ownerId, duplicate: true });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('uses a pending freeze once and starts at one after a prior freeze was consumed', async () => {
    const today = dateAtUtcOffset(0);
    const twoDaysAgo = dateAtUtcOffset(-2);
    const makeService = (currentStreak: number, streakFreezeUsed: boolean) => {
      const manager = {
        query: jest.fn((sql: string, parameters: unknown[] = []) => {
          void parameters;
          if (sql.includes('INSERT INTO streak_activity_events'))
            return Promise.resolve([{ event_id: 'event-id' }]);
          if (sql.includes('UPDATE user_streaks SET'))
            return Promise.resolve([row()]);
          return Promise.resolve([
            row({
              current_streak: currentStreak,
              longest_streak: 8,
              total_readings: 20,
              last_active_date: twoDaysAgo,
              streak_freeze_used: streakFreezeUsed,
            }),
          ]);
        }),
      };
      const transaction = (
        callback: (manager: { query: jest.Mock }) => unknown,
      ) => callback(manager);
      return {
        service: new StreakService({ transaction } as unknown as DataSource),
        manager,
      };
    };

    const pending = makeService(4, false);
    await pending.service.recordActivity(ownerId, 'iching', {
      ownerId,
      eventId: '00000000-0000-4000-8000-000000000007',
      activityDate: today,
      snapshot: snapshot({
        currentStreak: 4,
        lastActiveDate: twoDaysAgo,
        streakFreezeUsed: false,
      }),
    });
    const pendingUpdate = pending.manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE user_streaks SET'),
    );
    expect(pendingUpdate?.[1]?.[2]).toBe(5);
    expect(pendingUpdate?.[1]?.[6]).toBe(true);

    const consumed = makeService(4, true);
    await consumed.service.recordActivity(ownerId, 'iching', {
      ownerId,
      eventId: '00000000-0000-4000-8000-000000000008',
      activityDate: today,
      snapshot: snapshot({
        currentStreak: 4,
        lastActiveDate: twoDaysAgo,
        streakFreezeUsed: true,
      }),
    });
    const consumedUpdate = consumed.manager.query.mock.calls.find(([sql]) =>
      String(sql).includes('UPDATE user_streaks SET'),
    );
    expect(consumedUpdate?.[1]?.[2]).toBe(1);
    expect(consumedUpdate?.[1]?.[6]).toBe(false);
  });

  it('keeps same-day streak length stable and counts each distinct event id once', async () => {
    const today = dateAtUtcOffset(0);
    const activityIds = new Set<string>();
    let state = row({
      current_streak: 4,
      longest_streak: 6,
      total_readings: 10,
      last_active_date: today,
      streak_freeze_used: false,
    });
    const manager = {
      query: jest.fn((sql: string, parameters: unknown[] = []) => {
        if (sql.includes('INSERT INTO user_streaks')) {
          state = {
            ...state,
            current_streak: Math.max(
              Number(state.current_streak),
              Number(parameters[2]),
            ),
            longest_streak: Math.max(
              Number(state.longest_streak),
              Number(parameters[3]),
            ),
            total_readings: Math.max(
              Number(state.total_readings),
              Number(parameters[4]),
            ),
            last_active_date: today,
          };
          return Promise.resolve([state]);
        }
        if (sql.includes('INSERT INTO streak_activity_events')) {
          const eventId = String(parameters[2]);
          if (activityIds.has(eventId)) return Promise.resolve([]);
          activityIds.add(eventId);
          return Promise.resolve([{ event_id: eventId }]);
        }
        if (sql.includes('UPDATE user_streaks SET')) {
          state = {
            ...state,
            current_streak: Number(parameters[2]),
            longest_streak: Number(parameters[3]),
            total_readings: Number(parameters[4]),
            last_active_date: String(parameters[5]),
            streak_freeze_used: Boolean(parameters[6]),
          };
          return Promise.resolve([state]);
        }
        return Promise.resolve([state]);
      }),
    };
    const service = new StreakService({
      transaction: (callback: (manager: { query: jest.Mock }) => unknown) =>
        callback(manager),
    } as unknown as DataSource);
    const initial = snapshot({
      currentStreak: 4,
      longestStreak: 6,
      totalReadings: 10,
      lastActiveDate: today,
    });

    const first = await service.recordActivity(ownerId, 'iching', {
      ownerId,
      eventId: '00000000-0000-4000-8000-000000000009',
      activityDate: today,
      snapshot: initial,
    });
    const second = await service.recordActivity(ownerId, 'iching', {
      ownerId,
      eventId: '00000000-0000-4000-8000-000000000010',
      activityDate: today,
      snapshot: initial,
    });
    const duplicate = await service.recordActivity(ownerId, 'iching', {
      ownerId,
      eventId: '00000000-0000-4000-8000-000000000009',
      activityDate: today,
      snapshot: initial,
    });

    expect(first.streak).toMatchObject({ currentStreak: 4, totalReadings: 11 });
    expect(second.streak).toMatchObject({
      currentStreak: 4,
      totalReadings: 12,
    });
    expect(duplicate).toMatchObject({
      duplicate: true,
      streak: { currentStreak: 4, totalReadings: 12 },
    });
  });
});

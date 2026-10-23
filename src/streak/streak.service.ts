import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StreakSnapshotDto } from './dto/streak-write.dto';

export const STREAK_APP_IDS = [
  'iching',
  'iching-game',
  'tarot',
  'tuvi',
] as const;
export type StreakAppId = (typeof STREAK_APP_IDS)[number];

export interface StreakSnapshot {
  currentStreak: number;
  longestStreak: number;
  totalReadings: number;
  lastActiveDate: string | null;
  streakFreezeUsed: boolean;
  dailyCardDate: string | null;
  dailyCardId: string | number | null;
}

interface StreakRow extends Record<string, unknown> {
  current_streak: number | string;
  longest_streak: number | string;
  total_readings: number | string;
  last_active_date: string | null;
  streak_freeze_used: boolean;
  daily_card_date: string | null;
  daily_card_id: string | number | null;
}

const UPSERT_SNAPSHOT_SQL = `
  INSERT INTO user_streaks (
    user_id, app_id, current_streak, longest_streak, total_readings,
    last_active_date, streak_freeze_used, daily_card_date, daily_card_id, updated_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, CURRENT_TIMESTAMP)
  ON CONFLICT (user_id, app_id) DO UPDATE SET
    current_streak = CASE
      WHEN user_streaks.last_active_date IS NULL THEN EXCLUDED.current_streak
      WHEN EXCLUDED.last_active_date IS NULL THEN user_streaks.current_streak
      WHEN EXCLUDED.last_active_date > user_streaks.last_active_date THEN EXCLUDED.current_streak
      WHEN EXCLUDED.last_active_date = user_streaks.last_active_date
        THEN GREATEST(user_streaks.current_streak, EXCLUDED.current_streak)
      ELSE user_streaks.current_streak
    END,
    longest_streak = GREATEST(user_streaks.longest_streak, EXCLUDED.longest_streak),
    total_readings = GREATEST(user_streaks.total_readings, EXCLUDED.total_readings),
    last_active_date = CASE
      WHEN user_streaks.last_active_date IS NULL THEN EXCLUDED.last_active_date
      WHEN EXCLUDED.last_active_date IS NULL THEN user_streaks.last_active_date
      ELSE GREATEST(user_streaks.last_active_date, EXCLUDED.last_active_date)
    END,
    streak_freeze_used = CASE
      WHEN user_streaks.last_active_date IS NULL THEN EXCLUDED.streak_freeze_used
      WHEN EXCLUDED.last_active_date IS NULL THEN user_streaks.streak_freeze_used
      WHEN EXCLUDED.last_active_date > user_streaks.last_active_date THEN EXCLUDED.streak_freeze_used
      WHEN EXCLUDED.last_active_date = user_streaks.last_active_date
        THEN user_streaks.streak_freeze_used OR EXCLUDED.streak_freeze_used
      ELSE user_streaks.streak_freeze_used
    END,
    daily_card_date = CASE
      WHEN user_streaks.daily_card_date IS NULL THEN EXCLUDED.daily_card_date
      WHEN EXCLUDED.daily_card_date IS NULL THEN user_streaks.daily_card_date
      ELSE GREATEST(user_streaks.daily_card_date, EXCLUDED.daily_card_date)
    END,
    daily_card_id = CASE
      WHEN user_streaks.daily_card_date IS NULL THEN EXCLUDED.daily_card_id
      WHEN EXCLUDED.daily_card_date > user_streaks.daily_card_date THEN EXCLUDED.daily_card_id
      WHEN EXCLUDED.daily_card_date = user_streaks.daily_card_date
        THEN COALESCE(user_streaks.daily_card_id, EXCLUDED.daily_card_id)
      ELSE user_streaks.daily_card_id
    END,
    updated_at = CURRENT_TIMESTAMP
  RETURNING current_streak, longest_streak, total_readings, last_active_date,
    streak_freeze_used, daily_card_date, daily_card_id
`;

@Injectable()
export class StreakService {
  constructor(private readonly dataSource: DataSource) {}

  async get(userId: string, rawAppId: string) {
    const appId = this.requireAppId(rawAppId);
    const rows = await this.dataSource.query<StreakRow[]>(
      `SELECT current_streak, longest_streak, total_readings, last_active_date,
              streak_freeze_used, daily_card_date, daily_card_id
         FROM user_streaks WHERE user_id = $1 AND app_id = $2`,
      [userId, appId],
    );
    return {
      ownerId: userId,
      streak: rows.length ? this.mapRow(rows[0]) : null,
    };
  }

  async upsert(
    userId: string,
    rawAppId: string,
    body: { ownerId: string } & StreakSnapshotDto,
  ) {
    const appId = this.requireAppId(rawAppId);
    this.requireOwner(userId, body.ownerId);
    const state = this.normalizeSnapshot(body);
    const rows = await this.dataSource.query<StreakRow[]>(
      UPSERT_SNAPSHOT_SQL,
      this.snapshotParameters(userId, appId, state),
    );
    return { ownerId: userId, streak: this.mapRow(rows[0]) };
  }

  async recordActivity(
    userId: string,
    rawAppId: string,
    body: {
      ownerId: string;
      eventId: string;
      activityDate: string;
      snapshot: StreakSnapshotDto;
    },
  ) {
    const appId = this.requireAppId(rawAppId);
    this.requireOwner(userId, body.ownerId);
    if (!this.isPlausibleActivityDate(body.activityDate)) {
      throw new BadRequestException('Ngày hoạt động không hợp lệ');
    }
    const snapshot = this.normalizeSnapshot(body.snapshot);

    return this.dataSource.transaction(async (manager) => {
      let rows = await manager.query<StreakRow[]>(
        UPSERT_SNAPSHOT_SQL,
        this.snapshotParameters(userId, appId, snapshot),
      );
      const inserted = await manager.query<Array<{ event_id: string }>>(
        `INSERT INTO streak_activity_events (user_id, app_id, event_id, activity_date)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, app_id, event_id) DO NOTHING
         RETURNING event_id`,
        [userId, appId, body.eventId, body.activityDate],
      );

      if (inserted.length) {
        const state = this.applyActivity(
          this.mapRow(rows[0]),
          body.activityDate,
        );
        rows = await manager.query<StreakRow[]>(
          `UPDATE user_streaks SET
             current_streak = $3,
             longest_streak = $4,
             total_readings = $5,
             last_active_date = $6,
             streak_freeze_used = $7,
             updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $1 AND app_id = $2
           RETURNING current_streak, longest_streak, total_readings, last_active_date,
             streak_freeze_used, daily_card_date, daily_card_id`,
          [
            userId,
            appId,
            state.currentStreak,
            state.longestStreak,
            state.totalReadings,
            state.lastActiveDate,
            state.streakFreezeUsed,
          ],
        );
      }

      return {
        ownerId: userId,
        streak: this.mapRow(rows[0]),
        duplicate: inserted.length === 0,
      };
    });
  }

  private requireAppId(value: string): StreakAppId {
    if (!(STREAK_APP_IDS as readonly string[]).includes(value)) {
      throw new BadRequestException('Ứng dụng streak không hợp lệ');
    }
    return value as StreakAppId;
  }

  private requireOwner(userId: string, ownerId: string): void {
    if (ownerId !== userId) {
      throw new ConflictException(
        'Phiên đăng nhập đã thay đổi; hãy tải lại trang',
      );
    }
  }

  private normalizeSnapshot(value: StreakSnapshotDto): StreakSnapshot {
    const lastActiveDate = this.isPlausibleActivityDate(value.lastActiveDate)
      ? value.lastActiveDate
      : null;
    const dailyCardDate = this.isPlausibleActivityDate(value.dailyCardDate)
      ? value.dailyCardDate
      : null;
    const currentStreak = lastActiveDate
      ? this.counter(value.currentStreak, 1_000_000)
      : 0;
    const dailyCardId =
      this.isValidDailyCardId(value.dailyCardId) && dailyCardDate
        ? value.dailyCardId
        : null;
    return {
      currentStreak,
      longestStreak: Math.max(
        currentStreak,
        this.counter(value.longestStreak, 1_000_000),
      ),
      totalReadings: this.counter(value.totalReadings, 2_000_000_000),
      lastActiveDate,
      streakFreezeUsed: Boolean(lastActiveDate && value.streakFreezeUsed),
      dailyCardDate,
      dailyCardId,
    };
  }

  private snapshotParameters(
    userId: string,
    appId: StreakAppId,
    state: StreakSnapshot,
  ) {
    return [
      userId,
      appId,
      state.currentStreak,
      state.longestStreak,
      state.totalReadings,
      state.lastActiveDate,
      state.streakFreezeUsed,
      state.dailyCardDate,
      state.dailyCardId == null ? null : JSON.stringify(state.dailyCardId),
    ];
  }

  private mapRow(row: StreakRow): StreakSnapshot {
    return {
      currentStreak: Number(row.current_streak),
      longestStreak: Number(row.longest_streak),
      totalReadings: Number(row.total_readings),
      lastActiveDate: row.last_active_date,
      streakFreezeUsed: row.streak_freeze_used,
      dailyCardDate: row.daily_card_date,
      dailyCardId: row.daily_card_id,
    };
  }

  private applyActivity(
    snapshot: StreakSnapshot,
    activityDate: string,
  ): StreakSnapshot {
    if (snapshot.lastActiveDate === activityDate) {
      return {
        ...snapshot,
        totalReadings: this.counter(snapshot.totalReadings + 1, 2_000_000_000),
      };
    }
    if (snapshot.lastActiveDate && activityDate < snapshot.lastActiveDate) {
      return {
        ...snapshot,
        totalReadings: this.counter(snapshot.totalReadings + 1, 2_000_000_000),
      };
    }

    const gap = snapshot.lastActiveDate
      ? this.daysBetween(snapshot.lastActiveDate, activityDate)
      : -1;

    let currentStreak = snapshot.currentStreak;
    if (!snapshot.lastActiveDate) {
      currentStreak = 1;
    } else if (gap <= 0) {
      currentStreak = snapshot.currentStreak;
    } else if (gap === 1) {
      currentStreak = snapshot.currentStreak + 1;
    } else if (
      gap === 2 &&
      snapshot.currentStreak > 0 &&
      !snapshot.streakFreezeUsed
    ) {
      currentStreak = snapshot.currentStreak + 1;
    } else {
      currentStreak = 1;
    }

    currentStreak = this.counter(currentStreak, 1_000_000);
    return {
      ...snapshot,
      currentStreak,
      longestStreak: Math.max(snapshot.longestStreak, currentStreak),
      totalReadings: this.counter(snapshot.totalReadings + 1, 2_000_000_000),
      lastActiveDate: activityDate,
      streakFreezeUsed:
        gap === 2 && snapshot.currentStreak > 0 && !snapshot.streakFreezeUsed,
    };
  }

  private daysBetween(first: string, second: string): number {
    const firstParts = first.split('-').map(Number);
    const secondParts = second.split('-').map(Number);
    const firstUtc = Date.UTC(firstParts[0], firstParts[1] - 1, firstParts[2]);
    const secondUtc = Date.UTC(
      secondParts[0],
      secondParts[1] - 1,
      secondParts[2],
    );
    return Math.round((secondUtc - firstUtc) / 86_400_000);
  }

  private isValidDate(value: unknown): value is string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  /**
   * The UI records client-local dates. Allow one day ahead of UTC for timezone
   * skew, while rejecting materially future and implausibly old event dates.
   */
  private isPlausibleActivityDate(value: unknown): value is string {
    if (!this.isValidDate(value)) return false;
    const utcToday = new Date().toISOString().slice(0, 10);
    const offsetDays = this.daysBetween(utcToday, value);
    return offsetDays >= -3650 && offsetDays <= 1;
  }

  private isValidDailyCardId(value: unknown): value is string | number {
    return (
      (typeof value === 'string' && value.length <= 128) ||
      (typeof value === 'number' && Number.isFinite(value))
    );
  }

  private counter(value: number, maximum: number): number {
    return Number.isFinite(value)
      ? Math.min(maximum, Math.max(0, Math.floor(value)))
      : 0;
  }
}

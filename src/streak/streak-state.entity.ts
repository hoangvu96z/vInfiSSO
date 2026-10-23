import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_streaks')
export class StreakState {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @PrimaryColumn({ name: 'app_id', type: 'varchar', length: 32 })
  appId: string;

  @Column({ name: 'current_streak', type: 'integer', default: 0 })
  currentStreak: number;

  @Column({ name: 'longest_streak', type: 'integer', default: 0 })
  longestStreak: number;

  @Column({ name: 'total_readings', type: 'integer', default: 0 })
  totalReadings: number;

  @Column({ name: 'last_active_date', type: 'date', nullable: true })
  lastActiveDate: string | null;

  @Column({ name: 'streak_freeze_used', type: 'boolean', default: false })
  streakFreezeUsed: boolean;

  @Column({ name: 'daily_card_date', type: 'date', nullable: true })
  dailyCardDate: string | null;

  @Column({ name: 'daily_card_id', type: 'jsonb', nullable: true })
  dailyCardId: string | number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}

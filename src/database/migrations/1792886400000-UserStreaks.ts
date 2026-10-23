import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Store only per-user engagement aggregates and idempotent activity IDs. */
export class UserStreaks1792886400000 implements MigrationInterface {
  name = 'UserStreaks1792886400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_streaks (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        app_id varchar(32) NOT NULL,
        current_streak integer NOT NULL DEFAULT 0,
        longest_streak integer NOT NULL DEFAULT 0,
        total_readings integer NOT NULL DEFAULT 0,
        last_active_date date,
        streak_freeze_used boolean NOT NULL DEFAULT false,
        daily_card_date date,
        daily_card_id jsonb,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_user_streaks" PRIMARY KEY (user_id, app_id),
        CONSTRAINT "CHK_user_streaks_app" CHECK (app_id IN ('iching', 'iching-game', 'tarot', 'tuvi')),
        CONSTRAINT "CHK_user_streaks_counters" CHECK (
          current_streak >= 0 AND longest_streak >= current_streak AND total_readings >= 0
        ),
        CONSTRAINT "CHK_user_streaks_active_date" CHECK (
          last_active_date IS NOT NULL OR (current_streak = 0 AND streak_freeze_used = false)
        ),
        CONSTRAINT "CHK_user_streaks_daily_card" CHECK (
          (daily_card_date IS NOT NULL OR daily_card_id IS NULL)
          AND (daily_card_id IS NULL OR jsonb_typeof(daily_card_id) IN ('string', 'number'))
        )
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS streak_activity_events (
        user_id uuid NOT NULL,
        app_id varchar(32) NOT NULL,
        event_id uuid NOT NULL,
        activity_date date NOT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PK_streak_activity_events" PRIMARY KEY (user_id, app_id, event_id),
        CONSTRAINT "FK_streak_activity_events_streak" FOREIGN KEY (user_id, app_id)
          REFERENCES user_streaks(user_id, app_id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_streak_activity_events_created"
      ON streak_activity_events (created_at)
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinfi_sso') THEN
          EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.user_streaks TO vinfi_sso';
          EXECUTE 'GRANT SELECT, INSERT, UPDATE ON TABLE public.streak_activity_events TO vinfi_sso';
        END IF;
      END
      $$
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'This migration is forward-only to preserve streak and activity history; restore from a verified backup if rollback is required.',
      ),
    );
  }
}

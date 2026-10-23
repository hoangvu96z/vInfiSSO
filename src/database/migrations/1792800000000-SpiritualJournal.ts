import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add encrypted cross-app reflections linked to a user's saved readings.
 * The migration is explicit and forward-only; it does not alter existing data.
 */
export class SpiritualJournal1792800000000 implements MigrationInterface {
  name = 'SpiritualJournal1792800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS journal_entries (
        id uuid PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reading_id uuid NOT NULL REFERENCES readings(id) ON DELETE CASCADE,
        encrypted_payload jsonb NOT NULL,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UQ_journal_entries_reading" UNIQUE (reading_id),
        CONSTRAINT "CHK_journal_entries_encrypted_payload" CHECK (
          jsonb_typeof(encrypted_payload) = 'object'
          AND encrypted_payload ? '_enc'
        )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_journal_entries_user_created"
      ON journal_entries (user_id, created_at DESC)
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinfi_sso') THEN
          EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.journal_entries TO vinfi_sso';
        END IF;
      END
      $$
    `);
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    throw new Error(
      'This migration is forward-only to preserve user reflections. Review and restore from a backup if rollback is required.',
    );
  }
}

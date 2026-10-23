import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Persist authenticated SePay deliveries for atomic idempotency and audit. */
export class SePayWebhookEvents1792800000000 implements MigrationInterface {
  name = 'SePayWebhookEvents1792800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payment_webhook_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        provider varchar(20) NOT NULL,
        provider_transaction_id varchar(100) NOT NULL,
        payment_order_id uuid NULL
          REFERENCES payment_orders(id) ON DELETE SET NULL,
        transfer_type varchar(8) NOT NULL,
        gateway varchar(100) NOT NULL,
        reference varchar(24) NULL,
        amount bigint NOT NULL CHECK (amount > 0),
        account_last4 varchar(4) NOT NULL
          CHECK (account_last4 ~ '^[A-Za-z0-9]{4}$'),
        signature_timestamp bigint NOT NULL,
        payload_sha256 varchar(64) NOT NULL
          CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
        outcome varchar(12) NOT NULL DEFAULT 'received'
          CHECK (outcome IN ('received', 'paid', 'ignored')),
        rejection_reason varchar(32) NULL,
        received_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UQ_payment_webhook_events_provider_transaction"
          UNIQUE (provider, provider_transaction_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payment_webhook_events_order_received"
      ON payment_webhook_events (payment_order_id, received_at)
    `);
    await queryRunner.query(
      'GRANT SELECT, INSERT, UPDATE ON TABLE public.payment_webhook_events TO vinfi_sso',
    );
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'This migration is forward-only to preserve provider event audit history.',
      ),
    );
  }
}

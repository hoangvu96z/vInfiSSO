import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Idempotent TypeORM equivalent of migrations/20261022_coupon_redemptions.sql.
 * This is intentionally applied by the explicit migration CLI, never at app
 * startup. It can safely run after the earlier manual SQL migration.
 */
export class CouponRedemptions1792627200000 implements MigrationInterface {
  name = 'CouponRedemptions1792627200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS coupon_redemptions (
        id serial PRIMARY KEY,
        coupon_id uuid NOT NULL,
        user_id uuid NOT NULL,
        redeemed_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FK_coupon_redemptions_coupon"
          FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE CASCADE,
        CONSTRAINT "FK_coupon_redemptions_user"
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT "UQ_coupon_redemptions_coupon_user"
          UNIQUE (coupon_id, user_id)
      )
    `);

    await queryRunner.query(`
      INSERT INTO coupon_redemptions (coupon_id, user_id, redeemed_at)
      SELECT c.id, s."userId", MIN(s."createdAt")
      FROM user_subscriptions AS s
      JOIN coupons AS c ON c.code = s."grantedByCoupon"
      WHERE s."grantedByCoupon" IS NOT NULL
      GROUP BY c.id, s."userId"
      ON CONFLICT (coupon_id, user_id) DO NOTHING
    `);

    await queryRunner.query(
      'GRANT SELECT, INSERT ON TABLE public.coupon_redemptions TO vinfi_sso',
    );
    await queryRunner.query(
      'GRANT USAGE, SELECT ON SEQUENCE public.coupon_redemptions_id_seq TO vinfi_sso',
    );
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    throw new Error(
      'This migration is forward-only to preserve coupon redemption history.',
    );
  }
}

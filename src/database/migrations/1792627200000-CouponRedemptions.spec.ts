import { CouponRedemptions1792627200000 } from './1792627200000-CouponRedemptions';
import { createMigrationDataSourceOptions } from '../data-source';
import type { QueryRunner } from 'typeorm';

describe('explicit migration DataSource', () => {
  it('never synchronizes or runs migrations automatically', () => {
    const options = createMigrationDataSourceOptions({
      NODE_ENV: 'production',
      DATABASE_HOST: 'db.example.test',
      DATABASE_PORT: '5432',
      DATABASE_USER: 'migration-user',
      DATABASE_NAME: 'vinfi-test',
    });

    expect(options.synchronize).toBe(false);
    expect(options.migrationsRun).toBe(false);
    expect(options.migrationsTransactionMode).toBe('all');
    expect(options.migrationsTableName).toBe('typeorm_migrations');
    expect(options.host).toBe('db.example.test');
    expect(options.port).toBe(5432);
    expect(options.username).toBe('migration-user');
  });
});

describe('coupon-redemption schema migration', () => {
  it('repeats the applied SQL migration safely and preserves existing uses', async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
    const migration = new CouponRedemptions1792627200000();

    await migration.up(queryRunner as unknown as QueryRunner);

    expect(queryRunner.query).toHaveBeenCalledTimes(4);
    expect(queryRunner.query.mock.calls[0][0]).toContain(
      'CREATE TABLE IF NOT EXISTS coupon_redemptions',
    );
    expect(queryRunner.query.mock.calls[1][0]).toContain(
      'ON CONFLICT (coupon_id, user_id) DO NOTHING',
    );
    expect(queryRunner.query.mock.calls[2][0]).toContain(
      'GRANT SELECT, INSERT ON TABLE public.coupon_redemptions TO vinfi_sso',
    );
    expect(queryRunner.query.mock.calls[3][0]).toContain(
      'GRANT USAGE, SELECT ON SEQUENCE public.coupon_redemptions_id_seq TO vinfi_sso',
    );
  });

  it('refuses destructive rollback of coupon-use history', async () => {
    const migration = new CouponRedemptions1792627200000();
    await expect(migration.down({} as QueryRunner)).rejects.toThrow(
      'forward-only to preserve coupon redemption history',
    );
  });
});

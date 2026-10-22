import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { getEnvFiles } from '../config/env-files';

// Match ConfigModule's file precedence for the standalone TypeORM CLI. Existing
// process variables take precedence, and .env takes precedence over .env.production.
for (const envFile of getEnvFiles()) {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}

export function createMigrationDataSourceOptions(
  environment: NodeJS.ProcessEnv = process.env,
): DataSourceOptions {
  return {
    type: 'postgres',
    host:
      environment.MIGRATION_DATABASE_HOST ||
      environment.DATABASE_HOST ||
      'localhost',
    port: Number(
      environment.MIGRATION_DATABASE_PORT ||
        environment.DATABASE_PORT ||
        5432,
    ),
    username:
      environment.MIGRATION_DATABASE_USER ||
      environment.DATABASE_USER ||
      'postgres',
    password:
      environment.MIGRATION_DATABASE_PASSWORD ??
      environment.DATABASE_PASSWORD ??
      '',
    database:
      environment.MIGRATION_DATABASE_NAME ||
      environment.DATABASE_NAME ||
      'vinfi_sso',
    migrations: [join(__dirname, 'migrations', '*.js')],
    migrationsTableName: 'typeorm_migrations',
    migrationsTransactionMode: 'all',
    synchronize: false,
    migrationsRun: false,
    logging: environment.NODE_ENV !== 'production',
  };
}

const migrationDataSource = new DataSource(createMigrationDataSourceOptions());

export default migrationDataSource;

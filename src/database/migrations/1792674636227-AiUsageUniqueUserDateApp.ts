import type { MigrationInterface, QueryRunner } from 'typeorm';

// This is the default TypeORM index name generated for
// @Index(['userId', 'date', 'app'], { unique: true }) on AiUsage.
const AI_USAGE_UNIQUE_INDEX = 'IDX_72dc538b954157b0ed930f9f19';

export class AiUsageUniqueUserDateApp1792674636227 implements MigrationInterface {
  name = 'AiUsageUniqueUserDateApp1792674636227';

  async up(queryRunner: QueryRunner): Promise<void> {
    const duplicateCheck = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1
        FROM public.ai_usage
        GROUP BY "userId", date, app
        HAVING COUNT(*) > 1
      ) AS has_duplicates
    `);

    if (duplicateCheck[0]?.has_duplicates === true) {
      throw new Error(
        'Cannot create the ai_usage unique index: duplicate (userId, date, app) rows exist. No rows were changed; resolve duplicates through an approved data review, then rerun this migration.',
      );
    }

    const existingNamedIndex = await queryRunner.query(
      `
        SELECT
          relation.relkind = 'i' AS is_index,
          access_method.amname = 'btree' AS uses_btree,
          index_data.indisunique AS is_unique,
          index_data.indisvalid AS is_valid,
          index_data.indisready AS is_ready,
          index_data.indpred IS NULL AS has_no_predicate,
          index_data.indexprs IS NULL AS has_no_expressions,
          index_data.indnkeyatts = 3 AS has_expected_key_count,
          (
            SELECT array_agg(attribute.attname::text ORDER BY key.ordinality)
            FROM unnest(index_data.indkey) WITH ORDINALITY AS key(attnum, ordinality)
            JOIN pg_attribute AS attribute
              ON attribute.attrelid = table_relation.oid
             AND attribute.attnum = key.attnum
            WHERE key.ordinality <= index_data.indnkeyatts
          ) = ARRAY['userId', 'date', 'app']::text[] AS has_expected_columns,
          table_namespace.nspname = 'public'
            AND table_relation.relname = 'ai_usage' AS has_expected_table
        FROM pg_class AS relation
        JOIN pg_namespace AS relation_namespace
          ON relation_namespace.oid = relation.relnamespace
        LEFT JOIN pg_index AS index_data
          ON index_data.indexrelid = relation.oid
        LEFT JOIN pg_am AS access_method
          ON access_method.oid = relation.relam
        LEFT JOIN pg_class AS table_relation
          ON table_relation.oid = index_data.indrelid
        LEFT JOIN pg_namespace AS table_namespace
          ON table_namespace.oid = table_relation.relnamespace
        WHERE relation_namespace.nspname = 'public'
          AND relation.relname = $1
        LIMIT 1
      `,
      [AI_USAGE_UNIQUE_INDEX],
    );

    if (existingNamedIndex.length > 0) {
      const index = existingNamedIndex[0];
      const isExpectedIndex = [
        index.is_index,
        index.uses_btree,
        index.is_unique,
        index.is_valid,
        index.is_ready,
        index.has_no_predicate,
        index.has_no_expressions,
        index.has_expected_key_count,
        index.has_expected_columns,
        index.has_expected_table,
      ].every((value) => value === true);

      if (!isExpectedIndex) {
        throw new Error(
          'Cannot create the ai_usage unique index: its canonical name is already used by a different or invalid index. No rows were changed; review the index definition before rerunning.',
        );
      }

      return;
    }

    // A prior synchronize/manual rollout may already have created this exact
    // TypeORM-generated index. The catalog check above allows that case only.
    // Do not use IF NOT EXISTS here: an index created between the catalog check
    // and this statement must cause an error instead of being silently skipped.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "${AI_USAGE_UNIQUE_INDEX}"
      ON public.ai_usage ("userId", date, app)
    `);
  }

  async down(_queryRunner: QueryRunner): Promise<void> {
    throw new Error(
      'This migration is forward-only; removing the quota uniqueness constraint could reintroduce duplicate usage rows.',
    );
  }
}

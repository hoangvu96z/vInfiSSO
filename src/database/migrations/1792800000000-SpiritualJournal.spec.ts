import { SpiritualJournal1792800000000 } from './1792800000000-SpiritualJournal';
import type { QueryRunner } from 'typeorm';

describe('SpiritualJournal migration', () => {
  it('creates only the encrypted journal table and its timestamp index', async () => {
    const queries: string[] = [];
    const query = jest.fn<Promise<unknown>, [string, unknown[]?]>((sql) => {
      queries.push(sql);
      return Promise.resolve(undefined);
    });

    await new SpiritualJournal1792800000000().up({
      query,
    } as unknown as QueryRunner);

    expect(queries.join('\n')).toContain(
      'CREATE TABLE IF NOT EXISTS journal_entries',
    );
    expect(queries.join('\n')).toContain('encrypted_payload jsonb NOT NULL');
    expect(queries.join('\n')).toContain(
      'REFERENCES readings(id) ON DELETE CASCADE',
    );
    expect(queries.join('\n')).toContain('UNIQUE (reading_id)');
    expect(queries.join('\n')).not.toMatch(/\btags\s+text\[\]/i);
    expect(queries.join('\n')).toContain(
      "IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vinfi_sso')",
    );
    expect(queries.join('\n')).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });

  it('refuses destructive rollback without an approved recovery procedure', async () => {
    await expect(new SpiritualJournal1792800000000().down()).rejects.toThrow(
      /forward-only/,
    );
  });
});

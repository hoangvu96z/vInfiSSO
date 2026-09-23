import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { getEnvFiles } from './env-files';

describe('deployment environment loading', () => {
  const key = 'TUVI_AI_API_KEY';
  const original = process.env[key];
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sso-env-test-'));
    delete process.env[key];
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  });
  async function load(environment: string) {
    await ConfigModule.forRoot({ envFilePath: getEnvFiles(environment).map(file => join(directory, file)) });
  }
  it('loads a production AI key when .env has no AI key', async () => {
    writeFileSync(join(directory, '.env'), '# existing deployment\n');
    writeFileSync(join(directory, '.env.production'), `${key}=production-test-key\n`);
    await load('production');
    expect(process.env[key]).toBe('production-test-key');
  });
  it('preserves explicitly configured .env and process values', async () => {
    writeFileSync(join(directory, '.env'), `${key}=env-test-key\n`);
    writeFileSync(join(directory, '.env.production'), `${key}=production-test-key\n`);
    await load('production');
    expect(process.env[key]).toBe('env-test-key');
    process.env[key] = 'process-test-key';
    await load('production');
    expect(process.env[key]).toBe('process-test-key');
  });
  it('never loads production secrets in development', async () => {
    writeFileSync(join(directory, '.env.production'), `${key}=production-test-key\n`);
    await load('development');
    expect(process.env[key]).toBeUndefined();
  });
});

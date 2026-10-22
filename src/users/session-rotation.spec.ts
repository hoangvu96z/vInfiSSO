import * as crypto from 'node:crypto';
import { Session } from './session.entity';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { SsoService } from '../sso/sso.service';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ROTATION_GRACE_MS = 2 * 60 * 1000;
const ROTATION_SECRET = 'rotation-test-secret-'.padEnd(40, 'x');
const FIXED_NOW = new Date('2026-10-23T00:00:00.000Z');

interface StoredSession {
  id: string;
  userId: string;
  appOrigin: string | null;
  tokenHash: string;
  expiresAt: Date;
}

class MemorySessionStore {
  readonly user = { id: 'user-1', role: 'user' } as User;
  readonly sessions: StoredSession[] = [];
  readonly logoutLockQueries: string[] = [];
  readonly logoutLockParameters: string[][] = [];
  private transactionQueue: Promise<unknown> = Promise.resolve();
  private nextId = 1;

  readonly manager = {
    query: (sql: string, parameters: unknown[] = []) =>
      this.query(sql, parameters),
    getRepository: (entity: unknown) => {
      if (entity === User) {
        return {
          findOne: async ({ where }: { where: { id: string } }) =>
            where.id === this.user.id ? this.user : null,
        };
      }
      if (entity === Session) {
        return {
          create: (session: any) => session,
          save: async (session: any) => {
            const stored = {
              id: `session-${this.nextId++}`,
              userId: session.user.id,
              appOrigin: session.appOrigin,
              tokenHash: session.tokenHash,
              expiresAt: session.expiresAt,
            };
            this.sessions.push(stored);
            return stored;
          },
        };
      }
      throw new Error('Unexpected repository');
    },
  };

  async transaction<T>(callback: (manager: any) => Promise<T>): Promise<T> {
    const result = this.transactionQueue.then(() => callback(this.manager));
    this.transactionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  add(rawToken: string, expiresAt: Date, appOrigin = 'https://app.test') {
    this.sessions.push({
      id: `session-${this.nextId++}`,
      userId: this.user.id,
      appOrigin,
      tokenHash: this.hash(rawToken),
      expiresAt,
    });
  }

  hash(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  private async query(sql: string, parameters: unknown[]) {
    if (sql.startsWith('SELECT id, user_id, app_origin, expires_at')) {
      const row = this.sessions.find(
        (session) => session.tokenHash === parameters[0],
      );
      return row
        ? [
            {
              id: row.id,
              user_id: row.userId,
              app_origin: row.appOrigin,
              expires_at: row.expiresAt,
            },
          ]
        : [];
    }

    if (
      sql.startsWith(
        'SELECT id FROM sessions WHERE token_hash = $1 AND user_id',
      )
    ) {
      const [tokenHash, userId, expiresAfter] = parameters as [
        string,
        string,
        Date,
      ];
      return this.sessions
        .filter(
          (session) =>
            session.tokenHash === tokenHash &&
            session.userId === userId &&
            session.expiresAt > expiresAfter,
        )
        .map((session) => ({ id: session.id }));
    }

    if (
      sql.startsWith(
        'SELECT token_hash FROM sessions WHERE token_hash = ANY($1::varchar[])',
      )
    ) {
      const hashes = parameters[0] as string[];
      this.logoutLockQueries.push(sql);
      this.logoutLockParameters.push([...hashes]);
      return this.sessions
        .filter((session) => hashes.includes(session.tokenHash))
        .sort(
          (left, right) =>
            hashes.indexOf(left.tokenHash) - hashes.indexOf(right.tokenHash),
        )
        .map((session) => ({ token_hash: session.tokenHash }));
    }

    if (sql.startsWith('UPDATE sessions SET expires_at')) {
      const [expiresAt, id] = parameters as [Date, string];
      const row = this.sessions.find((session) => session.id === id);
      if (row) row.expiresAt = expiresAt;
      return [];
    }

    if (sql.startsWith('DELETE FROM sessions WHERE id = $1')) {
      const index = this.sessions.findIndex(
        (session) => session.id === parameters[0],
      );
      if (index >= 0) this.sessions.splice(index, 1);
      return [];
    }

    if (sql.startsWith('DELETE FROM sessions WHERE token_hash = ANY')) {
      const hashes = new Set(parameters[0] as string[]);
      for (let index = this.sessions.length - 1; index >= 0; index -= 1) {
        if (hashes.has(this.sessions[index].tokenHash)) {
          this.sessions.splice(index, 1);
        }
      }
      return [];
    }

    throw new Error(`Unexpected SQL: ${sql}`);
  }
}

function createUsersService(store: MemorySessionStore) {
  const usersRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      where.id === store.user.id ? store.user : null,
    ),
  };
  const sessionsRepo = {
    findOne: jest.fn(async ({ where }: { where: { tokenHash: string } }) => {
      const session = store.sessions.find(
        (entry) => entry.tokenHash === where.tokenHash,
      );
      return session ? { ...session, user: store.user } : null;
    }),
    delete: jest.fn(async (id: string) => {
      const index = store.sessions.findIndex((entry) => entry.id === id);
      if (index >= 0) store.sessions.splice(index, 1);
    }),
  };
  const service = new UsersService(
    usersRepo as any,
    {} as any,
    sessionsRepo as any,
    {} as any,
    store as any,
    {
      get: jest.fn((key: string) =>
        key === 'SESSION_SECRET' ? ROTATION_SECRET : undefined,
      ),
    } as any,
  );
  return { service, sessionsRepo };
}

describe('UsersService session rotation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('leaves sessions outside the rotation window unchanged', async () => {
    const store = new MemorySessionStore();
    const { service } = createUsersService(store);
    const rawToken = 'a'.repeat(64);
    store.add(rawToken, new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));

    const resolved = await service.resolveSessionForRequest(rawToken);

    expect(resolved).toEqual({ user: store.user });
    expect(store.sessions).toHaveLength(1);
  });

  it('rotates near expiry, stores hashes, and accepts old and new tokens safely', async () => {
    const store = new MemorySessionStore();
    const { service } = createUsersService(store);
    const oldToken = 'b'.repeat(64);
    store.add(oldToken, new Date(Date.now() + 24 * 60 * 60 * 1000));

    const rotated = await service.resolveSessionForRequest(oldToken);

    expect(rotated?.user).toBe(store.user);
    expect(rotated?.rotatedToken).toMatch(/^v1\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
    expect(store.sessions).toHaveLength(2);
    expect(
      store.sessions.every((session) => !session.tokenHash.includes(oldToken)),
    ).toBe(true);
    expect(store.sessions[0].expiresAt.getTime()).toBe(
      Date.now() + ROTATION_GRACE_MS,
    );
    expect(store.sessions[1].expiresAt.getTime()).toBe(
      Date.now() + SESSION_TTL_MS,
    );

    const repeatedOldToken = await service.resolveSessionForRequest(oldToken);
    expect(repeatedOldToken?.rotatedToken).toBe(rotated?.rotatedToken);

    const currentToken = await service.resolveSessionForRequest(
      rotated!.rotatedToken!,
    );
    expect(currentToken).toEqual({ user: store.user });

    jest.setSystemTime(new Date(Date.now() + ROTATION_GRACE_MS + 1));
    await expect(
      service.resolveSessionForRequest(oldToken),
    ).resolves.toBeNull();
    await expect(
      service.resolveSessionForRequest(rotated!.rotatedToken!),
    ).resolves.toEqual({ user: store.user });
  });

  it('rotates on the first request with less than two minutes remaining', async () => {
    const store = new MemorySessionStore();
    const { service } = createUsersService(store);
    const oldToken = 'g'.repeat(64);
    store.add(oldToken, new Date(Date.now() + 90 * 1000));

    const rotated = await service.resolveSessionForRequest(oldToken);

    expect(rotated?.rotatedToken).toMatch(/^v1\.[a-f0-9]{64}\.[a-f0-9]{64}$/);
    expect(store.sessions).toHaveLength(2);
    expect(store.sessions[0].expiresAt.getTime()).toBe(
      Date.now() + ROTATION_GRACE_MS,
    );
    await expect(
      service.resolveSessionForRequest(rotated!.rotatedToken!),
    ).resolves.toEqual({ user: store.user });
  });

  it('does not rotate expired sessions and removes their rows', async () => {
    const store = new MemorySessionStore();
    const { service } = createUsersService(store);
    const rawToken = 'c'.repeat(64);
    store.add(rawToken, new Date(Date.now() - 1));

    await expect(
      service.resolveSessionForRequest(rawToken),
    ).resolves.toBeNull();
    expect(store.sessions).toHaveLength(0);
  });

  it('issues one identical replacement for concurrent old-cookie requests', async () => {
    const store = new MemorySessionStore();
    const { service } = createUsersService(store);
    const oldToken = 'd'.repeat(64);
    store.add(oldToken, new Date(Date.now() + 24 * 60 * 60 * 1000));

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.resolveSessionForRequest(oldToken),
      ),
    );
    const replacements = new Set(
      results.map((result) => result?.rotatedToken).filter(Boolean),
    );

    expect(replacements.size).toBe(1);
    expect(store.sessions).toHaveLength(2);
  });

  it('logs out the presented rotation lineage without deleting sibling sessions', async () => {
    const store = new MemorySessionStore();
    const { service: usersService } = createUsersService(store);
    const oldToken = 'e'.repeat(64);
    const siblingToken = 'f'.repeat(64);
    store.add(oldToken, new Date(Date.now() + 24 * 60 * 60 * 1000));
    store.add(siblingToken, new Date(Date.now() + SESSION_TTL_MS));
    const rotation = await usersService.resolveSessionForRequest(oldToken);
    const auditLogRepo = { save: jest.fn().mockResolvedValue(undefined) };
    const ssoService = new SsoService(usersService as any, auditLogRepo as any);

    await ssoService.logout(rotation!.rotatedToken);

    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].tokenHash).toBe(store.hash(siblingToken));
    expect(auditLogRepo.save).toHaveBeenCalledWith({
      userId: store.user.id,
      action: 'logout',
      app: 'sso',
    });
  });

  it('locks parent and child logout lineages in consistent order concurrently', async () => {
    const store = new MemorySessionStore();
    const { service: usersService } = createUsersService(store);
    const parentToken = 'h'.repeat(64);
    const siblingToken = 'i'.repeat(64);
    store.add(parentToken, new Date(Date.now() + 24 * 60 * 60 * 1000));
    store.add(siblingToken, new Date(Date.now() + SESSION_TTL_MS));
    const rotation = await usersService.resolveSessionForRequest(parentToken);
    const childToken = rotation!.rotatedToken!;
    const auditLogRepo = { save: jest.fn().mockResolvedValue(undefined) };
    const ssoService = new SsoService(usersService as any, auditLogRepo as any);

    await Promise.all([
      ssoService.logout(parentToken),
      ssoService.logout(childToken),
    ]);

    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].tokenHash).toBe(store.hash(siblingToken));
    expect(store.logoutLockQueries).toHaveLength(2);
    expect(
      store.logoutLockQueries.every((sql) =>
        /ORDER BY array_position\(\$1::varchar\[], token_hash\) FOR UPDATE$/.test(
          sql,
        ),
      ),
    ).toBe(true);
    const sharedLineage = [store.hash(parentToken), store.hash(childToken)];
    expect(
      store.logoutLockParameters.map((hashes) =>
        hashes.filter((hash) => sharedLineage.includes(hash)),
      ),
    ).toEqual([sharedLineage, sharedLineage]);
  });
});

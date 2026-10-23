import { BadRequestException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { AdminService } from './admin.service';
import { User } from '../users/user.entity';
import { Session } from '../users/session.entity';
import { AuditLog } from '../users/audit-log.entity';
import { Reading } from '../readings/reading.entity';
import { AiUsage } from '../plans/ai-usage.entity';

describe('AdminService role changes', () => {
  const user = { id: 'admin-1', email: 'admin@example.test', role: 'admin' };
  const userRepo = {
    findOne: jest.fn<Promise<Partial<User> | null>, [unknown]>(),
    count: jest.fn<Promise<number>, [unknown?]>(),
    save: jest.fn<Promise<Partial<User>>, [Partial<User>]>(),
  };
  const sessionRepo = { delete: jest.fn<Promise<unknown>, [unknown]>() };
  const auditRepo = {
    save: jest.fn<Promise<unknown>, [Partial<AuditLog>]>(),
  };
  const injectedAuditRepo = { createQueryBuilder: jest.fn() };
  const manager = {
    query: jest.fn<Promise<unknown>, [string, unknown[]?]>(),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === User) return userRepo;
      if (entity === Session) return sessionRepo;
      if (entity === AuditLog) return auditRepo;
      throw new Error('Unexpected repository');
    }),
  };
  const dataSource = {
    transaction: jest.fn((callback: (manager: unknown) => unknown) =>
      callback(manager),
    ),
    query: jest.fn<Promise<unknown>, [string, unknown[]?]>(),
  };
  const service = new AdminService(
    {} as unknown as Repository<User>,
    {} as unknown as Repository<Session>,
    injectedAuditRepo as unknown as Repository<AuditLog>,
    {} as unknown as Repository<Reading>,
    {} as unknown as Repository<AiUsage>,
    dataSource as unknown as DataSource,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    userRepo.findOne.mockResolvedValue({ ...user });
    userRepo.count.mockResolvedValue(2);
  });

  it('blocks an admin from removing their own admin role', async () => {
    await expect(
      service.updateUserRole('admin-1', 'user', 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userRepo.save).not.toHaveBeenCalled();
    expect(auditRepo.save).not.toHaveBeenCalled();
  });

  it('keeps the final admin role protected', async () => {
    userRepo.count.mockResolvedValue(1);
    await expect(
      service.updateUserRole('admin-1', 'user', 'other-admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(userRepo.save).not.toHaveBeenCalled();
  });

  it('records the acting admin separately from the role-change target', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'member-1',
      email: 'member@example.test',
      role: 'user',
    });
    userRepo.save.mockImplementation((saved) => Promise.resolve(saved));

    const result = await service.updateUserRole(
      'member-1',
      'admin',
      'admin-1',
      '127.0.0.1',
      'test-agent',
    );

    expect(result.user).toEqual({
      id: 'member-1',
      email: 'member@example.test',
      role: 'admin',
    });
    expect(auditRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'update_role',
        metadata: {
          actorId: 'admin-1',
          targetUserId: 'member-1',
          previousRole: 'user',
          newRole: 'admin',
        },
      }),
    );
    expect(sessionRepo.delete).toHaveBeenCalledWith({
      user: { id: 'member-1' },
    });
  });

  it('aggregates AI usage without hydrating encrypted reading data', async () => {
    dataSource.query.mockResolvedValue([
      {
        userId: 'user-1',
        email: 'member@example.test',
        displayName: 'Member',
        role: 'user',
        ichingReadings: 2,
        tarotReadings: 1,
        tuviReadings: 0,
        totalAiQuestions: 6,
        lastActive: new Date('2026-10-22T00:00:00Z'),
      },
    ]);

    const result = await service.getAiUsageStats();

    expect(dataSource.query.mock.calls[0][0]).toContain(
      'THEN usage."monthlyCount" ELSE usage."dailyCount"',
    );
    expect(dataSource.query.mock.calls[0][0]).toContain(
      'ORDER BY "totalAiQuestions" DESC, email ASC, "userId" ASC',
    );
    expect(dataSource.query.mock.calls[0][0]).not.toContain(
      'LIMIT $6 OFFSET $7',
    );
    expect(dataSource.query).toHaveBeenCalledTimes(1);
    expect(dataSource.query.mock.calls[0][0]).not.toContain('r.data');
    expect(result.userAiStats[0].totalAiQuestions).toBe(6);
    expect(result.summary).toEqual({
      totalUsersWithReadings: 1,
      totalIchingReadings: 2,
      totalTarotReadings: 1,
      totalTuviReadings: 0,
      totalAiQuestions: 6,
    });
    expect(result).not.toHaveProperty('page');
  });

  it('applies audit date filters alongside server pagination', async () => {
    const query = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    injectedAuditRepo.createQueryBuilder.mockReturnValue(query);

    await service.getAuditLogs(
      3,
      30,
      '',
      'admin',
      '2026-10-01T00:00:00.000Z',
      '2026-11-01T00:00:00.000Z',
    );

    expect(query.skip).toHaveBeenCalledWith(60);
    expect(query.take).toHaveBeenCalledWith(30);
    expect(query.andWhere).toHaveBeenCalledWith('log.createdAt >= :dateFrom', {
      dateFrom: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(query.andWhere).toHaveBeenCalledWith('log.createdAt < :dateTo', {
      dateTo: new Date('2026-11-01T00:00:00.000Z'),
    });
    expect(query.addOrderBy).toHaveBeenCalledWith('log.id', 'ASC');
  });

  it('includes the full date-only end day for audit log filters', async () => {
    const query = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    injectedAuditRepo.createQueryBuilder.mockReturnValue(query);

    await service.getAuditLogs(1, 30, '', '', '2026-10-31', '2026-10-31');

    expect(query.andWhere).toHaveBeenCalledWith('log.createdAt >= :dateFrom', {
      dateFrom: new Date('2026-10-31T00:00:00.000Z'),
    });
    expect(query.andWhere).toHaveBeenCalledWith('log.createdAt < :dateTo', {
      dateTo: new Date('2026-11-01T00:00:00.000Z'),
    });
  });

  it('rejects an invalid audit date range', async () => {
    injectedAuditRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
    });
    await expect(
      service.getAuditLogs(1, 30, '', '', 'not-a-date'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AdminService dashboard and user listing', () => {
  const userRepo = {
    count: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const sessionRepo = {
    count: jest.fn(),
    find: jest.fn(),
  };
  const auditLogRepo = { count: jest.fn(), find: jest.fn() };
  const readingRepo = {
    count: jest.fn(),
    find: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
  const aiUsageRepo = { find: jest.fn(), createQueryBuilder: jest.fn() };
  const dataSource = {
    query: jest.fn<Promise<unknown>, [string, unknown[]?]>(),
  };
  const service = new AdminService(
    userRepo as unknown as Repository<User>,
    sessionRepo as unknown as Repository<Session>,
    auditLogRepo as unknown as Repository<AuditLog>,
    readingRepo as unknown as Repository<Reading>,
    aiUsageRepo as unknown as Repository<AiUsage>,
    dataSource as unknown as DataSource,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates dashboard reading totals without hydrating readings', async () => {
    userRepo.count.mockResolvedValue(12);
    sessionRepo.count.mockResolvedValue(5);
    auditLogRepo.count.mockResolvedValue(3);

    const aiUsageQuery = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        totalAiQuestions: '23',
        todayAiQuestions: '5',
      }),
    };
    aiUsageRepo.createQueryBuilder.mockReturnValue(aiUsageQuery);

    const readingQuery = {
      select: jest.fn<unknown, [string | string[], string?]>().mockReturnThis(),
      addSelect: jest.fn<unknown, [string, string?]>().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        totalReadings: '17',
        totalIchingReadings: '4',
        totalTarotReadings: '6',
        totalTuviReadings: '2',
      }),
    };
    readingRepo.createQueryBuilder.mockReturnValue(readingQuery);

    await expect(service.getDashboardStats()).resolves.toEqual({
      totalUsers: 12,
      activeSessions: 5,
      totalReadings: 17,
      totalIchingReadings: 4,
      totalTarotReadings: 6,
      totalTuviReadings: 2,
      totalAiQuestions: 23,
      todayLogins: 3,
      todayAiQuestions: 5,
    });

    expect(readingRepo.createQueryBuilder).toHaveBeenCalledWith('reading');
    expect(readingQuery.select).toHaveBeenCalledWith(
      'COUNT(*)',
      'totalReadings',
    );
    expect(readingQuery.addSelect).toHaveBeenCalledTimes(3);
    expect(
      readingQuery.addSelect.mock.calls.map(([expression]) => expression),
    ).toEqual([
      `COUNT(*) FILTER (WHERE LOWER(reading.app) = 'iching')`,
      `COUNT(*) FILTER (WHERE LOWER(reading.app) = 'tarot')`,
      `COUNT(*) FILTER (WHERE LOWER(reading.app) LIKE '%tuvi%')`,
    ]);
    expect(readingQuery.getRawOne).toHaveBeenCalledTimes(1);
    expect(readingRepo.find).not.toHaveBeenCalled();
    expect(readingRepo.count).not.toHaveBeenCalled();
    expect(aiUsageRepo.createQueryBuilder).toHaveBeenCalledWith('usage');
    expect(aiUsageQuery.select).toHaveBeenCalledWith(
      'COALESCE(SUM(usage.monthlyCount), 0)',
      'totalAiQuestions',
    );
    expect(aiUsageQuery.addSelect).toHaveBeenCalledWith(
      'COALESCE(SUM(CASE WHEN usage.date = :today THEN usage.dailyCount ELSE 0 END), 0)',
      'todayAiQuestions',
    );
    expect(aiUsageQuery.setParameter).toHaveBeenCalledWith(
      'today',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(aiUsageQuery.getRawOne).toHaveBeenCalledTimes(1);
    expect(aiUsageRepo.find).not.toHaveBeenCalled();
  });

  it('selects only returned user fields and aggregates sessions for the page', async () => {
    const createdAt = new Date('2026-10-20T10:00:00.000Z');
    const user = {
      id: 'user-1',
      email: 'member@example.test',
      username: 'member',
      displayName: 'Member',
      role: 'user',
      planName: 'free',
      isVerified: true,
      createdAt,
    };
    const query = {
      select: jest.fn<unknown, [string | string[], string?]>().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[user], 1]),
    };
    userRepo.createQueryBuilder.mockReturnValue(query);
    dataSource.query
      .mockResolvedValueOnce([{ userId: 'user-1', count: 2 }])
      .mockResolvedValueOnce([{ userId: 'user-1', count: 3 }])
      .mockResolvedValueOnce([{ userId: 'user-1', count: 8 }]);

    await expect(service.getUsers(1, 20)).resolves.toEqual({
      users: [
        {
          ...user,
          activeSessionsCount: 2,
          readingsCount: 3,
          aiQuestionsCount: 8,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    expect(query.select.mock.calls[0][0]).toEqual([
      'user.id',
      'user.email',
      'user.username',
      'user.displayName',
      'user.role',
      'user.planName',
      'user.isVerified',
      'user.createdAt',
    ]);
    expect(query.select.mock.calls[0][0]).not.toContain('user.avatar');
    expect(query.addOrderBy).toHaveBeenCalledWith('user.id', 'ASC');
    expect(sessionRepo.find).not.toHaveBeenCalled();
    expect(dataSource.query).toHaveBeenCalledTimes(3);
    expect(dataSource.query.mock.calls[0][0]).toContain('FROM sessions');
    expect(dataSource.query.mock.calls[0][0]).toContain(
      'user_id = ANY($1::uuid[])',
    );
    expect(dataSource.query.mock.calls[0][0]).toContain('COUNT(*)::int');
    expect(dataSource.query.mock.calls[0][0]).toContain('expires_at > NOW()');
    expect(dataSource.query.mock.calls[0][1]).toEqual([['user-1']]);
  });

  it('applies the user creation date range before paginating', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    userRepo.createQueryBuilder.mockReturnValue(query);

    const result = await service.getUsers(
      2,
      10,
      '',
      '',
      '2026-10-01',
      '2026-10-10',
    );

    expect(query.andWhere).toHaveBeenCalledWith('user.createdAt >= :dateFrom', {
      dateFrom: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(query.andWhere).toHaveBeenCalledWith('user.createdAt < :dateTo', {
      dateTo: new Date('2026-10-11T00:00:00.000Z'),
    });
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(result).toMatchObject({ total: 0, page: 2, limit: 10 });
  });

  it('server-paginates AI usage and applies search and date filters in SQL', async () => {
    dataSource.query
      .mockResolvedValueOnce([
        {
          userId: 'user-1',
          email: 'member@example.test',
          displayName: 'Member',
          role: 'user',
          ichingReadings: '2',
          tarotReadings: '1',
          tuviReadings: '0',
          totalAiQuestions: '6',
          lastActive: new Date('2026-10-05T12:00:00Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          total: '1',
          totalIchingReadings: '2',
          totalTarotReadings: '1',
          totalTuviReadings: '0',
          totalAiQuestions: '6',
        },
      ]);

    const result = await service.getAiUsageStats(
      2,
      10,
      'member',
      '2026-10-01',
      '2026-10-10',
    );

    const [pageSql, pageParameters] = dataSource.query.mock.calls[0];
    expect(pageSql).toContain('LIMIT $6 OFFSET $7');
    expect(pageSql).toContain('usage.date >= $3::text');
    expect(pageSql).toContain('reading.created_at < $2::timestamptz');
    expect(pageSql).toContain(
      'ORDER BY "totalAiQuestions" DESC, email ASC, "userId" ASC',
    );
    expect(pageParameters).toEqual([
      '2026-10-01T00:00:00.000Z',
      '2026-10-11T00:00:00.000Z',
      '2026-10-01',
      '2026-10-11',
      '%member%',
      10,
      10,
    ]);
    expect(result).toMatchObject({
      total: 1,
      page: 2,
      limit: 10,
      totalPages: 1,
      userAiStats: [{ totalAiQuestions: 6, ichingReadings: 2 }],
    });
  });

  it('includes the last UTC usage day touched by an exclusive local timestamp bound', async () => {
    dataSource.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: 0 }]);

    await service.getAiUsageStats(
      1,
      20,
      '',
      '2026-10-10T00:00:00+07:00',
      '2026-10-11T00:00:00+07:00',
    );

    const queryCall = dataSource.query.mock.calls[0];
    if (!queryCall) throw new Error('Expected the usage query to run');
    const parameters = queryCall[1];
    if (!parameters) throw new Error('Expected query parameters');
    const [startTimestamp, endTimestamp, startDate, endDate] = parameters;
    expect(startTimestamp).toBe('2026-10-09T17:00:00.000Z');
    expect(endTimestamp).toBe('2026-10-10T17:00:00.000Z');
    expect(startDate).toBe('2026-10-09');
    expect(endDate).toBe('2026-10-11');
    if (typeof endDate !== 'string') {
      throw new Error('Expected end date to be a string');
    }
    expect('2026-10-10' < endDate).toBe(true);
  });

  it('aggregates analytics app distribution without loading reading rows', async () => {
    auditLogRepo.find.mockResolvedValue([]);
    const aiUsageQuery = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    aiUsageRepo.createQueryBuilder.mockReturnValue(aiUsageQuery);

    const readingQuery = {
      select: jest.fn<unknown, [string | string[], string?]>().mockReturnThis(),
      addSelect: jest.fn<unknown, [string, string?]>().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({
        ichingCount: '3',
        tarotCount: '2',
        tuviCount: '4',
      }),
    };
    readingRepo.createQueryBuilder.mockReturnValue(readingQuery);

    const result = await service.getAnalyticsData();

    expect(result.appDistribution).toEqual({ iching: 3, tarot: 2, tuvi: 4 });
    expect(result.timeSeries).toHaveLength(14);
    expect(result.topLocations).toEqual([]);
    expect(readingRepo.find).not.toHaveBeenCalled();
    expect(readingQuery.select).toHaveBeenCalledWith(
      `COUNT(*) FILTER (WHERE LOWER(reading.app) = 'iching')`,
      'ichingCount',
    );
    expect(readingQuery.addSelect).toHaveBeenNthCalledWith(
      1,
      `COUNT(*) FILTER (WHERE LOWER(reading.app) = 'tarot')`,
      'tarotCount',
    );
    expect(readingQuery.addSelect).toHaveBeenNthCalledWith(
      2,
      `COUNT(*) FILTER (WHERE LOWER(reading.app) LIKE '%tuvi%')`,
      'tuviCount',
    );
    expect(readingQuery.getRawOne).toHaveBeenCalledTimes(1);
  });
});

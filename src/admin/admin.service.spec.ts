import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';
import { User } from '../users/user.entity';
import { Session } from '../users/session.entity';
import { AuditLog } from '../users/audit-log.entity';

describe('AdminService role changes', () => {
  const user = { id: 'admin-1', email: 'admin@example.test', role: 'admin' };
  const userRepo = {
    findOne: jest.fn(),
    count: jest.fn(),
    save: jest.fn(),
  };
  const sessionRepo = { delete: jest.fn() };
  const auditRepo = { save: jest.fn() };
  const injectedAuditRepo = { createQueryBuilder: jest.fn() };
  const manager: any = {
    query: jest.fn(),
    getRepository: jest.fn((entity: unknown) => {
      if (entity === User) return userRepo;
      if (entity === Session) return sessionRepo;
      if (entity === AuditLog) return auditRepo;
      throw new Error('Unexpected repository');
    }),
  };
  const dataSource = {
    transaction: jest.fn((callback: (manager: any) => unknown) =>
      callback(manager),
    ),
    query: jest.fn(),
  };
  const service = new AdminService(
    {} as any,
    {} as any,
    injectedAuditRepo as any,
    {} as any,
    {} as any,
    dataSource as any,
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
    userRepo.save.mockImplementation(async (saved) => saved);

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
        metadata: expect.objectContaining({
          actorId: 'admin-1',
          targetUserId: 'member-1',
          previousRole: 'user',
          newRole: 'admin',
        }),
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

    expect(dataSource.query.mock.calls[0][0]).toContain('SUM("monthlyCount")');
    expect(dataSource.query.mock.calls[0][0]).not.toContain('r.data');
    expect(result.userAiStats[0].totalAiQuestions).toBe(6);
  });

  it('applies audit date filters alongside server pagination', async () => {
    const query = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
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
    expect(query.andWhere).toHaveBeenCalledWith(
      'log.createdAt >= :dateFrom',
      { dateFrom: new Date('2026-10-01T00:00:00.000Z') },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'log.createdAt < :dateTo',
      { dateTo: new Date('2026-11-01T00:00:00.000Z') },
    );
  });

  it('rejects an invalid audit date range', async () => {
    injectedAuditRepo.createQueryBuilder.mockReturnValue({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
    });
    await expect(
      service.getAuditLogs(1, 30, '', '', 'not-a-date'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

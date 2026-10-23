import { ForbiddenException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { PlansService } from './plans.service';
import { AiUsage } from './ai-usage.entity';
import { Plan } from './plan.entity';
import { UserSubscription } from './user-subscription.entity';
import { Coupon } from './coupon.entity';
import { User } from '../users/user.entity';

describe('PlansService quota transactions', () => {
  type UsageState = Pick<
    AiUsage,
    | 'userId'
    | 'app'
    | 'date'
    | 'month'
    | 'dailyCount'
    | 'monthlyCount'
    | 'bonusRemaining'
    | 'bonusUsedToday'
  >;
  type TransactionManagerStub = {
    query: jest.Mock;
    getRepository: jest.Mock;
  };
  let usage: UsageState;
  let insertQuery: {
    insert: jest.Mock;
    values: jest.Mock;
    orIgnore: jest.Mock;
    execute: jest.Mock;
  };
  let monthlyQuery: {
    select: jest.Mock;
    where: jest.Mock;
    getRawOne: jest.Mock;
  };
  let manager: TransactionManagerStub;
  let service: PlansService;
  const usageRepo = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn((value: UsageState) => Promise.resolve(value)),
  };
  const dataSource = {
    transaction: jest.fn(
      (callback: (manager: TransactionManagerStub) => unknown) =>
        callback(manager),
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    usage = {
      userId: 'user-1',
      app: 'ichingnow',
      date: new Date().toISOString().slice(0, 10),
      month: new Date().toISOString().slice(0, 7),
      dailyCount: 1,
      monthlyCount: 1,
      bonusRemaining: 2,
      bonusUsedToday: 0,
    };
    insertQuery = {
      insert: jest.fn(() => insertQuery),
      values: jest.fn(() => insertQuery),
      orIgnore: jest.fn(() => insertQuery),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    monthlyQuery = {
      select: jest.fn(() => monthlyQuery),
      where: jest.fn(() => monthlyQuery),
      getRawOne: jest.fn().mockResolvedValue({ total: '1' }),
    };
    usageRepo.createQueryBuilder
      .mockReturnValueOnce(insertQuery)
      .mockReturnValueOnce(monthlyQuery);
    usageRepo.findOne.mockResolvedValue(usage);
    manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn((entity: unknown) => {
        if (entity === AiUsage) return usageRepo;
        throw new Error('Unexpected repository');
      }),
    };
    service = new PlansService(
      {} as unknown as Repository<Plan>,
      {} as unknown as Repository<UserSubscription>,
      usageRepo as unknown as Repository<AiUsage>,
      {} as unknown as Repository<Coupon>,
      {} as unknown as Repository<User>,
      dataSource as unknown as DataSource,
    );
    jest.spyOn(service, 'getEffectivePlan').mockResolvedValue({
      name: 'premium',
      label: 'Premium',
      dailyLimit: 1,
      monthlyLimit: 30,
      canBonus: true,
      bonusAmount: 5,
      bonusMaxPerDay: 1,
      isActive: true,
      overrideFreeToLite: false,
      overrideFreeToPremium: false,
      price: 0,
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies Plan);
  });

  it('serializes quota consumption under the normalized app lock and records bonus use atomically', async () => {
    const reservation = await service.consumeQuota('user-1', 'iching');

    expect(reservation).toEqual(
      expect.objectContaining({ app: 'ichingnow', usedBonus: true }),
    );
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [expect.stringMatching(/^ai-quota:user-1:ichingnow:\d{4}-\d{2}$/)],
    );
    expect(usageRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        dailyCount: 2,
        monthlyCount: 2,
        bonusRemaining: 1,
      }),
    );
    expect(usageRepo.createQueryBuilder).toHaveBeenCalledTimes(2);
  });

  it('rejects exhausted quota with a stable code and does not increment usage', async () => {
    usage.dailyCount = 1;
    usage.bonusRemaining = 0;

    try {
      await service.consumeQuota('user-1', 'iching');
      throw new Error('Expected quota rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toEqual(
        expect.objectContaining({ code: 'QUOTA_EXCEEDED' }),
      );
    }
    expect(usageRepo.save).not.toHaveBeenCalled();
  });

  it('refunds a failed AI request under the same quota lock and restores used bonus', async () => {
    usage.dailyCount = 2;
    usage.monthlyCount = 2;
    usage.bonusRemaining = 1;
    usageRepo.createQueryBuilder.mockReset();
    usageRepo.findOne.mockResolvedValue(usage);
    const date = usage.date;

    await service.refundQuota('user-1', 'iching', date, true);

    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`ai-quota:user-1:ichingnow:${date.slice(0, 7)}`],
    );
    expect(usageRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        dailyCount: 1,
        monthlyCount: 1,
        bonusRemaining: 2,
      }),
    );
  });
});

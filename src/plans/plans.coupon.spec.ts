import { BadRequestException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import { PlansService } from './plans.service';
import { Plan } from './plan.entity';
import { AiUsage } from './ai-usage.entity';
import { Coupon } from './coupon.entity';
import { CouponRedemption } from './coupon-redemption.entity';
import { UserSubscription } from './user-subscription.entity';
import { User } from '../users/user.entity';

describe('PlansService coupon application', () => {
  const coupon = {
    id: 'coupon-1',
    code: 'SPRING',
    type: 'trial_days',
    durationDays: 7,
    maxUses: 10,
    usedCount: 3,
    isActive: true,
    expiresAt: null,
  };
  const couponRepo = { findOne: jest.fn(), save: jest.fn() };
  const redemptionRepo = {
    findOne: jest.fn(),
    insert: jest.fn(),
  };
  const subscriptionRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value: Partial<UserSubscription>) => value),
  };
  const userRepo = { findOne: jest.fn(), save: jest.fn() };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Coupon) return couponRepo;
      if (entity === CouponRedemption) return redemptionRepo;
      if (entity === UserSubscription) return subscriptionRepo;
      if (entity === User) return userRepo;
      throw new Error('Unexpected repository');
    }),
    query: jest.fn(),
  };
  const dataSource = {
    transaction: jest.fn((callback: (manager: typeof manager) => unknown) =>
      callback(manager),
    ),
  };
  const service = new PlansService(
    {} as unknown as Repository<Plan>,
    {} as unknown as Repository<UserSubscription>,
    {} as unknown as Repository<AiUsage>,
    couponRepo as unknown as Repository<Coupon>,
    userRepo as unknown as Repository<User>,
    dataSource as unknown as DataSource,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    couponRepo.findOne.mockResolvedValue({ ...coupon });
    redemptionRepo.findOne.mockResolvedValue(null);
    redemptionRepo.insert.mockResolvedValue(undefined);
    subscriptionRepo.findOne.mockResolvedValue(null);
    subscriptionRepo.save.mockImplementation((value: UserSubscription) =>
      Promise.resolve(value),
    );
    userRepo.findOne.mockResolvedValue({ id: 'user-1', planName: 'free' });
    manager.query.mockResolvedValue([{ usedCount: 4 }]);
  });

  it('locks the coupon row and rejects duplicate redemption before changing state', async () => {
    redemptionRepo.findOne.mockResolvedValue({
      couponId: 'coupon-1',
      userId: 'user-1',
    });
    await expect(
      service.applyCoupon('user-1', 'spring'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(couponRepo.findOne).toHaveBeenCalledWith({
      where: { code: 'SPRING', isActive: true },
      lock: { mode: 'pessimistic_write' },
    });
    expect(couponRepo.save).not.toHaveBeenCalled();
    expect(redemptionRepo.insert).not.toHaveBeenCalled();
    expect(subscriptionRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a coupon already redeemed by this user', async () => {
    redemptionRepo.findOne.mockResolvedValue({
      couponId: 'coupon-1',
      userId: 'user-1',
    });

    await expect(
      service.applyCoupon('user-1', 'spring'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(redemptionRepo.findOne).toHaveBeenCalledWith({
      where: { couponId: 'coupon-1', userId: 'user-1' },
    });
    expect(redemptionRepo.insert).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('creates a redemption and increments the use count atomically', async () => {
    const result = await service.applyCoupon('user-1', 'spring');

    expect(result).toEqual({
      message: 'Đã thêm 7 ngày vào gói của bạn!',
      planName: 'free',
    });
    expect(redemptionRepo.insert).toHaveBeenCalledWith({
      couponId: 'coupon-1',
      userId: 'user-1',
    });
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining(
        'AND ("maxUses" = -1 OR "usedCount" < "maxUses")',
      ),
      ['coupon-1'],
    );
    expect(subscriptionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        grantedByCoupon: 'SPRING',
      }),
    );
    expect(couponRepo.save).not.toHaveBeenCalled();
  });

  it('rejects when the atomic use-count update finds no remaining capacity', async () => {
    couponRepo.findOne.mockResolvedValue({ ...coupon, usedCount: 9 });
    manager.query.mockResolvedValue([]);

    await expect(
      service.applyCoupon('user-1', 'spring'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(redemptionRepo.insert).toHaveBeenCalledWith({
      couponId: 'coupon-1',
      userId: 'user-1',
    });
    expect(subscriptionRepo.save).not.toHaveBeenCalled();
  });

  it('translates a redemption uniqueness conflict into a rejected redemption', async () => {
    redemptionRepo.insert.mockRejectedValue({
      driverError: { code: '23505' },
    });

    await expect(
      service.applyCoupon('user-1', 'spring'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(manager.query).not.toHaveBeenCalled();
    expect(subscriptionRepo.save).not.toHaveBeenCalled();
  });
});

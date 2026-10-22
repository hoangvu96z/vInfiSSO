import { BadRequestException } from '@nestjs/common';
import { PlansService } from './plans.service';
import { Coupon } from './coupon.entity';
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
  const subscriptionRepo = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn((value) => value),
  };
  const userRepo = { findOne: jest.fn(), save: jest.fn() };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Coupon) return couponRepo;
      if (entity === UserSubscription) return subscriptionRepo;
      if (entity === User) return userRepo;
      throw new Error('Unexpected repository');
    }),
  };
  const dataSource = {
    transaction: jest.fn((callback: (manager: any) => unknown) =>
      callback(manager),
    ),
  };
  const service = new PlansService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    dataSource as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    couponRepo.findOne.mockResolvedValue({ ...coupon });
    subscriptionRepo.findOne.mockResolvedValue({ id: 'existing-subscription' });
  });

  it('locks the coupon row and rejects duplicate redemption before changing state', async () => {
    await expect(
      service.applyCoupon('user-1', 'spring'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(couponRepo.findOne).toHaveBeenCalledWith({
      where: { code: 'SPRING', isActive: true },
      lock: { mode: 'pessimistic_write' },
    });
    expect(couponRepo.save).not.toHaveBeenCalled();
    expect(subscriptionRepo.save).not.toHaveBeenCalled();
  });
});

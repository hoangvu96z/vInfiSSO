import type { Request } from 'express';
import type { PlansService } from '../plans/plans.service';
import type { User } from '../users/user.entity';
import type { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

describe('AdminController legacy and paginated listings', () => {
  const adminService = {
    getAiUsageStats: jest.fn(),
    updateUserRole: jest.fn(),
  };
  const plansService = {
    getAllCoupons: jest.fn(),
    getCoupons: jest.fn(),
  };
  const controller = new AdminController(
    adminService as unknown as AdminService,
    plansService as unknown as PlansService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('forwards the acting admin id and request metadata when updating a user role', async () => {
    adminService.updateUserRole.mockResolvedValue({
      success: true,
      user: { id: 'target-1', email: 'target@example.test', role: 'vip' },
    });

    const result = await controller.updateRole(
      'target-1',
      { role: 'vip' },
      { id: 'admin-1' } as User,
      {
        ip: '203.0.113.10',
        headers: { 'user-agent': 'admin-browser/1.0' },
      } as unknown as Request,
    );

    expect(adminService.updateUserRole).toHaveBeenCalledWith(
      'target-1',
      'vip',
      'admin-1',
      '203.0.113.10',
      'admin-browser/1.0',
    );
    expect(result).toEqual({
      success: true,
      user: { id: 'target-1', email: 'target@example.test', role: 'vip' },
    });
  });

  it('keeps the legacy AI route unpaginated while providing an explicit page route', async () => {
    adminService.getAiUsageStats
      .mockResolvedValueOnce({ userAiStats: [{ userId: 'legacy-user' }] })
      .mockResolvedValueOnce({ userAiStats: [{ userId: 'page-user' }] });

    await controller.getAiUsage();
    await controller.getAiUsagePage(
      2,
      10,
      'member',
      '2026-10-01',
      '2026-10-31',
    );

    expect(adminService.getAiUsageStats).toHaveBeenNthCalledWith(1);
    expect(adminService.getAiUsageStats).toHaveBeenNthCalledWith(
      2,
      2,
      10,
      'member',
      '2026-10-01',
      '2026-10-31',
    );
  });

  it('keeps the legacy full coupon response and exposes a separate paginated route', async () => {
    const coupons = [{ id: 'legacy-coupon' }];
    plansService.getAllCoupons.mockResolvedValue(coupons);
    plansService.getCoupons.mockResolvedValue({
      coupons: [{ id: 'page-coupon' }],
    });

    await expect(controller.getCoupons()).resolves.toEqual({ coupons });
    await controller.getCouponsPage(
      3,
      25,
      'spring',
      '2026-10-01',
      '2026-10-31',
    );

    expect(plansService.getCoupons).toHaveBeenCalledWith(
      3,
      25,
      'spring',
      '2026-10-01',
      '2026-10-31',
    );
  });
});

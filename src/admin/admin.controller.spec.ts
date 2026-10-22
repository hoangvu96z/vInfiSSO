import { AdminController } from './admin.controller';

describe('AdminController legacy and paginated listings', () => {
  const adminService = {
    getAiUsageStats: jest.fn(),
  };
  const plansService = {
    getAllCoupons: jest.fn(),
    getCoupons: jest.fn(),
  };
  const controller = new AdminController(adminService as any, plansService as any);

  beforeEach(() => jest.clearAllMocks());

  it('keeps the legacy AI route unpaginated while providing an explicit page route', async () => {
    adminService.getAiUsageStats
      .mockResolvedValueOnce({ userAiStats: [{ userId: 'legacy-user' }] })
      .mockResolvedValueOnce({ userAiStats: [{ userId: 'page-user' }] });

    await controller.getAiUsage();
    await controller.getAiUsagePage(2, 10, 'member', '2026-10-01', '2026-10-31');

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
    plansService.getCoupons.mockResolvedValue({ coupons: [{ id: 'page-coupon' }] });

    await expect(controller.getCoupons()).resolves.toEqual({ coupons });
    await controller.getCouponsPage(3, 25, 'spring', '2026-10-01', '2026-10-31');

    expect(plansService.getCoupons).toHaveBeenCalledWith(
      3,
      25,
      'spring',
      '2026-10-01',
      '2026-10-31',
    );
  });
});

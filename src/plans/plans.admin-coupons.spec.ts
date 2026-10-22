import { BadRequestException } from '@nestjs/common';
import { PlansService } from './plans.service';

describe('PlansService admin coupon listing', () => {
  const query = {
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    andWhere: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getManyAndCount: jest.fn(),
  };
  const couponRepo = { createQueryBuilder: jest.fn() };

  const chainMethods = [
    query.orderBy,
    query.addOrderBy,
    query.andWhere,
    query.skip,
    query.take,
  ];
  for (const method of chainMethods) {
    method.mockReturnValue(query);
  }

  const service = new PlansService(
    {} as any,
    {} as any,
    {} as any,
    couponRepo as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    for (const method of chainMethods) {
      method.mockReturnValue(query);
    }
    couponRepo.createQueryBuilder.mockReturnValue(query);
    query.getManyAndCount.mockResolvedValue([[{ id: 'coupon-1' }], 21]);
  });

  it('filters coupons by search and creation dates before server pagination', async () => {
    const result = await service.getCoupons(
      2,
      10,
      'spring',
      '2026-10-01',
      '2026-10-31',
    );

    expect(query.andWhere).toHaveBeenCalledWith(
      '(coupon.code ILIKE :search OR coupon.description ILIKE :search OR coupon.planName ILIKE :search)',
      { search: '%spring%' },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'coupon.createdAt >= :dateFrom',
      { dateFrom: new Date('2026-10-01T00:00:00.000Z') },
    );
    expect(query.andWhere).toHaveBeenCalledWith(
      'coupon.createdAt < :dateTo',
      { dateTo: new Date('2026-11-01T00:00:00.000Z') },
    );
    expect(query.skip).toHaveBeenCalledWith(10);
    expect(query.take).toHaveBeenCalledWith(10);
    expect(query.addOrderBy).toHaveBeenCalledWith('coupon.id', 'ASC');
    expect(result).toEqual({
      coupons: [{ id: 'coupon-1' }],
      total: 21,
      page: 2,
      limit: 10,
      totalPages: 3,
    });
  });

  it('rejects invalid date filters', async () => {
    await expect(service.getCoupons(1, 20, '', 'not-a-date')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(couponRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});

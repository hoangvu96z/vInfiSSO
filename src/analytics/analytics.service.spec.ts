import { AnalyticsService } from './analytics.service';
import type { Repository } from 'typeorm';
import type { PageVisit } from './page-visit.entity';

describe('AnalyticsService traffic log filters', () => {
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('filters paginated traffic logs by the selected day range', async () => {
    jest.useFakeTimers();
    const query = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    };
    const service = new AnalyticsService(
      repository as unknown as Repository<PageVisit>,
    );

    const result = await service.getTrafficLogs(2, 20, 'all', 'visitor', 7);

    expect(query.skip).toHaveBeenCalledWith(20);
    expect(query.take).toHaveBeenCalledWith(20);
    expect(query.andWhere).toHaveBeenCalledWith(
      'v.createdAt >= :since',
      expect.objectContaining({ since: expect.any(Date) }),
    );
    expect(result).toMatchObject({ page: 2, limit: 20, days: 7, total: 0 });
  });
});

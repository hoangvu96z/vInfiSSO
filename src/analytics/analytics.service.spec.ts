import { AnalyticsService, extractClientIp } from './analytics.service';
import type { Repository } from 'typeorm';
import type { PageVisit } from './page-visit.entity';
import type { Request } from 'express';

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

describe('extractClientIp', () => {
  it('uses Express resolved IP instead of client supplied forwarding headers', () => {
    const request = {
      ip: '198.51.100.24',
      headers: {
        'x-forwarded-for': '203.0.113.9',
        'x-real-ip': '203.0.113.10',
      },
      socket: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    expect(extractClientIp(request)).toBe('198.51.100.24');
  });

  it('falls back to the socket address and normalizes IPv4 mapped IPv6', () => {
    const request = {
      ip: '',
      headers: {
        'x-forwarded-for': '203.0.113.9',
        'x-real-ip': '203.0.113.10',
      },
      socket: { remoteAddress: '::ffff:192.0.2.15' },
    } as unknown as Request;

    expect(extractClientIp(request)).toBe('192.0.2.15');
  });
});

import { BadRequestException } from '@nestjs/common';
import { parseAdminDateRange } from './admin-date-range.util';

describe('parseAdminDateRange', () => {
  it('treats date-only end values as inclusive calendar dates', () => {
    expect(parseAdminDateRange('2026-10-01', '2026-10-02')).toEqual({
      start: new Date('2026-10-01T00:00:00.000Z'),
      end: new Date('2026-10-03T00:00:00.000Z'),
    });

    const { end } = parseAdminDateRange('2026-10-31', '2026-10-31');
    expect(new Date('2026-10-31T23:59:59.999Z') < end!).toBe(true);
  });

  it('keeps ISO timestamp bounds exact', () => {
    expect(
      parseAdminDateRange(
        '2026-10-01T00:00:00+07:00',
        '2026-10-02T00:00:00+07:00',
      ),
    ).toEqual({
      start: new Date('2026-09-30T17:00:00.000Z'),
      end: new Date('2026-10-01T17:00:00.000Z'),
    });
  });

  it('rejects invalid calendar dates and reversed ranges', () => {
    expect(() => parseAdminDateRange('2026-02-30')).toThrow(
      BadRequestException,
    );
    expect(() => parseAdminDateRange('2026-10-03', '2026-10-02')).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseAdminDateRange('2026-10-03', '2026-10-02T23:59:59Z'),
    ).toThrow(BadRequestException);
  });
});

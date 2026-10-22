import { BadRequestException } from '@nestjs/common';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string): Date {
  const date = DATE_ONLY_PATTERN.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Invalid admin date range');
  }

  if (
    DATE_ONLY_PATTERN.test(value) &&
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Invalid admin date range');
  }

  return date;
}

export function parseAdminDateRange(dateFrom?: string, dateTo?: string) {
  const dateOnlyEnd = !!dateTo && DATE_ONLY_PATTERN.test(dateTo);
  const start = dateFrom ? parseDate(dateFrom) : undefined;
  const parsedEnd = dateTo ? parseDate(dateTo) : undefined;
  const end = parsedEnd ? new Date(parsedEnd) : undefined;

  if (end && dateOnlyEnd) {
    end.setUTCDate(end.getUTCDate() + 1);
  }

  if (
    start &&
    parsedEnd &&
    (dateOnlyEnd ? start >= end! : start > parsedEnd)
  ) {
    throw new BadRequestException('Invalid admin date range');
  }

  return { start, end };
}

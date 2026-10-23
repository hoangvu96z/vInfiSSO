import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const JOURNAL_TAGS = [
  'career',
  'love',
  'health',
  'family',
  'finance',
  'personal',
  'growth',
  'other',
] as const;

export type JournalTag = (typeof JOURNAL_TAGS)[number];

export class CreateJournalEntryDto {
  @IsUUID()
  readingId: string;

  @IsString()
  @MaxLength(2000)
  reflection: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(JOURNAL_TAGS, { each: true })
  tags?: JournalTag[];
}

export class UpdateJournalEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reflection?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(JOURNAL_TAGS, { each: true })
  tags?: JournalTag[];
}

export class JournalListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  to?: string;

  @IsOptional()
  @IsIn(JOURNAL_TAGS)
  tag?: JournalTag;

  @IsOptional()
  @IsIn(['iching', 'tarot', 'tuvi', 'tuvi-hop-hon'])
  app?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class JournalReadingsQueryDto {
  @IsOptional()
  @IsIn(['iching', 'tarot', 'tuvi', 'tuvi-hop-hon'])
  app?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

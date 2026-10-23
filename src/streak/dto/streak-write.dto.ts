import {
  Allow,
  IsBoolean,
  IsDefined,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class StreakSnapshotDto {
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  currentStreak: number;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  longestStreak: number;

  @IsInt()
  @Min(0)
  @Max(2_000_000_000)
  totalReadings: number;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  lastActiveDate?: string | null;

  @IsBoolean()
  streakFreezeUsed: boolean;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dailyCardDate?: string | null;

  @IsOptional()
  @Allow()
  dailyCardId?: string | number | null;
}

export class UpsertStreakDto extends StreakSnapshotDto {
  @IsUUID()
  ownerId: string;
}

export class RecordStreakActivityDto {
  @IsUUID()
  ownerId: string;

  @IsUUID()
  eventId: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  activityDate: string;

  @ValidateNested()
  @IsDefined()
  @Type(() => StreakSnapshotDto)
  snapshot: StreakSnapshotDto;
}

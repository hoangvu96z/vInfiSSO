import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Plan } from '../../plans/plan.entity';
import type { Coupon } from '../../plans/coupon.entity';

export class UpdateUserRoleDto {
  @IsIn(['user', 'admin', 'vip', 'editor'])
  role: string;
}

export class UpdateUserStatusDto {
  @IsBoolean()
  isVerified: boolean;
}

export class BatchUserIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  userIds: string[];
}

export class BatchIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids: string[];
}

export class UpdatePlanDto implements Partial<Plan> {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(-1)
  dailyLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(-1)
  monthlyLimit?: number;

  @IsOptional()
  @IsBoolean()
  canBonus?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  bonusAmount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bonusMaxPerDay?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  overrideFreeToLite?: boolean;

  @IsOptional()
  @IsBoolean()
  overrideFreeToPremium?: boolean;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 0 })
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class CreateCouponDto implements Partial<Coupon> {
  @IsString()
  @MaxLength(100)
  code: string;

  @IsString()
  @MaxLength(255)
  description: string;

  @IsIn(['grant_plan', 'trial_days', 'discount_percent'])
  type: Coupon['type'];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  planName?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(-1)
  maxUses?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date | null;
}

export class UpdateCouponDto implements Partial<Coupon> {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsIn(['grant_plan', 'trial_days', 'discount_percent'])
  type?: Coupon['type'];

  @IsOptional()
  @IsString()
  @MaxLength(50)
  planName?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  discountPercent?: number;

  @IsOptional()
  @IsInt()
  @Min(-1)
  maxUses?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date | null;
}

export class GrantPlanDto {
  @IsIn(['free', 'lite', 'premium'])
  planName: string;

  @IsInt()
  @Min(0)
  @Max(36500)
  durationDays: number;
}

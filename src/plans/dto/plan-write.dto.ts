import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const APP_NAMES = [
  'iching',
  'ichingnow',
  'tarot',
  'tarotnow',
  'tuvi',
  'tuvinow',
] as const;

export class AppQuotaDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  app?: string;
}

export class ApplyCouponDto {
  @IsString()
  @MaxLength(100)
  code: string;
}

export class AiMessageDto {
  @IsIn(['system', 'user', 'assistant'])
  role: string;

  @IsString()
  @MaxLength(60000)
  content: string;
}

export class PlansAiDto {
  @IsIn(APP_NAMES)
  app: string;

  @IsString()
  @MaxLength(120)
  model: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => AiMessageDto)
  messages: AiMessageDto[];

  @Equals(true)
  stream: true;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8192)
  max_tokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;
}

export class TuviAiDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  model?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => AiMessageDto)
  messages: AiMessageDto[];
}

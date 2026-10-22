import {
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  IsBoolean,
  IsUrl,
  ValidateIf,
} from 'class-validator';

export class RecordVisitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  app: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  path?: string;

  @ValidateIf(
    (_object, value) => value !== undefined && value !== null && value !== '',
  )
  @IsString()
  @MaxLength(500)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  referrer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  screen?: string;

  @IsOptional()
  @IsBoolean()
  isMobile?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  userId?: string;
}

import { IsString, IsNotEmpty, IsOptional, MaxLength, IsBoolean } from 'class-validator';

export class RecordVisitDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  app: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  path?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
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
